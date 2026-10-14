import { onRequestGet as importHistory } from '../functions/api/imports/history';
import { DurableObject } from 'cloudflare:workers';
import { jsonResponse,readSession,type CloudflareEnv } from '../cloudflare/auth';
import { onRequestGet,onRequestPost } from '../cloudflare/stateEngine';
import { sealSnapshot,verifySnapshot,type StateBackup } from '../cloudflare/stateBackup';
import type { CloudState } from '../cloudflare/syncState';
import type { StateMeta,OperationReceipt,TransactionStore,StatePatch } from '../cloudflare/transactionStore';
interface Env extends CloudflareEnv {STORAGE_MAINTENANCE_TOKEN?:string;CHALAK_BACKUPS?:R2Bucket}
const CHANGE_LOG_KEEP=1000,AUTHORITY_NAME='chalak-authoritative-state-v1',BACKUP_PREFIX='backups/',BACKUP_KEEP=30,METRIC_DAYS=60;
const isoDay=(offsetDays=0)=>new Date(Date.now()+offsetDays*86400000).toISOString().slice(0,10);
const chunks=(text:string)=>{const result:string[]=[];for(let i=0;i<text.length;){let end=Math.min(i+64000,text.length);if(end<text.length&&text.charCodeAt(end-1)>=0xD800&&text.charCodeAt(end-1)<=0xDBFF)end--;result.push(text.slice(i,end));i=end;}return result.length?result:[''];};
function patchable(value:unknown):value is Array<{id:string}> {return Array.isArray(value)&&value.every(row=>row&&typeof row==='object'&&typeof row.id==='string')&&new Set(value.map(r=>r.id)).size===value.length;}
export class ChalakState extends DurableObject<Env> implements TransactionStore {
 private cache:CloudState|undefined;
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS control(id INTEGER PRIMARY KEY CHECK(id=1),initialized INTEGER NOT NULL,mode TEXT NOT NULL,meta TEXT NOT NULL,migration_hash TEXT);INSERT OR IGNORE INTO control VALUES(1,0,'frozen','{"revision":0,"updatedAt":""}',NULL);CREATE TABLE IF NOT EXISTS collections(key TEXT PRIMARY KEY,kind TEXT NOT NULL);CREATE TABLE IF NOT EXISTS state_rows(collection TEXT NOT NULL,identity TEXT NOT NULL,ordinal INTEGER NOT NULL,part INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(collection,identity,part));CREATE INDEX IF NOT EXISTS state_order ON state_rows(collection,ordinal,part);CREATE TABLE IF NOT EXISTS receipts(operation_id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS metrics(day TEXT NOT NULL,name TEXT NOT NULL,n INTEGER NOT NULL,PRIMARY KEY(day,name));CREATE TABLE IF NOT EXISTS change_log(revision INTEGER NOT NULL,collection TEXT NOT NULL,identity TEXT NOT NULL);CREATE INDEX IF NOT EXISTS change_log_rev ON change_log(revision);CREATE TABLE IF NOT EXISTS log_floor(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);INSERT OR IGNORE INTO log_floor SELECT 1,COALESCE(json_extract(meta,'$.revision'),0) FROM control WHERE id=1;CREATE TABLE IF NOT EXISTS backup_log(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER,sha256 TEXT,bytes INTEGER,detail TEXT);`);}
 // Observability counters never affect a request: any failure here is swallowed.
 private bump(name:string){try{const sql=this.ctx.storage.sql;sql.exec('INSERT INTO metrics(day,name,n) VALUES(?,?,1) ON CONFLICT(day,name) DO UPDATE SET n=n+1',isoDay(),name);sql.exec('DELETE FROM metrics WHERE day<?',isoDay(-METRIC_DAYS));}catch{}}
 private logBackup(kind:string,status:string,revision:number|null,sha256:string|null,bytes:number|null,detail:string){try{this.ctx.storage.sql.exec('INSERT INTO backup_log(at,kind,status,revision,sha256,bytes,detail) VALUES(?,?,?,?,?,?,?)',new Date().toISOString(),kind,status,revision,sha256,bytes,detail.slice(0,300));this.ctx.storage.sql.exec('DELETE FROM backup_log WHERE id NOT IN (SELECT id FROM backup_log ORDER BY id DESC LIMIT 200)');}catch{}}
 private makeSnapshot(){
  const receipts=this.ctx.storage.sql.exec<{value:string}>('SELECT value FROM receipts ORDER BY operation_id').toArray().map(r=>JSON.parse(r.value));
  return sealSnapshot({...this.load(),__operation_receipts:receipts},JSON.parse(this.control().meta) as StateMeta);
 }
 private health(){
  const c=this.control(),sql=this.ctx.storage.sql,meta=JSON.parse(c.meta) as StateMeta;
  const collections=sql.exec<{collection:string;records:number;approxBytes:number}>('SELECT collection,COUNT(DISTINCT identity) AS records,SUM(LENGTH(value)) AS approxBytes FROM state_rows GROUP BY collection ORDER BY approxBytes DESC').toArray();
  const metrics=sql.exec<{day:string;name:string;n:number}>('SELECT day,name,n FROM metrics WHERE day>=? ORDER BY day DESC',isoDay(-6)).toArray();
  const backups=sql.exec<{at:string;kind:string;status:string;revision:number|null;sha256:string|null;bytes:number|null;detail:string}>('SELECT at,kind,status,revision,sha256,bytes,detail FROM backup_log ORDER BY id DESC LIMIT 12').toArray();
  const lastOk=backups.find(b=>b.status==='ok'&&b.kind==='scheduled')||null;
  return {version:'8.1.0',storage:'sqlite-durable-object',mode:c.mode,initialized:!!c.initialized,revision:meta.revision,updatedAt:meta.updatedAt,updatedBy:meta.updatedBy||null,
   receipts:sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM receipts').one().n,totalApproxBytes:collections.reduce((s,r)=>s+(r.approxBytes||0),0),collections,metrics,backups,lastScheduledBackup:lastOk,
   backupTarget:{r2Bound:!!this.env.CHALAK_BACKUPS,keep:BACKUP_KEEP,schedule:'daily 00:00 UTC'},now:new Date().toISOString()};
 }
 // Called by the Worker's scheduled() handler. Snapshot is taken inside the object's input gate (consistent),
 // the slow R2 upload happens outside it so users are not blocked.
 async runScheduledBackup():Promise<{status:string;detail:string}>{
  const done=(status:string,detail:string,revision:number|null=null,sha:string|null=null,bytes:number|null=null)=>{this.logBackup('scheduled',status,revision,sha,bytes,detail);return {status,detail};};
  try{
   const c=this.control();if(!c.initialized)return done('skipped','authority not initialized');
   if(!this.env.CHALAK_BACKUPS)return done('skipped','R2 bucket CHALAK_BACKUPS is not bound');
   const meta=JSON.parse(c.meta) as StateMeta;
   const last=this.ctx.storage.sql.exec<{revision:number|null}>("SELECT revision FROM backup_log WHERE kind='scheduled' AND status='ok' ORDER BY id DESC LIMIT 1").toArray()[0];
   if(last&&last.revision===meta.revision)return done('skipped','revision unchanged since last backup',meta.revision);
   const body=await this.ctx.blockConcurrencyWhile(async()=>{const snapshot=await this.makeSnapshot();return JSON.stringify(snapshot);});
   const snapshot=JSON.parse(body) as StateBackup,bytes=new TextEncoder().encode(body).byteLength;
   const key=BACKUP_PREFIX+'chalak-'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z')+'-r'+snapshot.meta.revision+'.json';
   await this.env.CHALAK_BACKUPS.put(key,body,{httpMetadata:{contentType:'application/json'},customMetadata:{sha256:snapshot.sha256,revision:String(snapshot.meta.revision)}});
   const head=await this.env.CHALAK_BACKUPS.head(key);
   if(!head||head.size!==bytes)return done('failed','upload verification failed',snapshot.meta.revision,snapshot.sha256,bytes);
   const listed=await this.env.CHALAK_BACKUPS.list({prefix:BACKUP_PREFIX});
   const old=listed.objects.map(o=>o.key).sort().slice(0,Math.max(0,listed.objects.length-BACKUP_KEEP));
   if(old.length)await this.env.CHALAK_BACKUPS.delete(old);
   return done('ok',key,snapshot.meta.revision,snapshot.sha256,bytes);
  }catch(error){return done('failed',error instanceof Error?error.name+': '+error.message:'unknown error');}
 }
 private control(){return this.ctx.storage.sql.exec<{initialized:number;mode:string;meta:string;migration_hash:string|null}>('SELECT initialized,mode,meta,migration_hash FROM control WHERE id=1').one();}
 private load():CloudState {
  if(this.cache)return this.cache;
  const state:CloudState={};
  for(const {key,kind} of this.ctx.storage.sql.exec<{key:string;kind:string}>('SELECT key,kind FROM collections').toArray()){
   const rows=this.ctx.storage.sql.exec<{identity:string;value:string}>('SELECT identity,value FROM state_rows WHERE collection=? ORDER BY ordinal,part',key).toArray();
   const encoded=new Map<string,string>();for(const row of rows)encoded.set(row.identity,(encoded.get(row.identity)||'')+row.value);
   state[key]=kind==='array'||kind==='audit'?[...encoded.values()].map(value=>JSON.parse(value)):JSON.parse([...encoded.values()].join(''));
  }
  this.cache=state;return state;
 }
 read(){const c=this.control();if(!c.initialized)throw Error('Migration required');return {state:this.load(),meta:JSON.parse(c.meta) as StateMeta};}
 receipt(id:string){const rows=this.ctx.storage.sql.exec<{value:string}>('SELECT value FROM receipts WHERE operation_id=?',id).toArray();return rows.length?JSON.parse(rows[0].value) as OperationReceipt:undefined;}
 private writeRecord(key:string,id:string,ordinal:number,value:unknown,metrics:StatePatch['metrics']){
  const text=JSON.stringify(value);metrics.serializedRecords++;if(key==='pe_audit_logs')metrics.auditRecords++;if(key==='pe_evaluations')metrics.evaluationRecords++;
  this.ctx.storage.sql.exec('DELETE FROM state_rows WHERE collection=? AND identity=?',key,id);metrics.sqlWrites++;
  chunks(text).forEach((chunk,part)=>{this.ctx.storage.sql.exec('INSERT INTO state_rows(collection,identity,ordinal,part,value) VALUES(?,?,?,?,?)',key,id,ordinal,part,chunk);metrics.sqlWrites++;});
 }
 private persist(current:CloudState,next:CloudState,touched:Array<[string,string]>=[]):StatePatch{
  const ack:StatePatch={state:{},replacementKeys:[],deletedStateIds:{},metrics:{serializedRecords:0,auditRecords:0,evaluationRecords:0,sqlWrites:0}};
  for(const [key,value] of Object.entries(next)){
   if(key==='__operation_receipts'||value===current[key])continue;
   const old=current[key];
   if(key==='pe_audit_logs'){
    if(!Array.isArray(value)||old!==undefined&&!Array.isArray(old))throw Error('Invalid audit');
    const previous=(old||[]) as unknown[];const first=previous[0];const prefix=first===undefined?value.length:value.indexOf(first);
    if(prefix<0||value.length!==prefix+previous.length||previous.length>0&&value[value.length-1]!==previous[previous.length-1])throw Error('Audit history is append-only');
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO collections(key,kind) VALUES(?,?)',key,'audit');touched.push([key,'+']);
    const min=this.ctx.storage.sql.exec<{n:number|null}>('SELECT MIN(ordinal) AS n FROM state_rows WHERE collection=?',key).one().n??0;
    value.slice(0,prefix).forEach((row,i)=>this.writeRecord(key,crypto.randomUUID(),min-prefix+i,row,ack.metrics));continue;
   }
   if(patchable(value)&&(!old||patchable(old))){
    const before=(old||[]) as Array<{id:string}>;const beforeMap=new Map(before.map((v,i)=>[v.id,{v,i}]));const afterIds=new Set(value.map(v=>v.id));
    ack.state[key]=[];this.ctx.storage.sql.exec('INSERT OR REPLACE INTO collections(key,kind) VALUES(?,?)',key,'array');
    for(const row of before)if(!afterIds.has(row.id)){this.ctx.storage.sql.exec('DELETE FROM state_rows WHERE collection=? AND identity=?',key,row.id);(ack.deletedStateIds[key]||=[]).push(row.id);touched.push([key,row.id]);ack.metrics.sqlWrites++;}
    value.forEach((row,i)=>{const previous=beforeMap.get(row.id);if(row!==previous?.v){this.writeRecord(key,row.id,i,row,ack.metrics);(ack.state[key] as unknown[]).push(row);touched.push([key,row.id]);}else if(previous.i!==i){this.ctx.storage.sql.exec('UPDATE state_rows SET ordinal=? WHERE collection=? AND identity=?',i,key,row.id);ack.metrics.sqlWrites++;}});
   }else{
    this.ctx.storage.sql.exec('DELETE FROM state_rows WHERE collection=?',key);this.ctx.storage.sql.exec('INSERT OR REPLACE INTO collections(key,kind) VALUES(?,?)',key,'json');this.writeRecord(key,'json',0,value,ack.metrics);ack.state[key]=value;ack.replacementKeys.push(key);touched.push([key,'*']);
   }
  }
  return ack;
 }
 // Which records changed after `base`? Complete only inside the retained window and after the last migration/restore.
 changesSince(base:number):{complete:boolean;entries:Array<{collection:string;identity:string}>}{
  const sql=this.ctx.storage.sql,floor=sql.exec<{revision:number}>('SELECT revision FROM log_floor WHERE id=1').one().revision,revision=(JSON.parse(this.control().meta) as StateMeta).revision;
  if(!Number.isInteger(base)||base<floor||base>revision||revision-base>CHANGE_LOG_KEEP)return {complete:false,entries:[]};
  return {complete:true,entries:sql.exec<{collection:string;identity:string}>('SELECT collection,identity FROM change_log WHERE revision>? AND revision<=?',base,revision).toArray()};
 }
 commit(current:CloudState,next:CloudState,expectedRevision:number,meta:StateMeta,receipt:OperationReceipt):StatePatch {
  let result:StatePatch;
  this.ctx.storage.transactionSync(()=>{
   const c=this.control();if(c.mode!=='active'||!c.initialized||JSON.parse(c.meta).revision!==expectedRevision||meta.revision!==expectedRevision+1||receipt.acceptedRevision!==meta.revision||this.receipt(receipt.operationId))throw Error('Atomic precondition failed');
   const touched:Array<[string,string]>=[];result=this.persist(current,next,touched);
   for(const [collection,identity] of touched)this.ctx.storage.sql.exec('INSERT INTO change_log(revision,collection,identity) VALUES(?,?,?)',meta.revision,collection,identity);
   this.ctx.storage.sql.exec('DELETE FROM change_log WHERE revision<=?',meta.revision-CHANGE_LOG_KEEP);
   this.ctx.storage.sql.exec('INSERT INTO receipts(operation_id,value) VALUES(?,?)',receipt.operationId,JSON.stringify(receipt));
   this.ctx.storage.sql.exec('UPDATE control SET meta=? WHERE id=1',JSON.stringify(meta));
  });
  this.cache=next;return result!;
 }
 private async maintenance(request:Request){
  const supplied=request.headers.get('Authorization')||'';const secret=this.env.STORAGE_MAINTENANCE_TOKEN;
  if(!secret||secret.length<32||supplied!=='Bearer '+secret)return jsonResponse({error:'Operator authorization required'},403);
  if(request.method!=='POST')return jsonResponse({error:'POST required'},405);
  const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>30_000_000)return jsonResponse({error:'Backup too large'},413);
  const body=JSON.parse(raw) as {action:string;backup?:StateBackup;expectedRevision?:number;confirmSha256?:string};const c=this.control();
  if(body.action==='status')return jsonResponse({initialized:!!c.initialized,mode:c.mode,meta:JSON.parse(c.meta),migrationHash:c.migration_hash});
  if(body.action==='dry-run'||body.action==='migrate'){
   let backup:StateBackup;try{backup=await verifySnapshot(body.backup!);}catch{return jsonResponse({error:'Backup validation failed',code:'backup_invalid'},400);}
   if(body.action==='dry-run')return jsonResponse({valid:true,counts:backup.counts,revision:backup.meta.revision,sha256:backup.sha256});
   if(c.initialized)return c.migration_hash===backup.sha256?jsonResponse({migrated:true,replayed:true,revision:JSON.parse(c.meta).revision,sha256:backup.sha256}):jsonResponse({error:'Authority already initialized'},409);
   this.ctx.storage.transactionSync(()=>{
    if(this.control().initialized)throw Error('Migration race');
    const {__operation_receipts:receipts,...state}=backup.state;
    this.persist({},state);
    for(const receipt of (receipts||[]) as OperationReceipt[])this.ctx.storage.sql.exec('INSERT INTO receipts(operation_id,value) VALUES(?,?)',receipt.operationId,JSON.stringify(receipt));
    this.ctx.storage.sql.exec('DELETE FROM change_log');this.ctx.storage.sql.exec('INSERT OR REPLACE INTO log_floor(id,revision) VALUES(1,?)',backup.meta.revision);
    this.ctx.storage.sql.exec("UPDATE control SET initialized=1,mode='frozen',meta=?,migration_hash=? WHERE id=1",JSON.stringify(backup.meta),backup.sha256);
   });this.cache=undefined;return jsonResponse({migrated:true,revision:backup.meta.revision,sha256:backup.sha256,counts:backup.counts});
  }
  if(!c.initialized)return jsonResponse({error:'Migration required'},503);
  const meta=JSON.parse(c.meta) as StateMeta;
  if(body.action==='snapshot'){
   // Operator-only, read-only, consistent snapshot: needs no freeze and never blocks users.
   const snapshot=await this.makeSnapshot();this.logBackup('operator','ok',snapshot.meta.revision,snapshot.sha256,null,'snapshot via maintenance tool');this.bump('operator_snapshots');return jsonResponse(snapshot);
  }
  if(body.expectedRevision!==meta.revision)return jsonResponse({error:'Maintenance revision conflict',revision:meta.revision},409);
  if(body.action==='freeze'||body.action==='activate'){
   this.ctx.storage.transactionSync(()=>{if(JSON.parse(this.control().meta).revision!==body.expectedRevision)throw Error('Revision conflict');this.ctx.storage.sql.exec('UPDATE control SET mode=? WHERE id=1',body.action==='freeze'?'frozen':'active');});return jsonResponse({mode:body.action==='freeze'?'frozen':'active',revision:meta.revision});
  }
  if(body.action==='export'){
   if(c.mode!=='frozen')return jsonResponse({error:'Freeze all authoritative writes before export'},409);
   const receipts=this.ctx.storage.sql.exec<{value:string}>('SELECT value FROM receipts ORDER BY operation_id').toArray().map(r=>JSON.parse(r.value));
   return jsonResponse(await sealSnapshot({...this.load(),__operation_receipts:receipts},meta));
  }
  if(body.action==='restore'){
   // Operator-only, frozen-only, hash-confirmed replacement of the whole authoritative state from a sealed backup.
   if(c.mode!=='frozen')return jsonResponse({error:'Freeze all authoritative writes before restore'},409);
   let backup:StateBackup;try{backup=await verifySnapshot(body.backup!);}catch{return jsonResponse({error:'Backup validation failed',code:'backup_invalid'},400);}
   if(body.confirmSha256!==backup.sha256)return jsonResponse({error:'Restore confirmation hash does not match the backup',code:'confirmation_mismatch'},400);
   const nextRevision=Math.max(meta.revision,backup.meta.revision)+1;
   this.ctx.storage.transactionSync(()=>{
    if(JSON.parse(this.control().meta).revision!==body.expectedRevision)throw Error('Restore revision conflict');
    const sql=this.ctx.storage.sql;sql.exec('DELETE FROM state_rows');sql.exec('DELETE FROM collections');sql.exec('DELETE FROM receipts');
    const {__operation_receipts:receipts,...state}=backup.state;
    this.persist({},state);
    for(const receipt of (receipts||[]) as OperationReceipt[])sql.exec('INSERT INTO receipts(operation_id,value) VALUES(?,?)',receipt.operationId,JSON.stringify(receipt));
    sql.exec('DELETE FROM change_log');sql.exec('INSERT OR REPLACE INTO log_floor(id,revision) VALUES(1,?)',nextRevision);
    sql.exec("UPDATE control SET meta=?,migration_hash=? WHERE id=1",JSON.stringify({...backup.meta,revision:nextRevision,updatedAt:new Date().toISOString(),updatedBy:'restore'}),backup.sha256);
   });
   this.cache=undefined;this.logBackup('restore','ok',nextRevision,backup.sha256,null,'restored backup revision '+backup.meta.revision);this.bump('restores');
   return jsonResponse({restored:true,revision:nextRevision,sha256:backup.sha256,counts:backup.counts,mode:'frozen'});
  }
 }
 fetch(request:Request):Promise<Response>{
  // Cloudflare routes this one named object globally. Validation is held in its input gate;
  // SQLite transactionSync commits state rows, audit, meta and receipt atomically.
  return this.ctx.blockConcurrencyWhile(async()=>{
   try{
    const path=new URL(request.url).pathname;
    if(path==='/api/storage')return await this.maintenance(request);
    const c=this.control();
    if(path==='/internal/health')return jsonResponse({status:c.initialized&&c.mode==='active'?'ok':'maintenance',storage:'sqlite-durable-object',version:'8.1.0',revision:JSON.parse(c.meta).revision,initialized:!!c.initialized,mode:c.mode},c.initialized&&c.mode==='active'?200:503);
    if(!c.initialized)return jsonResponse({error:'مرجع تراکنشی هنوز مهاجرت و تأیید نشده است.',code:'migration_required',retryable:false},503);
    if(path==='/internal/identity'){const state=this.load();return jsonResponse({pe_employees:state.pe_employees||[],pe_locked_users:state.pe_locked_users||[]});}
    if(path!=='/api/state'&&path!=='/internal/import-history'&&path!=='/api/admin/health'&&path!=='/api/backup')return jsonResponse({error:'Not found'},404);
    const env={...this.env,TRANSACTION_STORE:this};const session=await readSession(request,env);
    if(!session)return jsonResponse({error:'Authentication required',code:'authentication_required',retryable:false},401);
    if(path==='/api/admin/health'||path==='/api/backup'){
     // Read-only operator views. Admin role is checked here, inside the authority, from the verified session.
     if(request.method!=='GET')return jsonResponse({error:'Method not allowed'},405);
     if(session.role!=='admin')return jsonResponse({error:'Admin role required',code:'admin_required',retryable:false},403);
     if(path==='/api/admin/health')return jsonResponse(this.health());
     const snapshot=await this.makeSnapshot(),body=JSON.stringify(snapshot);
     this.logBackup('download','ok',snapshot.meta.revision,snapshot.sha256,new TextEncoder().encode(body).byteLength,'by '+session.id);this.bump('backup_downloads');
     return new Response(body,{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Content-Disposition':'attachment; filename="chalak-backup-r'+snapshot.meta.revision+'.json"','X-Backup-Sha256':snapshot.sha256}});
    }
    if(request.method==='POST'&&c.mode!=='active'){this.bump('frozen_rejected');return jsonResponse({error:'ذخیره برای مهاجرت یا بازگشت موقتاً متوقف است؛ تغییرات حفظ شدند.',code:'authority_frozen',retryable:false},503);}
    const context={request,env,data:{session}};
    if(path==='/internal/import-history')return importHistory(context);
    const response = request.method==='GET'?await onRequestGet(context):request.method==='POST'?await onRequestPost(context):jsonResponse({error:'Method not allowed'},405);
    if(request.method==='POST'&&response.ok&&response.headers.get('X-Chalak-Rebased'))this.bump('rebased');
    if(request.method==='POST'){this.bump(response.ok?'commits':response.status===409?'conflicts':response.status>=500?'failures':'rejected');}
    if(request.method==='POST'&&response.ok)await this.ctx.storage.sync();
    return response;
   }catch(error){this.bump('failures');console.error(JSON.stringify({event:'authority_request_failed',type:error instanceof Error?error.name:'unknown'}));return jsonResponse({error:'درخواست مرجع تراکنشی ناموفق بود؛ ذخیره تأیید نشده است.',code:'transaction_request_failed',retryable:false},503);}
  });
 }
}
// The authority's public Worker URL is never a route into business/maintenance data.
export default {
 fetch(){return new Response('Not found',{status:404});},
 // Daily backup trigger (cron in worker/wrangler.jsonc). Does nothing unless the R2 binding CHALAK_BACKUPS exists.
 scheduled(_event:ScheduledController,env:Omit<Env,'CHALAK_STATE'>&{CHALAK_STATE:DurableObjectNamespace<ChalakState>},ctx:ExecutionContext){
  const stub=env.CHALAK_STATE.get(env.CHALAK_STATE.idFromName(AUTHORITY_NAME));
  ctx.waitUntil(stub.runScheduledBackup().then(()=>undefined,()=>undefined));
 }
};



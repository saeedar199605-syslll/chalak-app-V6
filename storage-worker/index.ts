import { onRequestGet as importHistory } from '../functions/api/imports/history';
import { DurableObject } from 'cloudflare:workers';
import { jsonResponse,readSession,type CloudflareEnv } from '../cloudflare/auth';
import { onRequestGet,onRequestPost } from '../cloudflare/stateEngine';
import { sealSnapshot,verifySnapshot,type StateBackup } from '../cloudflare/stateBackup';
import type { CloudState } from '../cloudflare/syncState';
import type { StateMeta,OperationReceipt,TransactionStore,StatePatch } from '../cloudflare/transactionStore';
interface Env extends CloudflareEnv {STORAGE_MAINTENANCE_TOKEN?:string}
const chunks=(text:string)=>{const result:string[]=[];for(let i=0;i<text.length;){let end=Math.min(i+64000,text.length);if(end<text.length&&text.charCodeAt(end-1)>=0xD800&&text.charCodeAt(end-1)<=0xDBFF)end--;result.push(text.slice(i,end));i=end;}return result.length?result:[''];};
function patchable(value:unknown):value is Array<{id:string}> {return Array.isArray(value)&&value.every(row=>row&&typeof row==='object'&&typeof row.id==='string')&&new Set(value.map(r=>r.id)).size===value.length;}
export class ChalakState extends DurableObject<Env> implements TransactionStore {
 private cache:CloudState|undefined;
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS control(id INTEGER PRIMARY KEY CHECK(id=1),initialized INTEGER NOT NULL,mode TEXT NOT NULL,meta TEXT NOT NULL,migration_hash TEXT);INSERT OR IGNORE INTO control VALUES(1,0,'frozen','{"revision":0,"updatedAt":""}',NULL);CREATE TABLE IF NOT EXISTS collections(key TEXT PRIMARY KEY,kind TEXT NOT NULL);CREATE TABLE IF NOT EXISTS state_rows(collection TEXT NOT NULL,identity TEXT NOT NULL,ordinal INTEGER NOT NULL,part INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(collection,identity,part));CREATE INDEX IF NOT EXISTS state_order ON state_rows(collection,ordinal,part);CREATE TABLE IF NOT EXISTS receipts(operation_id TEXT PRIMARY KEY,value TEXT NOT NULL);`);}
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
 private persist(current:CloudState,next:CloudState):StatePatch{
  const ack:StatePatch={state:{},replacementKeys:[],deletedStateIds:{},metrics:{serializedRecords:0,auditRecords:0,evaluationRecords:0,sqlWrites:0}};
  for(const [key,value] of Object.entries(next)){
   if(key==='__operation_receipts'||value===current[key])continue;
   const old=current[key];
   if(key==='pe_audit_logs'){
    if(!Array.isArray(value)||old!==undefined&&!Array.isArray(old))throw Error('Invalid audit');
    const previous=(old||[]) as unknown[];const first=previous[0];const prefix=first===undefined?value.length:value.indexOf(first);
    if(prefix<0||value.length!==prefix+previous.length||previous.length>0&&value[value.length-1]!==previous[previous.length-1])throw Error('Audit history is append-only');
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO collections(key,kind) VALUES(?,?)',key,'audit');
    const min=this.ctx.storage.sql.exec<{n:number|null}>('SELECT MIN(ordinal) AS n FROM state_rows WHERE collection=?',key).one().n??0;
    value.slice(0,prefix).forEach((row,i)=>this.writeRecord(key,crypto.randomUUID(),min-prefix+i,row,ack.metrics));continue;
   }
   if(patchable(value)&&(!old||patchable(old))){
    const before=(old||[]) as Array<{id:string}>;const beforeMap=new Map(before.map((v,i)=>[v.id,{v,i}]));const afterIds=new Set(value.map(v=>v.id));
    ack.state[key]=[];this.ctx.storage.sql.exec('INSERT OR REPLACE INTO collections(key,kind) VALUES(?,?)',key,'array');
    for(const row of before)if(!afterIds.has(row.id)){this.ctx.storage.sql.exec('DELETE FROM state_rows WHERE collection=? AND identity=?',key,row.id);(ack.deletedStateIds[key]||=[]).push(row.id);ack.metrics.sqlWrites++;}
    value.forEach((row,i)=>{const previous=beforeMap.get(row.id);if(row!==previous?.v){this.writeRecord(key,row.id,i,row,ack.metrics);(ack.state[key] as unknown[]).push(row);}else if(previous.i!==i){this.ctx.storage.sql.exec('UPDATE state_rows SET ordinal=? WHERE collection=? AND identity=?',i,key,row.id);ack.metrics.sqlWrites++;}});
   }else{
    this.ctx.storage.sql.exec('DELETE FROM state_rows WHERE collection=?',key);this.ctx.storage.sql.exec('INSERT OR REPLACE INTO collections(key,kind) VALUES(?,?)',key,'json');this.writeRecord(key,'json',0,value,ack.metrics);ack.state[key]=value;ack.replacementKeys.push(key);
   }
  }
  return ack;
 }
 commit(current:CloudState,next:CloudState,expectedRevision:number,meta:StateMeta,receipt:OperationReceipt):StatePatch {
  let result:StatePatch;
  this.ctx.storage.transactionSync(()=>{
   const c=this.control();if(c.mode!=='active'||!c.initialized||JSON.parse(c.meta).revision!==expectedRevision||meta.revision!==expectedRevision+1||receipt.acceptedRevision!==meta.revision||this.receipt(receipt.operationId))throw Error('Atomic precondition failed');
   result=this.persist(current,next);
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
  const body=JSON.parse(raw) as {action:string;backup?:StateBackup;expectedRevision?:number};const c=this.control();
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
    this.ctx.storage.sql.exec("UPDATE control SET initialized=1,mode='frozen',meta=?,migration_hash=? WHERE id=1",JSON.stringify(backup.meta),backup.sha256);
   });this.cache=undefined;return jsonResponse({migrated:true,revision:backup.meta.revision,sha256:backup.sha256,counts:backup.counts});
  }
  if(!c.initialized)return jsonResponse({error:'Migration required'},503);
  const meta=JSON.parse(c.meta) as StateMeta;
  if(body.expectedRevision!==meta.revision)return jsonResponse({error:'Maintenance revision conflict',revision:meta.revision},409);
  if(body.action==='freeze'||body.action==='activate'){
   this.ctx.storage.transactionSync(()=>{if(JSON.parse(this.control().meta).revision!==body.expectedRevision)throw Error('Revision conflict');this.ctx.storage.sql.exec('UPDATE control SET mode=? WHERE id=1',body.action==='freeze'?'frozen':'active');});return jsonResponse({mode:body.action==='freeze'?'frozen':'active',revision:meta.revision});
  }
  if(body.action==='export'){
   if(c.mode!=='frozen')return jsonResponse({error:'Freeze all authoritative writes before export'},409);
   const receipts=this.ctx.storage.sql.exec<{value:string}>('SELECT value FROM receipts ORDER BY operation_id').toArray().map(r=>JSON.parse(r.value));
   return jsonResponse(await sealSnapshot({...this.load(),__operation_receipts:receipts},meta));
  }
  return jsonResponse({error:'Unknown maintenance action'},400);
 }
 fetch(request:Request):Promise<Response>{
  // Cloudflare routes this one named object globally. Validation is held in its input gate;
  // SQLite transactionSync commits state rows, audit, meta and receipt atomically.
  return this.ctx.blockConcurrencyWhile(async()=>{
   try{
    const path=new URL(request.url).pathname;
    if(path==='/api/storage')return await this.maintenance(request);
    const c=this.control();
    if(path==='/internal/health')return jsonResponse({status:c.initialized&&c.mode==='active'?'ok':'maintenance',storage:'sqlite-durable-object',version:'7.0.0',revision:JSON.parse(c.meta).revision,initialized:!!c.initialized,mode:c.mode},c.initialized&&c.mode==='active'?200:503);
    if(!c.initialized)return jsonResponse({error:'مرجع تراکنشی هنوز مهاجرت و تأیید نشده است.',code:'migration_required',retryable:false},503);
    if(path==='/internal/identity'){const state=this.load();return jsonResponse({pe_employees:state.pe_employees||[],pe_locked_users:state.pe_locked_users||[]});}
    if(path!=='/api/state'&&path!=='/internal/import-history')return jsonResponse({error:'Not found'},404);
    const env={...this.env,TRANSACTION_STORE:this};const session=await readSession(request,env);
    if(!session)return jsonResponse({error:'Authentication required',code:'authentication_required',retryable:false},401);
    if(request.method==='POST'&&c.mode!=='active')return jsonResponse({error:'ذخیره برای مهاجرت یا بازگشت موقتاً متوقف است؛ تغییرات حفظ شدند.',code:'authority_frozen',retryable:false},503);
    const context={request,env,data:{session}};
    if(path==='/internal/import-history')return importHistory(context);
    const response = request.method==='GET'?await onRequestGet(context):request.method==='POST'?await onRequestPost(context):jsonResponse({error:'Method not allowed'},405);
    if(request.method==='POST'&&response.ok)await this.ctx.storage.sync();
    return response;
   }catch(error){console.error(JSON.stringify({event:'authority_request_failed',type:error instanceof Error?error.name:'unknown'}));return jsonResponse({error:'درخواست مرجع تراکنشی ناموفق بود؛ ذخیره تأیید نشده است.',code:'transaction_request_failed',retryable:false},503);}
  });
 }
}
// The authority's public Worker URL is never a route into business/maintenance data.
export default {fetch(){return new Response('Not found',{status:404});}};



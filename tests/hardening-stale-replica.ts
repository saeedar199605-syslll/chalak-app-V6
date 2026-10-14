import fs from 'node:fs';import assert from 'node:assert/strict';import {actorA,actorB,person} from './hardening-fixture';
const origin='http://127.0.0.1:8798',sessions=JSON.parse(fs.readFileSync('.qa-sessions-private.json','utf8'));
const cookie='chalak_session='+sessions[0].token;
async function get(key:string){const r=await fetch(origin+'/api/__qa_kv?key='+key,{headers:{Cookie:cookie}});assert.equal(r.status,200);return(await r.json() as any).value as string;}
async function put(key:string,value:string){const r=await fetch(origin+'/api/__qa_kv',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({key,value})});assert.equal(r.status,200);}
const snapshot={app_state:await get('app_state'),app_state_meta:await get('app_state_meta')};
const state=JSON.parse(snapshot.app_state),meta=JSON.parse(snapshot.app_state_meta),e=state.pe_employees.find((x:any)=>x.id===person.id);
// Two distinct module instances have independent instance-local queues, just as independent Workers do.
const handlerPath=new URL('../.state-handler-private.mjs',import.meta.url).href;
const handlerA=await import(handlerPath+'?workerA'),handlerB=await import(handlerPath+'?workerB');
const namespace={get:async(key:string)=>snapshot[key as keyof typeof snapshot]??null,put,delete:async()=>{throw new Error('Test must not delete data');}};
const response=await Promise.all([handlerA.onRequestPost({env:{CHALAK_DB:namespace},data:{session:sessions[0].session},request:new Request(origin+'/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:{pe_employees:[{...e,unit:'STALE-WRITER-A'}]},employeePatch:true,baseRevision:meta.revision,operationId:crypto.randomUUID()})})}),handlerB.onRequestPost({env:{CHALAK_DB:namespace},data:{session:sessions[1].session},request:new Request(origin+'/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:{pe_employees:[{...e,approvedJobTitle:'STALE-WRITER-B'}]},employeePatch:true,baseRevision:meta.revision,operationId:crypto.randomUUID()})})})]);
const bodies=await Promise.all(response.map(r=>r.json()));const final=JSON.parse(await get('app_state'));const actual=final.pe_employees.find((x:any)=>x.id===e.id);
const report={mode:'Deterministic stale-replica read injection; original handler, actual Pages/KV writes',http:response.map(r=>r.status),acceptedRevisions:bodies.map(b=>b.revision),baseRevision:meta.revision,writerAPersisted:actual.unit==='STALE-WRITER-A',writerBPersisted:actual.approvedJobTitle==='STALE-WRITER-B',sameAcceptedRevision:bodies[0].revision===bodies[1].revision};assert.deepEqual(report.http,[200,200]);assert(report.sameAcceptedRevision);assert(!(report.writerAPersisted&&report.writerBPersisted));
fs.writeFileSync('.replica-evidence-private.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));

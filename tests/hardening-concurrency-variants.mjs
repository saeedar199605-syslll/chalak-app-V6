import fs from 'node:fs';import assert from 'node:assert/strict';
const sessions=JSON.parse(fs.readFileSync('.qa-sessions-private.json','utf8'));const cookie='chalak_session='+sessions[0].token;const origin='http://127.0.0.1:8798';
async function get(key){const r=await fetch(origin+'/api/__qa_kv?key='+key,{headers:{Cookie:cookie}});assert.equal(r.status,200);return(await r.json()).value;}
async function put(key,value){const r=await fetch(origin+'/api/__qa_kv',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({key,value})});assert.equal(r.status,200);}
const reports=[];
for(const scenario of ['import_vs_manual_score','same_criterion']){
 const snapshot={app_state:await get('app_state'),app_state_meta:await get('app_state_meta')};const state=JSON.parse(snapshot.app_state),meta=JSON.parse(snapshot.app_state_meta);
 const handlerPath=new URL('../.state-handler-private.mjs',import.meta.url).href;const [A,B]=await Promise.all([import(handlerPath+'?'+scenario+'A'),import(handlerPath+'?'+scenario+'B')]);
 const namespace={get:async key=>snapshot[key]??null,put,delete:async()=>{throw Error('no deletion')}};
 const employee=state.pe_employees.find(e=>e.id==='qa-person'),evaluation=state.pe_evaluations.find(e=>e.id==='qa-eval');const op=crypto.randomUUID();
 const bodies=scenario==='import_vs_manual_score'?[{state:{pe_employees:[{...employee,unit:'IMPORT-QA61',personnelEffectiveDate:'1405/07/22'}]},employeePatch:true,sourceImport:{importType:'EMPLOYEE',operationId:op},operationId:op},{state:{pe_evaluations:[{...evaluation,scores:evaluation.scores.map((s,i)=>i===0?{...s,value:3}:s)}]},evaluationPatch:true,operationId:crypto.randomUUID()}]:[{state:{pe_criteria:state.pe_criteria.map((c,i)=>i===0?{...c,name:'CRITERION-A'}:c)},operationId:op},{state:{pe_criteria:state.pe_criteria.map((c,i)=>i===0?{...c,def:'CRITERION-B'}:c)},operationId:crypto.randomUUID()}];
 const responses=await Promise.all([A,B].map((handler,i)=>handler.onRequestPost({env:{CHALAK_DB:namespace},data:{session:sessions[i].session},request:new Request(origin+'/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...bodies[i],baseRevision:meta.revision})})})));
 const results=await Promise.all(responses.map(r=>r.json()));const final=JSON.parse(await get('app_state'));
 const survives=scenario==='import_vs_manual_score'?[final.pe_employees.find(e=>e.id==='qa-person').unit==='IMPORT-QA61',final.pe_evaluations.find(e=>e.id==='qa-eval').scores[0].value===3]:[final.pe_criteria[0].name==='CRITERION-A',final.pe_criteria[0].def==='CRITERION-B'];
 const report={scenario,mode:'Injected stale reads; final handler; actual isolated Pages/KV writes',http:responses.map(r=>r.status),revisions:results.map(r=>r.revision),bothChangesPersisted:survives.every(Boolean)};reports.push(report);assert.deepEqual(report.http,[200,200]);assert.equal(report.revisions[0],report.revisions[1]);assert(!report.bothChangesPersisted);
}
fs.writeFileSync('.concurrency-variants-private.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));

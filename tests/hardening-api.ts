import fs from 'node:fs';import assert from 'node:assert/strict';
import {SESSION_COOKIE} from '../cloudflare/auth';
import {actorA,actorB,person} from './hardening-fixture';
const secret=fs.readFileSync('.dev.vars','utf8').match(/ADMIN_PASSWORD="([^"\r\n]+)"/)[1];
const cookies=JSON.parse(fs.readFileSync('.qa-sessions-private.json','utf8')).map((s:any)=>SESSION_COOKIE+'='+s.token);
const originA='http://127.0.0.1:8798',originB='http://127.0.0.1:8799';
const measurements:any[]=[];
async function read(origin=originA,actor=0){const r=await fetch(origin+'/api/state',{headers:{Cookie:cookies[actor]}});assert.equal(r.status,200);return r.json() as Promise<any>;}
async function post(origin:string,state:any,revision:number,operationId:string,actor=0,extra:any={}){const body=JSON.stringify({state,baseRevision:revision,operationId,...extra});const start=performance.now();const r=await fetch(origin+'/api/state',{method:'POST',headers:{Cookie:cookies[actor],'Content-Type':'application/json'},body});const text=await r.text();measurements.push({status:r.status,bytes:body.length,responseBytes:text.length,elapsedMs:Math.round(performance.now()-start)});return{status:r.status,body:JSON.parse(text)};}
const initial=await read();const initialB=await read(originB,1);assert.equal(initialB.revision,initial.revision);
const old=initial.state.pe_employees.find((e:any)=>e.id===person.id);
const opA=crypto.randomUUID(),opB=crypto.randomUUID();
// Concurrent independent Worker processes, same real isolated KV namespace/persistence directory.
const race=await Promise.all([post(originA,{pe_employees:[{...old,unit:'Writer A'}]},initial.revision,opA,0,{employeePatch:true}),post(originB,{pe_employees:[{...old,approvedJobTitle:'Writer B'}]},initial.revision,opB,1,{employeePatch:true})]);
const afterA=await read(),afterB=await read(originB,1);
const observed=afterA.state.pe_employees.find((e:any)=>e.id===old.id);
const raceReport={http:race.map(r=>r.status),acceptedRevisions:race.map(r=>r.body.revision),finalRevision:afterA.revision,writerAValuePersisted:observed.unit==='Writer A',writerBValuePersisted:observed.approvedJobTitle==='Writer B',twoReadersAgree:JSON.stringify(afterA.state.pe_employees)===JSON.stringify(afterB.state.pe_employees)};
const report:any={independentWorkers:raceReport};
// Same-isolate conflict and operation replay safeguards (no reset of authoritative data).
let current=await read();const e=current.state.pe_employees.find((e:any)=>e.id===old.id);const op=crypto.randomUUID();const mutation={pe_employees:[{...e,shift:'LOCAL-A'}]};const a=await post(originA,mutation,current.revision,op,0,{employeePatch:true});assert.equal(a.status,200);
const duplicate=await post(originA,mutation,current.revision,op,0,{employeePatch:true});assert.equal(duplicate.status,200);const replay=await read();assert.equal(replay.revision,a.body.revision);
const conflict=await post(originA,{pe_employees:[{...e,shift:'LOCAL-B'}]},current.revision,crypto.randomUUID(),1,{employeePatch:true});assert.equal(conflict.status,409);
const denied=await post(originA,{pe_employees:[{...e,role:'admin'}]},replay.revision,crypto.randomUUID(),2,{employeePatch:true});assert.equal(denied.status,403);
const unauth=await fetch(originA+'/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:mutation,baseRevision:replay.revision,operationId:crypto.randomUUID(),employeePatch:true})});assert.equal(unauth.status,401);
const final=await read();assert.deepEqual(final.state.pe_evaluations,initial.state.pe_evaluations);assert.deepEqual(final.state.pe_archived_evaluations,initial.state.pe_archived_evaluations);
report.sameWorker={idempotentReplay:true,conflictHttp:409,unauthorizedHttp:403,unauthenticatedHttp:401,historicalPreserved:true};report.measurements=measurements;
fs.writeFileSync('.api-evidence-private.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));

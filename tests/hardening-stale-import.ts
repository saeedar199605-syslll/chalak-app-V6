import fs from 'node:fs';import assert from 'node:assert/strict';
const sessions=JSON.parse(fs.readFileSync('.qa-sessions-private.json','utf8')),cookie='chalak_session='+sessions[1].token,origin='http://127.0.0.1:8798';
async function read(){const r=await fetch(origin+'/api/state',{headers:{Cookie:cookie}});assert.equal(r.status,200);return r.json() as Promise<any>;}
async function save(employee:any,revision:number){const id=crypto.randomUUID();const r=await fetch(origin+'/api/state',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({state:{pe_employees:[employee]},employeePatch:true,baseRevision:revision,operationId:id,sourceImport:{importType:'EMPLOYEE',operationId:id}})});return{status:r.status,body:await r.json() as any};}
const current=await read(),person=current.state.pe_employees.find((e:any)=>e.id==='qa-person');
const result=await save({...person,unit:'OLDER-SOURCE',personnelEffectiveDate:'1405/06/01'},current.revision);const after=await read();
const report={http:result.status,overwroteCurrentData:after.state.pe_employees.find((e:any)=>e.id===person.id).unit==='OLDER-SOURCE'};if(result.status===200)await save(person,after.revision);
fs.writeFileSync(process.argv.includes('--before')?'.stale-import-before-private.json':'.stale-import-after-private.json',JSON.stringify(report));console.log(JSON.stringify(report));if(!process.argv.includes('--before')){assert.equal(result.status,403);assert(!report.overwroteCurrentData);}

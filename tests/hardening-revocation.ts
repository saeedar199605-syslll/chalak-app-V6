import fs from 'node:fs';import assert from 'node:assert/strict';
const sessions=JSON.parse(fs.readFileSync('.qa-sessions-private.json','utf8'));const origin='http://127.0.0.1:8798';const cookies=sessions.map((s:any)=>'chalak_session='+s.token);
async function read(actor:number){const r=await fetch(origin+'/api/state',{headers:{Cookie:cookies[actor]}});return{status:r.status,body:await r.json() as any};}
async function patch(actor:number,employee:any,revision:number){const r=await fetch(origin+'/api/state',{method:'POST',headers:{Cookie:cookies[actor],'Content-Type':'application/json'},body:JSON.stringify({state:{pe_employees:[employee]},employeePatch:true,baseRevision:revision,operationId:crypto.randomUUID()})});assert.equal(r.status,200);return r.json() as Promise<any>;}
const before=await read(1);assert.equal(before.status,200);const admin=before.body.state.pe_employees.find((e:any)=>e.id===sessions[0].session.id);const employee=before.body.state.pe_employees.find((e:any)=>e.id===sessions[2].session.id);
await patch(1,{...admin,role:'employee'},before.body.revision);const revoked=await read(0);
const secret=fs.readFileSync('.dev.vars','utf8').match(/ADMIN_PASSWORD="([^"\r\n]+)"/)[1];
const revokedLogin=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:secret})});
let current=await read(1);await patch(1,admin,current.body.revision);
current=await read(1);await patch(1,{...employee,employmentStatus:'inactive'},current.body.revision);const inactive=await read(2);current=await read(1);await patch(1,employee,current.body.revision);
const report={revokedAdminReadHttp:revoked.status,revokedAdminLoginHttp:revokedLogin.status,inactiveSessionReadHttp:inactive.status,restored:true};
fs.writeFileSync(process.argv.includes('--before')?'.revocation-before-private.json':'.revocation-after-private.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!process.argv.includes('--before')){assert.equal(revoked.status,401);assert.equal(inactive.status,401);assert.equal(revokedLogin.status,403);}

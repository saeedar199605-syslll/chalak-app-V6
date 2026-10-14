// Exactly the requested connected scenarios 1–3. Scenarios 4–5 use the real browser and the local fault proxy.
// Supply V6_BASELINE_FILE, V6_ROSTER_FILE, V6_ADMIN_PASSWORD; never package real personnel data or secrets.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { readWorkbookRowsLocally } from '../src/utils/excelWorkbook';
import { parsePersonnelWorkbook, preparePersonnelImport } from '../src/utils/personnelImport';
import { normalizePersonnelCode } from '../src/utils/personnelSearch';
import { canonicalEvaluationPeriodId } from '../src/utils/evaluationPeriod';
import { EMPTY_VIOLATION_POLICY } from '../src/utils/disciplinaryViolations';
const rosterPath=process.env.V6_ROSTER_FILE||'../1405-06-22.xlsx';
const baselinePath=process.env.V6_BASELINE_FILE||'../chalak-performance-v5.1.3-role-kpi-violations/.acceptance-state-private.json';
const baseline=JSON.parse(fs.readFileSync(baselinePath,'utf8'));
const admin=baseline.pe_employees.find((e:any)=>e.role==='admin');
const profile=baseline.pe_profiles.find((p:any)=>p.id!==admin.profileId);
const employee={id:'v6-disposable',code:'V6TEST',username:'v6test',name:'کارمند آزمایش v6',unit:'آزمایش مجزا',role:'employee',profileId:profile.id,supervisorId:admin.id};
baseline.pe_employees.push(employee);
baseline.pe_evaluations.push({id:'v6-disposable-eval',empId:employee.id,profileId:employee.profileId,period:baseline.pe_active_period||'شهریور 1405',evaluationPeriodId:canonicalEvaluationPeriodId(baseline.pe_active_period||'شهریور 1405'),status:'draft',stage:'supervisor_review',currentAssigneeId:admin.id,currentAssigneeRole:'admin',currentAssigneeName:admin.name,scores:profile.items.map((i:any)=>({...i,value:0,self:0,scoreStatus:'pending'})),created:Date.now()});
baseline.pe_violation_policy=EMPTY_VIOLATION_POLICY;baseline.pe_violations=[];delete baseline.__operation_receipts;
const workbook=await readWorkbookRowsLocally(new File([fs.readFileSync(rosterPath)],'1405-06-22.xlsx'));
const parsed=parsePersonnelWorkbook(workbook);
assert.deepEqual(parsed.identityCounts,{main:626,secondary:148,overlap:89,secondaryOnly:59,distinct:685});
assert.notEqual(normalizePersonnelCode('0012'),normalizePersonnelCode('12'));assert.notEqual(normalizePersonnelCode('AB-12'),normalizePersonnelCode('AB12'));
const options={approved:true,reference:'ISOLATED-LOCAL-SOURCE-REVIEW',effectiveDate:'1405/07/20',newProfileId:profile.id};
if(process.argv.includes('--prepare')){fs.writeFileSync('.v6-seed-private.json',JSON.stringify(baseline));fs.writeFileSync('.v6-meta-private.json',JSON.stringify({revision:1,updatedAt:new Date().toISOString()}));console.log(JSON.stringify({identityCounts:parsed.identityCounts,preview:preparePersonnelImport(parsed.inputs,baseline.pe_employees,baseline.pe_profiles,options).counts}));process.exit(0);}
const origin=process.env.V6_ORIGIN||'http://127.0.0.1:8796';
const password=process.env.V6_ADMIN_PASSWORD||fs.readFileSync('.dev.vars','utf8').match(/ADMIN_PASSWORD\s*=\s*"?([^"\r\n]+)"?/)![1];
const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
async function read(op?:string){const r=await fetch(origin+'/api/state'+(op?'?operationId='+op:''),{headers:{Cookie:cookie,'Cache-Control':'no-cache'}});assert.equal(r.status,200);return r.json() as Promise<any>;}
async function post(updates:any[],op=crypto.randomUUID()){const b=await read();const r=await fetch(origin+'/api/state',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({state:{pe_employees:updates},employeePatch:true,baseRevision:b.revision,operationId:op,sourceImport:{importType:'EMPLOYEE',operationId:op}})});const body=await r.json();if(r.status!==200)console.log(JSON.stringify({status:r.status,body}));assert.equal(r.status,200);return{status:r.status,body,op};}
const before=await read();const historical=JSON.stringify([before.state.pe_evaluations,before.state.pe_archived_evaluations]);
const plan=preparePersonnelImport(parsed.inputs,before.state.pe_employees,before.state.pe_profiles,options);assert(plan.updates.length>0);
// Test 1 preview is pure: authoritative revision/state unchanged before confirmation.
const previewRead=await read();assert.equal(previewRead.revision,before.revision);assert.deepEqual(previewRead.state,before.state);
const result=await post(plan.updates);let current=await read();assert.equal(JSON.stringify([current.state.pe_evaluations,current.state.pe_archived_evaluations]),historical);
for(const u of plan.updates){const actual=current.state.pe_employees.find((e:any)=>e.id===u.id);for(const k of Object.keys(u))assert.deepEqual(actual[k],u[k]);assert(actual.personnelRevision>=1);}
const counts=new Set(current.state.pe_employees.map((e:any)=>normalizePersonnelCode(e.code)));assert.equal(counts.size,current.state.pe_employees.length);
const receipt=await read(result.op);assert.equal(receipt.accepted,true);
// Test 2 repeat exactly the real workbook; no writes and no duplicates.
const repeat=preparePersonnelImport(parsed.inputs,current.state.pe_employees,current.state.pe_profiles,options);assert.equal(repeat.updates.length,0);const unchanged=await read();assert.equal(unchanged.revision,current.revision);assert.equal(JSON.stringify([unchanged.state.pe_evaluations,unchanged.state.pe_archived_evaluations]),historical);
// Test 3 one harmless disposable employee edit; changed record only, exact server read, other personnel/history untouched.
const old=current.state.pe_employees.find((e:any)=>e.id==='v6-disposable');const edit=await post([{...old,unit:'واحد آزمایش v6'}]);const after=await read();assert.equal(after.state.pe_employees.find((e:any)=>e.id===old.id).unit,'واحد آزمایش v6');
assert.deepEqual(after.state.pe_employees.filter((e:any)=>e.id!==old.id),current.state.pe_employees.filter((e:any)=>e.id!==old.id));assert.equal(JSON.stringify([after.state.pe_evaluations,after.state.pe_archived_evaluations]),historical);
const report={test1:{http:200,revision:result.body.revision,identityCounts:parsed.identityCounts,previewWrites:0,changedRecords:plan.updates.length,statuses:plan.counts,persisted:true,receipt:true},test2:{writes:0,updates:0,duplicates:0,preservedHistory:true},test3:{http:edit.status,changedRecords:1,persisted:true,unrelatedPreserved:true},test4:'PENDING_BROWSER',test5:'PENDING_BROWSER'};fs.writeFileSync('.v6-result-private.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));

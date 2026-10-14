import fs from 'node:fs';import assert from 'node:assert/strict';
import {actorA,actorB,person,profile,evaluation,policy} from './hardening-fixture';
import {preparePersonnelImport,parsePersonnelWorkbook,identifyPersonnelHeaders,parsePersonnelSheet,restorePersonnelMapping} from '../src/utils/personnelImport';
import {applyViolationCommands} from '../src/utils/disciplinaryViolations';
import {DEFAULT_GRANULAR_PERMISSION_POLICY} from '../src/utils/authorization';
import {calculateFinalScore} from '../src/utils/formulaEngine';
import {db} from '../src/utils/db';
const before=process.argv.includes('--before'), findings:any={};
const input:any={row:2,sheet:'پرسنل چالاک',data:{code:'0012',name:person.name,unit:'واحد قدیمی'},issues:[]};
const stale=preparePersonnelImport([input],[person],[profile],{approved:true,reference:'LOCAL-QA',effectiveDate:'1405/06/01'});
findings.stalePersonnel={updates:stale.updates.length,status:stale.rows[0].status};if(!before)assert.equal(stale.updates.length,0);
const complete={...evaluation,stage:'completed',status:'draft'};
const newWeights={...profile,items:[{cid:'qa-c1',weight:90},{cid:'qa-c2',weight:10}]};
findings.finalizedScore={snapshot:calculateFinalScore(complete),withChangedLiveProfile:calculateFinalScore(complete,[newWeights])};if(!before)assert.equal(findings.finalizedScore.withChangedLiveProfile,60);
const violation:any={id:'qa-bad-date',employeeId:person.id,periodId:evaluation.evaluationPeriodId,date:'1405/05/02',categoryId:'qa-cat',severity:'minor',evidence:'LOCAL-DATE',description:'آزمایش تاریخ نامنطبق',source:'manual'};
let records:any[]=[],evals=[evaluation];let rejected=false;
try {for(const command of [{action:'create',record:violation},{action:'submit',id:violation.id,reason:'QA'},{action:'review',id:violation.id,reason:'QA'},{action:'approve',id:violation.id,reason:'QA'}]){const r=applyViolationCommands({records,evaluations:evals,employees:[actorA,actorB,person],actor:command.action==='approve'?actorB:actorA,permissions:DEFAULT_GRANULAR_PERMISSION_POLICY,policy,commands:[command],operationId:crypto.randomUUID(),now:new Date().toISOString()});records=r.records;evals=r.evaluations as any;}}catch{rejected=true;}
findings.wrongPeriodViolation={rejected,deduction:evals[0].approvedDeduction||0};if(!before)assert(rejected);
const ordered=[['کد پرسنلی','نام پرسنل','واحد'],['0012',person.name,'QA']];const reordered=[['واحد','نام پرسنل','کد پرسنلی'],['QA',person.name,'0012']];
const saved=identifyPersonnelHeaders(ordered).mapping;
const mapping=before?saved:restorePersonnelMapping(reordered,{headers:ordered[0],mapping:saved});
findings.reorderedStoredMapping=parsePersonnelSheet(reordered,'Sheet1',mapping)[0].data.code;if(!before)assert.equal(findings.reorderedStoredMapping,'0012');
findings.unrelatedFirstSheet={parsed:false};try{const parsed=parsePersonnelWorkbook({sheets:['Summary','Roster'],rowsBySheet:{Summary:[['گزارش'],['خلاصه']],Roster:ordered}});findings.unrelatedFirstSheet={parsed:true,code:parsed.inputs[0].data.code};}catch{}if(!before)assert(findings.unrelatedFirstSheet.parsed);
const originalFetch=globalThis.fetch;let requests=0;
globalThis.fetch=async()=>{requests++;return new Response(JSON.stringify({accepted:true,operationId:'wrong-operation',revision:9,acceptedRevision:9,state:{}}),{status:200,headers:{'Content-Type':'application/json'}});};
try {const r=await(db as any).postManagedState(JSON.stringify({state:{pe_employees:[person]},baseRevision:1,operationId:'qa-expected-operation',employeePatch:true}),new AbortController().signal);findings.incompatibleReceipt={http:r.status,accepted:r.ok};if(!before)assert(!r.ok);}finally{globalThis.fetch=originalFetch;}
fs.writeFileSync(before?'.before-source-private.json':'.after-source-private.json',JSON.stringify(findings,null,2));console.log(JSON.stringify(findings));

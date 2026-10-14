import fs from 'node:fs';import assert from 'node:assert/strict';import {db} from '../src/utils/db';
const origin='http://127.0.0.1:8798',sessions=JSON.parse(fs.readFileSync('.qa-sessions-private.json','utf8')),cookie='chalak_session='+sessions[0].token;
const nativeFetch=globalThis.fetch;const results:any[]=[];
async function direct(path:string,init:any={}){return nativeFetch(origin+path,{...init,headers:{...init.headers,Cookie:cookie}});}
async function read(){const r=await direct('/api/state');assert.equal(r.status,200);return r.json() as Promise<any>;}
async function scenario(mode:string,operationId=crypto.randomUUID()){
  const before=await read(),e=before.state.pe_employees.find((e:any)=>e.id==='qa-person'),shift='FAILURE-'+mode;let posts=0,lookups=0;
  const payload={state:{pe_employees:[{...e,shift}]},baseRevision:mode==='conflict'?before.revision-1:before.revision,employeePatch:true,operationId};const body=JSON.stringify(payload),prepared=body;
  globalThis.fetch=async(url:any,init:any={})=>{
    const path=String(url);if(init.method==='POST'){posts++;
      if(mode==='before_disconnect')throw new TypeError('Controlled precommit disconnect');
      if(mode==='timeout')throw new DOMException('Controlled timeout','AbortError');
      if(mode==='503'||mode==='receipt_other_payload')return new Response(JSON.stringify({code:'controlled_precommit_503',retryable:false}),{status:503,headers:{'Content-Type':'application/json'}});
      if(mode==='bad_receipt')return new Response(JSON.stringify({accepted:true,operationId:'other-operation',acceptedRevision:before.revision,revision:before.revision,state:before.state}),{status:200,headers:{'Content-Type':'application/json'}});
      const r=await direct(path,init);if(mode==='after_disconnect'){assert.equal(r.status,200);throw new TypeError('Controlled response loss AFTER commit');}return r;
    }lookups++;return direct(path,init);
  };
  let status:number|undefined,thrown=false;
  try{status=(await(db as any).postManagedState(body,new AbortController().signal)).status;}catch{thrown=true;}finally{globalThis.fetch=nativeFetch;}
  assert.equal(body,prepared);assert.equal(posts,1);
  const after=await read(),actual=after.state.pe_employees.find((e:any)=>e.id===e.id && e.id==='qa-person');
  const persisted=actual.shift===shift;
  if(mode==='after_disconnect'){assert.equal(status,200);assert(persisted);assert.equal(after.revision,before.revision+1);assert(lookups>=1);}
  else if(mode==='before_disconnect'||mode==='timeout'){assert(thrown);assert(!persisted);assert(lookups>=1);}
  else if(mode==='conflict'){assert.equal(status,409);assert(!persisted);}
  else{assert.equal(status,503);assert(!persisted);}
  results.push({mode,status:status??'THROWN',posts,receiptLookups:lookups,persisted,preparedPreserved:true,requestBytes:Buffer.byteLength(body)});
  return {operationId,actual};
}
await scenario('before_disconnect');await scenario('after_disconnect');await scenario('timeout');await scenario('503');await scenario('conflict');await scenario('bad_receipt');
// A genuine old receipt for the same ID but a DIFFERENT payload must not confirm the attempted new data.
const current=await read(),person=current.state.pe_employees.find((e:any)=>e.id==='qa-person'),id=crypto.randomUUID();const keep=await direct('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:{pe_employees:[{...person,shift:'RECEIPT-ORIGINAL'}]},employeePatch:true,baseRevision:current.revision,operationId:id})});assert.equal(keep.status,200);await scenario('receipt_other_payload',id);
fs.writeFileSync('.failure-evidence-private.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));

import { jsonResponse, type CloudflareEnv } from './auth';
const AUTHORITY_NAME='chalak-authoritative-state-v1';
export function authorityStub(env:CloudflareEnv){
 if(!env.CHALAK_STATE)throw new Error('transaction_store_unconfigured');
 return env.CHALAK_STATE.get(env.CHALAK_STATE.idFromName(AUTHORITY_NAME));
}
export async function forwardAuthority(request:Request,env:CloudflareEnv):Promise<Response>{
 try{return await authorityStub(env).fetch(request);}
 catch{return jsonResponse({error:'مرجع تراکنشی پیکربندی نشده یا موقتاً در دسترس نیست؛ ذخیره در KV انجام نمی‌شود.',code:'transaction_store_unavailable',retryable:false},503);}
}
export async function readIdentityState(env:CloudflareEnv):Promise<Record<string,unknown>>{
 if(env.TRANSACTION_STORE){const {state}=env.TRANSACTION_STORE.read();return {pe_employees:state.pe_employees||[],pe_locked_users:state.pe_locked_users||[]};}
 const response=await authorityStub(env).fetch(new Request('https://authority/internal/identity'));
 if(!response.ok)throw new Error('authoritative_identity_unavailable');
 return response.json() as Promise<Record<string,unknown>>;
}

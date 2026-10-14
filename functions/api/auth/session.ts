import { readIdentityState } from '../../../cloudflare/authority';
import { type AuthSession,type CloudflareEnv,jsonResponse,normalizeUsername } from '../../../cloudflare/auth';
export async function onRequestGet({data,env}:{data:{session?:AuthSession};env:CloudflareEnv}){
 const session=data.session;if(!session)return jsonResponse({session:null},401);
 try{const state=await readIdentityState(env);const employees=(state.pe_employees||[]) as Array<Record<string,unknown>>;const user=employees.find(e=>e.id===session.id&&normalizeUsername(e.username)===session.username);
 if(!user&&employees.length)return jsonResponse({error:'حساب کاربری دیگر فعال نیست.'},401);
 return jsonResponse({session,user:user||{id:session.id,name:session.name,username:session.username,role:session.role,code:'ADMIN-001'}});
 }catch{return jsonResponse({error:'بازیابی هویت تراکنشی موقتاً در دسترس نیست.',code:'authoritative_identity_unavailable',retryable:false},503);}
}

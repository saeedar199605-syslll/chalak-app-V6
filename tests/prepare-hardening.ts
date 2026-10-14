import fs from 'node:fs';import {randomBytes} from 'node:crypto';import {isolatedState,actorA,actorB,person} from './hardening-fixture';
const secret='LOCAL-ISOLATED-'+randomBytes(24).toString('hex');
fs.writeFileSync('.dev.vars','ADMIN_PASSWORD="'+secret+'"\n');
fs.writeFileSync('.qa-seed-private.json',JSON.stringify(isolatedState()));
fs.writeFileSync('.qa-meta-private.json',JSON.stringify({revision:1,updatedAt:new Date().toISOString()}));
const sessions=[actorA,actorB,person].map(actor=>({token:randomBytes(32).toString('hex'),session:{id:actor.id,name:actor.name,username:actor.username,role:actor.role,authVersion:0,expiresAt:Date.now()+3600000}}));
fs.writeFileSync('.qa-sessions-private.json',JSON.stringify(sessions));
fs.writeFileSync('.qa-session-kv-private.json',JSON.stringify(sessions.map(s=>({key:'session:'+s.token,value:JSON.stringify(s.session),expiration_ttl:3600}))));
console.log('Synthetic isolated fixture ready; no real personnel or production secrets.');

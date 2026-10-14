import fs from 'node:fs';
import {sealSnapshot,verifySnapshot,type StateBackup} from '../cloudflare/stateBackup';
// Operator-facing tool. No implicit remote writes or KV fallback. Backup files are sensitive.
const [action,...args]=process.argv.slice(2);
async function read(file:string){return JSON.parse(fs.readFileSync(file,'utf8'));}
async function request(url:string,body:unknown){
 const token=process.env.CHALAK_MAINTENANCE_TOKEN;if(!token||token.length<32)throw Error('Set CHALAK_MAINTENANCE_TOKEN privately');
 const base=new URL(url);if(base.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(base.hostname))throw Error('HTTPS required');
 const r=await fetch(new URL('/api/storage',base),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json() as any;if(!r.ok)throw Error('Maintenance HTTP '+r.status+' '+(result.code||result.error||''));return result;
}
if(action==='seal'){
 const [state,meta,out]=args;const backup=await sealSnapshot(await read(state),await read(meta));fs.writeFileSync(out,JSON.stringify(backup));console.log(JSON.stringify({backup:out,sha256:backup.sha256,revision:backup.meta.revision,counts:backup.counts}));
}else if(action==='verify'){
 const backup=await verifySnapshot(await read(args[0]));console.log(JSON.stringify({verified:true,sha256:backup.sha256,revision:backup.meta.revision,counts:backup.counts}));
}else if(action==='dry-run'||action==='migrate'){
 const [url,file,execute]=args;if(action==='migrate'&&execute!=='--execute')throw Error('Explicit --execute and prior owner approval required for migration');
 const backup=await verifySnapshot(await read(file));const result=await request(url,{action,backup});if(action==='migrate'&&result.sha256!==backup.sha256)throw Error('Migration checksum mismatch');console.log(JSON.stringify(result));
}else if(action==='freeze'||action==='activate'){
 const [url,revision,execute]=args;if(execute!=='--execute')throw Error('Explicit --execute and prior owner approval required');console.log(JSON.stringify(await request(url,{action,expectedRevision:Number(revision)})));
}else if(action==='export'){
 const [url,revision,out]=args;const backup=await verifySnapshot(await request(url,{action,expectedRevision:Number(revision)}));fs.writeFileSync(out,JSON.stringify(backup));console.log(JSON.stringify({backup:out,revision:backup.meta.revision,sha256:backup.sha256,counts:backup.counts}));
}else if(action==='rollback-kv'){
 const [file,out]=args;const backup=await verifySnapshot(await read(file));fs.writeFileSync(out,JSON.stringify([{key:'app_state',value:JSON.stringify(backup.state)},{key:'app_state_meta',value:JSON.stringify(backup.meta)}]));console.log(JSON.stringify({stagedOnly:true,output:out,revision:backup.meta.revision,sha256:backup.sha256,note:'No KV write or deployment performed; traffic gate and owner approval required before remote restore'}));
}else throw Error('Actions: seal STATE META OUT | verify BACKUP | dry-run URL BACKUP | migrate URL BACKUP --execute | freeze/activate URL REV --execute | export URL REV OUT | rollback-kv BACKUP OUT');

import { sanitizeCloudState, type CloudState } from './syncState';
import { normalizePersonnelCode } from '../src/utils/personnelSearch';
import type { StateMeta,OperationReceipt } from './transactionStore';
export interface StateBackup {format:'chalak-state-backup-v1';state:CloudState;meta:StateMeta;counts:Record<string,number>;sha256:string}
export function snapshotCounts(state:CloudState){return Object.fromEntries(Object.entries(state).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,(v as unknown[]).length]));}
export function validateSnapshot(state:CloudState,meta:StateMeta){
 if(!state||typeof state!=='object'||Array.isArray(state)||Object.keys(sanitizeCloudState(state,true)).length!==Object.keys(state).length)throw Error('Unknown or malformed snapshot keys');
 if(!Number.isSafeInteger(meta?.revision)||meta.revision<0||typeof meta.updatedAt!=='string')throw Error('Invalid snapshot revision');
 const unique=(key:string)=>{const rows=(state[key]||[]) as Array<Record<string,unknown>>;if(!Array.isArray(rows))throw Error('Invalid collection '+key);const ids=new Set<string>();for(const row of rows){if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id))throw Error('Duplicate/missing ID in '+key);ids.add(row.id);}return ids;};
 const profiles=unique('pe_profiles');unique('pe_criteria');
 const employees=unique('pe_employees');const codes=new Set<string>();
 for(const e of (state.pe_employees||[]) as Array<Record<string,unknown>>){if(e.profileId&&!profiles.has(String(e.profileId)))throw Error('Orphan personnel profile');const c=normalizePersonnelCode(String(e.code||''));if(!c||codes.has(c))throw Error('Duplicate/missing personnel code');codes.add(c);}
 for(const key of ['pe_evaluations','pe_archived_evaluations','pe_violations']){
  unique(key);for(const row of (state[key]||[]) as Array<Record<string,unknown>>){const id=key==='pe_violations'?row.employeeId:row.empId;if(!employees.has(String(id)))throw Error('Orphan relationship '+key);if(key!=='pe_violations'&&row.profileId&&!profiles.has(String(row.profileId)))throw Error('Orphan evaluation profile');}
 }
 const opIds=new Set<string>();
 for(const op of (state.__operation_receipts||[]) as OperationReceipt[]){if(!op.operationId||!op.actorId||!op.payloadHash||!Number.isSafeInteger(op.acceptedRevision)||op.acceptedRevision<1||op.acceptedRevision>meta.revision||opIds.has(op.operationId))throw Error('Invalid/duplicate receipt');opIds.add(op.operationId);}
}
function canonical(value:unknown):unknown {if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)]));return value;}
async function digest(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(value)))))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function sealSnapshot(state:CloudState,meta:StateMeta):Promise<StateBackup>{validateSnapshot(state,meta);const data={format:'chalak-state-backup-v1' as const,state,meta,counts:snapshotCounts(state)};return {...data,sha256:await digest(data)};}
export async function verifySnapshot(backup:StateBackup){if(backup?.format!=='chalak-state-backup-v1')throw Error('Unsupported backup');validateSnapshot(backup.state,backup.meta);const expected=await sealSnapshot(backup.state,backup.meta);if(expected.sha256!==backup.sha256||JSON.stringify(expected.counts)!==JSON.stringify(backup.counts))throw Error('Backup checksum/count mismatch');return backup;}

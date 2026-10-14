import { isCloudSyncKey, type CloudState } from './syncState';
export interface AcknowledgedPatch {state:CloudState;statePatch?:boolean;deletedStateIds?:Record<string,string[]>;replacementKeys?:string[]}
export function materializeStatePatch(ack:AcknowledgedPatch,read:(key:string)=>unknown):CloudState{
 if(ack.statePatch!==true)return ack.state;
 const result:CloudState={};
 const replacements=new Set(ack.replacementKeys||[]);
 for(const key of new Set([...Object.keys(ack.state),...Object.keys(ack.deletedStateIds||{})])){
  if(!isCloudSyncKey(key))throw Error('Invalid state patch key');
  const rows=ack.state[key];
  if(replacements.has(key)){result[key]=rows;continue;}
  if(!Array.isArray(rows)&&rows!==undefined)throw Error('Invalid state patch collection');
  const before=read(key);if(before!==undefined&&!Array.isArray(before))throw Error('Invalid local collection');
  const deleted=new Set(ack.deletedStateIds?.[key]||[]);const updates=new Map<string,unknown>();
  for(const row of (rows||[]) as Array<{id:string}>){if(!row||typeof row!=='object'||typeof row.id!=='string'||updates.has(row.id))throw Error('Invalid state patch record');updates.set(row.id,row);}
  result[key]=[...((before||[]) as Array<{id:string}>).filter(row=>!deleted.has(row.id)).map(row=>{const next=updates.get(row.id);updates.delete(row.id);return next||row;}),...updates.values()];
 }
 return result;
}

import assert from 'node:assert/strict';
const values=new Map<string,string>([['pe_employees','[{"id":"one"},{"id":"two"}]'],['pe_evaluations','[{"id":"evaluation"}]']]);
(globalThis as any).localStorage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)};
const {db}=await import('../src/utils/db');const store=db as any; (globalThis as any).window={dispatchEvent:()=>true};
for(const [key,value] of values)store.lastSyncedValues.set(key,value);store.workflowContacts=[{id:'contact'}];store.remoteAuditHistory=[{id:'historic'}];
store.applyRemoteState({pe_system_logs:[]},true);
assert.equal(values.get('pe_employees'),'[{"id":"one"},{"id":"two"}]');assert.equal(values.get('pe_evaluations'),'[{"id":"evaluation"}]');assert.equal(store.remoteAuditHistory[0].id,'historic');assert.equal(store.workflowContacts[0].id,'contact');
console.log('Partial ACK preserves unrelated cached entities, historical audit and contacts (client-only regression).');


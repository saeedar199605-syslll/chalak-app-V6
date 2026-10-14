import type { CloudState } from './syncState';
export interface StateMeta {revision:number;updatedAt:string;updatedBy?:string;clientId?:string}
export interface OperationReceipt {operationId:string;actorId:string;actorUsername?:string;payloadHash:string;acceptedRevision:number;timestamp:string;clientId?:string}
export interface StatePatch {state:CloudState;deletedStateIds:Record<string,string[]>;replacementKeys:string[];metrics:{serializedRecords:number;auditRecords:number;evaluationRecords:number;sqlWrites:number}}
export interface TransactionStore {
 read():{state:CloudState;meta:StateMeta};
 receipt(id:string):OperationReceipt|undefined;
 commit(current:CloudState,next:CloudState,expectedRevision:number,meta:StateMeta,receipt:OperationReceipt):StatePatch;
 changesSince(base:number):{complete:boolean;entries:Array<{collection:string;identity:string}>};
}

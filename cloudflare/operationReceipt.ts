import { sanitizeCloudState } from './syncState';
export async function stateOperationHash(envelope: Record<string, unknown>): Promise<string> {
  const payload = { changes: sanitizeCloudState(envelope.state === undefined ? envelope : envelope.state), sourceImport: envelope.sourceImport, evaluationPatch: envelope.evaluationPatch === true, employeePatch: envelope.employeePatch === true, evaluationExpected: envelope.evaluationExpected, evaluationDeleteIds: envelope.evaluationDeleteIds };
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload))))).map(b => b.toString(16).padStart(2,'0')).join('');
}
export function isAcceptedOperation(value: unknown, operationId: string, payloadHash: string): boolean {
  const v = value as Record<string, unknown> | null;
  return !!v && v.storage === 'sqlite-durable-object' && v.protocolVersion === 2 && v.accepted === true && v.operationId === operationId && v.payloadHash === payloadHash && Number.isInteger(v.acceptedRevision) && Number(v.acceptedRevision) > 0 && Number.isInteger(v.revision) && Number(v.revision) >= Number(v.acceptedRevision) && !!v.state && typeof v.state === 'object' && !Array.isArray(v.state);
}

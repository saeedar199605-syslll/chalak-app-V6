// V8 live-local acceptance. Runs against the shipped release bundles (worker + pages) with a local SQLite Durable Object
// and local R2. Run AFTER tests/prepare-transactional.ts + tests/transactional-acceptance.ts (same harness as V7).
// The Worker must be started with --test-scheduled so the cron handler can be triggered over HTTP.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { verifySnapshot } from '../cloudflare/stateBackup';

const pages = 'http://127.0.0.1:8801', worker = 'http://127.0.0.1:8810';
const sessions = JSON.parse(fs.readFileSync('.qa62-sessions-private.json', 'utf8'));
const cookie = (i: number) => 'chalak_session=' + sessions[i].token; // 0,1 = admins, 2 = employee
const operator = fs.readFileSync('storage-worker/.dev.vars', 'utf8').match(/STORAGE_MAINTENANCE_TOKEN="([^"\r\n]+)"/)![1];
const original = JSON.parse(fs.readFileSync('.qa62-backup-private.json', 'utf8'));
const report: Record<string, unknown> = {};
const canon = (v: any): string => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v);
const ok = (name: string, detail: unknown = true) => { report[name] = detail; console.log('PASS ' + name + ' ' + JSON.stringify(detail)); };
const get = async (path: string, actor = 0) => fetch(pages + path, { headers: { Cookie: cookie(actor) } });
const maintain = async (action: string, extra: any = {}) => { const r = await fetch(pages + '/api/storage', { method: 'POST', headers: { Authorization: 'Bearer ' + operator, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) }); return { http: r.status, body: await r.json() as any }; };
const post = async (body: any, actor = 0) => { const r = await fetch(pages + '/api/state', { method: 'POST', headers: { Cookie: cookie(actor), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { http: r.status, body: await r.json() as any }; };
const readState = async () => (await get('/api/state')).json() as Promise<any>;
const health = async (actor = 0) => (await get('/api/admin/health', actor)).json() as Promise<any>;
const trigger = async () => { const r = await fetch(worker + '/cdn-cgi/handler/scheduled'); assert.equal(r.status, 200); await new Promise(res => setTimeout(res, 2500)); };

// 0. make sure the authority is active
let status = await maintain('status');
if (status.body.mode !== 'active') assert.equal((await maintain('activate', { expectedRevision: status.body.meta.revision })).http, 200);

// 1. access control for the two new routes
assert.equal((await fetch(pages + '/api/admin/health')).status, 401);
assert.equal((await fetch(pages + '/api/backup')).status, 401);
assert.equal((await get('/api/admin/health', 2)).status, 403);
assert.equal((await get('/api/backup', 2)).status, 403);
assert.equal((await fetch(pages + '/api/admin/health', { method: 'POST', headers: { Cookie: cookie(0) } })).status, 405);
ok('access-control', { anonymous: 401, employee: 403, adminPost: 405 });

// 2. health reflects real state and counters
const h = await health();
const publicHealth = await (await fetch(pages + '/api/health')).json() as any;
assert.equal(h.version, '8.0.0'); assert.equal(h.revision, publicHealth.revision); assert.equal(h.mode, 'active'); assert(h.totalApproxBytes > 0);
const employees = h.collections.find((c: any) => c.collection === 'pe_employees');
assert.equal(employees.records, 3);
const sum = (name: string) => h.metrics.filter((m: any) => m.name === name).reduce((s: number, m: any) => s + m.n, 0);
assert(sum('commits') >= 3, 'commits counted'); assert(sum('conflicts') >= 1, 'a 409 conflict was counted');
assert.equal(h.backupTarget.r2Bound, true);
ok('health', { revision: h.revision, commits: sum('commits'), conflicts: sum('conflicts'), employees: employees.records });

// 3. rejected / failure counters move with real requests
const before = await readState();
const beforeRejected = sum('rejected');
const bad = await post({ state: { pe_employees: [{ ...before.state.pe_employees.find((e: any) => e.id === 'qa-person'), unit: 'X' }] }, employeePatch: true, baseRevision: before.revision, operationId: crypto.randomUUID() }, 2);
assert.equal(bad.http, 403);
const h2 = await health();
assert(h2.metrics.filter((m: any) => m.name === 'rejected').reduce((s: number, m: any) => s + m.n, 0) > beforeRejected, 'rejected counter did not move');
ok('metrics-move', { lowRoleWrite: 403 });

// 4. download is a consistent, verifiable snapshot and does not change state
const rev0 = (await readState()).revision;
const dl = await get('/api/backup');
assert.equal(dl.status, 200);
assert(/attachment; filename="chalak-backup-r\d+\.json"/.test(dl.headers.get('Content-Disposition') || ''));
const snapshot = await verifySnapshot(await dl.json() as any);
assert.equal(dl.headers.get('X-Backup-Sha256'), snapshot.sha256);
assert.equal(snapshot.meta.revision, rev0);
assert.equal((await readState()).revision, rev0);
const live = await readState();
for (const key of ['pe_employees', 'pe_evaluations', 'pe_violations']) assert.equal(canon(snapshot.state[key]), canon(live.state[key]), key + ' differs from live state');
assert((snapshot.state.__operation_receipts as any[]).length > 0);
ok('backup-download', { revision: snapshot.meta.revision, sha256: snapshot.sha256.slice(0, 12), receipts: (snapshot.state.__operation_receipts as any[]).length });

// 4b. operator snapshot (maintenance token): read-only, no freeze, verifiable, logged
const snap = await maintain('snapshot');
assert.equal(snap.http, 200); const snapVerified = await verifySnapshot(snap.body);
assert.equal(snapVerified.meta.revision, rev0); assert.equal((await readState()).revision, rev0);
assert.equal(canon(snapVerified.state.pe_employees), canon(live.state.pe_employees));
assert.equal((await maintain('status')).body.mode, 'active', 'snapshot must not freeze the authority');
assert.equal((await fetch(pages + '/api/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"snapshot"}' })).status, 403, 'snapshot needs the operator token');
const hs = await health();
assert(hs.backups.some((b: any) => b.kind === 'operator' && b.status === 'ok' && b.revision === rev0));
ok('operator-snapshot', { revision: snapVerified.meta.revision, frozen: false, withoutToken: 403 });
// 5. scheduled backup into local R2 (the Worker was started with --test-scheduled)
await trigger();
let h3 = await health();
const firstScheduled = h3.backups.find((b: any) => b.kind === 'scheduled');
assert(firstScheduled && firstScheduled.status === 'ok', JSON.stringify(h3.backups.slice(0, 3)));
assert.equal(firstScheduled.revision, rev0);
await trigger();
h3 = await health();
const second = h3.backups.find((b: any) => b.kind === 'scheduled');
assert.equal(second.status, 'skipped'); assert(/unchanged/.test(second.detail));
const cur = await readState();
const person = cur.state.pe_employees.find((e: any) => e.id === 'qa-person');
assert.equal((await post({ state: { pe_employees: [{ ...person, shift: 'V8-AFTER-BACKUP' }] }, employeePatch: true, baseRevision: cur.revision, operationId: crypto.randomUUID() })).http, 200);
await trigger();
h3 = await health();
const third = h3.backups.find((b: any) => b.kind === 'scheduled');
assert.equal(third.status, 'ok'); assert.equal(third.revision, cur.revision + 1);
assert(h3.lastScheduledBackup && h3.lastScheduledBackup.revision === cur.revision + 1);
ok('scheduled-backup', { firstOk: firstScheduled.revision, unchangedSkipped: true, afterWriteOk: third.revision });

// 6. restore
const beforeRestore = await readState();
assert.equal((await maintain('restore', { backup: original, expectedRevision: beforeRestore.revision, confirmSha256: original.sha256 })).http, 409); // not frozen
assert.equal((await maintain('freeze', { expectedRevision: beforeRestore.revision })).http, 200);
const fresh = await maintain('export', { expectedRevision: beforeRestore.revision });
assert.equal(fresh.http, 200); await verifySnapshot(fresh.body);
assert.equal((await maintain('restore', { backup: original, expectedRevision: beforeRestore.revision, confirmSha256: 'f'.repeat(64) })).http, 400);
assert.equal((await maintain('restore', { backup: { ...original, sha256: '0'.repeat(64) }, expectedRevision: beforeRestore.revision, confirmSha256: original.sha256 })).http, 400);
assert.equal((await maintain('restore', { backup: original, expectedRevision: beforeRestore.revision - 1, confirmSha256: original.sha256 })).http, 409, 'stale operator revision must be refused');
const restored = await maintain('restore', { backup: original, expectedRevision: beforeRestore.revision, confirmSha256: original.sha256 });
assert.equal(restored.http, 200); assert.equal(restored.body.revision, Math.max(beforeRestore.revision, original.meta.revision) + 1);
const exported = await maintain('export', { expectedRevision: restored.body.revision });
assert.equal(exported.http, 200);
const { __operation_receipts: r1, ...s1 } = original.state; const { __operation_receipts: r2, ...s2 } = exported.body.state;
assert.equal(canon(s1), canon(s2), 'restored state differs from backup');
assert.equal(new Set((r1 as any[]).map(canon)).size, new Set((r2 as any[]).map(canon)).size);
assert.equal((await post({ state: { pe_active_period: 'NO-WRITE' }, baseRevision: restored.body.revision, operationId: crypto.randomUUID() })).http, 503); // still frozen
assert.equal((await maintain('activate', { expectedRevision: restored.body.revision })).http, 200);
const after = await readState();
assert.equal(after.revision, restored.body.revision);
const stale = await post({ state: { pe_employees: [{ ...after.state.pe_employees.find((e: any) => e.id === 'qa-person'), unit: 'STALE-CLIENT' }] }, employeePatch: true, baseRevision: beforeRestore.revision, operationId: crypto.randomUUID() });
assert.equal(stale.http, 409, 'a client holding a pre-restore revision must be told to re-read');
const person2 = after.state.pe_employees.find((e: any) => e.id === 'qa-person');
assert.equal((await post({ state: { pe_employees: [{ ...person2, unit: 'AFTER-RESTORE' }] }, employeePatch: true, baseRevision: after.revision, operationId: crypto.randomUUID() })).http, 200);
const h4 = await health();
assert(h4.backups.some((b: any) => b.kind === 'restore' && b.status === 'ok'));
ok('restore', { frozenOnly: 409, wrongConfirm: 400, tamperedBackup: 400, staleOperatorRevision: 409, newRevision: restored.body.revision, staleClient409: true, writesAfterActivate: 200 });

fs.writeFileSync('v8-live-report.json', JSON.stringify(report, null, 2));
console.log('V8 LIVE-LOCAL: all groups PASS');

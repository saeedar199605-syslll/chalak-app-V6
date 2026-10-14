// V8 safe rebase acceptance (live-local, shipped bundles). Run after tests/prepare-transactional.ts + transactional-acceptance.ts.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const pages = 'http://127.0.0.1:8801', second = 'http://127.0.0.1:8802';
const sessions = JSON.parse(fs.readFileSync('.qa62-sessions-private.json', 'utf8'));
const cookie = (i: number) => 'chalak_session=' + sessions[i].token; // 0,1 admins, 2 employee
const operator = fs.readFileSync('storage-worker/.dev.vars', 'utf8').match(/STORAGE_MAINTENANCE_TOKEN="([^"\r\n]+)"/)![1];
const digest = (record: unknown) => crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');
const report: Record<string, unknown> = {};
const ok = (name: string, detail: unknown = true) => { report[name] = detail; console.log('PASS ' + name + ' ' + JSON.stringify(detail)); };
const read = async (origin = pages, actor = 0) => { const r = await fetch(origin + '/api/state', { headers: { Cookie: cookie(actor) } }); assert.equal(r.status, 200); return r.json() as Promise<any>; };
const post = async (origin: string, body: any, actor = 0) => { const r = await fetch(origin + '/api/state', { method: 'POST', headers: { Cookie: cookie(actor), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { http: r.status, rebasedHeader: r.headers.get('X-Chalak-Rebased'), body: await r.json() as any }; };
const maintain = async (action: string, extra: any = {}) => { const r = await fetch(pages + '/api/storage', { method: 'POST', headers: { Authorization: 'Bearer ' + operator, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) }); return { http: r.status, body: await r.json() as any }; };
const find = (state: any, key: string, id: string) => state.state[key].find((r: any) => r.id === id);
let counter = 0;
const evalPatch = (state: any, base: number, origin = pages, id = 'qa-eval', actor = 0) => { const old = find(state, 'pe_evaluations', id); const next = { ...old, scores: old.scores.map((s: any, i: number) => i === 0 ? { ...s, value: 2 + (counter++ % 3) } : s) }; return { send: (over: any = {}) => post(origin, { state: { pe_evaluations: [next] }, evaluationPatch: true, evaluationExpected: { [id]: digest(old) }, evaluationDeleteIds: [], baseRevision: base, operationId: crypto.randomUUID(), ...over }, actor), next }; };
const empPatch = (state: any, base: number, id: string, field: string, value: string, origin = pages, actor = 1) => { const old = find(state, 'pe_employees', id); return { send: (over: any = {}) => post(origin, { state: { pe_employees: [{ ...old, [field]: value }] }, employeePatch: true, employeeExpected: { [id]: digest(old) }, baseRevision: base, operationId: crypto.randomUUID(), ...over }, actor), old }; };

let status = await maintain('status');
if (status.body.mode !== 'active') assert.equal((await maintain('activate', { expectedRevision: status.body.meta.revision })).http, 200);

// 1. employee patch prepared on an old revision is merged after an unrelated evaluation commit
let s = await read(); let r0 = s.revision;
const e1 = await evalPatch(s, r0).send(); assert.equal(e1.http, 200); assert.equal(e1.body.rebased, undefined);
const p1 = empPatch(s, r0, 'qa-admin-b', 'shift', 'REBASED-EMPLOYEE');
const stale1 = await p1.send(); assert.equal(stale1.http, 200, JSON.stringify(stale1.body)); assert.equal(stale1.body.rebased, true); assert.equal(stale1.rebasedHeader, '1'); assert.equal(stale1.body.rebasedFrom, r0); assert.equal(stale1.body.acceptedRevision, r0 + 2);
let after = await read(second, 1); assert.equal(find(after, 'pe_employees', 'qa-admin-b').shift, 'REBASED-EMPLOYEE'); assert.deepEqual(find(after, 'pe_evaluations', 'qa-eval').scores[0].value, e1.body.state.pe_evaluations[0].scores[0].value);
ok('employee-edit-merged-after-evaluation-commit', { base: r0, accepted: stale1.body.acceptedRevision });

// 1b. replay of the rebased operation is idempotent
const replay = await post(pages, { state: { pe_employees: [{ ...p1.old, shift: 'REBASED-EMPLOYEE' }] }, employeePatch: true, employeeExpected: { 'qa-admin-b': digest(p1.old) }, baseRevision: r0, operationId: stale1.body.operationId }, 1);
assert.equal(replay.http, 200); assert.equal(replay.body.acceptedRevision, stale1.body.acceptedRevision); assert.equal((await read()).revision, r0 + 2);
ok('rebased-operation-replay-idempotent');

// 2. evaluation patch prepared on an old revision is merged after an unrelated employee edit
s = await read(); const r1 = s.revision;
assert.equal((await empPatch(s, r1, 'qa-admin-b', 'shift', 'UNRELATED-EDIT').send()).http, 200);
const stale2 = await evalPatch(s, r1).send(); assert.equal(stale2.http, 200, JSON.stringify(stale2.body)); assert.equal(stale2.body.rebased, true);
after = await read(); assert.equal(find(after, 'pe_employees', 'qa-admin-b').shift, 'UNRELATED-EDIT');
ok('evaluation-merged-after-unrelated-employee-edit', { accepted: stale2.body.acceptedRevision });

// 3. the employee of the evaluation changed meanwhile -> refuse
s = await read(); const r2 = s.revision;
assert.equal((await empPatch(s, r2, 'qa-person', 'unit', 'MOVED-UNIT').send()).http, 200);
const c3 = await evalPatch(s, r2).send(); assert.equal(c3.http, 409); assert.equal(c3.body.rebaseDeclined, 'related_employee_changed');
ok('related-employee-change-refused', c3.body.rebaseDeclined);

// 4. same evaluation changed meanwhile -> refuse (extra id check, and the digest would refuse as well)
s = await read(); const r3 = s.revision;
assert.equal((await evalPatch(s, r3, pages, 'qa-eval', 1).send()).http, 200);
const c4 = await evalPatch(s, r3).send(); assert.equal(c4.http, 409); assert.equal(c4.body.rebaseDeclined, 'same_evaluation_changed');
ok('same-record-change-refused', c4.body.rebaseDeclined);

// 5. stale request carrying a key outside the safe set -> strict v7 behaviour
s = await read(); const r4 = s.revision;
assert.equal((await evalPatch(s, r4, pages, 'qa-eval', 1).send()).http, 200);
const c5 = await post(pages, { state: { pe_active_period: 'STALE-PERIOD' }, baseRevision: r4, operationId: crypto.randomUUID() });
assert.equal(c5.http, 409); assert.equal(c5.body.rebaseDeclined, 'request_not_rebasable');
ok('unsafe-key-refused', c5.body.rebaseDeclined);

// 6. an unsafe collection changed meanwhile -> refuse even a safe patch
s = await read(); const r5 = s.revision;
assert.equal((await post(pages, { state: { pe_active_period: 'NEW-PERIOD' }, baseRevision: r5, operationId: crypto.randomUUID() }, 1)).http, 200);
const c6 = await evalPatch(s, r5).send(); assert.equal(c6.http, 409); assert.match(c6.body.rebaseDeclined, /^intervening_pe_active_period$/);
ok('unsafe-intervening-change-refused', c6.body.rebaseDeclined);

// 7. wrong / missing digests and unknown base are refused
s = await read(); const r6 = s.revision;
assert.equal((await evalPatch(s, r6, pages, 'qa-eval', 1).send()).http, 200);
const wrong = await empPatch(s, r6, 'qa-admin-b', 'shift', 'WRONG-DIGEST').send({ employeeExpected: { 'qa-admin-b': 'f'.repeat(64) } });
assert.equal(wrong.http, 409); assert.equal(wrong.body.code, 'employee_revision_conflict');
const missing = await evalPatch(s, r6).send({ evaluationExpected: undefined }); assert.equal(missing.http, 409); assert.equal(missing.body.rebaseDeclined, 'evaluation_digests_required');
const ancient = await evalPatch(await read(), 1).send(); assert.equal(ancient.http, 409); assert.equal(ancient.body.rebaseDeclined, 'change_log_incomplete');
const future = await evalPatch(await read(), 999999).send(); assert.equal(future.http, 409);
ok('digest-and-base-guards', { wrongEmployeeDigest: wrong.body.code, missingDigest: missing.body.rebaseDeclined, ancientBase: ancient.body.rebaseDeclined });

// 8. genuine concurrency: two Pages processes, different entities, same base revision
s = await read(); const r7 = s.revision;
const a = evalPatch(s, r7, pages, 'qa-eval', 0), b = empPatch(s, r7, 'qa-admin-b', 'shift', 'CONCURRENT-EMPLOYEE', second, 1);
const both = await Promise.all([a.send(), b.send()]);
assert.deepEqual(both.map(x => x.http), [200, 200], JSON.stringify(both.map(x => x.body.rebaseDeclined || x.body.code)));
assert.equal(both.filter(x => x.body.rebased === true).length, 1, 'exactly one of the two had to be rebased');
after = await read(); assert.equal(after.revision, r7 + 2); assert.equal(find(after, 'pe_employees', 'qa-admin-b').shift, 'CONCURRENT-EMPLOYEE');
assert.equal(find(after, 'pe_evaluations', 'qa-eval').scores[0].value, a.next.scores[0].value);
ok('concurrent-different-entities-both-succeed', { revisions: both.map(x => x.body.acceptedRevision) });

// 9. same entity concurrently -> exactly one wins, the other gets 409 (no lost update)
s = await read(); const r8 = s.revision;
const x = evalPatch(s, r8, pages, 'qa-eval', 0), y = evalPatch(s, r8, second, 'qa-eval', 1);
const dup = await Promise.all([x.send(), y.send()]);
assert.deepEqual(dup.map(v => v.http).sort(), [200, 409]);
assert.equal((await read()).revision, r8 + 1);
ok('concurrent-same-entity-one-conflict', dup.map(v => v.http));

// 9b. a stale notifications-only request (read marks) is merged by the engine, never replacing server rows
s = await read(); const r9 = s.revision;
assert.equal((await evalPatch(s, r9, pages, 'qa-eval', 1).send()).http, 200);
const notice = await post(pages, { state: { pe_notifications: [] }, baseRevision: r9, operationId: crypto.randomUUID() }, 0);
assert.equal(notice.http, 200, JSON.stringify(notice.body)); assert.equal(notice.body.rebased, true);
ok('stale-notification-marks-merged');

// 10. counters
const health = await (await fetch(pages + '/api/admin/health', { headers: { Cookie: cookie(0) } })).json() as any;
const total = (name: string) => health.metrics.filter((m: any) => m.name === name).reduce((n: number, m: any) => n + m.n, 0);
assert(total('rebased') >= 4, 'rebased counter'); assert(total('conflicts') >= 6, 'conflict counter');
ok('counters', { rebased: total('rebased'), conflicts: total('conflicts') });

fs.writeFileSync('v8-rebase-report.json', JSON.stringify(report, null, 2));
console.log('V8 REBASE: all groups PASS');
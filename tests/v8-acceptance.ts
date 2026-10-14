// V8 offline acceptance: package integrity, deployment gate, read-only preflight. Never contacts Cloudflare.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
// @ts-ignore plain ESM scripts shipped in the package
import { verify, hashArtifacts } from '../scripts/release.mjs';
// @ts-ignore
import { preflight } from '../scripts/preflight.mjs';
// @ts-ignore
import { gate } from '../scripts/deploy.mjs';
// @ts-ignore
import * as C from '../scripts/config.mjs';

const release = path.resolve('release');
assert(fs.existsSync(path.join(release, 'artifact-hashes.json')), 'run npm run release:prepare first');
const results: Record<string, string> = {};
const ok = (name: string) => { results[name] = 'PASS'; console.log('PASS ' + name); };

// 1. sealed package verifies and every hash is stable
assert.deepEqual(verify(release), []);
assert(verify(release, { r2Enabled: true }).some((p: string) => /R2/.test(p)), 'structure check must notice a worker without the R2 binding when R2 is enabled');
ok('package-verifies');

// 2. tampering with any shipped executable is detected
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-tamper-'));
fs.cpSync(release, tmp, { recursive: true, filter: s => !s.includes('node_modules') });
fs.appendFileSync(path.join(tmp, 'worker/index.js'), '\n//x');
assert(verify(tmp).some((p: string) => p.includes('hash mismatch: worker/index.js')));
fs.cpSync(release, tmp, { recursive: true, force: true, filter: s => !s.includes('node_modules') });
fs.writeFileSync(path.join(tmp, 'worker/.dev.vars'), 'X=1');
assert(verify(tmp).some((p: string) => p.includes('forbidden file')));
fs.rmSync(path.join(tmp, 'worker/.dev.vars'));
const wr = path.join(tmp, 'pages/wrangler.jsonc');
fs.writeFileSync(wr, fs.readFileSync(wr, 'utf8').replace('"env"', '"env_x"'));
assert(verify(tmp).length > 0);
fs.rmSync(tmp, { recursive: true, force: true });
ok('tamper-and-forbidden-files-detected');

// 3. bundles carry the exact release identity
const rel = JSON.parse(fs.readFileSync(path.join(release, 'pages/release.json'), 'utf8'));
assert.equal(rel.version, '8.0.0'); assert.equal(rel.storage, 'sqlite-durable-object'); assert.equal(rel.base, '7.0.0'); assert(rel.features.includes('operator-snapshot') && rel.features.includes('restore') && !rel.features.includes('scheduled-backup-r2'));
const workerJs = fs.readFileSync(path.join(release, 'worker/index.js'), 'utf8');
assert(/version:\s*"8\.0\.0"/.test(workerJs)); assert(workerJs.includes('ChalakState')); assert(workerJs.includes('runScheduledBackup') && workerJs.includes('scheduled(') && workerJs.includes('/api/admin/health') && workerJs.includes('/api/backup')); assert(workerJs.includes('blockConcurrencyWhile')); assert(workerJs.includes('transactionSync'));
const pagesJs = fs.readFileSync(path.join(release, 'pages/_worker.js/index.js'), 'utf8');
assert(pagesJs.includes('chalak-authoritative-state-v1')); assert(pagesJs.includes('admin/health') || pagesJs.includes('/api/admin/health')); assert(pagesJs.includes('api/backup') || pagesJs.includes('/api/backup'));
ok('release-identity');

// 4. no operational state is written to KV by the shipped Pages bundle
const kvWrites = [...pagesJs.matchAll(/CHALAK_DB\s*\.\s*(put|delete)\s*\(\s*([^,)]{0,80})/g)].map(m => m[2]);
assert(kvWrites.length > 0, 'KV write scan matched nothing (vacuous)');
for (const key of kvWrites) assert(!/app_state/.test(key), 'operational KV write found: ' + key);
assert.equal((pagesJs.match(/app_state/g) || []).length, 0, 'Pages bundle references the legacy app_state key');
assert.equal((workerJs.match(/app_state/g) || []).length, 0, 'Worker bundle references the legacy app_state key');
ok('no-operational-kv-writes');

// 5. deployment gate refuses every incomplete invocation
const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 't', CHALAK_PAGES_PROJECT: 'p', CHALAK_LEGACY_WRITES_FROZEN: 'YES' };
assert.equal(gate(env, ['worker', '--owner-approved']), null);
assert(gate(env, ['worker']));
assert(gate(env, ['bogus', '--owner-approved']));
assert(gate({ ...env, CHALAK_LEGACY_WRITES_FROZEN: 'yes' }, ['pages', '--owner-approved']));
assert(gate({ ...env, CHALAK_LEGACY_WRITES_FROZEN: undefined }, ['pages', '--owner-approved']));
for (const k of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CHALAK_PAGES_PROJECT']) assert(gate({ ...env, [k]: '' }, ['pages', '--owner-approved']));
ok('deploy-gate');

// 6. preflight: GET-only, names-only, stops on any drift (mock Cloudflare)
const goodProject = {
  name: 'p', deployment_configs: {
    production: { kv_namespaces: { CHALAK_DB: { namespace_id: C.KV_NAMESPACE_ID } }, durable_object_namespaces: { CHALAK_STATE: { namespace_id: 'ns1' } }, env_vars: { ADMIN_PASSWORD: { type: 'secret_text' }, GEMINI_API_KEY: { type: 'secret_text' } } },
    preview: { env_vars: {} }
  }
};
const live = (over: any = {}) => {
  const calls: { method: string; url: string }[] = [];
  const data: any = { project: goodProject, kv: [{ id: C.KV_NAMESPACE_ID }], dos: [{ id: 'ns1', class: 'ChalakState', script: C.WORKER_NAME, use_sqlite: true }], scripts: [{ id: C.WORKER_NAME }], secrets: [{ name: 'STORAGE_MAINTENANCE_TOKEN' }], settings: { bindings: [{ type: 'kv_namespace', name: 'CHALAK_DB' }, { type: 'durable_object_namespace', name: 'CHALAK_STATE' }, { type: 'secret_text', name: 'STORAGE_MAINTENANCE_TOKEN' }] }, ...over };
  const fetchImpl = async (url: string, init: any) => {
    calls.push({ method: init.method, url });
    const u = new URL(url).pathname.replace(/^\/client\/v4\/accounts\/[^/]+/, '');
    let result: any;
    if (u.startsWith('/pages/projects/')) result = data.project; else if (u.startsWith('/storage/kv/namespaces')) result = data.kv; else if (u === '/workers/durable_objects/namespaces') result = data.dos; else if (u === '/workers/scripts') result = data.scripts; else if (u.endsWith('/secrets')) result = data.secrets; else if (u.endsWith('/settings')) result = data.settings; else if (u === '/r2/buckets/chalak-backups' && data.r2 !== false) result = data.r2 ?? { name: 'chalak-backups' }; else return new Response(JSON.stringify({ success: false, errors: [{ code: 404 }] }), { status: 404 });
    return new Response(JSON.stringify({ success: true, result }), { status: 200 });
  };
  return { fetchImpl, calls };
};
const run = async (over: any = {}, r2Enabled = false) => { const l = live(over); const checks = await preflight({ accountId: 'a'.repeat(32), project: 'p', token: 'SECRET-TOKEN-VALUE', root: release, fetchImpl: l.fetchImpl, r2Enabled }); return { checks, calls: l.calls }; };
const base = await run();
assert(base.checks.every((c: any) => c.ok), JSON.stringify(base.checks.filter((c: any) => !c.ok)));
assert(base.calls.length > 0 && base.calls.every(c => c.method === 'GET'));
assert(!JSON.stringify(base.checks).includes('SECRET-TOKEN-VALUE'));
const drift: Record<string, any> = {
  'unknown production binding group': { project: { ...goodProject, deployment_configs: { ...goodProject.deployment_configs, production: { ...goodProject.deployment_configs.production, r2_buckets: { X: {} } } } } },
  'unknown variable': { project: { ...goodProject, deployment_configs: { ...goodProject.deployment_configs, production: { ...goodProject.deployment_configs.production, env_vars: { ADMIN_PASSWORD: { type: 'secret_text' }, MYSTERY: { type: 'plain_text', value: 'x' } } } } } },
  'missing ADMIN_PASSWORD': { project: { ...goodProject, deployment_configs: { ...goodProject.deployment_configs, production: { ...goodProject.deployment_configs.production, env_vars: {} } } } },
  'preview bound to production KV': { project: { ...goodProject, deployment_configs: { ...goodProject.deployment_configs, preview: { kv_namespaces: { CHALAK_DB: { namespace_id: C.KV_NAMESPACE_ID } } } } } },
  'wrong KV namespace': { kv: [{ id: 'other' }] },
  'DO not SQLite': { dos: [{ id: 'ns1', class: 'ChalakState', script: C.WORKER_NAME, use_sqlite: false }] },
  'DO owned by another worker': { dos: [{ id: 'ns1', class: 'ChalakState', script: 'other', use_sqlite: true }] },
  'pages binding points elsewhere': { dos: [{ id: 'ns2', class: 'ChalakState', script: C.WORKER_NAME, use_sqlite: true }] },
  'worker unknown secret': { secrets: [{ name: 'STORAGE_MAINTENANCE_TOKEN' }, { name: 'LEAKED' }] },
  'worker missing maintenance secret': { secrets: [] },
  'worker unknown binding': { settings: { bindings: [{ type: 'r2_bucket', name: 'B' }] } },
  'R2 binding present while R2 backups are disabled': { settings: { bindings: [{ type: 'kv_namespace', name: 'CHALAK_DB' }, { type: 'durable_object_namespace', name: 'CHALAK_STATE' }, { type: 'r2_bucket', name: 'CHALAK_BACKUPS' }, { type: 'secret_text', name: 'STORAGE_MAINTENANCE_TOKEN' }] } },
  'worker has an unexpected R2 binding name': { settings: { bindings: [{ type: 'kv_namespace', name: 'CHALAK_DB' }, { type: 'durable_object_namespace', name: 'CHALAK_STATE' }, { type: 'r2_bucket', name: 'OTHER' }, { type: 'secret_text', name: 'STORAGE_MAINTENANCE_TOKEN' }] } }
};
for (const [name, over] of Object.entries(drift)) { const r = await run(over); assert(r.checks.some((c: any) => !c.ok), 'preflight did not stop for: ' + name); }
// R2 mode (opt-in): the same preflight must additionally require the bucket and the exact binding
const r2Bindings = { settings: { bindings: [{ type: 'kv_namespace', name: 'CHALAK_DB' }, { type: 'durable_object_namespace', name: 'CHALAK_STATE' }, { type: 'r2_bucket', name: 'CHALAK_BACKUPS' }, { type: 'secret_text', name: 'STORAGE_MAINTENANCE_TOKEN' }] } };
assert((await run(r2Bindings, true)).checks.every((c: any) => c.ok), 'R2-enabled preflight should pass with bucket and binding');
assert((await run({ ...r2Bindings, r2: false }, true)).checks.some((c: any) => !c.ok && /R2/.test(c.name)), 'missing bucket must stop an R2-enabled preflight');
assert((await run({ settings: { bindings: [{ type: 'kv_namespace', name: 'CHALAK_DB' }, { type: 'durable_object_namespace', name: 'CHALAK_STATE' }, { type: 'r2_bucket', name: 'OTHER' }, { type: 'secret_text', name: 'STORAGE_MAINTENANCE_TOKEN' }] } }, true)).checks.some((c: any) => !c.ok));
ok('preflight-read-only-and-fails-closed');

// 7. identity of the base and sealed hash set
assert.equal(C.BASE.version, '7.0.0'); assert.equal(C.BASE.gitCommit, '15bddd2');
assert(Object.keys(hashArtifacts(release)).length > 50);
ok('base-identity');

fs.writeFileSync('tests/evidence/v8-offline-acceptance.json', JSON.stringify({ version: '8.0.0', results }, null, 2));
console.log('V8 OFFLINE ACCEPTANCE: ' + Object.keys(results).length + ' groups PASS');

// Usage: node scripts/release.mjs prepare | seal-artifacts | verify
// `prepare` runs from the SOURCE tree and writes ./release. `seal-artifacts` and `verify` run inside either tree
// (release root = ./release if present, otherwise the current directory).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as C from './config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(here, '..');
const log = (...a) => console.log(...a);
const fail = (m) => { console.error('RELEASE STOP: ' + m); process.exit(1); };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
const walk = (dir, base = dir) => !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
});
const run = (cmd, args, cwd, shell = false) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell });
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} failed (${r.status})`);
};

export function hashArtifacts(root) {
  const files = {};
  for (const entry of C.HASHED_FILES_ROOTS) {
    const abs = path.join(root, entry);
    if (!fs.existsSync(abs)) continue;
    const list = fs.statSync(abs).isDirectory() ? walk(abs, root) : [entry];
    for (const f of list) files[f] = sha(fs.readFileSync(path.join(root, f)));
  }
  for (const f of ['package.json', 'package-lock.json', 'V8-CUTOVER.md', 'V8-READ-ME-FIRST.md'])
    if (fs.existsSync(path.join(root, f))) files[f] = sha(fs.readFileSync(path.join(root, f)));
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

const FORBIDDEN = [/\.dev\.vars$/, /(^|\/)\.env(\..*)?$/, /-private\./, /\.wrangler\//, /node_modules\//];
export function structuralCheck(root, opts = {}) {
  const r2Enabled = opts.r2Enabled ?? C.R2_BACKUP_ENABLED;
  const problems = [];
  const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8').replace(/^﻿/, ''));
  const strip = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8').replace(/^﻿/, '').replace(/^\s*\/\/.*$/gm, ''));
  const all = walk(root).filter(f => !f.startsWith('node_modules/'));
  for (const f of all) if (FORBIDDEN.some(r => r.test(f))) problems.push('forbidden file: ' + f);
  const pkg = read('package.json');
  if (pkg.version !== C.VERSION) problems.push(`package version ${pkg.version} != ${C.VERSION}`);
  if (pkg.devDependencies?.wrangler !== C.WRANGLER_VERSION) problems.push('wrangler is not pinned to ' + C.WRANGLER_VERSION);
  const rel = read('pages/release.json');
  if (rel.version !== C.VERSION) problems.push('pages/release.json version mismatch');
  const pages = strip('pages/wrangler.jsonc'), worker = strip('worker/wrangler.jsonc');
  const kv = (c) => (c.kv_namespaces || []).filter(k => k.binding === C.KV_BINDING && k.id === C.KV_NAMESPACE_ID).length;
  if (kv(pages) !== 1) problems.push('pages KV binding missing or wrong');
  if (kv(worker) !== 1) problems.push('worker KV binding missing or wrong');
  const dob = (pages.durable_objects?.bindings || [])[0];
  if (!dob || dob.name !== C.DO_BINDING || dob.class_name !== C.DO_CLASS || dob.script_name !== C.WORKER_NAME) problems.push('pages Durable Object binding mismatch');
  const wob = (worker.durable_objects?.bindings || [])[0];
  if (!wob || wob.name !== C.DO_BINDING || wob.class_name !== C.DO_CLASS) problems.push('worker Durable Object binding mismatch');
  if (worker.name !== C.WORKER_NAME) problems.push('worker name mismatch');
  const mig = worker.migrations || [];
  if (mig.length !== 1 || mig[0].tag !== C.MIGRATION_TAG || JSON.stringify(mig[0].new_sqlite_classes) !== JSON.stringify([C.DO_CLASS])) problems.push('worker SQLite migration mismatch');
  if (worker.workers_dev !== false) problems.push('worker must not be public (workers_dev=false)');
  const r2 = worker.r2_buckets || [];
  if (r2Enabled) {
    if (r2.length !== 1 || r2[0].binding !== C.R2_BINDING || r2[0].bucket_name !== C.R2_BUCKET) problems.push('worker R2 backup binding mismatch');
    if (JSON.stringify(worker.triggers?.crons) !== JSON.stringify([C.BACKUP_CRON])) problems.push('worker backup cron mismatch');
  } else {
    if (r2.length) problems.push('R2 binding present while R2 backups are disabled');
    if ((worker.triggers?.crons || []).length) problems.push('cron present while R2 backups are disabled');
  }
  const prev = pages.env?.preview;
  if (!prev || prev.kv_namespaces || prev.durable_objects || prev.d1_databases || prev.r2_buckets || prev.services) problems.push('preview must exist and carry no bindings');
  if (!fs.existsSync(path.join(root, 'pages/_worker.js/index.js'))) problems.push('pages/_worker.js/index.js missing');
  if (!fs.existsSync(path.join(root, 'worker/index.js'))) problems.push('worker/index.js missing');
  if (!fs.existsSync(path.join(root, 'pages/index.html'))) problems.push('pages/index.html missing');
  const workerJs = fs.existsSync(path.join(root, 'worker/index.js')) ? fs.readFileSync(path.join(root, 'worker/index.js'), 'utf8') : '';
  if (!workerJs.includes(`version:"${C.VERSION}"`) && !workerJs.includes(`version: "${C.VERSION}"`)) problems.push('worker bundle does not report version ' + C.VERSION);
  return problems;
}

function releaseRoot() {
  const r = path.join(process.cwd(), 'release');
  return fs.existsSync(path.join(r, 'pages')) ? r : process.cwd();
}

function seal(root) {
  const bad = structuralCheck(root);
  if (bad.length) fail('structure invalid:\n - ' + bad.join('\n - '));
  const doc = { version: C.VERSION, algorithm: 'SHA-256', files: hashArtifacts(root) };
  fs.writeFileSync(path.join(root, 'artifact-hashes.json'), JSON.stringify(doc, null, 2));
  log(`sealed ${Object.keys(doc.files).length} files`);
}

export function verify(root, opts = {}) {
  const bad = structuralCheck(root, opts);
  const recorded = fs.existsSync(path.join(root, 'artifact-hashes.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'artifact-hashes.json'), 'utf8')) : null;
  if (!recorded) bad.push('artifact-hashes.json missing');
  else {
    const now = hashArtifacts(root);
    for (const f of new Set([...Object.keys(now), ...Object.keys(recorded.files)]))
      if (now[f] !== recorded.files[f]) bad.push(`hash mismatch: ${f}`);
  }
  return bad;
}

function prepare() {
  const rel = path.join(sourceRoot, 'release');
  for (const f of ['.dev.vars', 'storage-worker/.dev.vars']) if (fs.existsSync(path.join(sourceRoot, f))) fail(f + ' must not exist while preparing a package');
  const dist = path.join(sourceRoot, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) fail('run npm run build first');
  fs.rmSync(rel, { recursive: true, force: true });
  fs.mkdirSync(rel, { recursive: true });
  // pages/
  fs.cpSync(dist, path.join(rel, 'pages'), { recursive: true });
  run(process.execPath, [path.join(sourceRoot, 'node_modules/wrangler/bin/wrangler.js'), 'pages', 'functions', 'build', 'functions', '--outdir', path.join(rel, 'pages/_worker.js'), '--compatibility-date', C.COMPATIBILITY_DATE, '--compatibility-flag', 'nodejs_compat'], sourceRoot);
  const mapFiles = walk(path.join(rel, 'pages/_worker.js')).filter(f => f.endsWith('.map'));
  for (const m of mapFiles) fs.rmSync(path.join(rel, 'pages/_worker.js', m));
  // Wrangler names its route modules with a random numeric suffix; normalise it (pure identifier rename) so rebuilds are byte-reproducible.
  const entry = path.join(rel, 'pages/_worker.js/index.js');
  fs.writeFileSync(entry, fs.readFileSync(entry, 'utf8').replace(/functionsRoutes_0_\d+/g, 'functionsRoutes_0_0').replace(/\.wrangler\/tmp\/pages-[A-Za-z0-9]+\/functionsRoutes-0\.\d+\.mjs/g, '.wrangler/tmp/pages-build/functionsRoutes-0.mjs'));
  // The Functions build emits its own routing; keep _routes.json from public/ for the static/Functions split.
  fs.copyFileSync(path.join(sourceRoot, 'public/_routes.json'), path.join(rel, 'pages/_routes.json'));
  fs.writeFileSync(path.join(rel, 'pages/release.json'), JSON.stringify({ name: 'chalak-performance', version: C.VERSION, base: C.BASE.version, storage: 'sqlite-durable-object', protocolVersion: 2, features: ['admin-health', 'backup-download', ...(C.R2_BACKUP_ENABLED ? ['scheduled-backup-r2'] : []), 'operator-snapshot', 'restore'] }, null, 2));
  fs.writeFileSync(path.join(rel, 'pages/wrangler.jsonc'), JSON.stringify({
    name: C.PAGES_DEFAULT_NAME, compatibility_date: C.COMPATIBILITY_DATE, compatibility_flags: ['nodejs_compat'], pages_build_output_dir: '.',
    kv_namespaces: [{ binding: C.KV_BINDING, id: C.KV_NAMESPACE_ID }],
    durable_objects: { bindings: [{ name: C.DO_BINDING, class_name: C.DO_CLASS, script_name: C.WORKER_NAME }] },
    env: { preview: { compatibility_date: C.COMPATIBILITY_DATE, compatibility_flags: ['nodejs_compat'] } }
  }, null, 2));
  // worker/
  const esbuild = createRequire(createRequire(import.meta.url).resolve('vite'))('esbuild');
  esbuild.buildSync({ entryPoints: [path.join(sourceRoot, 'storage-worker/index.ts')], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', conditions: ['workerd', 'worker', 'browser'], mainFields: ['module', 'main'], external: ['cloudflare:*', 'node:*'], outfile: path.join(rel, 'worker/index.js'), legalComments: 'none' });
  fs.writeFileSync(path.join(rel, 'worker/wrangler.jsonc'), JSON.stringify({
    name: C.WORKER_NAME, main: 'index.js', compatibility_date: C.COMPATIBILITY_DATE, compatibility_flags: ['nodejs_compat'],
    durable_objects: { bindings: [{ name: C.DO_BINDING, class_name: C.DO_CLASS }] },
    migrations: [{ tag: C.MIGRATION_TAG, new_sqlite_classes: [C.DO_CLASS] }],
    kv_namespaces: [{ binding: C.KV_BINDING, id: C.KV_NAMESPACE_ID }],
    ...(C.R2_BACKUP_ENABLED ? { r2_buckets: [{ binding: C.R2_BINDING, bucket_name: C.R2_BUCKET }], triggers: { crons: [C.BACKUP_CRON] } } : {}), workers_dev: false
  }, null, 2));
  // scripts/, tools/, docs, package
  fs.mkdirSync(path.join(rel, 'scripts'), { recursive: true });
  for (const f of ['config.mjs', 'release.mjs', 'preflight.mjs', 'deploy.mjs', 'cloudflare-api.mjs']) fs.copyFileSync(path.join(sourceRoot, 'scripts', f), path.join(rel, 'scripts', f));
  fs.mkdirSync(path.join(rel, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, 'tools/state-transfer.mjs'), path.join(rel, 'tools/state-transfer.mjs'));
  for (const f of ['V8-CUTOVER.md', 'V8-READ-ME-FIRST.md']) fs.copyFileSync(path.join(sourceRoot, f), path.join(rel, f));
  fs.writeFileSync(path.join(rel, 'package.json'), JSON.stringify({
    name: 'chalak-performance-release', private: true, version: C.VERSION, type: 'module', engines: { node: '>=' + C.NODE_MAJOR },
    scripts: { verify: 'node scripts/release.mjs verify', preflight: 'node scripts/preflight.mjs', 'deploy:worker': 'node scripts/deploy.mjs worker', 'deploy:pages': 'node scripts/deploy.mjs pages' },
    devDependencies: { wrangler: C.WRANGLER_VERSION }
  }, null, 2));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npm, ['install', '--package-lock-only', '--no-audit', '--no-fund'], rel, process.platform === 'win32');
  seal(rel);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === 'prepare') prepare();
  else if (cmd === 'seal-artifacts') seal(releaseRoot());
  else if (cmd === 'verify') {
    const bad = verify(releaseRoot());
    if (bad.length) fail('verification failed:\n - ' + bad.join('\n - '));
    log(`V7 package verified: ${C.VERSION}`);
  } else fail('usage: release.mjs prepare | seal-artifacts | verify');
}

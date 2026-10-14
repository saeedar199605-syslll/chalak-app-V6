// Read-only live comparison of Cloudflare against the sealed V7 configuration. Reports secret NAMES only.
// Exit code 0 only when every check passes; any unknown binding/variable or missing resource stops the release.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from './config.mjs';
import { makeReader } from './cloudflare-api.mjs';

const stripJsonc = (t) => JSON.parse(t.replace(/^﻿/, '').replace(/^\s*\/\/.*$/gm, ''));
const names = (o) => Object.keys(o || {});
const BINDING_GROUPS = ['kv_namespaces', 'durable_object_namespaces', 'd1_databases', 'r2_buckets', 'services', 'queue_producers', 'analytics_engine_datasets', 'ai_bindings', 'vectorize_bindings', 'browser_bindings', 'hyperdrive_bindings', 'mtls_certificates', 'send_email_bindings'];

export async function preflight({ accountId, project, token, root, fetchImpl }) {
  const get = makeReader({ accountId, token, fetchImpl });
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  const pagesCfg = stripJsonc(fs.readFileSync(path.join(root, 'pages/wrangler.jsonc'), 'utf8'));
  const workerCfg = stripJsonc(fs.readFileSync(path.join(root, 'worker/wrangler.jsonc'), 'utf8'));
  check('project name given', !!project, 'CHALAK_PAGES_PROJECT');
  if (!project) return checks;

  const pagesProject = await get('/pages/projects/' + encodeURIComponent(project));
  check('Pages project exists', pagesProject?.name === project);
  const dc = pagesProject?.deployment_configs || {};
  for (const env of ['production', 'preview']) {
    const cfg = dc[env] || {};
    const present = BINDING_GROUPS.filter(g => names(cfg[g]).length);
    if (env === 'production') {
      const kv = cfg.kv_namespaces?.[C.KV_BINDING]?.namespace_id;
      check(`${env}: KV ${C.KV_BINDING} matches`, kv === C.KV_NAMESPACE_ID, kv === C.KV_NAMESPACE_ID ? '' : (kv ? 'namespace differs' : 'missing'));
      check(`${env}: Durable Object ${C.DO_BINDING} present`, !!cfg.durable_object_namespaces?.[C.DO_BINDING]?.namespace_id);
      const unknown = present.filter(g => !['kv_namespaces', 'durable_object_namespaces'].includes(g));
      check(`${env}: no unknown binding groups`, unknown.length === 0, unknown.join(','));
      check(`${env}: no unknown KV/DO binding names`, names(cfg.kv_namespaces).every(n => n === C.KV_BINDING) && names(cfg.durable_object_namespaces).every(n => n === C.DO_BINDING), [...names(cfg.kv_namespaces), ...names(cfg.durable_object_namespaces)].filter(n => ![C.KV_BINDING, C.DO_BINDING].includes(n)).join(','));
    } else {
      check(`${env}: carries no binding (isolated from production)`, present.length === 0, present.join(','));
    }
    const vars = cfg.env_vars || {};
    const varNames = names(vars);
    check(`${env}: no unknown variables`, varNames.every(n => C.PAGES_VARS_KNOWN.includes(n)), varNames.filter(n => !C.PAGES_VARS_KNOWN.includes(n)).join(','));
    if (env === 'production') {
      for (const s of C.PAGES_SECRETS_REQUIRED) check(`production: secret name ${s} exists`, varNames.includes(s) && vars[s]?.type === 'secret_text', 'name only; value never read');
    }
  }
  check('local pages config name matches project', pagesCfg.name === project || pagesCfg.name === C.PAGES_DEFAULT_NAME, `config=${pagesCfg.name}`);

  const kvList = await get('/storage/kv/namespaces?per_page=100');
  check('KV namespace exists', Array.isArray(kvList) && kvList.some(n => n.id === C.KV_NAMESPACE_ID));
  const namespaces = await get('/workers/durable_objects/namespaces');
  const ns = (namespaces || []).filter(n => n.class === C.DO_CLASS);
  check('Durable Object class namespace exists once', ns.length <= 1, `found=${ns.length}`);
  if (ns.length === 1) {
    check('namespace belongs to expected Worker', ns[0].script === C.WORKER_NAME, `script=${ns[0].script}`);
    check('namespace uses SQLite', ns[0].use_sqlite === true);
    const pagesDo = dc.production?.durable_object_namespaces?.[C.DO_BINDING]?.namespace_id;
    check('Pages production binding points to that namespace', pagesDo === ns[0].id);
  }
  let scripts;
  try { scripts = await get('/workers/scripts'); } catch (e) { check('Workers list readable', false, e.message); scripts = []; }
  const live = (scripts || []).find(s => s.id === C.WORKER_NAME);
  check('Worker name consistent with sealed config', workerCfg.name === C.WORKER_NAME);
  if (live) {
    const secrets = await get('/workers/scripts/' + C.WORKER_NAME + '/secrets');
    const sn = (secrets || []).map(s => s.name);
    check('Worker has no unknown secret names', sn.every(n => C.WORKER_SECRETS_KNOWN.includes(n)), sn.filter(n => !C.WORKER_SECRETS_KNOWN.includes(n)).join(','));
    check('Worker secret STORAGE_MAINTENANCE_TOKEN exists', sn.includes('STORAGE_MAINTENANCE_TOKEN'), 'name only');
    const settings = await get('/workers/scripts/' + C.WORKER_NAME + '/settings');
    const bindings = settings?.bindings || [];
    const unknown = bindings.filter(b => !((b.type === 'kv_namespace' && b.name === C.KV_BINDING) || (b.type === 'durable_object_namespace' && b.name === C.DO_BINDING) || b.type === 'secret_text'));
    check('Worker has no unknown bindings or variables', unknown.length === 0, unknown.map(b => b.name).join(','));
  } else {
    check('Worker not yet deployed (first deploy; STORAGE_MAINTENANCE_TOKEN must be created by owner)', true, 'informational');
  }
  return checks;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  try {
    const checks = await preflight({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, project: process.env.CHALAK_PAGES_PROJECT, token: process.env.CLOUDFLARE_API_TOKEN, root });
    for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  [' + c.detail + ']' : ''}`);
    const bad = checks.filter(c => !c.ok);
    if (bad.length) { console.error(`PREFLIGHT STOP: ${bad.length} check(s) failed`); process.exit(1); }
    console.log('PREFLIGHT PASS (read-only; nothing was changed)');
  } catch (e) { console.error('PREFLIGHT STOP: ' + e.message); process.exit(1); }
}


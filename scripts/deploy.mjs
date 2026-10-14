// Usage: node scripts/deploy.mjs worker|pages --owner-approved
// Stops on the first failure. No retry, no rollback, no resource creation, no secret writes, no migration.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as C from './config.mjs';
import { verify } from './release.mjs';
import { preflight } from './preflight.mjs';

const stop = (m) => { console.error('DEPLOY STOP: ' + m); process.exit(1); };
export function gate(env, argv) {
  const target = argv[0];
  if (!['worker', 'pages'].includes(target)) return 'target must be worker or pages';
  if (!argv.includes('--owner-approved')) return 'explicit --owner-approved is required';
  if (env[C.FREEZE_ENV] !== 'YES') return `${C.FREEZE_ENV}=YES is required, set only after all legacy writers are proven stopped`;
  for (const k of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CHALAK_PAGES_PROJECT']) if (!env[k]) return k + ' is not set in the process environment';
  return null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const refused = gate(process.env, argv);
  if (refused) stop(refused);
  const root = process.cwd();
  const bad = verify(root);
  if (bad.length) stop('package verification failed: ' + bad.join('; '));
  const checks = await preflight({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, project: process.env.CHALAK_PAGES_PROJECT, token: process.env.CLOUDFLARE_API_TOKEN, root }).catch(e => stop('preflight error: ' + e.message));
  const failed = checks.filter(c => !c.ok);
  if (failed.length) stop('preflight failed: ' + failed.map(c => c.name).join('; '));
  const wrangler = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
  const args = argv[0] === 'worker'
    ? [wrangler, 'deploy', '--config', 'worker/wrangler.jsonc', '--keep-vars']
    : [wrangler, 'pages', 'deploy', 'pages', '--project-name', process.env.CHALAK_PAGES_PROJECT, '--branch', 'main', '--commit-dirty=true'];
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (r.status !== 0) stop('wrangler exited with ' + r.status);
  console.log(`DEPLOYED ${argv[0]} ${C.VERSION}. Next: verify /release.json and /api/health, then follow V7-CUTOVER.md.`);
}

# V7 source delta against accepted v6.2

Base: `chalak-performance-v6.2-TRANSACTION-SAFE.zip`, SHA-256 `8E3AA6733BB97D7783A52B1B4F268E6F31844131F80969CA8499FE5CA3FA795A` (recomputed in this rebuild; equals `release-checksums.json` of v6.2).

Compared byte-for-byte (v6.2 vs V7 source): `src/`, `functions/`, `cloudflare/`, `public/`, `tools/`, `index.html`, `vite.config.ts`, `tsconfig.json`, `storage-worker/`.

Only runtime change: `storage-worker/index.ts` — the health payload version string `6.2.0` → `7.0.0`. Everything else under those paths is identical, so business rules, scoring, import, violation, authorization and the transactional engine are exactly v6.2.

Added (non-runtime): `scripts/` (config, release, preflight, deploy, cloudflare-api), `tests/v7-acceptance.ts`, `tests/run-v7.mjs`, `V7-CUTOVER.md`, `V7-READ-ME-FIRST.md`. `package.json` version 7.0.0, Wrangler pinned to exactly 4.131.2 (v6.2 package had `^4.148.0` while its verification ran on 4.131.2), lock file regenerated accordingly.

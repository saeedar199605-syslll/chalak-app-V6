# V8 live-local evidence (shipped release/ bundles)

Harness (R2 binding added only in a local-only config, because the shipped config keeps R2 disabled): `release/worker` under `wrangler dev --test-scheduled` (local SQLite Durable Object + local R2 bucket `chalak-backups`), two `wrangler pages dev` processes on `release/pages`, synthetic anonymous fixtures. No Cloudflare account contacted. Pages and Worker had to share one KV namespace id locally (production already does through the same id in both configs).

## V7 transactional scenarios A–E on the V8 bundles — PASS (unchanged results)
Same-employee race 200/409, independent entities, import vs score, lost acknowledgement with receipt replay, migration idempotency, frozen export.

## tests/v8-live.ts — all groups PASS
- access-control: anonymous 401, employee 403 on `/api/admin/health` and `/api/backup`, POST 405.
- health: revision equals public `/api/health`; 3 employees in `pe_employees`; counters show commits and the 409 conflicts produced by scenario A–C; R2 bound.
- metrics-move: a low-role write returns 403 and the `rejected` counter increases.
- backup-download: admin snapshot verifies (`verifySnapshot`), header hash equals snapshot hash, revision unchanged by the download, employees/evaluations/violations equal the live state, receipts included.
- operator-snapshot: maintenance-token snapshot is verifiable, equals live state, does not freeze, needs the token (403 otherwise) and is logged.
- scheduled-backup (R2 mode, optional feature, local R2 only): cron trigger writes to R2 and logs `ok`; second trigger with no change logs `skipped (revision unchanged)`; after one write the next trigger logs `ok` with the new revision.
- restore: refused when not frozen (409), wrong confirmation hash 400, tampered backup 400, stale operator revision 409; restore of the original backup replaced the state (export equals backup, receipts equal), new revision = max(current, backup)+1, still frozen until activate, a client holding a pre-restore revision gets 409, writes work after activate.

## Browser (built-in browser, local admin)
Login → Management Center → "backup/Excel/data" tab shows the "System health and backups" panel with live revision, last save time, 7-day counters, backup history (scheduled / manual / restore), and the download button added a "manual download" row and incremented the download counter.

## Not verified
Real Cloudflare R2 (disabled in the shipped package; the account could not enable R2) (bucket creation, token permission, cron execution at 00:00 UTC), Restore on production data, behaviour at production scale, and the retention pruning of >30 objects (code path present, not exercised).
## 8.1 — safe rebase (tests/v8-rebase.ts, shipped bundles) — all PASS
- employee edit prepared on an old revision merged after an unrelated evaluation commit (rebased, revision +2, replay idempotent)
- evaluation patch merged after an unrelated employee edit
- refused (409 with reason): related employee changed, same evaluation changed, unsafe key, unsafe intervening collection, wrong or missing digest, base before the last migration/restore, future base
- two Pages processes, same base revision, different entities: both 200, exactly one rebased; same entity: one 200 and one 409
- stale notification-marks request merged
- Real browser: the app's own save button, with the sync engine on revision 42 while the server was on 43, sent employeePatch+employeeExpected, got 200 ebased:true (revision 44); the unit value and the other writer's evaluation score both persisted and the local cache matched.
- Known limit: a request that also carries admin pe_system_logs (for example the first save after login) is not rebased.

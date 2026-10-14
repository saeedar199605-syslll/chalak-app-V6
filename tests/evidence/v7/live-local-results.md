# V7 live-local evidence (shipped release/ bundles, not the source tree)

Setup: `release/worker/index.js` under `wrangler dev` (4.131.2) and two separate `wrangler pages dev` processes on `release/pages` (ports 8801/8802), sharing one local SQLite Durable Object and one local KV. Synthetic anonymous fixtures only (`tests/prepare-transactional.ts`). No Cloudflare account was contacted.

`GET /api/health` before migration (both Pages processes): `{"status":"maintenance","storage":"sqlite-durable-object","version":"7.0.0","revision":0,"initialized":false,"mode":"frozen"}`. `GET /release.json`: version 7.0.0, base 6.2.0.

## tests/transactional-acceptance.ts (A–E) — PASS
- E migration: dry-run 200, invalid checksum 400, migrate 200, same-hash replay 200 (no duplicate), revision 17 preserved, employees/evaluations/scores/finalized/reversed violation preserved, poisoned stale KV ignored.
- A same employee, two Pages processes: 200 + 409, one revision advance, no lost update.
- B independent entities: 200 + 409, explicit fresh-read re-preparation 200, both values persisted.
- C personnel import vs scoring: 409/200, re-preparation 200, unit + score both persisted, finalized record unchanged; score save serialized 1 evaluation + 1 audit row.
- D lost acknowledgement: commit 200, response dropped, authoritative receipt 200, same-ID replay 200 without new revision/audit, altered payload 409, low-role 403.
- E export: frozen export 200, checksum verified, counts/violations/finalized/audit preserved, frozen write 503, rollback artifact ready.
- Sizes: employee save 465 B request / 826 B ACK / 18 ms; score save 635 B / 1019 B / 26 ms (local, not production).

## Logic suites (no server) — PASS
- hardening-matrix: duplicate prevention, re-import without writes, conflicts quarantined, blank preserves, inactive not reactivated, missing≠0, maintenance duplicate counted once, manual scores preserved, finalized snapshot, header/date/digit edge cases, corrupt files rejected, fuzz 64 cases, violation workflow (independent approval, duplicate no double deduction, appeal, policy change not retroactive, reversal restores, audit).
- hardening-source: stale personnel → NEEDS_REVIEW with 0 updates, finalized score snapshot 60, wrong-period violation rejected, reordered stored mapping, unrelated first sheet, incompatible receipt 503.

## API suites against the shipped bundles
- hardening-calculation-api — PASS (profile change 200 with final snapshot unchanged 60, out-of-range/identity-move/final mutation 403, manual scores preserved, low-role scoped read).
- hardening-violations-api — every behavioural assertion PASS (create/submit/review, self-approval 403, independent approval 200 deduction 2, duplicate 409, policy change keeps snapshot, appeal, reverse, reject, policy restore, deduction back to 0, scores unchanged, audit contains violation_reverse). The script's last count assertion (`pe_violations.length === 2`) fails with 3 because this migrated fixture already holds 1 reversed violation from the migration test (1 migrated + 2 created). This is a fixture expectation, not a data defect.
- hardening-stale-import — NOT RUN: it depends on the local KV-bridge failure-injection adapter (`tests/kv-bridge-adapter.txt`), which is deliberately excluded from the package and cannot exist against the Durable Object authority. Its intent (stale replica must not overwrite) is covered by scenarios A–D above.

## Not re-run in this rebuild
Playwright browser acceptance and the real-source-workbook suite (`tests/v6-acceptance.ts`, needs the owner's workbooks). Frontend source is byte-identical to v6.2 (see source-diff.md), and the build entry file name `index-BU24H1rZ.js` equals the v6.2 release-gate build.

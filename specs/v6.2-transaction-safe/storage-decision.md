# v6.2 — storage decision
Base v6.1 ZIP hashes verified and preserved. Scope is operational state, revisions, receipts, authorisation and direct readers/writers; seven existing fixes remain.

| Criterion | SQLite Durable Object | D1 |
|---|---|---|
| Commit | synchronous SQL transaction inside one global named authority | atomic batch plus conditional CAS/receipt/audit statements required |
| Existing JS validators | reused while the object's input gate holds a stable snapshot | read/validate/write must be redesigned with guarded SQL to prevent stale decisions |
| Revision and receipts | revision CAS checked again in same SQL transaction; durable unique operation ID | feasible with guarded SQL/constraints; separate SELECT/UPDATE insufficient |
| Pages integration | separate Worker + Pages DO binding | direct Pages D1 binding |
| Migration/rollback | frozen authority, verified snapshots, idempotent import, offline legacy snapshot export | similar tools needed |

Selected: SQLite-backed Durable Object. One instance `chalak-authoritative-state-v1` in the `ChalakState` namespace owns all business state. Pages binds CHALAK_STATE to separately deployed `chalak-state-authority`. Its public Worker fetch returns404. Browser requests are authenticated inside the DO; no caller-supplied actor is trusted. blockConcurrencyWhile protects validation across awaits; transactionSync commits changed entity rows, appended audit rows, metadata and unique operation receipt together. Explicit sync/output gating precedes success. No per-Worker promise lock or KV lock is relied upon.

[Cloudflare Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/), [SQLite DO transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

Write inventory: employee edits/deletes, evaluations/bulk/workflow, MIS/Kasra/personnel/criteria imports, violation commands/policy, audit/settings/delegations all enter `/api/state` -> named DO -> shared stateEngine -> SQL commit. No production source reads or writes app_state/meta from CHALAK_DB. Missing namespace/uninitialized authority/frozen writes fail closed503. Auth/session/password registry reads use SQL identity projection; import history and email approval receipts use SQL truth.

KV retains credentials, opaque sessions, rate limits, inbound email quarantine/review metadata and separate credential/email trace events. They cannot write operational employees, evaluations, score audit, revisions or receipts. These auxiliary domains were not redesigned; eventual KV credential revocation/queue-index consistency remain outside this P0 fix. Existing owner KV data is neither cleared nor used as a write fallback.

Performance: per-entity chunked rows (64k UTF-16 characters with surrogate-safe boundaries); only changed rows serialized. Audit append-only; receipts queried by primary key and not kept as a truncated state array. Full-state reading/export and cold cache loading still cost data size; production-scale limits were not benchmarked. Compact patch ACKs omit unrelated evaluations/audit; client materializes affected arrays and preserves unrelated cache/audit/contacts. Full authoritative GET remains a complete scoped snapshot. Protocol2/storage markers reject an old KV backend.

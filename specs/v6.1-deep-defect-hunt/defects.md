# v6.1 confirmed defects

8 defect families: 2 P0, 5 P1, 1 P2, 0 P3. Seven fixed; B01 critical unresolved. Counts group related identity/receipt failures rather than inflate individual assertions.

## B01 — P0

Affected Component: state.ts / KV revisions and operation receipts

Trigger: Independent handlers both read the same old state+meta

Reproduction: Captured real KV snapshot, inject stale GET into two independent handler module instances; PUT remains actual Pages/KV. Both return 200 revision31; A employee update lost. Import vs score: both200 revision34, one lost. Criterion writers: both200 revision35, one lost.

Root Cause: Read-check-write across nontransactional KV; queue exists only within one isolate. State and metadata are separate writes.

Fix: UNRESOLVED. Do not implement KV pseudo-lock. Transactional authoritative save/receipt path needs owner-approved limited migration.

Regression Test: tests/hardening-stale-replica.ts; hardening-concurrency-variants.mjs; real two-Worker control in hardening-api.ts

Verification Result: Reproduced again on final handler. Normal two-process local control returned200/503 SQLite locking, NOT proof of production global consistency. BLOCKER.

## B02 — P1

Affected Component: personnelImport + state.ts sourceImport validation

Trigger: Approved source older than existing personnelEffectiveDate

Reproduction: Baseline helper updates1 and real API200 overwrites unit; after helper0 NEEDS_REVIEW and API403, current unit retained.

Root Cause: No effective-date monotonicity guard in preparation or server validation.

Fix: Reject invalid or older changed effective dates; preserve unchanged legacy dates for unrelated legitimate edits.

Regression Test: tests/hardening-source.ts; hardening-stale-import.ts

Verification Result: PASS, real backend rejection and fresh read.

## B03 — P1

Affected Component: formulaEngine.ts

Trigger: Legacy completed stage still has draft status; live profile changes50/50 to90/10

Reproduction: Baseline final60 becomes92; after remains60. Locked real record unchanged through profile save200.

Root Cause: Live-weight choice tested draft status only, ignoring completed stage.

Fix: Use live weights only for draft AND non-completed stage.

Regression Test: tests/hardening-source.ts; hardening-calculation-api.ts

Verification Result: PASS; historical score60 and manual scores preserved.

## B04 — P1

Affected Component: disciplinaryViolations.ts / evaluationPeriod.ts

Trigger: Violation date in Mordad assigned to Shahrivar under an annual policy

Reproduction: Baseline accepted and deducted2; after rejected, deduction0.

Root Cause: Policy effective interval was checked without membership in evaluation period.

Fix: Validate business date against recognizable Jalali month/quarter/half/year period on create and approve; retain safe reversal of legacy records.

Regression Test: tests/hardening-source.ts; hardening-matrix.ts; hardening-violations-api.ts

Verification Result: PASS; independent approval403/200; duplicate409; snapshot, appeal, reversal, audit preserved.

## B05 — P1

Affected Component: db.ts / state.ts / operationReceipt.ts

Trigger: HTTP200 with another operation receipt or malformed receipt before retry

Reproduction: Baseline incompatible200 treated success. After503 operation_ack_mismatch. Malformed successful receipt before retry now yields503 and zero POST. Post-commit disconnect recovered through actual receipt with exactly one POST.

Root Cause: ACK trusted success status without binding id/hash/accepted revision; receipt success could be confused with authoritative absence.

Fix: Shared payload hash; validate operationId, payloadHash, acceptedRevision, revision and returned state; retry only after a well-formed explicit negative receipt. Explicit server noMutation log-only exception excludes business data.

Regression Test: tests/hardening-source.ts; hardening-failures.ts; hardening-retry-receipt.ts

Verification Result: PASS seven fault modes with actual persistence. Payload preserved, no false success/blind retry. Receipt atomicity across global Workers remains B01.

## B06 — P1

Affected Component: personnelImport.ts / PersonnelImport.tsx

Trigger: Saved numeric column index reused after column reorder

Reproduction: Baseline code reads QA instead of0012; header-based restored mapping after fix reads0012.

Root Cause: Saved mapping had no header identity.

Fix: Persist headers with mapping; resolve normalized identities; reject legacy/ambiguous mapping and safely redetect.

Regression Test: tests/hardening-source.ts; hardening-matrix.ts

Verification Result: PASS parser/mapping regression. No claim that wrong-person server write was demonstrated.

## B07 — P2

Affected Component: personnelImport.ts / PersonnelImport.tsx

Trigger: Unrelated Summary sheet precedes real Roster

Reproduction: Baseline parse fails; after selects semantic personnel sheet and reads0012.

Root Cause: Fallback selected sheets[0] regardless of contents.

Fix: Use known roster sheets or single semantic candidate; ambiguous candidates fail clearly; invalid new file clears old preparation.

Regression Test: tests/hardening-source.ts

Verification Result: PASS helper regression, unrelated first sheet ignored.

## B08 — P0

Affected Component: auth.ts / api/auth/login.ts

Trigger: Admin downgraded in registry or employee deactivated with live session; registered Admin has stable non-emp-admin id

Reproduction: Baseline revoked Admin GET200, inactive GET200; login returnedemp-admin while registryqa-admin-a. After revoked GET401/login403 and inactive GET401; ordinary public Admin login matches registered id and browser save succeeds.

Root Cause: Username admin bypassed registry check; login hardcoded identity. Employment revocation was not checked during session reads.

Fix: Validate all current sessions against registry role/lock/employment; resolve active unique registered Admin after existing credential verification. Allow bootstrap only on empty registry.

Regression Test: tests/hardening-revocation.ts; hardening-calculation-api.ts; browser group7

Verification Result: PASS real backend and actual login; low-role reads scoped; score/identity/final mutations403. Global revocation visibility still depends on KV consistency B01.

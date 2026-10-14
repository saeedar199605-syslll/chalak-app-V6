# v6.1 risk map
Base: accepted v6.0 source and production archive hashes verified, preserved unchanged. Only isolated synthetic personnel and actual local Pages Functions/CHALAK_DB KV used. No production access, changes, migration or deployment.

| Priority | Path | Failure challenged | Evidence |
|---|---|---|---|
| Critical | state.ts -> app_state/app_state_meta, per-instance queue, receipts | stale KV replica / independent writers / partial commit | real local KV + explicit stale-read injection |
| Critical | login.ts/auth.ts -> state.ts permissions | revoked Admin, inactive account, low-role direct API | actual 401/403/200 responses |
| High | personnelImport/PersonnelImport -> sourceImport save | older source, blank/reordered headers, wrong sheet, conflicting identity | baseline/after probes + real API |
| High | db.ts -> ACK / receipt GET | malformed ACK, uncertain outcome, unsafe retry | bounded fetch fault injection with real persistence |
| High | formulaEngine -> live profile/snapshot | completed legacy record uses current weights, missing != zero | baseline/after + real profile save |
| High | disciplinaryViolations/evaluationPeriod | cross-period deduction, independent approval, duplicate/reversal | baseline/after + real API |
| Medium | Employees/Evaluations/bulk/modal + state sync | stale names, wrong filtered employee, second tab | actual two-browser-tab operation + authoritative backend read |

Inspected direct dependencies: cloudflare/{auth,syncState,operationReceipt}.ts; functions/{_middleware.ts,api/state.ts,api/auth/login.ts}; src/utils/{db,personnelImport,personnelSearch,businessDate,evaluationPeriod,formulaEngine,scoreSemantics,realSourceMapping,realSourcePlan,sourceImports,excelWorkbook,spreadsheetXml,disciplinaryViolations,authorization,workflowAuthorization}.ts; src/components/{PersonnelImport,Employees,Evaluations}.tsx; package/tsconfig/wrangler configuration. Inspection is risk-based, not a proof that all application defects are absent.

Performance boundary: retained existing conditional audit comparison in Admin authorization (state.ts). No 8.5 MB audit JSON is created there unless audit is supplied. Other serialization was inspected, but no measured CPU/memory regression justified speculative resource changes. No Cloudflare invocation resource logs were available.

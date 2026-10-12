# v6 data foundation — scoped Spec Kit continuation

Base: accepted v5.1.3 targeted ZIP SHA256 `939D778D315E609E5E6593D1AF3C0FFF0590FF0DE79D902E81A48304924E84F3`, verified before extraction into the separate v6 workspace. Accepted source/archives untouched.

Owner problem → code evidence → targeted change:

- Wrong personnel identity: `employeeImport.ts` matched code OR username; `normalizePersonnelCode` removed separators. Distinct `AB-12`/`AB12` collapsed. Exact digit-normalized, separator/leading-zero-preserving business codes now own identity; username cannot select a different person.
- Missing fields overwrite existing data: old importer selected first profile, default employee role and empty organizational relationships. Existing profile/role/relationships/optional metadata are retained unless supplied; new profiles require explicit selection; conflicting versions are all quarantined.
- False personnel save completion: `App` add/update staged local state and immediately notified success; `Employees` closed the form without awaiting the server. The form now awaits a managed server commit, preserves failure inputs and uses stable operation IDs.
- Save work: employee updates previously sent the full personnel collection. New changed-entity mode checks operation receipt/revision/authorization before merging into the same authoritative registry. Unrelated evaluations are not reconciled; 8.5MB audit serialization optimization remains. Referential IDs are constructed once per import, not once per row.
- Real roster import: only approved business fields, meaning-based aliases/manual mapping, eight statuses, bounded 25-row preview and no preview/cancel business writes. Secondary/overlapping records do not automatically override current employment. No parallel registry.

Not claimed: reproduction or elimination of production 503/1102, production deployment, guaranteed atomic multi-Worker transactions on KV. Existing same-isolate serialization and revision/receipt protections are retained; KV's cross-isolate concurrency limitation remains.

Focused live checks exposed two additional synchronization paths: server-generated personnel revision/timestamp fields were treated as user changes, producing metadata-only audit entries; shared cache equality suppressed React notification in the second tab. Server-owned stamps are now excluded from client mutation comparison/payload, no-op server entities retain their revision, untracked personnel cache changes trigger reads rather than writes, and authoritative reads notify when the tab's accepted baseline differs even if shared storage already matches. Only affected live/recovery gates were repeated after these source corrections.

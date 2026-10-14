# v6.2 — final release readiness gate

**FINAL_STATUS: BLOCKED. READY_FOR_CONTROLLED_DEPLOYMENT: NO.** دلیل: دسترسی معتبر برای تطبیق Bindingها/نام Secretهای پروژهٔ زنده و اثبات Freeze همهٔ مسیرهای Legacy موجود نیست. هیچ مانع محلیِ حفظ داده در آزمون‌های زیر مشاهده نشد؛ موفقیت محلی مجوز استقرار نیست.

Browser ACK: PASS — انتظار بدون موفقیت کاذب، POST200، Revision19→20، Receipt با همان Operation ID/Hash، بسته‌شدن فرم پس از پاسخ، مقدار QA62-GATE-ACK پس از Refresh و Fresh Read. تعارض واقعی POST409 در برابر نویسندهٔ مستقل200، Revision21؛ فرم QA62-GATE-UNSAVED حفظ شد و Receipt ردشده accepted:false بود؛ فقط یک POST برای آن عملیات. تأخیر اولیه بیش از15s شد: بدون موفقیت کاذب، فرم حفظ شد و Commit دیرهنگام جداگانه با Receipt تأیید شد. آزمون ACK عادی سپس با تأخیر4.6s گذشت؛ HTTP موفق جعلی تزریق نشد.

Migration: Dry Run200/بدون نوشتن؛ migrate200؛ تکرار همان Hash200/بدون Duplicate؛ Export Frozen دقیقاً برابر Snapshot اولیه.3 کارمند،2 ارزیابی،4 اسلات نمره،1 تخلف برگشت‌خورده،5 Audit و1 Receipt؛ Revision17 و SHA256 یکسان. نمرات، سوابق نهایی و روابط حفظ شدند.

Deployment structure: Worker جداگانه/class/SQLite migration/Pages binding و Object name ثابت در سورس تأیید شدند؛ هر دو Pages محلی [connected]. تنظیمات انتشار و23 فایل اجرایی با ZIP پذیرفته‌شده بدون تغییر بودند. خواننده/نویسنده operational app_state در KV صفر؛ KV نشست/رمز/صف ایمیل خارج از Authority امتیازهاست. Secret تولید خوانده، تغییر یا چاپ نشد؛ حفظ تنظیمات زنده تا زمان دسترسی قابل تأیید نیست.

Runbook کوتاه با توقف/بازیابی هر مرحله در migration.md. شواهد Browser/Network/Receipt/Snapshot در tests/evidence/v6.2/release-gate. بازبینی قطع‌شدهٔ مرورگر اکنون تکمیل شده؛ محدودیت قدیمی زیر صرفاً تاریخچه است. در همین Gate یک Typecheck (برنامه و Worker) و یک Build اجرا شدند: هر دو PASS؛ Build در29.84s. هشدارهای موجود وابستگی و حجم Chunk مانع Build نبودند.

---
## Historical transactional verification

# v6.2 — focused acceptance
**LOCAL TRANSACTIONAL VERIFIED** for the five isolated operational-state scenarios. Production unchanged and unverified; remote cutover requires separate owner approval.

| Test | Observed |
|---|---|
| A same employee | separate Pages writers200/409; one revision advance; no two successes at same revision. Specific final-source race409/200 also passed. |
| B independent entities |409/200 then explicit fresh-read re-preparation200; both values survived. Global revision is conservative: unrelated writes can conflict. No blind automatic retry/rebase. |
| C personnel import vs score |200/409 then explicit fresh-read re-preparation200; employee unit and manual score3 survived; finalized record unchanged. |
| D lost acknowledgement | actual commit200; transport response deliberately lost; authoritative receipt200; same-ID replay200 without new revision/audit; altered payload409. Real client recovery subsequently used one POST/one receipt GET and rejected old-backend ACKs. |
| E migration/rollback | dry-run200/no write; invalid checksum400; migrate200/replay200; revision17 preserved;3 employees,2 evaluations,1 reversed violation and all prior scores/audit retained. Frozen export200 verified; actual isolated legacy KV fresh state/meta read exactly matched export revision23. Frozen mutation503. |

Additional direct dependencies: real violation approval200 persisted record, deduction and audit; low-role mutation403; real registered Admin login200. Worker restart fresh read matched exact state and revision27, proving persisted SQLite rather than in-memory-only state. Intentionally poisoned old KV data never replaced SQL state.

Measured isolated ordinary employee save:465-byte request,806-byte ACK,124ms, serialized one employee + one new audit, zero evaluations. Score save:635-byte request,999-byte ACK,127ms, serialized one evaluation + one new audit. `sqlWrites` metrics count state-row delete/insert work, excluding collection catalog/meta/receipt writes; they are not total SQL statements or CPU/memory measurements.

Integration correction: compact ACK initially exposed a cache bug in applyRemoteState: missing keys were treated as deletions and local defaults appeared, causing a rejected403 attempt. SQL retained all3 employees. Fixed partial updates to skip absent keys and retain audit/contacts. Dedicated client-only regression passed. Browser follow-up was interrupted by tool transport closure before the clean-origin recheck; do NOT report final browser acceptance as passed. This is a remaining verification limitation, not evidence of server data loss.

Final typecheck PASS for application and isolated Worker compiler contexts. Final build PASS20.38s,index-BU24H1rZ.js. Checks were repaired/repeated only after actual type-configuration, protocol-pairing and partial-ACK fixes; no full regression cycles or suites. Existing vendor annotation/chunk-size warnings remain. No production CPU/memory, production binding, deployment or owner-data migration claim is made.

Evidence: tests/evidence/v6.2/{acceptance,final-backend,client-recovery,restart,validation}.json; source patch. All fixtures anonymous, no secret/session/raw production data shipped. Business authorization/scoring/policy rules remain v6.1; changes only authoritative storage and direct transport/identity consumers. Auxiliary KV session/credential/email metadata consistency is not a new transactional guarantee.

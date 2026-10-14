# CHALAK PERFORMANCE V7 — Runbook انتقال (Cutover) و بازگشت (Rollback)

**وضعیت: اجرا فقط با مجوز صریح مالک.** این بسته Production را بررسی یا تغییر نداده است. هیچ مرحله‌ای خودکار نیست؛ هر خطا فرایند را متوقف می‌کند (بدون Retry یا Rollback خودکار).

## اصول
- مرجع نوشتن فقط یکی است: Durable Object با SQLite، شیء `chalak-authoritative-state-v1`، کلاس `ChalakState`، Worker `chalak-state-authority`.
- KV `CHALAK_DB` فقط نشست، رمز، محدودیت نرخ و صف ایمیل را نگه می‌دارد، نه وضعیت عملیاتی.
- هیچ Secret چاپ، تکثیر یا بازنویسی نمی‌شود. مقدار `STORAGE_MAINTENANCE_TOKEN` را فقط مالک در Cloudflare می‌سازد (حداقل ۳۲ نویسه تصادفی).
- Preview هیچ Binding ندارد و به Production وصل نمی‌شود.
- هر Commit جدید پس از Cutover، Backup قدیمی را بی‌اعتبار می‌کند؛ Rollback فقط از Export تازه.

## متغیرهای محیطی خصوصی اپراتور (فقط در همان Session)
`CLOUDFLARE_ACCOUNT_ID`، `CLOUDFLARE_API_TOKEN`، `CHALAK_PAGES_PROJECT` (نام واقعی پروژه موجود)، `CHALAK_MAINTENANCE_TOKEN` (برای `tools/state-transfer.mjs`)، و پس از اثبات توقف نویسندگان: `CHALAK_LEGACY_WRITES_FROZEN=YES`. این متغیر نویسندگان را متوقف نمی‌کند؛ فقط گواهی اپراتور است.

## مراحل

| # | مرحله | شرط عبور | در صورت شکست |
|---|---|---|---|
| 0 | `npm ci` و `npm run verify` در پوشه مستقل | Hash همه فایل‌ها و ساختار تأیید شود | توقف؛ بسته مشکوک است |
| 1 | `npm run preflight` (فقط GET) | همه بررسی‌ها PASS: پروژه، KV، کلاس/Namespace SQLite، Migration، Bindingهای Production/Preview، نام Secretها، بدون Binding/متغیر ناشناخته | توقف؛ حذف Binding برای عبور ممنوع؛ مالک تنظیمات را بازبینی کند |
| 2 | اثبات توقف همه نویسندگان قدیمی (دامنه اصلی، pages.dev، Deploymentهای Preview، فراخوان‌های سرویس) | هیچ مسیر قدیمی قادر به نوشتن نیست | مهاجرت ممنوع؛ KV قدیمی مرجع می‌ماند |
| 3 | `export CHALAK_LEGACY_WRITES_FROZEN=YES` | فقط پس از مرحله ۲ | — |
| 4 | Backup اولیه State + Meta از KV قدیمی، `node tools/state-transfer.mjs seal STATE.json META.json BACKUP.json` سپس `verify` | Hash و Revision و تعداد کارمند/ارزیابی/نمره/تخلف/Audit/Receipt ثبت و تطبیق شود | توقف؛ بدون Repair خودکار |
| 5 | `npm run deploy:worker -- --owner-approved` | Preflight دوباره PASS؛ Worker بدون Gate باز مستقر شود؛ DO در حالت Frozen بماند | توقف؛ کلاس/Namespace قبلی تغییر نام یا حذف نشود |
| 6 | `node tools/state-transfer.mjs dry-run URL BACKUP.json` | ۲۰۰ و بدون نوشتن | توقف |
| 7 | `node tools/state-transfer.mjs migrate URL BACKUP.json --execute` | Hash پاسخ = Hash Backup؛ تکرار همان Hash بدون Duplicate؛ Snapshot متفاوت ۴۰۹ | توقف؛ Gate بسته بماند |
| 8 | `node tools/state-transfer.mjs export URL REV MIGRATED.json` و تطبیق با Backup | Hash، Revision و تعدادها برابر | توقف؛ مقصد نامعتبر فعال نشود |
| 9 | `npm run deploy:pages -- --owner-approved` | `/release.json` نسخه 7.0.0؛ `/api/health` مرجع `sqlite-durable-object` نسخه 7.0.0 (فقط HTTP 200 Frontend کافی نیست) | توقف؛ Gate بسته |
| 10 | Smoke با Admin آزمایشگر: یک ذخیره، ACK/Receipt، Refresh، Fresh Read | مقدار حفظ شود | Operation ID را از Receipt بررسی کنید؛ Retry کور ممنوع؛ DO را Freeze کنید |
| 11 | تأیید مالک؛ `node tools/state-transfer.mjs activate URL REV --execute` | مالک صریحاً تأیید کرده | Freeze فوری |

## Rollback
```text
node tools/state-transfer.mjs freeze URL CURRENT_REV --execute
node tools/state-transfer.mjs export URL CURRENT_REV FRESH_BACKUP.json
node tools/state-transfer.mjs verify FRESH_BACKUP.json
node tools/state-transfer.mjs rollback-kv FRESH_BACKUP.json RESTORE_BULK.json
```
`rollback-kv` فقط فایل می‌سازد. نوشتن در KV قدیمی، بازگرداندن کد و تنظیمات قبلی و برداشتن Gate فقط با مجوز مالک و بعد از تأیید Hash/Revision/تعدادها انجام شود. DO در Frozen بماند. هیچ لحظه‌ای دو مرجع هم‌زمان قابل نوشتن نیستند. قبل از Commit جدید، Backup مرحله ۴ معتبر است؛ بعد از آن فقط Export تازه.

## محدودیت‌های شناخته‌شده
- یک DO سراسری: Revision سراسری است و نوشتن‌های مستقل هم‌زمان ممکن است ۴۰۹ بگیرند؛ کلاینت باید با خواندن تازه دوباره آماده‌سازی کند.
- مقیاس، CPU و حافظه در Production اندازه‌گیری نشده است.
- Consistency نهایی KV برای نشست/رمز/ایمیل تضمین تراکنشی جدید نیست.

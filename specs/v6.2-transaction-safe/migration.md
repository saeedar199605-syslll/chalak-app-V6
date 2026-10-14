# v6.2 — Runbook اجرایی Cutover و Rollback

**وضعیت فعلی: BLOCKED.** حساب Cloudflare احراز هویت نیست؛ تطبیق تنظیمات زنده، Secretها و پوشش Freeze همهٔ URLهای قدیمی تأیید نشده است. هیچ دستور Production در این بررسی اجرا نشده. مراحل زیر فقط پس از مجوز مالک اجرا شوند؛ نسخه همچنان6.2.0 است.

## پیش‌شرط

با دسترسی معتبر، شناسهٔ حساب/پروژه، Worker `chalak-state-authority`، کلاس SQLite `ChalakState`، اتصال Pages `CHALAK_STATE` و KV احراز هویت `CHALAK_DB` را با پروژهٔ زنده تطبیق دهید. نام Bindingها، متغیرها و Secretهای فعلی را ثبت کنید؛ مقادیر Secret را چاپ/صادر نکنید و با مقدار آزمایشی جایگزین نکنید. Secretهای فعلی Pages حفظ شوند؛ توکن نگهداریِ Worker، مستقل و خصوصی باشد. Preview/Staging نباید به Namespace تولید متصل شود. اگر نام یا مالکیت Resource موجود متفاوت است، استقرار متوقف شود. [الزام تطبیق Wrangler با تنظیمات Pages](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).

یک اپراتور مسئول، فایل Backup اولیه و ZIP قبلی را نگه دارد. ابزار آماده است: `npm run storage:tool`؛ توکن از متغیر محیطی خصوصی `CHALAK_MAINTENANCE_TOKEN` خوانده می‌شود. URL نگهداری از Pagesِ محدودشده به اپراتور است، نه URL عمومی Worker؛ Worker عمومی404 می‌دهد.

| مرحله | اجرای کنترل‌شده و شرط عبور | شکست: توقف و بازیابی |
|---|---|---|
| Freeze Writes | تمام مسیرهای Legacy، دامنه اصلی، pages.dev، URLهای Deployment/Preview و فراخوان‌های سرویس را برای نوشتن ببندید. با درخواست مجاز ثابت کنید هیچ‌یک قادر به Commit نیست. DO جدید Frozen بماند. | اگر حتی یک مسیر نامعلوم/قابل نوشتن باقی است، مهاجرت ممنوع؛ KV مرجع قبلی بماند. متغیر Freeze جدید در کد v6.1 کار نمی‌کند؛ Gate واقعی لازم است. |
| Verified Backup | پس از قطع نویسندگان و همگرایی Replica، State+Meta را بگیرید؛ Hash دو برداشت، آخرین Revision/Receipt معلوم، روابط و تعدادها تطبیق داده شوند. Backup اصل تغییرناپذیر بماند. | اختلاف Hash/Revision، Receipt گمشده یا رابطه نامعتبر: توقف؛ هیچ Repair خودکار یا Import ناقص انجام نشود. |
| Migration | Worker SQLite و Pages محدودشده به اپراتور آماده شوند؛ Dry Run سپس Migration فقط روی مرجع خالی و Frozen. همان Hash قابلیت Replay دارد؛ Snapshot متفاوت409 می‌گیرد. | خطا: Gate بسته بماند؛ Authority فعال نشود. وضعیت/Hash مقصد بررسی شود؛ همان Backup فقط با تأیید نتیجه دوباره بررسی شود. |
| Integrity Check | Export از DO Frozen؛ Hash و Revision، تعداد کارکنان/ارزیابی/اسلات نمره، مقدار نمرات، نهایی‌شده‌ها، تخلفات/برگشت، Audit و Receiptها با Backup تطبیق داده شوند. | عدم تطبیق: توقف؛ KV دست‌نخورده مرجع قابل برگشت است؛ مقصد نامعتبر فعال نشود. |
| Switch Authority | همهٔ Functions فعال و Bindingها به همین Worker/Namespace بروند؛ همهٔ عملیات همان Object `chalak-authoritative-state-v1` را بگیرند. تنظیمات و Secretهای قبلی دوباره تطبیق داده شوند. | اتصال/Secret/نسخه ناسازگار: Gate بسته؛ تا قبل از پذیرش نوشتن جدید، کد و تنظیمات قبلی زیر Gate بازگردند. |
| Smoke Test | Gate عمومی بسته بماند؛ فقط Admin آزمایشگر مجاز باشد. DO در Revision تأییدشده Active شود؛ یک مقدار مجاز، ACK/Receipt، Refresh و Fresh Read بررسی شود. | نتیجه نامطمئن: همان Operation ID از Receipt بررسی شود؛ Retry کور ممنوع. DO Freeze شود. اگر Commit جدیدی رخ داده، فقط Export تازه مبنای Rollback است. |
| Enable Writes | پس از Smoke موفق، تأیید مالک و اثبات مسدودبودن همهٔ نویسندگان KV قدیمی، Gate عمومی برداشته شود. | خطای اولیه: Gate فوراً دوباره بسته و DO Freeze؛ Export تازه و Rollback کنترل‌شده. |

## دستورهای ابزار

```text
node tools/state-transfer.mjs seal STATE.json META.json BACKUP.json
node tools/state-transfer.mjs verify BACKUP.json
node tools/state-transfer.mjs dry-run URL BACKUP.json
node tools/state-transfer.mjs migrate URL BACKUP.json --execute
node tools/state-transfer.mjs export URL REV MIGRATED.json
node tools/state-transfer.mjs activate URL REV --execute
```

`URL` نشانی Pages محدودشده است؛ `REV` عدد خوانده‌شده و تأییدشده، نه مقدار حدسی. برای توقف و بازگشت:

```text
node tools/state-transfer.mjs freeze URL CURRENT_REV --execute
node tools/state-transfer.mjs export URL CURRENT_REV FRESH_BACKUP.json
node tools/state-transfer.mjs verify FRESH_BACKUP.json
node tools/state-transfer.mjs rollback-kv FRESH_BACKUP.json RESTORE_BULK.json
```

Rollback-kv فقط فایل ایجاد می‌کند. با مجوز مالک، Export **تازه** به KV قبلی برگردد؛ خواندن تازه، Hash/Revision و تعدادها تأیید شوند؛ کد و تنظیمات کامل قبلی بازگردند؛ سپس Gate برداشته شود. هنگام بازفعال‌شدن KV، DO Frozen بماند. بعد از Commit جدید هرگز Backup قدیمیِ قبل از Cutover برگردانده نشود. هیچ مرحله‌ای دو مرجع مستقل را هم‌زمان برای نوشتن فعال نمی‌کند.

# CHALAK PERFORMANCE V8 — ارتقا از V7، پشتیبان‌گیری و بازیابی

V8 همان معماری V7 است (Pages + Worker `chalak-state-authority` با Durable Object SQLite). **منطق کسب‌وکار، نمره‌دهی و داده تغییر نکرده.** فقط این‌ها اضافه شده:

| قابلیت | توضیح |
|---|---|
| پنل سلامت (Admin) | `/api/admin/health` و پنل «سلامت سیستم و پشتیبان‌گیری» در «مرکز مدیریت ← پشتیبان‌گیری…»: نسخه داده، حجم، آخرین ذخیره، شمارنده‌ی ۷ روز اخیر (ذخیره موفق، تعارض ۴۰۹، ردشده، خطای سرور)، تاریخچه‌ی پشتیبان‌ها و هشدار اگر ۴۸ ساعت پشتیبان بیرونی گرفته نشده باشد. |
| دانلود پشتیبان (Admin) | `/api/backup` (دکمه‌ی پنل). Snapshot سازگار و مهرشده؛ نوشتن را متوقف نمی‌کند. |
| پشتیبان با ابزار نگهداری | `node tools/state-transfer.mjs snapshot URL OUT.json` — فقط‌خواندنی، بدون Freeze، با رمز نگهداری؛ قابل زمان‌بندی روی کامپیوتر خودتان. |
| Restore | `node tools/state-transfer.mjs restore URL BACKUP.json REV --execute` — فقط وقتی سیستم Frozen است و با تأیید Hash. |
| پشتیبان خودکار R2 (اختیاری، پیش‌فرض خاموش) | کد آماده است ولی تا وقتی R2 در حساب فعال نشده، خاموش می‌ماند. فعال‌سازی: پایین. |

## ارتقا از V7
۱. Preflight فقط‌خواندنی: `npm run preflight` (همه‌ی بررسی‌ها PASS).
۲. Worker (داده‌ی Durable Object دست‌نخورده می‌ماند؛ کلاس و Migration عوض نشده):
`npx wrangler deploy --config worker/wrangler.jsonc --keep-vars`
۳. Pages: کد را به `main` Push کنید. بعد `/api/health` باید `8.0.0` و Revision بدون تغییر را نشان دهد.
۴. Admin وارد شود، پنل را ببیند و یک «دانلود پشتیبان کامل» بزند.

## پشتیبان‌گیری زمان‌بندی‌شده روی کامپیوتر خودتان (بدون R2)
رمز نگهداری Worker را در متغیر محیطی `CHALAK_MAINTENANCE_TOKEN` (فقط روی همان کامپیوتر) بگذارید و هر شب اجرا کنید:
```powershell
node tools/state-transfer.mjs snapshot https://دامنه-شما "D:\chalak-backups\chalak-$(Get-Date -Format yyyyMMdd).json"
```
با Task Scheduler ویندوز می‌توانید این را روزانه اجرا کنید. فایل‌ها داده‌ی کامل پرسنل‌اند؛ در مکان امن و خارج از GitHub نگه دارید و نسخه‌های قدیمی را خودتان پاک کنید.

## فعال‌سازی پشتیبان خودکار R2 (بعداً، وقتی R2 فعال شد)
۱. R2 را در حساب فعال کنید و به توکن «Workers R2 Storage: Edit» بدهید.
۲. `npx wrangler r2 bucket create chalak-backups`
۳. در `scripts/config.mjs` مقدار `R2_BACKUP_ENABLED` را `true` کنید و در `storage-worker/wrangler.jsonc` این‌ها را اضافه کنید:
`"r2_buckets":[{"binding":"CHALAK_BACKUPS","bucket_name":"chalak-backups"}]` و `"triggers":{"crons":["0 0 * * *"]}`
۴. `npm run release:prepare`، Preflight و استقرار Worker. هر شب ۰۰:۰۰ UTC یک Snapshot در R2 ذخیره می‌شود (۳۰ نسخه‌ی آخر؛ اگر داده تغییری نکرده باشد رد می‌شود).

## بازیابی (Restore)
بازیابی کل وضعیت را با پشتیبان **جایگزین می‌کند**؛ تغییرات بعد از آن پشتیبان از بین می‌رود. فقط با مجوز مالک:
1. `node tools/state-transfer.mjs freeze URL REV --execute`
2. **از وضعیت فعلی Export تازه بگیرید:** `node tools/state-transfer.mjs export URL REV FRESH.json`
3. `node tools/state-transfer.mjs verify BACKUP.json`
4. `node tools/state-transfer.mjs restore URL BACKUP.json REV --execute` — Revision جدید = بیشتر از هر دو (فعلی و پشتیبان) + ۱؛ مرورگرهای با داده‌ی قدیمی ۴۰۹ می‌گیرند. Authority بعد از Restore Frozen می‌ماند.
5. با Export و مقایسه (تعداد کارمند/ارزیابی/نمره) درستی را تأیید کنید، سپس `activate`.

## محدودیت‌های شناخته‌شده
- بدون R2، پشتیبان خودکار روی سرور وجود ندارد؛ پنل هشدار می‌دهد و پشتیبان‌گیری با ابزار یا دانلود دستی لازم است.
- شمارنده‌ها از لحظه‌ی استقرار V8 شروع می‌شوند، ۶۰ روز نگه داشته می‌شوند و روزها به وقت UTC‌اند.
- Restore فقط محلی آزمایش شده، نه روی داده‌ی Production. قبل از اتکا، تمرین Restore روی یک Worker آزمایشی انجام دهید.
- مسیر R2 واقعی (ساخت باکت، Cron، پاک‌سازی بیش از ۳۰ نسخه) روی Cloudflare آزمایش نشده است.
- محدودیت‌های V7 (یک Durable Object سراسری، ۴۰۹ برای نوشتن‌های همزمان مستقل، مقیاس اندازه‌گیری‌نشده) برقرارند.
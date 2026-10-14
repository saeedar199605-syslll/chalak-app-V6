# راهنمای ساده اجرای V7 با GitHub

نسخه ۷ دو بخش دارد: **سایت (Pages)** و **بخش ذخیره داده (Worker)**. هر دو از همین مخزن ساخته می‌شوند. ترتیب را رعایت کنید.

## ۰) آپلود روی GitHub
یک مخزن **خصوصی** (Private) بسازید و محتوای همین پوشه را در آن بگذارید (فایل‌های داخل ZIP، نه خود ZIP).

## ۱) بخش ذخیره داده (Worker) — اول این
1. Cloudflare → Workers & Pages → Create → Import a repository → مخزن را انتخاب کنید.
2. نام: `chalak-state-authority` (دقیقاً همین).
3. Root directory: `storage-worker`
4. Deploy command: `npx wrangler deploy`
5. بعد از ساخته شدن: Settings → Variables and Secrets → Add → نوع Secret
   - نام: `STORAGE_MAINTENANCE_TOKEN`
   - مقدار: یک رمز تصادفی بلند (حداقل ۳۲ حرف). آن را جایی امن نگه دارید.

## ۲) سایت (Pages)
1. Workers & Pages → Create → Pages → Connect to Git → همان مخزن. (پروژه شما `chalak-app` است و `wrangler.jsonc` ریشه با همین نام تنظیم شده.)
2. Build command: `npm run build`
3. Build output directory: `dist`
4. Environment variables: `NODE_VERSION` = `24`
5. رمزها (Secrets) پروژه قبلی را دوباره وارد کنید: `ADMIN_PASSWORD`، `GEMINI_API_KEY` و موارد ایمیل اگر استفاده می‌کردید.
6. KV و ارتباط با Worker خودکار از فایل `wrangler.jsonc` می‌آید؛ چیزی نیاز نیست دستی بزنید.

اگر پروژه Pages قدیمی را با Git ساخته بودید، همان را به این مخزن وصل کنید یا شاخه (branch) را عوض کنید.

## ۳) انتقال داده قبلی (یک بار)
از کامپیوتر خودتان، با Node 24 و داخل پوشه پروژه:
```powershell
npm ci
$env:CHALAK_MAINTENANCE_TOKEN = "همان-رمز-مرحله-۱"
node tools/state-transfer.mjs seal STATE.json META.json BACKUP.json
node tools/state-transfer.mjs migrate https://دامنه-شما BACKUP.json --execute
node tools/state-transfer.mjs activate https://دامنه-شما شماره-Revision --execute
```
`STATE.json` و `META.json` خروجی کلیدهای `app_state` و `app_state_meta` از KV قدیمی‌اند. قبل از انتقال، نسخه قدیمی نباید دیگر چیزی بنویسد.

## ۴) بررسی
- `https://دامنه-شما/release.json` باید `7.0.0` نشان دهد.
- `https://دامنه-شما/api/health` باید `sqlite-durable-object` و `7.0.0` نشان دهد.

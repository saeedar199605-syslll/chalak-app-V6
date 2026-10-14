# CHALAK PERFORMANCE V8

نسخه‌ی ارتقای V7 با **پنل سلامت سیستم**، **دانلود پشتیبان برای Admin**، **پشتیبان فقط‌خواندنی با ابزار نگهداری (snapshot)**، **Restore** و پشتیبان خودکار **R2 (اختیاری، پیش‌فرض خاموش)**. مراحل ارتقا و بازیابی در `V8-CUTOVER.md` است.

| مسیر | کاربرد |
|---|---|
| `pages/` | Frontend ساخته‌شده + Functions (`_worker.js/index.js`) |
| `worker/` | Worker `chalak-state-authority` (کلاس `ChalakState`؛ R2 و Cron فقط وقتی `R2_BACKUP_ENABLED` فعال شود) |
| `scripts/` | verify، preflight (فقط GET)، deploy با توقف در خطا |
| `tools/state-transfer.mjs` | backup/verify/dry-run/migrate/freeze/activate/export/restore/rollback |
| `artifact-hashes.json` | Hash فایل‌های اجرایی |

**R2 لازم نیست** (پیش‌فرض خاموش است). اسکریپت‌ها هیچ منبع جدیدی نمی‌سازند و Secret نمی‌نویسند.
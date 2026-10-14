import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Download, RefreshCw } from 'lucide-react';
import { formatTehranDateTime } from '../utils/iranDate';

interface HealthResponse {
  version: string;
  mode: string;
  initialized: boolean;
  revision: number;
  updatedAt: string;
  updatedBy: string | null;
  receipts: number;
  totalApproxBytes: number;
  collections: { collection: string; records: number; approxBytes: number }[];
  metrics: { day: string; name: string; n: number }[];
  backups: { at: string; kind: string; status: string; revision: number | null; bytes: number | null; detail: string }[];
  lastScheduledBackup: { at: string; revision: number | null; bytes: number | null } | null;
  backupTarget: { r2Bound: boolean; keep: number; schedule: string };
  now: string;
}

const METRIC_LABELS: [string, string][] = [
  ['commits', 'ذخیره موفق'],
  ['rebased', 'ادغام خودکار'],
  ['conflicts', 'تعارض (۴۰۹)'],
  ['rejected', 'ردشده'],
  ['failures', 'خطای سرور'],
  ['frozen_rejected', 'رد به‌دلیل توقف'],
  ['backup_downloads', 'دانلود پشتیبان'],
  ['operator_snapshots', 'پشتیبان ابزار'],
];
const KIND_LABELS: Record<string, string> = { scheduled: 'خودکار (R2)', download: 'دانلود دستی', operator: 'ابزار نگهداری', restore: 'بازیابی' };
const STATUS_LABELS: Record<string, string> = { ok: 'موفق', failed: 'ناموفق', skipped: 'رد شد' };
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);
const fa = (n: number) => n.toLocaleString('fa-IR');

export default function SystemHealthPanel() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/health', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 403 ? 'دسترسی فقط برای مدیر سیستم است.' : `پاسخ ناموفق (${response.status})`);
      setHealth(await response.json() as HealthResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطای ناشناخته');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const download = async () => {
    setDownloading(true);
    setError('');
    try {
      const response = await fetch('/api/backup', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`دریافت پشتیبان ناموفق بود (${response.status})`);
      const blob = await response.blob();
      const revision = response.headers.get('Content-Disposition')?.match(/r(\d+)\.json/)?.[1] || 'x';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `chalak-backup-r${revision}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطای ناشناخته');
    } finally {
      setDownloading(false);
    }
  };

  const days: string[] = health ? Array.from(new Set<string>(health.metrics.map(m => m.day))).sort().reverse() : [];
  const value = (day: string, name: string) => health?.metrics.find(m => m.day === day && m.name === name)?.n || 0;
  const staleBackup = health?.lastScheduledBackup ? Date.now() - new Date(health.lastScheduledBackup.at).getTime() > 36 * 3600 * 1000 : true;
  const lastExternal = health?.backups.find(b => b.status === 'ok' && (b.kind === 'download' || b.kind === 'operator')) || null;
  const staleExternal = lastExternal ? Date.now() - new Date(lastExternal.at).getTime() > 48 * 3600 * 1000 : true;
  const unsavedProblem = health ? health.metrics.some(m => m.day === days[0] && m.name === 'failures' && m.n > 0) : false;

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 space-y-5" dir="rtl" data-testid="system-health-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center hp-text-ok">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-100">سلامت سیستم و پشتیبان‌گیری</h3>
            <p className="text-[11px] text-slate-400">فقط مدیر سیستم؛ داده مستقیم از پایگاه‌داده سرور خوانده می‌شود.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} disabled={loading} className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 flex items-center gap-2 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> بازخوانی
          </button>
          <button type="button" onClick={() => void download()} disabled={downloading || !health} className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white flex items-center gap-2 disabled:opacity-50" data-testid="download-backup">
            <Download className="w-4 h-4" /> {downloading ? 'در حال آماده‌سازی…' : 'دانلود پشتیبان کامل'}
          </button>
        </div>
      </div>

      {error && <div role="alert" className="hp-banner hp-err text-xs p-3">{error}</div>}

      {health && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="rounded-2xl bg-slate-950/50 border border-slate-800 p-3">
              <div className="text-slate-400">وضعیت ذخیره‌سازی</div>
              <div className={`font-black mt-1 ${health.mode === 'active' ? 'hp-text-ok' : 'hp-text-warn'}`}>{health.mode === 'active' ? 'فعال' : 'متوقف (Frozen)'}</div>
            </div>
            <div className="rounded-2xl bg-slate-950/50 border border-slate-800 p-3">
              <div className="text-slate-400">شماره نسخه داده</div>
              <div className="font-black mt-1 text-slate-100" data-testid="health-revision">{fa(health.revision)}</div>
            </div>
            <div className="rounded-2xl bg-slate-950/50 border border-slate-800 p-3">
              <div className="text-slate-400">آخرین ذخیره</div>
              <div className="font-black mt-1 text-slate-100">{health.updatedAt ? formatTehranDateTime(health.updatedAt) : '—'}</div>
            </div>
            <div className="rounded-2xl bg-slate-950/50 border border-slate-800 p-3">
              <div className="text-slate-400">حجم تقریبی داده</div>
              <div className="font-black mt-1 text-slate-100">{fa(Number(mb(health.totalApproxBytes)))} مگابایت</div>
            </div>
          </div>

          {!health.backupTarget.r2Bound && (lastExternal && !staleExternal ? (
            <div className="hp-banner hp-ok text-xs p-3 flex gap-2 items-center">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>آخرین پشتیبان بیرونی: {formatTehranDateTime(lastExternal.at)} (نسخه {fa(lastExternal.revision ?? 0)}، {KIND_LABELS[lastExternal.kind] || lastExternal.kind}). پشتیبان خودکار روی سرور (R2) فعال نیست.</span>
            </div>
          ) : (
            <div className="hp-banner hp-warn text-xs p-3 flex gap-2 items-start">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>پشتیبان خودکار روی سرور (R2) فعال نیست و {lastExternal ? `آخرین پشتیبان بیرونی بیش از ۴۸ ساعت پیش بوده است (${formatTehranDateTime(lastExternal.at)})` : 'هیچ پشتیبان بیرونی ثبت نشده است'}. «دانلود پشتیبان کامل» را بزنید یا پشتیبان‌گیری زمان‌بندی‌شده با ابزار نگهداری را راه‌اندازی کنید.</span>
            </div>
          ))}
          {health.backupTarget.r2Bound && staleBackup && (
            <div className="hp-banner hp-warn text-xs p-3 flex gap-2 items-start">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{health.lastScheduledBackup ? `آخرین پشتیبان خودکار موفق بیش از ۳۶ ساعت پیش بوده است (${formatTehranDateTime(health.lastScheduledBackup.at)}).` : 'هنوز هیچ پشتیبان خودکار موفقی ثبت نشده است.'} اگر داده‌ی جدیدی ذخیره نشده، تغییری برای پشتیبان‌گیری وجود نداشته است.</span>
            </div>
          )}
          {health.backupTarget.r2Bound && !staleBackup && health.lastScheduledBackup && (
            <div className="hp-banner hp-ok text-xs p-3 flex gap-2 items-center">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>آخرین پشتیبان خودکار: {formatTehranDateTime(health.lastScheduledBackup.at)} (نسخه {fa(health.lastScheduledBackup.revision ?? 0)}). نگهداری {fa(health.backupTarget.keep)} نسخه‌ی آخر.</span>
            </div>
          )}
          {unsavedProblem && (
            <div className="hp-banner hp-err text-xs p-3">امروز خطای سرور هنگام ذخیره ثبت شده است؛ مقدار «خطای سرور» را در جدول زیر بررسی کنید.</div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <caption className="text-right text-slate-300 font-bold pb-2">فعالیت ۷ روز اخیر (به وقت UTC)</caption>
              <thead><tr className="text-slate-400"><th className="p-2">روز</th>{METRIC_LABELS.map(([, label]) => <th key={label} className="p-2">{label}</th>)}</tr></thead>
              <tbody>
                {days.length === 0 && <tr><td colSpan={METRIC_LABELS.length + 1} className="p-2 text-slate-500">هنوز فعالیتی ثبت نشده است.</td></tr>}
                {days.map(day => (
                  <tr key={day} className="border-t border-slate-800 text-slate-200">
                    <td className="p-2 font-mono" dir="ltr">{day}</td>
                    {METRIC_LABELS.map(([name]) => <td key={name} className="p-2">{fa(value(day, name))}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <caption className="text-right text-slate-300 font-bold pb-2">آخرین پشتیبان‌ها</caption>
              <thead><tr className="text-slate-400"><th className="p-2">زمان</th><th className="p-2">نوع</th><th className="p-2">وضعیت</th><th className="p-2">نسخه</th><th className="p-2">حجم</th></tr></thead>
              <tbody>
                {health.backups.length === 0 && <tr><td colSpan={5} className="p-2 text-slate-500">هنوز پشتیبانی ثبت نشده است.</td></tr>}
                {health.backups.map((b, i) => (
                  <tr key={i} className="border-t border-slate-800 text-slate-200" title={b.detail}>
                    <td className="p-2">{formatTehranDateTime(b.at)}</td>
                    <td className="p-2">{KIND_LABELS[b.kind] || b.kind}</td>
                    <td className={`p-2 font-bold ${b.status === 'ok' ? 'hp-text-ok' : b.status === 'failed' ? 'hp-text-bad' : 'hp-text-muted'}`}>{STATUS_LABELS[b.status] || b.status}</td>
                    <td className="p-2">{b.revision == null ? '—' : fa(b.revision)}</td>
                    <td className="p-2">{b.bytes == null ? '—' : `${fa(Number(mb(b.bytes)))} مگابایت`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="text-xs text-slate-300">
            <summary className="cursor-pointer font-bold">حجم بخش‌های داده</summary>
            <table className="w-full mt-2 text-right">
              <thead><tr className="text-slate-400"><th className="p-2">بخش</th><th className="p-2">رکورد</th><th className="p-2">حجم تقریبی (کیلوبایت)</th></tr></thead>
              <tbody>
                {health.collections.map(c => (
                  <tr key={c.collection} className="border-t border-slate-800"><td className="p-2 font-mono" dir="ltr">{c.collection}</td><td className="p-2">{fa(c.records)}</td><td className="p-2">{fa(Math.round(c.approxBytes / 1024))}</td></tr>
                ))}
              </tbody>
            </table>
          </details>

          <p className="text-[11px] text-slate-500">فایل پشتیبان شامل اطلاعات کامل پرسنل است؛ آن را فقط در محل امن نگه دارید و از طریق پیام‌رسان یا ایمیل عمومی ارسال نکنید.</p>
        </>
      )}
    </div>
  );
}

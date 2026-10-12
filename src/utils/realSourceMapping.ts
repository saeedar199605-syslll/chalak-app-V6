import type { Employee } from '../types';
import { normalizePersonnelCode } from './personnelSearch';
import { normalizeCriterionImportHeader } from './criterionSourceRegistry';
import { parseBusinessDate } from './businessDate';

export type SourceRow = unknown[];
export interface SourceIssue { row: number; reason: string }
const digits = (v: unknown) => String(v ?? '').replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim();
export function sourceNumber(v: unknown): number | null { if (v === null || v === undefined || digits(v) === '') return null; const s = digits(v); if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null; const n = Number(s); return Number.isFinite(n) ? n : null; }
/** Numeric minutes must be explicit; blank/invalid durations never become zero. */
export function durationMinutes(v: unknown, numericUnit: 'minutes' | 'excel_days' = 'minutes'): number | null {
  const s = digits(v); const clock = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (clock) return Number(clock[2]) < 60 && Number(clock[3] || 0) < 60 ? Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3] || 0) / 60 : null;
  const n = sourceNumber(v); return n !== null && n >= 0 ? n * (numericUnit === 'excel_days' ? 1440 : 1) : null;
}
function table(rows: SourceRow[]) {
  const headers = (rows[0] || []).map(v => normalizeCriterionImportHeader(String(v || '')));
  return { read: (row: SourceRow, name: string) => { const indexes = headers.flatMap((h, i) => h === normalizeCriterionImportHeader(name) ? [i] : []); const values = indexes.map(i => row[i]).filter(v => v !== '' && v != null); if (new Set(values.map(v => digits(v))).size > 1) throw new Error(`ستون تکراری مبهم: ${name}`); return values[0]; }, require: (names: string[]) => { if (names.some(n => !headers.includes(normalizeCriterionImportHeader(n)))) throw new Error('سرستون‌های فایل با منبع انتخاب‌شده منطبق نیستند.'); } };
}
export interface RosterPerson { code: string; unit: string; internalJob: string; jobTitle: string; jobCode: string; shift: string; departed: boolean; source: 'main' | 'secondary' }
export function parsePersonnelRoster(main: SourceRow[], secondary: SourceRow[]) {
  const issues: SourceIssue[] = []; const read = (rows: SourceRow[], source: 'main' | 'secondary') => {
    const t = table(rows); t.require(['کد پرسنلی', 'واحد اصلی']); const byCode = new Map<string, RosterPerson>();
    rows.slice(1).forEach((row, index) => { if (row.every(v => v == null || v === '')) return;
      try { const code = normalizePersonnelCode(String(t.read(row, 'کد پرسنلی') ?? '')); if (!code) { issues.push({ row: index + 2, reason: 'کد پرسنلی خالی' }); return; }
        const person: RosterPerson = { code, unit: String(t.read(row, 'واحد اصلی') || '').trim(), internalJob: String(t.read(row, source === 'main' ? 'شرح شغل (داخلی)' : 'شرح شغل') || '').trim(), jobTitle: String(t.read(row, source === 'main' ? 'عنوان شغل بهکو (1402/04/28)' : 'عنوان شغل') || '').trim(), jobCode: String(t.read(row, 'کد شغل بهکو 1402/04/28') || '').trim(), shift: String(t.read(row, 'شیفت جدید (آپدیت مرداد1405)') || t.read(row, 'شیفت') || '').trim(), departed: Boolean(t.read(row, 'تاریخ ترک کار')), source };
        const old = byCode.get(code); if (old && JSON.stringify(old) !== JSON.stringify(person)) { issues.push({ row: index + 2, reason: 'کد تکراری با نقش متفاوت؛ نیازمند بررسی' }); return; } byCode.set(code, person);
      } catch (e) { issues.push({ row: index + 2, reason: String((e as Error).message) }); }
    }); return byCode;
  };
  const a = read(main, 'main'), b = read(secondary, 'secondary'); const overlap = [...b.keys()].filter(k => a.has(k)).length;
  return { people: [...a.values(), ...[...b.values()].filter(p => !a.has(p.code))], mainCount: a.size, secondaryCount: b.size, overlap, secondaryOnly: b.size - overlap, units: [...new Set([...a.values()].map(p => p.unit).filter(Boolean))], titles: [...new Set([...a.values()].map(p => p.jobTitle).filter(v => v && !v.startsWith('#')))], internalJobs: [...new Set([...a.values()].map(p => p.internalJob).filter(v => v && !v.startsWith('#')))], issues };
}
export interface RawSourceMetric { code: string; date: string; reference: string; metrics: Record<string, number | null> }
export function parseProductionAndDowntime(production: SourceRow[], downtime: SourceRow[], cycleUnit: 'seconds' | 'minutes') {
  const p = table(production), d = table(downtime); p.require(['سریال ردیابی', 'کد پرسنل', 'تاریخ', 'تعداد تولید', 'سایکل تایم استاندارد', 'زمان در دسترس']); d.require(['سریال ردیابی', 'مجموع توقفات']);
  const issues: SourceIssue[] = []; const down = new Map<string, SourceRow>(); const duplicates = new Set<string>();
  downtime.slice(1).forEach(row => { const key = String(d.read(row, 'سریال ردیابی') ?? '').trim(); if (!key) return; if (down.has(key)) duplicates.add(key); else down.set(key, row); });
  const seen = new Set<string>(); const records: RawSourceMetric[] = [];
  production.slice(1).forEach((row, i) => { try { const reference = String(p.read(row, 'سریال ردیابی') ?? '').trim(); const code = normalizePersonnelCode(String(p.read(row, 'کد پرسنل') ?? '')); const date = digits(p.read(row, 'تاریخ')); const match = down.get(reference);
    if (!reference || !code || !parseBusinessDate(date) || !match || duplicates.has(reference) || seen.has(reference)) throw new Error('ردیابی/کد/تاریخ ناقص، توقف نامنطبق یا ردیابی تکراری');
    seen.add(reference); const qty = sourceNumber(p.read(row, 'تعداد تولید')); const scrap = sourceNumber(p.read(row, 'تعداد ضایعات')); const available = durationMinutes(p.read(row, 'زمان در دسترس')); const stopped = durationMinutes(d.read(match, 'مجموع توقفات')); const cycle = sourceNumber(p.read(row, 'سایکل تایم استاندارد')); const operating = available !== null && stopped !== null && available >= stopped ? available - stopped : null;
    records.push({ code, date, reference, metrics: { output_qty: qty, scrap_qty: scrap, available_minutes: available, downtime_minutes: stopped, operating_minutes: operating, earned_minutes: qty !== null && cycle !== null && cycle > 0 ? qty * cycle / (cycleUnit === 'seconds' ? 60 : 1) : null, scrap_rate: qty !== null && qty > 0 && scrap !== null && scrap >= 0 ? scrap / qty * 100 : null, downtime: available !== null && available > 0 && stopped !== null ? stopped / available * 100 : null, efficiency: qty !== null && qty >= 0 && cycle !== null && cycle > 0 && operating !== null && operating > 0 ? qty * cycle / (cycleUnit === 'seconds' ? 60 : 1) / operating * 100 : null } });
  } catch (e) { issues.push({ row: i + 2, reason: (e as Error).message }); } }); return { records, issues };
}
export function parseMaintenance(rows: SourceRow[]) {
  const t = table(rows); t.require(['شماره درخواست', 'شماره پرسنلی', 'زمان کار', 'زمان استاندارد فعالیت', 'تاریخ شروع تعمیر']); const seen = new Map<string, string>(), conflicts = new Set<string>(), records: RawSourceMetric[] = [], issues: SourceIssue[] = [];
  const identifier = (v: unknown) => digits(v).replace(/^0+(?=\d+$)/, '');
  rows.slice(1).forEach((row, i) => { if (row.every(v => v == null || v === '')) return; try { const code = normalizePersonnelCode(String(t.read(row, 'شماره پرسنلی') ?? '')); const date = digits(t.read(row, 'تاریخ شروع تعمیر')).split('/').map((p, i) => i ? p.padStart(2, '0') : p).join('/'); const time = digits(t.read(row, 'ساعت شروع تعمیر')).split(':').map(p => p.padStart(2, '0')); if (time.length === 2) time.push('00'); const reference = [identifier(t.read(row, 'شماره درخواست')), code, date, time.join(':'), identifier(t.read(row, 'کد فعالیت'))].join(':');
    if (!code || !parseBusinessDate(date) || !t.read(row, 'شماره درخواست')) throw new Error('شناسه/تاریخ ناقص');
    const work = durationMinutes(t.read(row, 'زمان کار')), standard = durationMinutes(t.read(row, 'زمان استاندارد فعالیت'));
    const signature = JSON.stringify([work, standard]);
    if (seen.has(reference)) { if (seen.get(reference) !== signature) conflicts.add(reference); throw new Error(conflicts.has(reference) ? 'فعالیت تکراری با زمان متفاوت؛ تمام نسخه‌های این فعالیت کنار گذاشته شدند' : 'فعالیت تکراری؛ دوباره محاسبه نشد'); } seen.set(reference, signature);
    records.push({ code, date, reference, metrics: { maintenance_minutes: work, maintenance_standard_minutes: standard !== null && standard > 0 ? standard : null, maintenance_efficiency: work !== null && work > 0 && standard !== null && standard > 0 ? standard / work * 100 : null } });
  } catch (e) { issues.push({ row: i + 2, reason: (e as Error).message }); } }); return { records: records.filter(r => !conflicts.has(r.reference)), issues };
}
export function parseRealKasra(rows: SourceRow[], periodDate: string) {
  const t = table(rows); t.require(['کد پرسنلی', 'تاخیر', 'سرجمع کسر کار', 'غیبت روزانه']); const seen = new Set<string>(), records: RawSourceMetric[] = [], issues: SourceIssue[] = [];
  rows.slice(1).forEach((row, i) => { try { const code = normalizePersonnelCode(String(t.read(row, 'کد پرسنلی') ?? '')); if (!code || seen.has(code)) throw new Error('کد پرسنلی خالی یا تکراری'); seen.add(code);
    records.push({ code, date: periodDate, reference: `kasra:${periodDate}:${code}`, metrics: { attendance_delay: durationMinutes(t.read(row, 'تاخیر')), attendance_early_departure: durationMinutes(t.read(row, 'تعجیل')), attendance_deficit: durationMinutes(t.read(row, 'سرجمع کسر کار')), attendance_absence: sourceNumber(t.read(row, 'غیبت روزانه')), attendance_required: durationMinutes(t.read(row, 'موظفی روزکار')) } });
  } catch (e) { issues.push({ row: i + 2, reason: (e as Error).message }); } }); return { records, issues };
}
/** Exact-code matching only: no names, substring or nearest-code attribution. */
export function matchRawMetrics(records: RawSourceMetric[], employees: Employee[]) { const byCode = new Map<string, Employee[]>(); employees.forEach(e => { const k = normalizePersonnelCode(e.code); byCode.set(k, [...(byCode.get(k) || []), e]); }); return records.map(record => ({ record, employee: byCode.get(record.code)?.length === 1 ? byCode.get(record.code)![0] : null })); }

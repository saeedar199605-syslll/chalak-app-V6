import React, { useRef, useState } from 'react';
import type { Employee, Evaluation, Criterion, JobProfile } from '../types';
import { readWorkbookRows } from '../utils/excelWorkbook';
import { parseProductionAndDowntime, parseMaintenance, parseRealKasra, type SourceIssue } from '../utils/realSourceMapping';
import { prepareRealSourcePlan } from '../utils/realSourcePlan';
import { canImport } from '../utils/authorization';
import { canonicalEvaluationPeriodId, getEvaluationPeriodStartOrdinal } from '../utils/evaluationPeriod';
import { db } from '../utils/db';
import type { EvaluationSourceImportContext } from '../utils/sourceImports';

export default function RealSourceImport(props: { actor: Employee; employees: Employee[]; evaluations: Evaluation[]; criteria: Criterion[]; profiles: JobProfile[]; onSave: (updates: Evaluation[], source?: EvaluationSourceImportContext, operationId?: string) => boolean | Promise<boolean> | void }) {
  const [kind, setKind] = useState<'production' | 'maintenance' | 'kasra'>('production'); const [period, setPeriod] = useState(db.getMiscData<string>('pe_active_period', '')); const [cycleUnit, setCycleUnit] = useState<'seconds' | 'minutes'>('seconds');
  const [file, setFile] = useState<File | null>(null), [down, setDown] = useState<File | null>(null); const [busy, setBusy] = useState(false); const submitting = useRef(false);
  const [issues, setIssues] = useState<SourceIssue[]>([]), [plan, setPlan] = useState<ReturnType<typeof prepareRealSourcePlan> | null>(null); const [error, setError] = useState(''), [message, setMessage] = useState(''); const operationId = useRef(crypto.randomUUID()); const [rowsRead, setRowsRead] = useState(0), [complete, setComplete] = useState(false);
  const source = kind === 'kasra' ? 'KASRA' : 'MIS';
  if (!canImport(props.actor, source === 'MIS' ? 'mis' : 'kasra').allowed) return null;
  const preview = async () => { if (!file || submitting.current) return; setBusy(true); setError(''); setMessage(''); setPlan(null); setComplete(false); try {
    const workbook = await readWorkbookRows(file); const rows = workbook.rowsBySheet[workbook.sheets[0]];
    let parsed: ReturnType<typeof parseMaintenance>;
    if (kind === 'production') { if (!down) throw new Error('فایل توقفات متناظر لازم است.'); const stops = await readWorkbookRows(down); parsed = parseProductionAndDowntime(rows, stops.rowsBySheet[stops.sheets[0]], cycleUnit); }
    else if (kind === 'maintenance') parsed = parseMaintenance(rows);
    else { const ordinal = getEvaluationPeriodStartOrdinal(period); if (ordinal === null) throw new Error('دوره مشخص نیست.'); parsed = parseRealKasra(rows, `${Math.floor((ordinal - 1) / 12)}/${String((ordinal - 1) % 12 + 1).padStart(2, '0')}/01`); }
    setIssues(parsed.issues); setRowsRead(Math.max(0, rows.length - 1)); setPlan(prepareRealSourcePlan({ records: parsed.records, source, kind, period, employees: props.employees, evaluations: props.evaluations, profiles: props.profiles, criteria: props.criteria, actor: props.actor })); operationId.current = crypto.randomUUID();
  } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const confirm = async () => { if (!plan || !complete || submitting.current) return; submitting.current = true; setBusy(true); setError(''); try { const accepted = await props.onSave(plan.updates, { importType: source, operationId: operationId.current, evaluationPeriodId: canonicalEvaluationPeriodId(period), rowsRead }, operationId.current); if (accepted !== true) { setError('سرور ذخیره را تأیید نکرد. پیش‌نمایش حفظ شد؛ در خطای ۵۰۳ نتیجه عملیات از رسید سرور بررسی می‌شود.'); return; } setMessage(`${plan.updates.length} پرونده و ${plan.scoresUpdated} نمره روی سرور ثبت شد؛ ${issues.length + plan.rejected.length} مورد ردشده/نیازمند بررسی.`); setPlan(null); } catch (e) { setError((e as Error).message); } finally { submitting.current = false; setBusy(false); } };
  return <details className="rounded-xl border p-4 space-y-3" dir="rtl"><summary className="font-bold">ورود فایل‌های واقعی تولید، توقفات، نت و کسری</summary>
    <p>فقط معیارهای پروفایل با منبع صحیح، نام فیلد و آستانهٔ تنظیم‌شده محاسبه می‌شوند. دادهٔ ناقص نمره نمی‌گیرد. نمرهٔ دستی و پروندهٔ نهایی حفظ می‌شود.</p>
    <fieldset disabled={busy || !!plan} className="flex flex-wrap gap-3"><select aria-label="منبع فایل واقعی" value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="production">تولید + توقفات</option><option value="maintenance">نت</option><option value="kasra">کسری</option></select><input aria-label="دوره فایل واقعی" value={period} onChange={e => setPeriod(e.target.value)} placeholder="شهریور 1405" />
      <input aria-label="فایل منبع واقعی" type="file" accept=".xlsx,.csv,.xls,.xml" onChange={e => setFile(e.target.files?.[0] || null)} />{kind === 'production' && <><input aria-label="فایل توقفات" type="file" accept=".xlsx,.csv" onChange={e => setDown(e.target.files?.[0] || null)} /><select aria-label="واحد سایکل استاندارد" value={cycleUnit} onChange={e => setCycleUnit(e.target.value as typeof cycleUnit)}><option value="seconds">سایکل استاندارد به ثانیه</option><option value="minutes">سایکل استاندارد به دقیقه</option></select></>}
      <button type="button" disabled={!file} onClick={() => void preview()}>پیش‌نمایش و محاسبه</button></fieldset>
    {busy && <p role="status">در حال پردازش و ذخیره…</p>}{error && <p role="alert" className="text-red-600">{error}</p>}{message && <p role="status" className="text-green-700">{message}</p>}
    {plan && <div role="dialog" aria-label="تأیید فایل واقعی"><p>{rowsRead} ردیف خوانده‌شده؛ {plan.updates.length} پرونده آماده؛ {plan.scoresUpdated} نمره؛ {issues.length + plan.rejected.length} مورد ردشده/نیازمند بررسی</p>
      <div className="max-h-48 overflow-auto">{issues.slice(0, 20).map((r, i) => <p key={i}>ردیف {r.row}: {r.reason}</p>)}{plan.rejected.slice(0, 20).map((r, i) => <p key={`r${i}`}>{r.reference}: {r.reason}</p>)}</div>
      <label><input type="checkbox" disabled={busy} checked={complete} onChange={e => setComplete(e.target.checked)} />کامل‌بودن دادهٔ ماه برای کارکنان انتخاب‌شده، واحد زمان و موارد ردشده را بررسی کردم. مقادیر این منبع جایگزین مقادیر قبلی همین دوره می‌شود.</label>
      <button type="button" disabled={busy || !complete || !plan.updates.length} onClick={() => void confirm()}>{busy ? 'در حال ذخیره روی سرور…' : 'تأیید و ذخیره یک‌باره'}</button><button type="button" disabled={busy} onClick={() => setPlan(null)}>انصراف</button>
    </div>}
  </details>;
}

import React, { useEffect, useRef, useState } from 'react';
import type { Employee } from '../types';
import { db } from '../utils/db';
import { authorize } from '../utils/authorization';
import { EMPTY_VIOLATION_POLICY, parseViolationRows, type ViolationCommand, type ViolationPolicy, type ViolationRecord } from '../utils/disciplinaryViolations';
import { readWorkbookRows, downloadWorkbook } from '../utils/excelWorkbook';
import { canonicalEvaluationPeriodId } from '../utils/evaluationPeriod';
import { getJalaliDateKey } from '../utils/iranDate';
import ViolationPolicyEditor from './ViolationPolicyEditor';

const labels: Record<string, string> = { draft: 'پیش‌نویس', submitted: 'ارسال‌شده', review: 'در بررسی', approved: 'تأییدشده', rejected: 'ردشده', appealed: 'اعتراض ثبت‌شده', reversed: 'برگشت‌خورده' };
export default function ViolationManager({ actor, employees }: { actor: Employee; employees: Employee[] }) {
  const [revision, refresh] = useState(0); const [busy, setBusy] = useState(false); const submitting = useRef(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(''); const [date, setDate] = useState(getJalaliDateKey()); const [period, setPeriod] = useState(db.getMiscData<string>('pe_active_period', ''));
  const [category, setCategory] = useState(''); const [severity, setSeverity] = useState(''); const [evidence, setEvidence] = useState(''); const [description, setDescription] = useState(''); const [reason, setReason] = useState('');
  const [prepared, setPrepared] = useState<ViolationCommand[]>([]); const [rejected, setRejected] = useState<Array<{ row: number; reason: string }>>([]); const operation = useRef(crypto.randomUUID());
  useEffect(() => { const listener = () => refresh(v => v + 1); window.addEventListener('pe_db_updated', listener); return () => window.removeEventListener('pe_db_updated', listener); }, []);
  const policy = db.getMiscData<ViolationPolicy>('pe_violation_policy', EMPTY_VIOLATION_POLICY);
  const records = db.getMiscData<ViolationRecord[]>('pe_violations', []);
  const allowedEmployees = employees.filter(e => authorize(actor, 'violations', 'create', e).allowed);
  const commit = async (commands: ViolationCommand[]) => {
    if (submitting.current) return; submitting.current = true; setBusy(true); setError(''); setMessage('');
    try { const accepted = await db.commitBulkState({ pe_violation_operations: commands }, operation.current); if (!accepted) { setError('ثبت روی سرور تأیید نشد. اطلاعات آماده‌شده حفظ شد؛ پیام وضعیت ذخیره را بررسی کنید.'); return; }
      setMessage(`${commands.length} اقدام روی سرور ثبت شد؛ ${rejected.length} ردیف ردشده حفظ شده است.`); setPrepared([]); operation.current = crypto.randomUUID(); refresh(v => v + 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'ارتباط با سرور ناموفق بود؛ نتیجه ذخیره تأیید نشد.'); } finally { submitting.current = false; setBusy(false); }
  };
  const prepareManual = () => {
    if (!employeeId || !category || !severity || !evidence.trim() || !description.trim() || !period.trim()) { setError('کارمند، دوره، دسته، شدت، مدرک و شرح را کامل کنید.'); return; }
    operation.current = crypto.randomUUID(); setRejected([]); setPrepared([{ action: 'create', record: { id: crypto.randomUUID(), employeeId, periodId: canonicalEvaluationPeriodId(period), date, categoryId: category, severity, evidence, description, source: 'manual' } }]);
  };
  const action = (record: ViolationRecord, name: Exclude<ViolationCommand['action'], 'create'>) => { if (!reason.trim()) { setError('دلیل اقدام را وارد کنید.'); return; } operation.current = crypto.randomUUID(); void commit([{ action: name, id: record.id, reason, ...(name === 'approve' ? { attendanceJustification: reason } : {}) }]); };
  if (!authorize(actor, 'violations', 'view').allowed && !records.some(r => r.employeeId === actor.id)) return null;
  return <section className="rounded-2xl border p-4 space-y-3" dir="rtl" data-revision={revision}>
    <button type="button" onClick={() => setOpen(v => !v)} className="font-bold">تخلفات و کسر امتیاز</button>
    {open && <><p>ثبت و ارسال تخلف نمره را تغییر نمی‌دهد. کسر فقط با تأیید مستقل و سیاست فعال انجام می‌شود. اعتراض تا تصمیم برگشت، کسر قبلی را حفظ می‌کند.</p>
      <p>{policy.active ? `سیاست فعال: ${policy.version} — سقف کسر: ${policy.maximumDeduction}` : 'سیاست کسر امتیاز غیرفعال است.'}</p>
      {error && <p role="alert" className="text-red-600">{error}</p>}{message && <p role="status" className="text-green-700">{message}</p>}{busy && <p role="status">در حال ثبت روی سرور…</p>}
      <fieldset disabled={busy} className="grid gap-2 sm:grid-cols-2">
        <select aria-label="کارمند تخلف" value={employeeId} onChange={e => setEmployeeId(e.target.value)}><option value="">کارمند</option>{allowedEmployees.map(e => <option key={e.id} value={e.id}>{e.code} — {e.name} — {e.unit}</option>)}</select>
        <input aria-label="دوره تخلف" value={period} onChange={e => setPeriod(e.target.value)} placeholder="دوره" /><input aria-label="تاریخ تخلف" value={date} onChange={e => setDate(e.target.value)} placeholder="1405/06/01" />
        <select aria-label="دسته تخلف" value={category} onChange={e => { setCategory(e.target.value); setSeverity(''); }}><option value="">دسته</option>{policy.categories.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
        <select aria-label="شدت تخلف" value={severity} onChange={e => setSeverity(e.target.value)}><option value="">شدت</option>{Object.keys(policy.categories.find(c => c.id === category)?.points || {}).map(s => <option key={s}>{s}</option>)}</select>
        <input aria-label="مدرک تخلف" value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="شناسه مدرک" /><textarea aria-label="شرح تخلف" value={description} onChange={e => setDescription(e.target.value)} placeholder="شرح" />
        <button type="button" disabled={!allowedEmployees.length} onClick={prepareManual}>پیش‌نمایش ثبت دستی</button>
        {authorize(actor, 'violations', 'import').allowed && <label>اکسل تخلفات<input type="file" accept=".xlsx,.csv" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { const workbook = await readWorkbookRows(file); const parsed = parseViolationRows(workbook.rowsBySheet[workbook.sheets[0]], employees.filter(person => authorize(actor, 'violations', 'import', person).allowed), canonicalEvaluationPeriodId(period)); operation.current = crypto.randomUUID(); setPrepared(parsed.records.map(record => ({ action: 'create', record }))); setRejected(parsed.rejected); setError(''); } catch (err) { setError((err as Error).message); } }} /></label>}
        <button type="button" onClick={() => void downloadWorkbook('قالب-تخلفات.xlsx', [{ name: 'تخلفات', rows: [['شناسه خارجی', 'کد پرسنلی', 'تاریخ', 'دسته', 'شدت', 'مدرک', 'شرح']] }, { name: 'دسته‌های مجاز', rows: [['دسته', 'عنوان', 'شدت'], ...policy.categories.flatMap(c => Object.keys(c.points).map(s => [c.id, c.title, s]))] }])}>دریافت قالب جاری</button>
      </fieldset>
      {prepared.length > 0 && <div role="dialog" aria-label="تأیید تخلفات"><p>{prepared.length} آماده ثبت؛ {rejected.length} ردشده</p>{rejected.map(r => <p key={r.row}>ردیف {r.row}: {r.reason}</p>)}<button disabled={busy} onClick={() => void commit(prepared)}>{busy ? 'در حال ذخیره…' : 'تأیید و ثبت روی سرور'}</button><button disabled={busy} onClick={() => { setPrepared([]); setRejected([]); }}>انصراف</button></div>}
      <textarea aria-label="دلیل بررسی تخلف" placeholder="دلیل اقدام / توجیه مستقل برای موارد حضور" value={reason} disabled={busy} onChange={e => setReason(e.target.value)} />
      <div className="max-h-96 overflow-auto">{records.map(r => { const employee = employees.find(e => e.id === r.employeeId); const canApprove = employee && authorize(actor, 'violations', 'approve', employee).allowed; const canSubmit = employee && authorize(actor, 'violations', 'submit', employee).allowed; const canReview = employee && authorize(actor, 'violations', 'edit', employee).allowed;
        return <article key={r.id} className="border-b py-3"><p>{employee?.name || r.employeeId} — {r.date} — {r.description} — {labels[r.status]} — کسر مصوب: {r.points}</p>
          {r.status === 'draft' && canSubmit && <button disabled={busy} onClick={() => action(r, 'submit')}>ارسال برای بررسی</button>}{r.status === 'submitted' && canReview && <button disabled={busy} onClick={() => action(r, 'review')}>شروع بررسی</button>}
          {r.status === 'review' && canApprove && r.reporterId !== actor.id && <button disabled={busy || !policy.active} onClick={() => action(r, 'approve')}>تأیید طبق سیاست</button>}{['submitted', 'review'].includes(r.status) && canApprove && <button disabled={busy} onClick={() => action(r, 'reject')}>رد با دلیل</button>}
          {r.status === 'approved' && (r.employeeId === actor.id || canSubmit) && <button disabled={busy} onClick={() => action(r, 'appeal')}>ثبت اعتراض</button>}{['approved', 'appealed'].includes(r.status) && canApprove && <button disabled={busy} onClick={() => action(r, 'reverse')}>برگشت با دلیل</button>}
          <details><summary>تاریخچه</summary>{r.history.map((h, i) => <p key={i}>{h.at} — {h.actorId} — {h.action} — {h.reason}</p>)}</details></article>; })}</div>
      {actor.role === 'admin' && <ViolationPolicyEditor initial={policy} busy={busy} onSaved={() => refresh(v => v + 1)} />}
    </>}
  </section>;
}

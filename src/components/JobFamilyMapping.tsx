import React, { useRef, useState } from 'react';
import type { Criterion, Employee, JobProfile } from '../types';
import { readWorkbookRows } from '../utils/excelWorkbook';
import { parsePersonnelRoster } from '../utils/realSourceMapping';
import { JOB_FAMILIES, suggestJobFamily, validateApprovedFamilyAssignment, type ApprovedFamilyAssignment } from '../utils/jobFamilyRegistry';
import { db } from '../utils/db';
import { ROLE_KPI_DRAFTS } from '../utils/roleKpiDrafts';
import { personnelRolePreview } from '../utils/personnelRolePreview';
import { normalizePersonnelCode } from '../utils/personnelSearch';

export default function JobFamilyMapping({ actor, profiles, criteria }: { actor: Employee; profiles: JobProfile[]; criteria: Criterion[] }) {
  const [roster, setRoster] = useState<ReturnType<typeof parsePersonnelRoster> | null>(null); const [title, setTitle] = useState(''); const [family, setFamily] = useState(''); const [profileId, setProfile] = useState(''); const [reference, setReference] = useState(''); const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const assignments = db.getMiscData<Record<string, ApprovedFamilyAssignment>>('pe_job_family_assignments', {});
  const [personCode, setPersonCode] = useState(''), [confirmed, setConfirmed] = useState(false);
  const submitting = useRef(false);
  const person = roster?.people.find(p => p.code === personCode);
  const personalPreview = person ? personnelRolePreview(person, family) : null;
  const assignPerson = async () => {
    if (!person || !confirmed || person.departed || submitting.current) return;
    const assignment = { familyId: family, profileId, approvalReference: reference, personnelCode: person.code, jobTitle: person.jobTitle, internalJob: person.internalJob };
    const employees = db.getEmployees();
    const matches = employees.filter(e => normalizePersonnelCode(e.code) === person.code);
    if (matches.length !== 1 || !validateApprovedFamilyAssignment(assignment, profiles, criteria)) { setMessage('کد یکتای موجود، شرح و عنوان تأییدشده، پروفایل مصوب با وزن ۱۰۰ و مرجع تأیید لازم است.'); return; }
    submitting.current = true; setBusy(true);
    try {
      const accepted = await db.commitBulkState({ pe_employees: employees.map(e => e.id === matches[0].id ? { ...e, profileId } : e), pe_job_family_assignments: { ...db.getMiscData<Record<string, ApprovedFamilyAssignment>>('pe_job_family_assignments', {}), [`person:${person.code}`]: assignment } }, crypto.randomUUID());
      setMessage(accepted ? 'انتساب همین کد و مرجع تأیید روی سرور ثبت شد؛ مدل‌های پیشنهادی سراسری فعال نشدند.' : 'سرور انتساب را تأیید نکرد؛ انتخاب شما حفظ شد.');
    } catch (error) { setMessage((error as Error).message); } finally { submitting.current = false; setBusy(false); }
  };
  return <details className="rounded-xl border p-4 space-y-3" dir="rtl"><summary className="font-bold">خانواده‌های شغلی و نگاشت فهرست واقعی</summary><p>۲۱ خانواده پیشنهادی؛ پروفایل و وزن‌ها پس از بررسی تأیید می‌شوند. ورود فهرست، کارکنان تاریخی را فعال نمی‌کند و پروفایل فعلی کارکنان را خودکار عوض نمی‌کند.</p>
    <input type="file" aria-label="فهرست واقعی پرسنل" accept=".xlsx" disabled={busy} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; setBusy(true); try { const w = await readWorkbookRows(file); if (!w.rowsBySheet['پرسنل چالاک'] || !w.rowsBySheet['پرسنل چالاک 2']) throw new Error('دو شیت فهرست اصلی و ثانویه لازم است.'); setRoster(parsePersonnelRoster(w.rowsBySheet['پرسنل چالاک'], w.rowsBySheet['پرسنل چالاک 2'])); setMessage('پیش‌نمایش آماده است؛ داده‌ای نوشته نشد.'); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); } }} />
    {roster && <><p>اصلی: {roster.mainCount}؛ ثانویه: {roster.secondaryCount}؛ مشترک: {roster.overlap}؛ فقط ثانویه: {roster.secondaryOnly}؛ یکتا: {roster.people.length}؛ واحد: {roster.units.length}؛ عنوان معتبر: {roster.titles.length}؛ شرح داخلی متمایز: {roster.internalJobs.length}</p><p>فاقد پیشنهاد قطعی: {roster.titles.filter(t => !suggestJobFamily(t)).join('، ') || 'ندارد'}؛ {roster.issues.length} ردیف نیازمند بررسی.</p>
      <select aria-label="عنوان واقعی شغل" value={title} onChange={e => { setTitle(e.target.value); setFamily(assignments[e.target.value]?.familyId || suggestJobFamily(e.target.value) || ''); setProfile(assignments[e.target.value]?.profileId || ''); setReference(assignments[e.target.value]?.approvalReference || ''); }}><option value="">انتخاب عنوان واقعی</option>{roster.titles.map(t => <option key={t}>{t}</option>)}</select></>}
    {roster && <div><select aria-label="کد پرسنلی پیش‌نمایش نقش" disabled={busy} value={personCode} onChange={e => { const p = roster.people.find(p => p.code === e.target.value); setPersonCode(e.target.value); setConfirmed(false); setProfile(''); setReference(''); if (p) { setTitle(p.jobTitle); setFamily(personnelRolePreview(p).model?.familyId || ''); } }}><option value="">انتخاب کد پرسنلی</option>{roster.people.map(p => <option key={p.code} value={p.code}>{p.code} — {p.jobTitle} — {p.internalJob}</option>)}</select>
      {person && personalPreview && <div aria-label="پیش‌نمایش ارزیابی نقش"><p>{person.code}؛ {person.jobTitle}؛ {person.internalJob}؛ {person.unit}</p><p>{personalPreview.note}</p><p>پیشنهاد: {personalPreview.candidates.map(c => c.title).join(' + ') || 'نیازمند تعیین شرح وظایف'}؛ پروفایل فعلی: {profiles.find(p => p.id === db.getEmployees().find(e => normalizePersonnelCode(e.code) === person.code)?.profileId)?.title || 'بدون تطبیق یکتا'}</p><label><input type="checkbox" disabled={busy || person.departed} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />عنوان، شرح وظایف، مدل انتخابی و مرجع تصویب این کد را تأیید می‌کنم.</label><button type="button" disabled={busy || !confirmed || actor.role !== 'admin'} onClick={() => void assignPerson()}>انتساب پروفایل مصوب به همین کد</button></div>}
    </div>}
    <select aria-label="خانواده ارزیابی" disabled={busy} value={family} onChange={e => { setFamily(e.target.value); setConfirmed(false); }}><option value="">خانواده</option>{JOB_FAMILIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
    {family && <div><p>مدل پیشنهادیِ غیرفعال؛ وزن، هدف، آستانه، شواهد تخصصی و دوره باید در پروفایل مصوب بررسی شوند. برای لیفتراک، حمل ایمن و دقیق جایگزین دقت تراکنش می‌شود؛ مسئولیت انبار به راننده نسبت داده نمی‌شود.</p><table><thead><tr><th>معیار پیشنهادی</th><th>وزن</th><th>منبع</th><th>هدف/آستانه</th></tr></thead><tbody>{ROLE_KPI_DRAFTS.find(d => d.familyId === family)?.criteria.map(c => <tr key={c.id}><td>{c.name}</td><td>{c.weight}٪</td><td>{c.source === 'mis' ? 'MIS پس از اعتبارسنجی' : 'دستی با شواهد نقش'}</td><td>نیازمند تصویب</td></tr>)}</tbody></table></div>}
    <select aria-label="پروفایل مصوب خانواده" value={profileId} onChange={e => setProfile(e.target.value)}><option value="">پروفایل مصوب</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select><input aria-label="مرجع تأیید نگاشت" value={reference} onChange={e => setReference(e.target.value)} placeholder="شماره/مرجع تأیید" />
    <button disabled={busy || actor.role !== 'admin' || !title} onClick={async () => { const assignment = { familyId: family, profileId, approvalReference: reference }; if (!validateApprovedFamilyAssignment(assignment, profiles, criteria)) { setMessage('پروفایل با معیار معتبر، وزن مجموع ۱۰۰ و مرجع تأیید لازم است.'); return; } setBusy(true); try { const accepted = await db.commitBulkState({ pe_job_family_assignments: { ...assignments, [title]: assignment } }, crypto.randomUUID()); setMessage(accepted ? 'نگاشت تأییدشده روی سرور ثبت شد. انتساب کارکنان از فرم کارکنان انجام می‌شود.' : 'سرور نگاشت را تأیید نکرد.'); } finally { setBusy(false); } }}>ثبت نگاشت تأییدشده</button>
    <p role="status">{busy ? 'در حال پردازش…' : message}</p>
  </details>;
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { calibrationCounts } from '../utils/calibrationState';
import { previewBulkAdvance, buildBulkAdvanceUpdates } from '../utils/bulkWorkflow';
import { calculateFinalScore } from '../utils/formulaEngine';
import { isNumericScoreRecorded } from '../utils/scoreSemantics';
import { 
  Scale, 
  Users, 
  Award, 
  TrendingUp, 
  ShieldAlert, 
  CheckCircle2, 
  SlidersHorizontal,
  FileCheck2
} from 'lucide-react';
import { Evaluation, Employee, JobProfile, getGrade, GRADE_DETAILS } from '../types';
import { Button } from './ui/Primitives';

interface CalibrationProps {
  evaluations: Evaluation[];
  employees: Employee[];
  profiles: JobProfile[];
  currentUser: Employee;
  onBulkUpdateEvaluations: (records: Evaluation[]) => boolean | Promise<boolean>;
  onUpdateEvaluation: (id: string, ev: Evaluation) => void;
  onSelectEvaluation: (id: string) => void;
}

export default function Calibration({
  evaluations,
  employees,
  profiles,
  currentUser,
  onBulkUpdateEvaluations,
  onUpdateEvaluation,
  onSelectEvaluation
}: CalibrationProps) {
  // We calibrate active evaluations that have some scores but are not finalized/locked yet
  const scoredEvals = evaluations.filter(ev => {
    const hasScores = ev.scores.some(s => isNumericScoreRecorded(s));
    return hasScores;
  });

  const { ready: readyForCalibration, approved: calibratedCount, completed: lockedCount } = calibrationCounts(evaluations);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(current => Math.min(current, Math.max(0, Math.ceil(readyForCalibration.length / 50) - 1))), [readyForCalibration.length]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedEvaluationIds, setSelectedEvaluationIds] = useState<string[]>([]);
  const [showBulkPreview, setShowBulkPreview] = useState(false);
  const saving = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const currentPageRows = readyForCalibration.slice(page * 50, page * 50 + 50);
  const bulkPreview = previewBulkAdvance(selectedEvaluationIds, evaluations, currentUser, employees);
  const selectedIds = new Set(selectedEvaluationIds);
  const allCurrentPageSelected = currentPageRows.length > 0 && currentPageRows.every(record => selectedIds.has(record.id));

  const toggleEvaluation = (id: string) => {
    setSelectedEvaluationIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    setShowBulkPreview(false);
    setError('');
    setSuccess('');
  };

  const toggleCurrentPage = () => {
    setSelectedEvaluationIds(current => allCurrentPageSelected
      ? current.filter(id => !currentPageRows.some(record => record.id === id))
      : Array.from(new Set([...current, ...currentPageRows.map(record => record.id)])));
    setShowBulkPreview(false);
    setError('');
    setSuccess('');
  };

  // Grade Distribution
  const dist = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  scoredEvals.forEach(ev => {
    const score = calculateFinalScore(ev, profiles);
    dist[getGrade(score)]++;
  });

  const totalScored = scoredEvals.length || 1;
  const aPercentage = Math.round((dist.A / totalScored) * 100);

  // Guidelines recommendation: A should be around 10-15%, B around 20-30%, C around 40-50%...
  const isInflated = aPercentage > 25;

  const handleApproveCalibration = async (ev: Evaluation) => {
    if (saving.current) return;
    const preview = previewBulkAdvance([ev.id], evaluations, currentUser, employees);
    const updates = buildBulkAdvanceUpdates(preview.rows, evaluations, employees, currentUser);
    if (!updates.length) { setError('مجوز یا وضعیت پرونده برای تأیید کالیبراسیون معتبر نیست.'); return; }
    saving.current = true; setIsSaving(true); setError('');
    try {
      const byId = new Map(updates.map(record => [record.id, record]));
      if ((await onBulkUpdateEvaluations(evaluations.map(record => byId.get(record.id) || record))) !== true) setError('سرور تأیید کالیبراسیون را نپذیرفت؛ پرونده در صف باقی ماند.');
      else setSuccess('تأیید کالیبراسیون ثبت شد.');
    } catch {
      setError('ذخیره‌سازی کالیبراسیون ناموفق بود؛ وضعیت صف پس از همگام‌سازی دوباره بررسی شود.');
    } finally { saving.current = false; setIsSaving(false); }
  };

  const handleBulkApproveCalibration = async () => {
    if (saving.current) return;
    const freshPreview = previewBulkAdvance(selectedEvaluationIds, evaluations, currentUser, employees);
    const updates = buildBulkAdvanceUpdates(freshPreview.rows, evaluations, employees, currentUser);
    if (!updates.length) { setError('در انتخاب فعلی پرونده واجد شرایطی برای تأیید گروهی وجود ندارد.'); return; }
    saving.current = true;
    setIsSaving(true);
    setError('');
    setSuccess('');
    try {
      const byId = new Map(updates.map(record => [record.id, record]));
      const accepted = await onBulkUpdateEvaluations(evaluations.map(record => byId.get(record.id) || record));
      if (accepted !== true) {
        setError('سرور تأیید گروهی را نپذیرفت؛ پرونده‌ها در صف باقی ماندند.');
        return;
      }
      setSuccess(`تأیید کالیبراسیون برای ${updates.length.toLocaleString('fa-IR')} پرونده ثبت شد.`);
      setSelectedEvaluationIds([]);
      setShowBulkPreview(false);
    } catch {
      setError('ذخیره گروهی کالیبراسیون ناموفق بود؛ وضعیت صف پس از همگام‌سازی دوباره بررسی شود.');
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  };

  const bulkReasonText = (reason: string) => ({
    not_owned: 'این پرونده در اختیار شما نیست',
    wrong_state: 'وضعیت پرونده برای کالیبراسیون مناسب نیست',
    missing_input: 'داده الزامی پرونده ناقص است',
    missing_assignee: 'مسئول مرحله بعد مشخص نیست',
    permission_denied: 'مجوز تأیید این پرونده را ندارید',
    already_transitioned: 'وضعیت پرونده پس از انتخاب تغییر کرده است',
  } as Record<string, string>)[reason] || 'واجد شرایط تأیید';

  return (
<div className="app-page space-y-7 text-right" dir="rtl">
      {/* Header */}
      <div className="border-b border-slate-200/80 pb-5 dark:border-slate-800/80">
        <p className="mb-1.5 text-xs font-bold text-teal-700 dark:text-teal-300">یکپارچگی و کنترل کیفیت نمرات</p>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-slate-100 tracking-tight">پنل کالیبراسیون سازمانی</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-7">
          هم‌راستاسازی معیارها و توزیع عادلانه نمرات بین واحدهای مختلف جهت تضمین کیفیت کارنامه نهایی
        </p>
      </div>

      {/* Top statistics indicators */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl flex items-center gap-4 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-400 flex items-center justify-center shrink-0">
            <SlidersHorizontal className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400">آماده کالیبراسیون کمیته</p>
            <p className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">{readyForCalibration.length} مورد</p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl flex items-center gap-4 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
            <Scale className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400">کالیبره‌شده (تایید اولیه)</p>
            <p className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">{calibratedCount} مورد</p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl flex items-center gap-4 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-400 flex items-center justify-center shrink-0">
            <FileCheck2 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400">ابلاغ نهایی و آرشیو قفل‌شده</p>
            <p className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">{lockedCount} مورد</p>
          </div>
        </div>
      </div>

      {/* Visual Alignment Graph */}
      <div className="bg-white/80 border border-slate-200 dark:bg-slate-900/70 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
        <div className="flex justify-between items-center flex-wrap gap-2">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">مقایسه توزیع سازمان با هدف‌گذاری استانداردهای ارزیابی</h3>
          {isInflated ? (
                  <span className="bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20 text-[10px] px-2.5 py-1 rounded font-bold flex items-center gap-1.5 shrink-0">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>هشدار: بروز پدیده «تورم نمره» (سهم رتبه A بیش از ۲۵٪ است)</span>
            </span>
          ) : (
            <span className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 text-[10px] px-2.5 py-1 rounded font-bold flex items-center gap-1.5 shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>توزیع نمرات و پراکندگی طبقات بهینه و عادلانه است</span>
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {(Object.keys(dist) as Array<keyof typeof dist>).map((grade) => {
            const count = dist[grade];
            const pct = Math.round((count / totalScored) * 100);
            const conf = GRADE_DETAILS[grade];

            // Standard recommendations for a healthy bell curve in production/HR:
            // A: 10%, B: 25%, C: 50%, D: 10%, E: 5%
            const target = grade === 'A' ? 15 : grade === 'B' ? 25 : grade === 'C' ? 45 : grade === 'D' ? 10 : 5;

            return (
              <div key={grade} className="bg-slate-50 border border-slate-200 dark:bg-slate-950/30 dark:border-slate-800/80 p-4 rounded-xl space-y-3">
                <div className="flex justify-between items-center">
                  <span className={`w-7 h-7 rounded-lg font-bold text-slate-900 bg-${conf.color}-400 flex items-center justify-center text-xs`}>
                    {grade}
                  </span>
                  <span className="text-slate-600 dark:text-slate-400 text-[11px]">{conf.label.split(' ')[0]}</span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-600 dark:text-slate-400">سهم فعلی:</span>
                    <span className="text-slate-900 dark:text-slate-200 font-bold">{pct}٪</span>
                  </div>
                  <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full bg-${conf.color}-500/80`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-[9px] text-slate-500 text-left" dir="ltr">
                    Target: ~{target}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Table calibration pending */}
      <div className="bg-white/80 border border-slate-200 dark:bg-slate-900/70 dark:border-slate-800 rounded-2xl overflow-hidden p-5 space-y-4 shadow-sm">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">ارزیابی‌های نیازمند هم‌ترازسازی و تایید کالیبراسیون</h3>

        {error && <p role="alert" className="text-rose-500">{error}</p>}
        {success && <p role="status" className="text-emerald-700 dark:text-emerald-300">{success}</p>}
        <p data-calibration-count>آماده کمیته: {readyForCalibration.length} · تأیید کمیته: {calibratedCount} · نهایی: {lockedCount}</p>
        {readyForCalibration.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800" aria-label="عملیات گروهی کالیبراسیون">
          <span className="text-xs text-slate-600 dark:text-slate-300">{selectedEvaluationIds.length.toLocaleString('fa-IR')} پرونده انتخاب شده</span>
          <div className="flex flex-wrap gap-2">
            <Button variant="info" disabled={!selectedEvaluationIds.length || isSaving} onClick={() => { setShowBulkPreview(true); setError(''); setSuccess(''); }} className="text-xs">پیش‌نمایش تأیید گروهی</Button>
          </div>
        </div>}
        {showBulkPreview && <section className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3" aria-label="پیش‌نمایش تأیید گروهی">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <strong>پیش از ثبت، صلاحیت هر پرونده دوباره بررسی می‌شود.</strong>
            <span>انتخاب‌شده: {bulkPreview.selected.toLocaleString('fa-IR')} · واجد شرایط: {bulkPreview.eligible.toLocaleString('fa-IR')} · ردشده: {(bulkPreview.selected - bulkPreview.eligible).toLocaleString('fa-IR')}</span>
          </div>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-[11px]" aria-label="نتیجه صلاحیت پرونده‌های انتخاب‌شده">
            {bulkPreview.rows.map(row => <li key={row.evaluationId} className="flex flex-wrap justify-between gap-2 rounded-lg bg-white/70 px-2 py-1.5 dark:bg-slate-950/60"><span>{row.employeeName}{row.employeeCode ? ` (${row.employeeCode})` : ''}</span><span className={row.reason === 'eligible' ? 'font-bold text-emerald-600 dark:text-emerald-300' : 'font-bold text-rose-600 dark:text-rose-300'}>{bulkReasonText(row.reason)}</span></li>)}
          </ul>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" disabled={isSaving} onClick={() => setShowBulkPreview(false)} className="text-xs">بازگشت</Button>
            <Button variant="success" disabled={isSaving || bulkPreview.eligible === 0} onClick={handleBulkApproveCalibration} className="text-xs">تأیید {bulkPreview.eligible.toLocaleString('fa-IR')} پرونده واجد شرایط</Button>
          </div>
        </section>}
        {readyForCalibration.length > 50 && <div className="flex gap-4"><button disabled={page === 0} onClick={() => setPage(page - 1)}>صفحه قبل</button><span>{page + 1} / {Math.ceil(readyForCalibration.length / 50)}</span><button disabled={(page + 1) * 50 >= readyForCalibration.length} onClick={() => setPage(page + 1)}>صفحه بعد</button></div>}
        {readyForCalibration.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-slate-700 dark:text-slate-300">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-bold dark:border-slate-800">
                  <th className="pb-3 text-center"><input type="checkbox" aria-label="انتخاب همه پرونده‌های این صفحه" checked={allCurrentPageSelected} disabled={isSaving} onChange={toggleCurrentPage} /></th>
                  <th className="pb-3 text-right">پرسنل</th>
                  <th className="pb-3 text-right">واحد</th>
                  <th className="pb-3 text-right">پروفایل و شایستگی</th>
                  <th className="pb-3 text-center">نمره اولیه</th>
                  <th className="pb-3 text-center">رتبه موقت</th>
                  <th className="pb-3 text-left">عملیات کالیبراسیون</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                {currentPageRows.map((ev) => {
                  const emp = employees.find(e => e.id === ev.empId);
                  const prof = profiles.find(p => p.id === ev.profileId);
                  const score = calculateFinalScore(ev, profiles);
                  const gr = getGrade(score);
                  const grConf = GRADE_DETAILS[gr];

                  return (
                    <tr key={ev.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 text-center"><input type="checkbox" aria-label={`انتخاب ${emp?.name || 'پرونده نامشخص'} برای کالیبراسیون گروهی`} checked={selectedIds.has(ev.id)} disabled={isSaving} onChange={() => toggleEvaluation(ev.id)} /></td>
                      <td className="py-3 font-semibold text-slate-900 dark:text-slate-200">{emp?.name || 'نامشخص'}</td>
                      <td className="py-3 text-slate-600 dark:text-slate-400">{emp?.unit || 'نامشخص'}</td>
                      <td className="py-3 text-slate-600 dark:text-slate-400">{prof?.title || 'نامشخص'}</td>
                      <td className="py-3 text-center font-bold text-slate-900 dark:text-slate-200">{score}٪</td>
                      <td className="py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold bg-${grConf.color}-500/10 text-${grConf.color}-300`}>
                          {gr} — {grConf.label}
                        </span>
                      </td>
                      <td className="py-3 text-left">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => onSelectEvaluation(ev.id)}
                            className="action-secondary min-h-9 px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[10px] font-semibold transition-colors cursor-pointer dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700"
                          >
                            بررسی و تغییر نمرات
                          </button>
                          
                          <button
                            disabled={isSaving} onClick={() => handleApproveCalibration(ev)}
                            className="action-success min-h-9 px-2.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-[10px] font-bold transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <Scale className="w-3 h-3" />
                            <span>تأیید کالیبراسیون</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-12 text-center text-slate-500">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <p className="font-bold">هیچ ارزیابی منتظر کالیبراسیونی وجود ندارد.</p>
            <p className="text-[11px] mt-1">تمام پرونده‌های دارای نمره در گام جاری تایید شده یا هنوز کامل امتیازدهی نشده‌اند.</p>
          </div>
        )}
      </div>
    </div>
  );
}


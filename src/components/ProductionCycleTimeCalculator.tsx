/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef } from 'react';
import {
  Zap,
  CheckCircle2,
  Clock,
  Gauge,
  AlertTriangle,
  FileSpreadsheet,
  Download,
  Upload,
  Plus,
  Sparkles,
  Info,
  Layers,
  Award,
  ChevronDown,
  RotateCcw,
  Check,
  TrendingUp,
  Percent,
  Timer,
  Factory
} from 'lucide-react';
import { Employee, Evaluation, Criterion, JobProfile } from '../types';
import { db } from '../utils/db';
import {
  calculateProductionMetrics,
  applyProductionMetricsToEvaluation,
  validateProductionInputs,
  parseProductionNumber,
  type ProductionCriterionMappings,
  ProductionInputParams,
  ProductionCalculationResult
} from '../utils/productionCalculations';

const PRODUCTION_OUTPUTS = [
  { key: 'production', label: 'تحقق تولید' },
  { key: 'cycleTime', label: 'سایکل‌تایم' },
  { key: 'scrap', label: 'ضایعات و کیفیت' },
  { key: 'oee', label: 'اثربخشی تجهیزات (OEE)' },
] as const;

interface ProductionCycleTimeCalculatorProps {
  employees: Employee[];
  criteria: Criterion[];
  profiles: JobProfile[];
  evaluations: Evaluation[];
  onUpdateEvaluations: (evals: Evaluation[]) => boolean | Promise<boolean>;
  currentUser?: Employee | null;
  onClose?: () => void;
}

export default function ProductionCycleTimeCalculator({
  employees,
  criteria,
  profiles,
  evaluations,
  onUpdateEvaluations,
  currentUser,
  onClose
}: ProductionCycleTimeCalculatorProps) {
  // Active sub-tab in calculator: 'single' (فرم تکی فوق‌سریع) | 'batch' (ورود گروهی)
  const [mode, setMode] = useState<'single' | 'batch'>('single');

  // Single Entry Form State
  const [selectedEmpId, setSelectedEmpId] = useState<string>(employees[0]?.id || '');
  const [period, setPeriod] = useState<string>(() => db.getMiscData<string>('pe_active_period', ''));
  const [producedUnits, setProducedUnits] = useState<number | ''>('');
  const [targetUnits, setTargetUnits] = useState<number | ''>('');
  const [actualCycleTimeSec, setActualCycleTimeSec] = useState<number | ''>('');
  const [standardCycleTimeSec, setStandardCycleTimeSec] = useState<number | ''>('');
  const [scrapUnits, setScrapUnits] = useState<number | ''>('');
  const [workingHours, setWorkingHours] = useState<number | ''>('');
  const [downtimeHours, setDowntimeHours] = useState<number | ''>('');
  const [criterionMappings, setCriterionMappings] = useState<ProductionCriterionMappings>({});
  const [operatorNotes, setOperatorNotes] = useState<string>('');

  // Status feedback
  const [submitFeedback, setSubmitFeedback] = useState<{
    success: boolean;
    message: string;
    details?: string;
  } | null>(null);

  // Batch CSV Input State
  const [batchText, setBatchText] = useState<string>('');
  const [batchFeedback, setBatchFeedback] = useState<{
    success: boolean;
    message: string;
    count?: number;
  } | null>(null);
  const submissionInFlight = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Selected Employee Details
  const selectedEmp = useMemo(() => {
    return employees.find(e => e.id === selectedEmpId);
  }, [employees, selectedEmpId]);

  const calculationParams = useMemo<ProductionInputParams>(() => ({
    empCode: selectedEmp?.code || '',
    empName: selectedEmp?.name,
    period: period.trim(),
    producedUnits: producedUnits === '' ? Number.NaN : producedUnits,
    targetUnits: targetUnits === '' ? Number.NaN : targetUnits,
    actualCycleTimeSec: actualCycleTimeSec === '' ? Number.NaN : actualCycleTimeSec,
    standardCycleTimeSec: standardCycleTimeSec === '' ? Number.NaN : standardCycleTimeSec,
    scrapUnits: scrapUnits === '' ? Number.NaN : scrapUnits,
    workingHours: workingHours === '' ? Number.NaN : workingHours,
    downtimeHours: downtimeHours === '' ? Number.NaN : downtimeHours,
    notes: operatorNotes,
  }), [selectedEmp, period, producedUnits, targetUnits, actualCycleTimeSec, standardCycleTimeSec, scrapUnits, workingHours, downtimeHours, operatorNotes]);

  const inputIssues = useMemo(() => {
    const missingFields = [producedUnits, targetUnits, actualCycleTimeSec, standardCycleTimeSec, scrapUnits, workingHours, downtimeHours].some(value => value === '');
    const issues = validateProductionInputs(calculationParams);
    if (missingFields) issues.unshift('همه پارامترهای تولید، زمان چرخه، ضایعات و شیفت را وارد کنید؛ برای مقدار صفر عدد ۰ بنویسید.');
    if (!selectedEmp) issues.unshift('یک همکار برای ثبت محاسبه انتخاب کنید.');
    return [...new Set(issues)];
  }, [calculationParams, producedUnits, targetUnits, actualCycleTimeSec, standardCycleTimeSec, scrapUnits, workingHours, downtimeHours, selectedEmp]);

  // LIVE AUTOMATED REAL-TIME CALCULATION
  const calculationResult: ProductionCalculationResult | null = useMemo(() => {
    if (inputIssues.length) return null;
    return calculateProductionMetrics(calculationParams);
  }, [inputIssues, calculationParams]);

  const selectedEmployeeProfile = profiles.find(profile => profile.id === selectedEmp?.profileId);
  const existingTargetEvaluation = evaluations.find(evaluation => evaluation.empId === selectedEmp?.id && evaluation.period === period.trim());
  const eligibleTargetIds = new Set((existingTargetEvaluation?.scores || selectedEmployeeProfile?.items.map(item => ({ cid: item.cid })) || []).map(item => item.cid));
  const eligibleTargetCriteria = criteria.filter(criterion => criterion.active !== false && eligibleTargetIds.has(criterion.id) &&
    (!criterion.scoringSource || criterion.scoringSource === 'supervisor') &&
    (!criterion.dataType || ['number', 'percentage'].includes(criterion.dataType)));
  const selectedMappingIds = Object.values(criterionMappings).filter((id): id is string => Boolean(id));
  const mappingIssues = [
    ...(selectedMappingIds.length === 0 ? ['حداقل یک شاخص مقصد را برای ثبت خروجی انتخاب کنید.'] : []),
    ...(new Set(selectedMappingIds).size < selectedMappingIds.length ? ['هر خروجی باید به شاخص جداگانه‌ای نگاشت شود.'] : []),
    ...(selectedMappingIds.some(id => !eligibleTargetCriteria.some(criterion => criterion.id === id)) ? ['یکی از شاخص‌های مقصد در پروفایل این همکار فعال یا قابل امتیازدهی نیست.'] : []),
    ...(existingTargetEvaluation && (existingTargetEvaluation.status === 'locked' || existingTargetEvaluation.stage === 'completed')
      ? ['ارزیابی این دوره نهایی شده و قابل تغییر نیست.']
      : []),
  ];

  // Handle Apply to Evaluation
  const handleApplySingleEvaluation = async () => {
    if (submissionInFlight.current) return;
    if (!selectedEmp || !calculationResult || inputIssues.length || mappingIssues.length) {
      setSubmitFeedback({ success: false, message: [...inputIssues, ...mappingIssues][0] || 'اطلاعات ورودی را بررسی کنید.' });
      return;
    }

    const empProfile = selectedEmployeeProfile;
    const profileId = empProfile ? empProfile.id : 'prof-default';

    // Find existing evaluation or prepare a new one
    let targetEval = evaluations.find(ev => ev.empId === selectedEmp.id && ev.period === period.trim());
    const isNew = !targetEval;

    if (!targetEval) {
      const initialScores = empProfile ? empProfile.items.map(item => ({
        cid: item.cid,
        weight: item.weight,
        value: 0,
        self: 0,
        doc: ''
      })) : criteria.slice(0, 5).map(c => ({
        cid: c.id,
        weight: 20,
        value: 0,
        self: 0,
        doc: ''
      }));

      targetEval = {
        id: `eval-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        empId: selectedEmp.id,
        profileId,
        period: period.trim(),
        status: 'draft',
        scores: initialScores,
        created: Date.now()
      };
    }

    // Apply the smart calculation
    const updatedEval = applyProductionMetricsToEvaluation(
      targetEval,
      criteria,
      calculationResult,
      calculationParams,
      criterionMappings,
    );

    let nextEvaluations: Evaluation[];
    if (isNew) {
      nextEvaluations = [updatedEval, ...evaluations];
    } else {
      nextEvaluations = evaluations.map(ev => ev.id === updatedEval.id ? updatedEval : ev);
    }

    submissionInFlight.current = true;
    setIsSubmitting(true);
    try {
      const accepted = await onUpdateEvaluations(nextEvaluations);
      if (accepted !== true) {
        setSubmitFeedback({ success: false, message: 'سرور ثبت این محاسبه را تأیید نکرد؛ اطلاعات فرم حفظ شده است.' });
        return;
      }
      setSubmitFeedback({
        success: true,
        message: `محاسبات برای همکار گرامی «${selectedEmp.name}» در دوره «${period.trim()}» ثبت شد.`,
        details: `راندمان: ${calculationResult.efficiencyRate}٪ | سایکل‌تایم: نمره ${calculationResult.cycleTimeScore}/5 | ضایعات: نمره ${calculationResult.scrapScore}/5 | نمره ترکیبی شاخص‌های تولید: ${calculationResult.overallKpiScore} از ۵`
      });
      setTimeout(() => setSubmitFeedback(null), 6000);
    } catch {
      setSubmitFeedback({ success: false, message: 'ذخیره انجام نشد؛ اطلاعات فرم حفظ شده است.' });
    } finally {
      submissionInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  // Handle Batch CSV Import
  const handleProcessBatchCSV = async () => {
    if (submissionInFlight.current) return;
    if (!batchText.trim()) {
      setBatchFeedback({ success: false, message: 'لطفاً داده‌های جدول را در کادر متن وارد کنید.' });
      return;
    }

    const lines = batchText.trim().split('\n').map(line => line.trim()).filter(Boolean);
    if (!lines.length) return;
    const mappingIds = Object.values(criterionMappings).filter((id): id is string => Boolean(id));
    if (!mappingIds.length || new Set(mappingIds).size !== mappingIds.length) {
      setBatchFeedback({ success: false, message: 'پیش از ورود گروهی، شاخص مقصد هر خروجی را انتخاب کنید و مقصدها را تکراری نگذارید.' });
      return;
    }

    let processedCount = 0;
    let skippedCount = 0;
    let duplicateCount = 0;
    const processedEmployeePeriods = new Set<string>();
    let nextEvals = [...evaluations];
    lines.forEach((line, index) => {
      if (index === 0 && (line.includes('کد') || line.toLowerCase().includes('code') || line.includes('نام') || line.includes('تولید'))) return;
      const parts = line.split(/[,;\t]/).map(part => part.trim().replace(/^["']|["']$/g, ''));
      if (parts.length < 9) { skippedCount++; return; }

      const codeOrName = parts[0];
      const rowPeriod = (parts[1] || period).trim();
      const values = parts.slice(2, 9).map(parseProductionNumber);
      if (values.some(value => value === null)) { skippedCount++; return; }
      const [produced, target, actualCycle, standardCycle, scrap, workHours, downtime] = values as number[];
      const employee = employees.find(person => person.code.toLocaleLowerCase() === codeOrName.toLocaleLowerCase() || person.name.toLocaleLowerCase() === codeOrName.toLocaleLowerCase() || person.id === codeOrName);
      if (!employee || !rowPeriod) { skippedCount++; return; }

      const params: ProductionInputParams = {
        empCode: employee.code,
        empName: employee.name,
        period: rowPeriod,
        producedUnits: produced,
        targetUnits: target,
        actualCycleTimeSec: actualCycle,
        standardCycleTimeSec: standardCycle,
        scrapUnits: scrap,
        workingHours: workHours,
        downtimeHours: downtime,
      };
      if (validateProductionInputs(params).length) { skippedCount++; return; }
      const calculation = calculateProductionMetrics(params);

      const employeeProfile = profiles.find(profile => profile.id === employee.profileId);
      if (!employeeProfile) { skippedCount++; return; }
      let targetEvaluation = nextEvals.find(evaluation => evaluation.empId === employee.id && evaluation.period === rowPeriod);
      const isNew = !targetEvaluation;
      if (!targetEvaluation) {
        targetEvaluation = {
          id: `eval-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          empId: employee.id,
          profileId: employeeProfile.id,
          period: rowPeriod,
          status: 'draft',
          scores: employeeProfile.items.map(item => ({ cid: item.cid, weight: item.weight, value: 0, self: 0, doc: '' })),
          created: Date.now(),
        };
      }
      if (targetEvaluation.status === 'locked' || targetEvaluation.stage === 'completed') { skippedCount++; return; }
      const applicableMappings = Object.fromEntries(Object.entries(criterionMappings).filter(([, criterionId]) => targetEvaluation!.scores.some(score => score.cid === criterionId))) as ProductionCriterionMappings;
      if (!Object.values(applicableMappings).some(Boolean)) { skippedCount++; return; }
      const employeePeriodKey = JSON.stringify([employee.id, rowPeriod]);
      if (processedEmployeePeriods.has(employeePeriodKey)) {
        skippedCount++;
        duplicateCount++;
        return;
      }
      processedEmployeePeriods.add(employeePeriodKey);
      const updated = applyProductionMetricsToEvaluation(targetEvaluation, criteria, calculation, params, applicableMappings);
      if (isNew) nextEvals.push(updated);
      else nextEvals = nextEvals.map(evaluation => evaluation.id === updated.id ? updated : evaluation);
      processedCount++;
    });

    if (!processedCount) {
      const duplicateDetail = duplicateCount ? `؛ ${duplicateCount} ردیف تکراری` : '';
      setBatchFeedback({ success: false, message: `هیچ ردیف معتبری برای ثبت پیدا نشد؛ ${skippedCount} ردیف کنار گذاشته شد${duplicateDetail}.`, count: 0 });
      return;
    }
    submissionInFlight.current = true;
    setIsSubmitting(true);
    try {
      const accepted = await onUpdateEvaluations(nextEvals);
      setBatchFeedback({
        success: accepted === true,
        message: accepted === true
          ? `${processedCount} ردیف پس از تأیید سرور ثبت شد؛ ${skippedCount} ردیف ناقص، نامعتبر یا بدون معیار مقصد کنار گذاشته شد${duplicateCount ? ` (شامل ${duplicateCount} ردیف تکراری)` : ''}.`
          : 'سرور ثبت گروهی را تأیید نکرد؛ متن ورودی حفظ شده است.',
        count: processedCount,
      });
    } catch {
      setBatchFeedback({ success: false, message: 'ذخیره گروهی انجام نشد؛ متن ورودی حفظ شده است.', count: processedCount });
    } finally {
      submissionInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  // Download Sample Batch CSV
  const handleDownloadSampleCSV = () => {
    const headers = [
      'کد پرسنلی',
      'دوره ارزیابی',
      'تولید واقعی (قطعه)',
      'برنامه مصوب (قطعه)',
      'سایکل تایم واقعی (ثانیه)',
      'سایکل تایم استاندارد (ثانیه)',
      'تعداد ضایعات',
      'ساعات کارکرد شیفت',
      'ساعات توقف خط'
    ];

    const sampleRows = employees.slice(0, 5).map((e, idx) => [
      e.code,
      period,
      12000 + idx * 400,
      12000,
      42 - idx,
      45,
      80 + idx * 10,
      160,
      3.5 + idx
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...sampleRows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `الگوی_ثبت_سریع_تولید_سایکل‌تایم_${period.replace(/\s+/g, '_')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6 text-slate-100" dir="rtl">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-teal-500 to-emerald-500 flex items-center justify-center text-slate-950 font-black shadow-lg shadow-teal-500/20">
            <Gauge className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-slate-100">
                موتور هوشمند ورود داده‌های تولید، سایکل‌تایم و محاسبات خودکار
              </h2>
              <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono">
                Auto-Calc Engine
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              تنها اعداد تولید و زمان چرخه را وارد کنید؛ تمام فرمول‌های راندمان، انحراف سایکل‌تایم، ضایعات و نمرات ۱ تا ۵ به صورت لحظه‌ای محاسبه و ثبت می‌شوند.
            </p>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center gap-2 bg-slate-950/80 p-1.5 rounded-2xl border border-slate-800">
          <button
            type="button"
            onClick={() => setMode('single')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              mode === 'single'
                ? 'bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            فرم ثبت سریع تکی
          </button>
          <button
            type="button"
            onClick={() => setMode('batch')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              mode === 'batch'
                ? 'bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ورود گروهی اکسل / متنی
          </button>
        </div>
      </div>

      {/* FEEDBACK BANNER */}
      {submitFeedback && (
        <div className={`p-4 rounded-2xl border text-xs leading-relaxed space-y-1 animate-in fade-in ${
          submitFeedback.success 
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
            : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
        }`}>
          <div className="flex items-center gap-2 font-bold text-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{submitFeedback.message}</span>
          </div>
          {submitFeedback.details && (
            <p className="text-slate-300 text-[11px] font-mono pr-6">{submitFeedback.details}</p>
          )}
        </div>
      )}

      {/* MODE 1: SINGLE SUPER-EASY FORM & LIVE CALCULATION */}
      {mode === 'single' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* LEFT: INPUT PARAMETERS */}
          <div className="lg:col-span-6 bg-slate-950/60 border border-slate-800 rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
              <span className="text-xs font-bold text-teal-400 flex items-center gap-1.5">
                <Factory className="w-4 h-4" />
                پارامترهای ورودی خط تولید و ایستگاه
              </span>
              <span className="text-[10px] text-slate-400">ورود آسان بدون فرمول</span>
            </div>

            {/* Row 1: Employee & Period */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-300">پرسنل / اپراتور:</label>
                <select
                  aria-label="پرسنل یا اپراتور محاسبه تولید"
                  value={selectedEmpId}
                  onChange={(e) => setSelectedEmpId(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-xl border bg-slate-900 border-slate-700 text-slate-100 font-bold focus:outline-none focus:border-teal-500 cursor-pointer"
                >
                  {employees.length === 0 && <option value="">پرسنلی برای انتخاب وجود ندارد</option>}
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.code}) - {emp.unit || 'خط تولید'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-300">دوره ارزیابی:</label>
                <input
                  type="text"
                  required
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  placeholder="دوره فعال یا دوره موردنظر"
                  className="w-full text-xs p-2.5 rounded-xl border bg-slate-900 border-slate-700 text-slate-100 font-bold focus:outline-none focus:border-teal-500"
                />
              </div>
            </div>

            <section data-testid="production-target-mapping" className="rounded-2xl border border-sky-500/25 bg-sky-500/5 p-3.5 space-y-2">
              <div>
                <h3 className="text-xs font-bold text-slate-200">نگاشت صریح خروجی به معیار ارزیابی</h3>
                <p className="mt-1 text-[10px] leading-5 text-slate-400">برنامه نام معیارها را حدس نمی‌زند. مقصدهای مجاز از پروفایل انتخاب‌شده می‌آیند و معیارهای تکراری قابل انتخاب نیستند.</p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {PRODUCTION_OUTPUTS.map(output => (
                  <label key={output.key} className="text-[10px] font-semibold text-slate-300">
                    {output.label}
                    <select
                      aria-label={`معیار مقصد ${output.label}`}
                      value={criterionMappings[output.key] || ''}
                      onChange={event => setCriterionMappings(current => ({ ...current, [output.key]: event.target.value || undefined }))}
                      className="mt-1 min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100"
                    >
                      <option value="">بدون نگاشت</option>
                      {eligibleTargetCriteria.map(criterion => (
                        <option key={criterion.id} value={criterion.id} disabled={Object.entries(criterionMappings).some(([key, value]) => key !== output.key && value === criterion.id)}>
                          {criterion.code} · {criterion.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {mappingIssues.map(issue => <p key={issue} role="status" className="text-[10px] text-amber-300">{issue}</p>)}
            </section>

            {/* Row 2: Production Quantity (Actual vs Target) */}
            <div className="p-3.5 bg-slate-900/80 rounded-2xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-300 font-bold">
                <span className="flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5 text-teal-400" />
                  حجم و خروجی تولید
                </span>
                <span className="text-teal-400 font-mono text-[11px]">
                  {calculationResult ? `راندمان: ${calculationResult.efficiencyRate}٪` : 'پس از تکمیل داده‌ها محاسبه می‌شود'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400">تولید واقعی (تعداد/قطعه):</label>
                  <input
                    type="number"
                    aria-label="تولید واقعی (تعداد یا قطعه)"
                    required
                    min="0"
                    value={producedUnits}
                    onChange={(e) => setProducedUnits(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full text-xs p-2 rounded-xl border bg-slate-950 border-slate-700 text-emerald-400 font-mono font-bold focus:outline-none focus:border-teal-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400">برنامه / تارگت مصوب:</label>
                  <input
                    type="number"
                    aria-label="برنامه یا تارگت مصوب"
                    required
                    min="1"
                    value={targetUnits}
                    onChange={(e) => setTargetUnits(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full text-xs p-2 rounded-xl border bg-slate-950 border-slate-700 text-slate-200 font-mono font-bold focus:outline-none focus:border-teal-500"
                  />
                </div>
              </div>
            </div>

            {/* Row 3: Cycle Time (Actual vs Standard) */}
            <div className="p-3.5 bg-slate-900/80 rounded-2xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-300 font-bold">
                <span className="flex items-center gap-1">
                  <Timer className="w-3.5 h-3.5 text-indigo-400" />
                  سایکل تایم قطعه (Cycle Time)
                </span>
                {calculationResult ? <span className={`font-mono text-[11px] font-bold ${calculationResult.cycleTimeVarianceSec >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {calculationResult.cycleTimeVarianceSec >= 0 ? 'بهبود: +' : 'انحراف: '}{calculationResult.cycleTimeImprovementRate}٪
                </span> : <span className="text-[10px] text-slate-500">در انتظار داده معتبر</span>}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400">سایکل‌تایم واقعی (ثانیه):</label>
                  <input
                    type="number"
                    aria-label="سایکل‌تایم واقعی (ثانیه)"
                    required
                    step="0.5"
                    min="1"
                    value={actualCycleTimeSec}
                    onChange={(e) => setActualCycleTimeSec(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full text-xs p-2 rounded-xl border bg-slate-950 border-slate-700 text-indigo-300 font-mono font-bold focus:outline-none focus:border-teal-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400">استاندارد مهندسی خط (ثانیه):</label>
                  <input
                    type="number"
                    aria-label="استاندارد مهندسی سایکل‌تایم (ثانیه)"
                    required
                    step="0.5"
                    min="1"
                    value={standardCycleTimeSec}
                    onChange={(e) => setStandardCycleTimeSec(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full text-xs p-2 rounded-xl border bg-slate-950 border-slate-700 text-slate-300 font-mono font-bold focus:outline-none focus:border-teal-500"
                  />
                </div>
              </div>
            </div>

            {/* Row 4: Scrap, Working Hours, Downtime */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400">ضایعات (تعداد):</label>
                <input
                  type="number"
                  aria-label="ضایعات (تعداد)"
                  required
                  min="0"
                  value={scrapUnits}
                  onChange={(e) => setScrapUnits(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full text-xs p-2 rounded-xl border bg-slate-950 border-slate-700 text-rose-300 font-mono font-bold focus:outline-none focus:border-teal-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400">ساعات کارکرد شیفت:</label>
                <input
                  type="number"
                  aria-label="ساعات کارکرد شیفت"
                  required
                  min="1"
                  value={workingHours}
                  onChange={(e) => setWorkingHours(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full text-xs p-2 rounded-xl border bg-slate-950 border-slate-700 text-slate-200 font-mono font-bold focus:outline-none focus:border-teal-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400">توقف خط (ساعت):</label>
                <input
                  type="number"
                  aria-label="ساعات توقف خط"
                  required
                  step="0.5"
                  min="0"
                  value={downtimeHours}
                  onChange={(e) => setDowntimeHours(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full text-xs p-2 rounded-xl border bg-slate-950 border-slate-700 text-amber-300 font-mono font-bold focus:outline-none focus:border-teal-500"
                />
              </div>
            </div>

            {/* Operator Notes */}
            <div className="space-y-1">
              <label className="text-[10px] text-slate-400">توضیحات تکمیلی شیفت یا اپراتور (اختیاری):</label>
              <input
                type="text"
                value={operatorNotes}
                onChange={(e) => setOperatorNotes(e.target.value)}
                placeholder="مثلاً: تعویض قالب جدید و تنظیم فیکسچر با سرعت بالا انجام شد."
                className="w-full text-xs p-2 rounded-xl border bg-slate-950 border-slate-700 text-slate-300 focus:outline-none focus:border-teal-500"
              />
            </div>

            {/* Action Submit Button */}
            <button
              type="button"
              onClick={handleApplySingleEvaluation}
              disabled={isSubmitting || !calculationResult || inputIssues.length > 0 || mappingIssues.length > 0}
              className="w-full action-primary disabled:cursor-not-allowed disabled:opacity-50 font-black py-3 rounded-2xl text-xs flex items-center justify-center gap-2 transition-all shadow-lg cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
              <span>{isSubmitting ? 'در حال انتظار برای تأیید سرور…' : 'محاسبه و درج مستقیم در کارنامه ارزیابی این دوره'}</span>
            </button>
          </div>

          {/* RIGHT: LIVE AUTO-CALCULATED RESULTS DASHBOARD */}
          <div className="lg:col-span-6 bg-slate-950/60 border border-teal-500/30 rounded-3xl p-5 space-y-4 flex flex-col justify-between">
            {calculationResult ? <>
            <div className="space-y-4">
              
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" />
                  خروجی محاسبات خودکار برنامه (Real-time Live Analytics)
                </span>
                <span className="text-[10px] bg-teal-500/20 text-teal-300 px-2 py-0.5 rounded-full font-bold">
                  {calculationResult.badgeLevel}
                </span>
              </div>

              {/* 4 Metric Tiles */}
              <div className="grid grid-cols-2 gap-3">
                {/* Tile 1: Production Efficiency */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 space-y-1">
                  <span className="text-[10px] text-slate-400 block font-bold">درصد راندمان تولید:</span>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xl font-black text-emerald-400 font-mono">
                      {calculationResult.efficiencyRate}٪
                    </span>
                    <span className="text-xs font-bold text-slate-300">
                      نمره {calculationResult.productionScore} از ۵
                    </span>
                  </div>
                  <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden mt-1">
                    <div
                      className="bg-emerald-400 h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, calculationResult.efficiencyRate)}%` }}
                    />
                  </div>
                </div>

                {/* Tile 2: Cycle Time Improvement */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 space-y-1">
                  <span className="text-[10px] text-slate-400 block font-bold">بهبود سایکل‌تایم:</span>
                  <div className="flex items-baseline justify-between">
                    <span className={`text-xl font-black font-mono ${
                      calculationResult.cycleTimeVarianceSec >= 0 ? 'text-emerald-400' : 'text-amber-400'
                    }`}>
                      {calculationResult.cycleTimeVarianceSec >= 0 ? '+' : ''}
                      {calculationResult.cycleTimeImprovementRate}٪
                    </span>
                    <span className="text-xs font-bold text-slate-300">
                      نمره {calculationResult.cycleTimeScore} از ۵
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 block">
                    {calculationResult.cycleTimeVarianceSec >= 0 ? 'سریع‌تر از استاندارد' : 'کندتر از استاندارد'}
                  </span>
                </div>

                {/* Tile 3: Scrap & PPM */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 space-y-1">
                  <span className="text-[10px] text-slate-400 block font-bold">نرخ ضایعات (PPM):</span>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xl font-black text-rose-400 font-mono">
                      {calculationResult.scrapRate}٪
                    </span>
                    <span className="text-xs font-bold text-slate-300">
                      نمره {calculationResult.scrapScore} از ۵
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono block">
                    {calculationResult.ppm.toLocaleString('fa-IR')} PPM
                  </span>
                </div>

                {/* Tile 4: OEE */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 space-y-1">
                  <span className="text-[10px] text-slate-400 block font-bold">اثربخشی کلی تجهیزات (OEE):</span>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xl font-black text-teal-400 font-mono">
                      {calculationResult.oeeRate}٪
                    </span>
                    <span className="text-xs font-bold text-slate-300">
                      نمره {calculationResult.oeeScore} از ۵
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 block">
                    دسترس‌پذیری: {calculationResult.availabilityRate}٪
                  </span>
                </div>
              </div>

              {/* OVERALL COMPOSITE SCORE CARD */}
              <div className="bg-gradient-to-r from-teal-950/40 to-slate-900 border border-teal-500/30 rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <span className="text-xs font-black text-slate-200 block">
                    امتیاز نهایی شاخص‌های کمی و تولید (Overall Score)
                  </span>
                  <span className="text-[11px] text-teal-300 mt-0.5 block">
                    محاسبه شده بر اساس وزن‌های ترکیبی خروجی، زمان چرخه و ضایعات
                  </span>
                </div>

                <div className="text-left">
                  <div className="text-2xl font-black text-emerald-400 font-mono">
                    {calculationResult.overallKpiScore} <span className="text-xs font-normal text-slate-400">/ ۵</span>
                  </div>
                </div>
              </div>

              {/* AUTO-GENERATED SUMMARY DOCUMENT */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 space-y-1.5">
                <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-teal-400" />
                  مستندات و توضیحات توجیهی تولید شده توسط برنامه:
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 font-mono">
                  {calculationResult.autoGeneratedSummary}
                </p>
              </div>

            </div>

            <div className="text-[11px] text-slate-500 text-center pt-2">
              خروجی فقط به معیارهایی می‌رود که در بخش نگاشت صریح انتخاب کرده‌اید؛ معیارهای دیگر دست‌نخورده می‌مانند.
            </div>
            </> : <div role="status" data-testid="production-calculation-empty" className="my-auto rounded-2xl border border-dashed border-slate-700 px-4 py-10 text-center">
              <Gauge className="mx-auto h-8 w-8 text-slate-500" />
              <h3 className="mt-2 text-sm font-bold text-slate-200">برای محاسبه داده واقعی لازم است</h3>
              <p className="mx-auto mt-1 max-w-lg text-xs leading-6 text-slate-400">مقادیر اولیه یا استانداردهای ساختگی وارد نمی‌شوند. اطلاعات تولید، استاندارد مهندسی، ضایعات و ساعات شیفت را از گزارش معتبر وارد کنید.</p>
              <ul className="mt-3 space-y-1 text-right text-[10px] text-amber-200">
                {inputIssues.map(issue => <li key={issue}>• {issue}</li>)}
              </ul>
            </div>}
          </div>

        </div>
      )}

      {/* MODE 2: BATCH CSV / EXCEL COPY-PASTE */}
      {mode === 'batch' && (
        <div className="bg-slate-950/60 border border-slate-800 rounded-3xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Upload className="w-4 h-4 text-teal-400" />
                ورود و محاسبه گروهی داده‌های تولید و سایکل‌تایم کل پرسنل
              </h3>
              <p className="text-[10px] text-slate-400 mt-0.5">
                می‌توانید اطلاعات جدول اکسل را مستقیم کپی کرده و در کادر زیر پیست نمایید؛ محاسبات برای همه اعمال خواهد شد.
              </p>
            </div>

            <button
              type="button"
              onClick={handleDownloadSampleCSV}
              className="bg-slate-800 hover:bg-slate-700 text-teal-300 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-all border border-slate-700 cursor-pointer shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>دانلود نمونه فایل CSV</span>
            </button>
          </div>

          {batchFeedback && (
            <div className={`p-3.5 rounded-xl text-xs font-semibold flex items-center gap-2 ${
              batchFeedback.success 
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' 
                : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
            }`}>
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{batchFeedback.message}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-bold block">
              متن جدول اکسل یا داده‌های CSV (با جداکننده کاما یا تب):
            </label>
            <textarea
              rows={6}
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              placeholder={`کد پرسنلی,دوره,تولید واقعی,برنامه تولید,سایکل تایم واقعی,سایکل تایم استاندارد,ضایعات,ساعات کارکرد,ساعات توقف\nEMP-1001,${period},12500,12000,42,45,95,160,4\nEMP-1002,${period},11800,12000,46,45,140,160,8`}
              className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-3.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-teal-500 leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setBatchText('')}
              className="text-xs text-slate-500 hover:text-slate-300 cursor-pointer"
            >
              پاکسازی متن
            </button>

            <button
              type="button"
              onClick={handleProcessBatchCSV}
              disabled={isSubmitting || !batchText.trim()}
              className="bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 font-black px-6 py-2.5 rounded-xl text-xs flex items-center gap-2 transition-all shadow-md shadow-teal-500/20 cursor-pointer"
            >
              <Zap className="w-4 h-4 stroke-[2.5]" />
              <span>{isSubmitting ? 'در حال انتظار برای تأیید سرور…' : 'محاسبه خودکار و درج در کارنامه‌ها'}</span>
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

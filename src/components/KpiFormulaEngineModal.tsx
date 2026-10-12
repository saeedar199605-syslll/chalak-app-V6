/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Dynamic KPI Formula Engine & Batch Evaluator Modal
 * Allows creating custom KPIs with formulas, testing them interactively,
 * and entering data to automatically compute 1-5 ratings directly into evaluations.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Calculator, 
  Sparkles, 
  Plus, 
  Trash2, 
  Save, 
  X, 
  CheckCircle2, 
  AlertCircle, 
  TrendingUp, 
  HelpCircle,
  Play,
  RotateCcw,
  Sliders,
  Table,
  UserCheck,
  Zap,
  Layers,
  ArrowRight
} from 'lucide-react';
import { 
  Criterion, 
  Employee, 
  Evaluation, 
  JobProfile, 
  KpiCalculationType, 
  KpiVariableDefinition,
  KpiScoreThresholds,
  DEFAULT_ROUTE_RULES
} from '../types';
import { 
  calculateKpiScore, 
  safeEvaluateMath, 
  validateMathExpression,
  DEFAULT_KPI_THRESHOLDS, 
  DEFAULT_INVERSE_THRESHOLDS 
} from '../utils/formulaEngine';
import { resolveInitialEvaluationWorkflow } from '../utils/evaluationStart';
import { CURRENT_ACTIVE_PERIOD, db } from '../utils/db';
import { evaluateCriterionFormulaGraph } from '../utils/formulaDependencyGraph';
import { isNumericScoreRecorded } from '../utils/scoreSemantics';

interface KpiFormulaEngineModalProps {
  isOpen: boolean;
  onClose: () => void;
  criteria: Criterion[];
  onAddCriterion: (crit: Omit<Criterion, 'id'>) => boolean;
  onUpdateCriterion: (id: string, crit: Omit<Criterion, 'id'>) => boolean;
  employees: Employee[];
  profiles: JobProfile[];
  evaluations: Evaluation[];
  onUpdateEvaluations: (nextEvals: Evaluation[]) => void;
  theme?: 'dark' | 'light';
}

export default function KpiFormulaEngineModal({
  isOpen,
  onClose,
  criteria,
  onAddCriterion,
  onUpdateCriterion,
  employees,
  profiles,
  evaluations,
  onUpdateEvaluations,
  theme = 'dark'
}: KpiFormulaEngineModalProps) {
  const [activeTab, setActiveTab] = useState<'define' | 'calculate' | 'batch'>('define');

  // --- 1. KPI DEFINITION STATE ---
  const [kpiCode, setKpiCode] = useState('KPI-PRD-01');
  const [kpiName, setKpiName] = useState('');
  const [kpiDef, setKpiDef] = useState('');
  const [kpiCat, setKpiCat] = useState<'K' | 'Q' | 'B' | 'S' | 'L'>('K');
  const [kpiDir, setKpiDir] = useState<'more' | 'less'>('more');
  const [calcType, setCalcType] = useState<KpiCalculationType>('ratio');
  const [customFormula, setCustomFormula] = useState('(actual / target) * 100');
  const [kpiUnit, setKpiUnit] = useState('درصد');
  const [targetVal, setTargetVal] = useState<number>(100);

  // Dynamic variables for the formula
  const [variables, setVariables] = useState<KpiVariableDefinition[]>([
    { key: 'actual', label: 'عملکرد واقعی', unit: 'عدد', defaultValue: 95 },
    { key: 'target', label: 'تارگت مصوب', unit: 'عدد', defaultValue: 100 }
  ]);
  const [criterionSearchQuery, setCriterionSearchQuery] = useState('');

  // Thresholds state
  const [thresholds, setThresholds] = useState<KpiScoreThresholds>({
    score5: 105,
    score4: 95,
    score3: 85,
    score2: 70
  });

  // Test Sandbox state
  const [testValues, setTestValues] = useState<Record<string, number>>({
    actual: 98,
    target: 100
  });

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // --- 2. SINGLE DATA ENTRY & AUTO EVALUATION STATE ---
  const [selectedKpiId, setSelectedKpiId] = useState<string>(() => {
    const kpi = criteria.find(c => c.calculationType || c.code.startsWith('K'));
    return kpi?.id || criteria[0]?.id || '';
  });
  const [selectedEmpId, setSelectedEmpId] = useState<string>(() => employees[0]?.id || '');
  const [activePeriod, setActivePeriod] = useState(() => db.getMiscData<string>('pe_active_period', '').trim());
  useEffect(() => db.subscribe((key, data) => {
    if (key === 'pe_active_period') setActivePeriod(typeof data === 'string' ? data.trim() : '');
  }), []);
  const [selectedPeriod, setSelectedPeriod] = useState<string>(() => activePeriod || CURRENT_ACTIVE_PERIOD);
  const availableEvaluationPeriods = useMemo(() => Array.from(new Set([
    CURRENT_ACTIVE_PERIOD,
    activePeriod,
    selectedPeriod,
    ...evaluations.map(evaluation => evaluation.period).filter(Boolean),
  ])).filter(Boolean).sort((left, right) => left === (activePeriod || CURRENT_ACTIVE_PERIOD)
    ? -1
    : right === (activePeriod || CURRENT_ACTIVE_PERIOD) ? 1 : left.localeCompare(right, 'fa')),
  [evaluations, selectedPeriod, activePeriod]);
  const [dataInputs, setDataInputs] = useState<Record<string, number>>({});

  // Active selected KPI object
  const activeSelectedKpi = useMemo(() => {
    return criteria.find(c => c.id === selectedKpiId) || criteria[0];
  }, [criteria, selectedKpiId]);

  const selectedFormulaEvaluation = useMemo(() => evaluations.find(evaluation =>
    evaluation.empId === selectedEmpId && evaluation.period === selectedPeriod,
  ), [evaluations, selectedEmpId, selectedPeriod]);

  const formulaSourceValues = useMemo(() => {
    const values: Record<string, number> = {};
    for (const score of selectedFormulaEvaluation?.scores || []) {
      if (isNumericScoreRecorded(score)) values[score.cid] = score.value;
    }
    return values;
  }, [selectedFormulaEvaluation]);

  const searchableReferenceCriteria = useMemo(() => {
    const query = criterionSearchQuery.trim().toLocaleLowerCase();
    return criteria.filter(criterion => !query || `${criterion.code} ${criterion.name}`.toLocaleLowerCase().includes(query));
  }, [criteria, criterionSearchQuery]);

  // Initialize data inputs when active KPI changes
  React.useEffect(() => {
    if (!activeSelectedKpi) return;
    const initial: Record<string, number> = {};
    if (activeSelectedKpi.variables && activeSelectedKpi.variables.length > 0) {
      activeSelectedKpi.variables.forEach(v => {
        initial[v.key] = v.defaultValue ?? 100;
      });
    } else {
      initial['actual'] = 95;
      initial['target'] = 100;
    }
    setDataInputs(initial);
  }, [activeSelectedKpi]);

  // Live calculation for single entry tab
  const singleCalculationResult = useMemo(() => {
    if (!activeSelectedKpi) return null;
    if (activeSelectedKpi.calculationType || activeSelectedKpi.formulaExpression) {
      const graph = evaluateCriterionFormulaGraph(criteria, formulaSourceValues, { [activeSelectedKpi.id]: dataInputs });
      return graph.results[activeSelectedKpi.id];
    }
    return calculateKpiScore(activeSelectedKpi, dataInputs);
  }, [activeSelectedKpi, criteria, dataInputs, formulaSourceValues]);

  // Live calculation for definition sandbox
  const sandboxKpiDummy: Criterion = useMemo(() => {
    return {
      id: 'dummy',
      code: kpiCode,
      name: kpiName || 'شاخص تستی',
      cat: kpiCat,
      def: kpiDef,
      dir: kpiDir,
      calculationType: calcType,
      formulaExpression: customFormula,
      variables,
      unit: kpiUnit,
      targetValue: targetVal,
      scoreThresholds: thresholds
    };
  }, [kpiCode, kpiName, kpiCat, kpiDef, kpiDir, calcType, customFormula, variables, kpiUnit, targetVal, thresholds]);

  const sandboxGraph = useMemo(() => evaluateCriterionFormulaGraph(
    [...criteria.filter(criterion => criterion.id !== sandboxKpiDummy.id), sandboxKpiDummy],
    formulaSourceValues,
    { [sandboxKpiDummy.id]: testValues },
  ), [criteria, formulaSourceValues, sandboxKpiDummy, testValues]);
  const sandboxResult = sandboxGraph.results[sandboxKpiDummy.id] || calculateKpiScore(sandboxKpiDummy, testValues);
  const sandboxIssues = sandboxGraph.issues.filter(issue => issue.criterionId === sandboxKpiDummy.id);
  const sandboxFormulaSyntax = useMemo(() => calcType === 'custom_formula'
    ? validateMathExpression(customFormula, variables.map(variable => variable.key))
    : {}, [calcType, customFormula, variables]);
  const blockingSandboxIssue = sandboxIssues.find(issue =>
    ['missing_dependency', 'inactive_dependency', 'invalid_source_type', 'dependency_error', 'cycle'].includes(issue.kind),
  );
  const formulaSaveDisabled = Boolean(
    blockingSandboxIssue
    || sandboxFormulaSyntax.error
    || (sandboxResult.error && !sandboxIssues.some(issue => issue.kind === 'missing_value')),
  );

  if (!isOpen) return null;

  // Preset formula switch handler
  const handleCalcTypeChange = (type: KpiCalculationType) => {
    setCalcType(type);
    if (type === 'ratio') {
      setCustomFormula('(actual / target) * 100');
      setKpiDir('more');
      setKpiUnit('درصد');
      setVariables([
        { key: 'actual', label: 'تولید واقعی', unit: 'عدد', defaultValue: 95 },
        { key: 'target', label: 'برنامه مصوب', unit: 'عدد', defaultValue: 100 }
      ]);
      setTestValues({ actual: 98, target: 100 });
      setThresholds(DEFAULT_KPI_THRESHOLDS);
    } else if (type === 'inverse_ratio') {
      setCustomFormula('(standard / actual) * 100');
      setKpiDir('more');
      setKpiUnit('درصد راندمان');
      setVariables([
        { key: 'actual', label: 'سایکل‌تایم واقعی', unit: 'ثانیه', defaultValue: 58 },
        { key: 'standard', label: 'استاندارد مهندسی خط', unit: 'ثانیه', defaultValue: 60 }
      ]);
      setTestValues({ actual: 58, standard: 60 });
      setThresholds(DEFAULT_KPI_THRESHOLDS);
    } else if (type === 'defect_rate') {
      setCustomFormula('100 - ((scrap / total) * 100)');
      setKpiDir('more');
      setKpiUnit('درصد سلامت');
      setVariables([
        { key: 'scrap', label: 'تعداد قطعات ضایعاتی', unit: 'عدد', defaultValue: 3 },
        { key: 'total', label: 'کل قطعات تولیدی', unit: 'عدد', defaultValue: 100 }
      ]);
      setTestValues({ scrap: 2, total: 100 });
      setThresholds(DEFAULT_KPI_THRESHOLDS);
    } else if (type === 'custom_formula') {
      setCustomFormula('(actual / target) * 80 + (quality_score * 0.2)');
      setVariables([
        { key: 'actual', label: 'عملکرد خط', unit: 'واحد', defaultValue: 90 },
        { key: 'target', label: 'هدف استاندارد', unit: 'واحد', defaultValue: 100 },
        { key: 'quality_score', label: 'نمره کیفی', unit: 'درصد', defaultValue: 98 }
      ]);
      setTestValues({ actual: 95, target: 100, quality_score: 98 });
    }
  };

  // Add variable to formula definition
  const handleAddVariable = () => {
    const nextKey = `var_${variables.length + 1}`;
    const newVar: KpiVariableDefinition = {
      key: nextKey,
      label: `متغیر ${variables.length + 1}`,
      unit: 'مقدار',
      defaultValue: 10
    };
    setVariables([...variables, newVar]);
    setTestValues({ ...testValues, [nextKey]: 10 });
  };

  const handleRemoveVariable = (index: number) => {
    const toRemove = variables[index];
    setVariables(variables.filter((_, i) => i !== index));
    const nextTest = { ...testValues };
    delete nextTest[toRemove.key];
    setTestValues(nextTest);
  };

  // Append operator to formula
  const handleAppendToFormula = (token: string) => {
    setCustomFormula(prev => prev ? `${prev} ${token} ` : token);
  };

  // Save new KPI
  const handleSaveKpi = (e: React.FormEvent) => {
    e.preventDefault();
    if (!kpiCode.trim() || !kpiName.trim()) {
      setFeedback({ type: 'error', message: 'لطفاً کد شاخص و عنوان آن را وارد کنید.' });
      return;
    }

    if (sandboxFormulaSyntax.error) {
      setFeedback({ type: 'error', message: `فرمول قابل محاسبه نیست: ${sandboxFormulaSyntax.error}` });
      return;
    }

    const invalidLink = blockingSandboxIssue;
    if (invalidLink) {
      setFeedback({ type: 'error', message: invalidLink.message });
      return;
    }
    if (sandboxResult.error && !sandboxIssues.some(issue => issue.kind === 'missing_value')) {
      setFeedback({ type: 'error', message: `فرمول قابل محاسبه نیست: ${sandboxResult.error}` });
      return;
    }

    const newCrit: Omit<Criterion, 'id'> = {
      code: kpiCode.trim().toUpperCase(),
      name: kpiName.trim(),
      cat: kpiCat,
      def: kpiDef.trim() || `فرمول محاسباتی برای شاخص ${kpiName}`,
      dir: kpiDir,
      calculationType: calcType,
      formulaExpression: customFormula.trim(),
      variables: variables,
      unit: kpiUnit,
      targetValue: targetVal,
      scoreThresholds: thresholds,
      source: 'موتور محاسبات شاخص‌های عملکرد اصفهان چالاک',
      method: `فرمول خودکار: ${customFormula}`
    };

    const success = onAddCriterion(newCrit);
    if (success) {
      setFeedback({ type: 'success', message: `شاخص ${kpiName} با فرمول محاسباتی خودکار با موفقیت ثبت شد.` });
      // Reset or stay
      setTimeout(() => setFeedback(null), 4000);
    } else {
      setFeedback({ type: 'error', message: 'کد شاخص تکراری است یا مشکلی در اعتبارسنجی رخ داده است.' });
    }
  };

  // Apply single calculation directly into Evaluation
  const handleApplySingleScore = () => {
    if (!singleCalculationResult || !activeSelectedKpi) return;
    if (singleCalculationResult.error) {
      setFeedback({ type: 'error', message: singleCalculationResult.error });
      return;
    }

    const emp = employees.find(e => e.id === selectedEmpId);
    if (!emp) {
      setFeedback({ type: 'error', message: 'کارمند موردنظر یافت نشد.' });
      return;
    }

    // Find or create evaluation
    let targetEval = evaluations.find(ev => ev.empId === selectedEmpId && ev.period === selectedPeriod);
    let nextEvaluations = [...evaluations];

    if (!targetEval) {
      // Create new evaluation
      const prof = profiles.find(p => p.id === emp.profileId) || profiles[0];
      const initialScores = (prof?.items || []).map(item => ({
        cid: item.cid,
        weight: item.weight,
        value: item.cid === activeSelectedKpi.id ? singleCalculationResult.score : 0,
        self: 0,
        doc: item.cid === activeSelectedKpi.id ? singleCalculationResult.summaryText : ''
      }));

      // Ensure the KPI is in scores even if not in standard profile
      if (!initialScores.some(s => s.cid === activeSelectedKpi.id)) {
        initialScores.push({
          cid: activeSelectedKpi.id,
          weight: 15,
          value: singleCalculationResult.score,
          self: 0,
          doc: singleCalculationResult.summaryText
        });
      }

      const newEv: Evaluation = {
        id: `eval-${Math.random().toString(36).substring(2, 9)}`,
        empId: selectedEmpId,
        profileId: prof?.id || 'prof-1',
        period: selectedPeriod,
        status: 'draft',
        ...resolveInitialEvaluationWorkflow(emp, employees, db.getMiscData('pe_route_rules', DEFAULT_ROUTE_RULES), prof?.id || emp.profileId),
        scores: initialScores,
        created: Date.now()
      };
      nextEvaluations.push(newEv);
    } else {
      // Update existing evaluation score
      const updatedScores = [...targetEval.scores];
      const scoreIndex = updatedScores.findIndex(s => s.cid === activeSelectedKpi.id);

      if (scoreIndex >= 0) {
        updatedScores[scoreIndex] = {
          ...updatedScores[scoreIndex],
          value: singleCalculationResult.score,
          doc: `${updatedScores[scoreIndex].doc ? updatedScores[scoreIndex].doc + ' | ' : ''}${singleCalculationResult.summaryText}`
        };
      } else {
        updatedScores.push({
          cid: activeSelectedKpi.id,
          weight: 15,
          value: singleCalculationResult.score,
          self: 0,
          doc: singleCalculationResult.summaryText
        });
      }

      nextEvaluations = nextEvaluations.map(ev => ev.id === targetEval!.id ? {
        ...ev,
        scores: updatedScores
      } : ev);
    }

    onUpdateEvaluations(nextEvaluations);
    setFeedback({
      type: 'success',
      message: `امتیاز ${singleCalculationResult.score} از ۵ بر اساس فرمول محاسبه و مستقیماً در کارنامه ${emp.name} درج شد.`
    });
    setTimeout(() => setFeedback(null), 4000);
  };

  if (!isOpen) return null;

  return typeof document !== 'undefined' ? createPortal(
    <div className="fixed inset-0 layer-modal flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto animate-in fade-in" dir="rtl">
      <div className={`relative w-full max-w-5xl rounded-3xl border shadow-2xl overflow-hidden my-6 flex flex-col max-h-[92vh] ${
        theme === 'dark' ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
      }`}>
        
        {/* HEADER */}
        <div className={`p-5 md:px-7 border-b flex items-center justify-between shrink-0 ${
          theme === 'dark' ? 'bg-slate-950/80 border-slate-800' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
              <Calculator className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black">موتور هوشمند فرمول‌ساز و ارزیاب خودکار KPI</h2>
                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-mono font-bold">
                  v3.8 Dynamic Engine
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                تعریف شاخص‌های جدید با فرمول‌های ریاضی دلخواه، دریافت داده‌های خام و تبدیل آنی به نمرات ۱ تا ۵ کارنامه
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* NAVIGATION TABS */}
        <div className="flex items-center gap-2 px-6 pt-4 border-b border-slate-800/40 bg-slate-950/30">
          <button
            type="button"
            onClick={() => setActiveTab('define')}
            className={`py-3 px-4 rounded-t-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer border-b-2 ${
              activeTab === 'define'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>۱. تعریف شاخص جدید و طراحی فرمول</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('calculate')}
            className={`py-3 px-4 rounded-t-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer border-b-2 ${
              activeTab === 'calculate'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-4 h-4 text-amber-400" />
            <span>۲. ورود داده‌های خام و محاسبه خودکار نمره</span>
          </button>
        </div>

        {/* FEEDBACK BANNER */}
        {feedback && (
          <div className={`mx-6 mt-4 p-3 rounded-2xl flex items-center justify-between text-xs font-bold animate-in fade-in ${
            feedback.type === 'success' 
              ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400' 
              : 'bg-rose-500/15 border border-rose-500/30 text-rose-400'
          }`}>
            <div className="flex items-center gap-2">
              {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              <span>{feedback.message}</span>
            </div>
            <button type="button" onClick={() => setFeedback(null)} className="cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* CONTENT AREA */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* ========================================================================= */}
          {/* TAB 1: DEFINE NEW KPI WITH CUSTOM FORMULA                                 */}
          {/* ========================================================================= */}
          {activeTab === 'define' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Form: Metadata & Formula Builder */}
              <div className="lg:col-span-7 space-y-5">
                <div className="p-4 rounded-2xl bg-slate-950/40 border border-slate-800/80 space-y-4">
                  <h3 className="text-xs font-black text-emerald-400 flex items-center gap-2">
                    <Sliders className="w-4 h-4" />
                    <span>اطلاعات پایه شاخص</span>
                  </h3>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-bold text-slate-400 block mb-1">کد شاخص (با پیشوند)</label>
                      <input
                        type="text"
                        value={kpiCode}
                        onChange={(e) => setKpiCode(e.target.value)}
                        placeholder="مثال: KPI-PRD-01"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold focus:outline-none focus:border-emerald-500"
                        dir="ltr"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-slate-400 block mb-1">دسته‌بندی</label>
                      <select
                        value={kpiCat}
                        onChange={(e) => setKpiCat(e.target.value as any)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:border-emerald-500"
                      >
                        <option value="K">K - شاخص‌های کلیدی عملکرد (KPI)</option>
                        <option value="Q">Q - کنترل کیفیت و ضایعات</option>
                        <option value="B">B - رفتاری و شایستگی‌های عمومی</option>
                        <option value="S">S - ایمنی، بهداشت و ۵اس</option>
                        <option value="L">L - مهارت‌های فنی و رهبری</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-400 block mb-1">عنوان شاخص</label>
                    <input
                      type="text"
                      value={kpiName}
                      onChange={(e) => setKpiName(e.target.value)}
                      placeholder="مثال: راندمان خط بسته‌بندی بر حسب تارگت شیفت"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-400 block mb-1">تعریف عملیاتی و منطق سنجش</label>
                    <textarea
                      rows={2}
                      value={kpiDef}
                      onChange={(e) => setKpiDef(e.target.value)}
                      placeholder="شرح روش اندازه‌گیری و کاربرد صنعتی شاخص..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                {/* Formula Type & Expression */}
                <div className="p-4 rounded-2xl bg-slate-950/40 border border-slate-800/80 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black text-emerald-400 flex items-center gap-2">
                      <Calculator className="w-4 h-4" />
                      <span>نوع محاسبه و فرمول ریاضی</span>
                    </h3>

                    <div className="flex items-center gap-1.5 text-[10px]">
                      <span className="text-slate-400">جهت مطلوبیت:</span>
                      <button
                        type="button"
                        onClick={() => setKpiDir(kpiDir === 'more' ? 'less' : 'more')}
                        className={`px-2 py-0.5 rounded-md font-bold cursor-pointer transition-colors ${
                          kpiDir === 'more' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                        }`}
                      >
                        {kpiDir === 'more' ? 'هرچه بیشتر بهتر (More)' : 'هرچه کمتر بهتر (Less)'}
                      </button>
                    </div>
                  </div>

                  {/* Preset Buttons */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => handleCalcTypeChange('ratio')}
                      className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                        calcType === 'ratio'
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300 font-black'
                          : 'border-slate-800 hover:bg-slate-800/40 text-slate-400 text-xs'
                      }`}
                    >
                      <div className="text-[11px] font-bold">تحقق برنامه</div>
                      <div className="text-[9px] text-slate-500 font-mono mt-0.5">(actual/target)*100</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCalcTypeChange('inverse_ratio')}
                      className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                        calcType === 'inverse_ratio'
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300 font-black'
                          : 'border-slate-800 hover:bg-slate-800/40 text-slate-400 text-xs'
                      }`}
                    >
                      <div className="text-[11px] font-bold">سایکل‌تایم و زمان</div>
                      <div className="text-[9px] text-slate-500 font-mono mt-0.5">(standard/actual)*100</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCalcTypeChange('defect_rate')}
                      className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                        calcType === 'defect_rate'
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300 font-black'
                          : 'border-slate-800 hover:bg-slate-800/40 text-slate-400 text-xs'
                      }`}
                    >
                      <div className="text-[11px] font-bold">کنترل ضایعات</div>
                      <div className="text-[9px] text-slate-500 font-mono mt-0.5">100 - (scrap/total)*100</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCalcTypeChange('custom_formula')}
                      className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                        calcType === 'custom_formula'
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300 font-black'
                          : 'border-slate-800 hover:bg-slate-800/40 text-slate-400 text-xs'
                      }`}
                    >
                      <div className="text-[11px] font-bold">فرمول دلخواه</div>
                      <div className="text-[9px] text-slate-500 font-mono mt-0.5">ترکیبی و سفارشی</div>
                    </button>
                  </div>

                  {/* Formula Expression Input */}
                  <div>
                    <label htmlFor="formula-expression" className="text-[11px] font-bold text-slate-400 block mb-1">
                      عبارت فرمول ریاضی:
                    </label>
                    <input
                      id="formula-expression"
                      type="text"
                      value={customFormula}
                      onChange={(e) => setCustomFormula(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs font-mono font-bold text-emerald-400 focus:outline-none focus:border-emerald-500"
                      dir="ltr"
                    />
                  </div>

                  {/* Quick Calculator Pad Buttons */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] text-slate-400 ml-2">درج سریع:</span>
                    {['+', '-', '*', '/', '(', ')', '%'].map(op => (
                      <button
                        key={op}
                        type="button"
                        onClick={() => handleAppendToFormula(op)}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs font-mono font-bold cursor-pointer"
                      >
                        {op}
                      </button>
                    ))}

                    {variables.map(v => (
                      <button
                        key={v.key}
                        type="button"
                        onClick={() => handleAppendToFormula(v.key)}
                        className="px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-xs font-mono font-bold cursor-pointer"
                      >
                        {v.key}
                      </button>
                    ))}
                  </div>

                  {/* Variables Manager */}
                  <div className="pt-2 border-t border-slate-800/60 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-300">متغیرهای ورودی این فرمول:</span>
                      <button
                        type="button"
                        onClick={handleAddVariable}
                        className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" /> افزودن متغیر جدید
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:items-end">
                      <label className="text-[10px] font-bold text-slate-400">
                        جستجوی معیارهای مرجع
                        <input type="search" aria-label="جستجوی معیارهای مرجع فرمول" value={criterionSearchQuery} onChange={event => setCriterionSearchQuery(event.target.value)} placeholder="کد یا عنوان معیار" className="mt-1 min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100" />
                      </label>
                      <p className="text-[10px] leading-5 text-slate-400">ارجاع با شناسه پایدار معیار ذخیره می‌شود؛ تغییر عنوان، پیوند فرمول را نمی‌شکند.</p>
                    </div>

                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {variables.map((v, idx) => (
                        <div key={idx} className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs">
                          <input
                            type="text"
                            value={v.key}
                            onChange={(e) => {
                              const updated = [...variables];
                              updated[idx].key = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
                              setVariables(updated);
                            }}
                            className="w-24 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-emerald-300"
                            placeholder="نام انگلیسی"
                            dir="ltr"
                          />
                          <input
                            type="text"
                            value={v.label}
                            onChange={(e) => {
                              const updated = [...variables];
                              updated[idx].label = e.target.value;
                              setVariables(updated);
                            }}
                            className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs"
                            placeholder="عنوان فارسی"
                          />
                          <input
                            type="text"
                            value={v.unit || ''}
                            onChange={(e) => {
                              const updated = [...variables];
                              updated[idx].unit = e.target.value;
                              setVariables(updated);
                            }}
                            className="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs"
                            placeholder="واحد"
                          />
                          <select
                            aria-label={`معیار مرجع برای ${v.label}`}
                            value={v.sourceCriterionId || ''}
                            onChange={event => {
                              const sourceId = event.target.value || undefined;
                              const source = criteria.find(criterion => criterion.id === sourceId);
                              const updated = [...variables];
                              updated[idx] = {
                                ...updated[idx],
                                sourceCriterionId: sourceId,
                                ...(source ? { label: source.name, unit: source.unit || updated[idx].unit } : {}),
                              };
                              setVariables(updated);
                            }}
                            className="min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-[10px] text-slate-200 sm:w-56"
                          >
                            <option value="">ورودی دستی</option>
                            {searchableReferenceCriteria.filter(criterion => criterion.code !== kpiCode.trim().toUpperCase()).map(criterion => (
                              <option key={criterion.id} value={criterion.id} disabled={criterion.active === false}>
                                [{criterion.code}] {criterion.name}{criterion.active === false ? ' (غیرفعال)' : ''}
                              </option>
                            ))}
                          </select>
                          {variables.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveVariable(idx)}
                              className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div aria-label="وابستگی‌های فرمول" className="rounded-lg border border-slate-800 bg-slate-950/50 p-2 text-[10px] text-slate-400">
                      <strong className="text-slate-300">وابستگی‌های معیار:</strong>{' '}
                      {variables.some(variable => variable.sourceCriterionId) ? variables.filter(variable => variable.sourceCriterionId).map(variable => {
                        const source = criteria.find(criterion => criterion.id === variable.sourceCriterionId);
                        return <span key={variable.key} className="ml-2 inline-flex items-center gap-1"><span>{source ? `[${source.code}] ${source.name}${source.active === false ? ' (غیرفعال)' : ''}` : 'شاخص مورد استفاده در فرمول پیدا نشد.'}</span></span>;
                      }) : <span>معیار مرجعی انتخاب نشده است؛ ورودی‌ها دستی هستند.</span>}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSaveKpi}
                  disabled={formulaSaveDisabled}
                  data-testid="formula-save-button"
                  className="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 cursor-pointer transition-all disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>ثبت نهایی و افزودن شاخص به بانک شایستگی‌ها</span>
                </button>
              </div>

              {/* Right Side: Interactive Sandbox & Thresholds */}
              <div className="lg:col-span-5 space-y-5">
                
                {/* Live Simulation Card */}
                <div className="p-5 rounded-3xl bg-gradient-to-b from-slate-900 to-slate-950 border border-emerald-500/30 shadow-xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black text-emerald-400 flex items-center gap-2">
                      <Play className="w-4 h-4" />
                      <span>تست زنده فرمول (Sandbox Simulation)</span>
                    </h3>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-bold">
                      ارزیابی آنی
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400">
                    مقادیر معیارهای پیوندخورده از ارزیابی انتخاب‌شده خوانده می‌شوند؛ ورودی‌های دستی را هم می‌توانید تغییر دهید.
                  </p>
                  <p className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-[10px] leading-5 text-slate-400" data-testid="formula-syntax-hint">
                    عملگرهای پشتیبانی‌شده: +، −، ×، ÷، باقی‌مانده، توان و پرانتز. نام تابع‌ها پشتیبانی نمی‌شوند.
                  </p>

                  {/* Variables Inputs for Sandbox */}
                  <div className="space-y-2">
                    {variables.map(v => (
                      <div key={v.key} className="flex items-center justify-between p-2 rounded-xl bg-slate-900 border border-slate-800">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-emerald-400 font-bold">{v.key}</span>
                          <span className="text-xs text-slate-300 font-bold">{v.label}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={testValues[v.key] ?? v.defaultValue ?? 0}
                            onChange={(e) => setTestValues({ ...testValues, [v.key]: Number(e.target.value) })}
                            className="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-left font-mono font-bold focus:outline-none focus:border-emerald-500"
                            dir="ltr"
                          />
                          <span className="text-[10px] text-slate-500">{v.unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Calculation Result Display */}
                  <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
                    {sandboxFormulaSyntax.error && (
                      <div role="alert" data-testid="formula-preview-syntax-error" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[10px] text-rose-300">
                        فرمول قابل خواندن نیست: {sandboxFormulaSyntax.error}
                      </div>
                    )}
                    {sandboxIssues.map((issue, index) => (
                      <div key={`${issue.kind}-${issue.dependencyId || index}`} role={issue.severity === 'error' ? 'alert' : 'status'} data-testid={`formula-preview-issue-${issue.kind}`} className={`rounded-lg border px-3 py-2 text-[10px] ${issue.severity === 'error' ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-300'}`}>
                        {issue.message}
                      </div>
                    ))}
                    {sandboxResult.error && !sandboxIssues.some(issue => issue.kind === 'missing_value') && (
                      <div role="alert" data-testid="formula-preview-error" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[10px] text-rose-300">{sandboxResult.error}</div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-400">مقدار خام محاسبه‌شده:</span>
                      <span className="text-lg font-black font-mono text-teal-400">
                        <span data-testid="formula-preview-computed">{sandboxResult.error && sandboxIssues.some(issue => issue.kind === 'missing_value') ? '—' : sandboxResult.computedValue}</span> {kpiUnit}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                      <span className="text-xs font-bold text-slate-300">نمره استاندارد کارنامه (۱ تا ۵):</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-2xl font-black font-mono px-3 py-0.5 rounded-xl ${
                          sandboxResult.score >= 4
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                            : sandboxResult.score === 3
                            ? 'bg-teal-500/20 text-teal-400 border border-teal-500/40'
                            : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                        }`}>
                          {sandboxResult.score}
                        </span>
                        <span className="text-xs font-bold text-slate-400">از ۵</span>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-400 bg-slate-900 p-2.5 rounded-xl border border-slate-800/80">
                      <span className="font-bold text-slate-200">وضعیت ارزیابی: </span>
                      <span className={sandboxResult.score >= 4 ? 'text-emerald-400' : 'text-amber-400'}>
                        {sandboxResult.statusLabel}
                      </span>
                      <p className="text-[10px] text-slate-500 mt-1">{sandboxResult.summaryText}</p>
                    </div>
                  </div>
                </div>

                {/* Score Thresholds Configuration */}
                <div className="p-4 rounded-2xl bg-slate-950/40 border border-slate-800/80 space-y-3">
                  <h3 className="text-xs font-black text-slate-300 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-teal-400" />
                    <span>آستانه‌های نمره‌دهی (Thresholds)</span>
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    تعیین حداقل مقدار لازم برای کسب هر نمره از ۱ تا ۵:
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                      <div className="text-[10px] font-bold text-emerald-400">نمره ۵ (عالی / فوق‌العاده)</div>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-[10px] text-slate-400">حداقل:</span>
                        <input
                          type="number"
                          value={thresholds.score5}
                          onChange={(e) => setThresholds({ ...thresholds, score5: Number(e.target.value) })}
                          className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs font-mono font-bold text-left"
                          dir="ltr"
                        />
                      </div>
                    </div>

                    <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                      <div className="text-[10px] font-bold text-teal-400">نمره ۴ (بسیار خوب)</div>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-[10px] text-slate-400">حداقل:</span>
                        <input
                          type="number"
                          value={thresholds.score4}
                          onChange={(e) => setThresholds({ ...thresholds, score4: Number(e.target.value) })}
                          className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs font-mono font-bold text-left"
                          dir="ltr"
                        />
                      </div>
                    </div>

                    <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                      <div className="text-[10px] font-bold text-blue-400">نمره ۳ (منطبق بر هدف)</div>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-[10px] text-slate-400">حداقل:</span>
                        <input
                          type="number"
                          value={thresholds.score3}
                          onChange={(e) => setThresholds({ ...thresholds, score3: Number(e.target.value) })}
                          className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs font-mono font-bold text-left"
                          dir="ltr"
                        />
                      </div>
                    </div>

                    <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                      <div className="text-[10px] font-bold text-amber-400">نمره ۲ (نیاز به بهبود)</div>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-[10px] text-slate-400">حداقل:</span>
                        <input
                          type="number"
                          value={thresholds.score2}
                          onChange={(e) => setThresholds({ ...thresholds, score2: Number(e.target.value) })}
                          className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs font-mono font-bold text-left"
                          dir="ltr"
                        />
                      </div>
                    </div>
                  </div>
                </div>

              </div>

            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: DATA INPUT & AUTO EVALUATION                                      */}
          {/* ========================================================================= */}
          {activeTab === 'calculate' && (
            <div className="space-y-6">
              
              {/* Header explanation */}
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Zap className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div>
                    <h3 className="text-xs font-black text-emerald-300">ورود داده‌های عملکردی و درج آنی در کارنامه</h3>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      فقط مقادیر خام را وارد کنید؛ سامانه طبق فرمول شاخص، درصد تحقق و امتیاز ۱ تا ۵ را محاسبه و مستقیماً در کارنامه فرد درج می‌کند.
                    </p>
                  </div>
                </div>
              </div>

              {/* Selection Bar */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-2xl bg-slate-950/40 border border-slate-800">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">شاخص ارزیابی موردنظر:</label>
                  <select
                    value={selectedKpiId}
                    onChange={(e) => setSelectedKpiId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:border-emerald-500"
                  >
                    {criteria.map(c => (
                      <option key={c.id} value={c.id}>
                        [{c.code}] {c.name} {c.formulaExpression ? '(فرمول‌دار)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">همکار و اپراتور:</label>
                  <select
                    value={selectedEmpId}
                    onChange={(e) => setSelectedEmpId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:border-emerald-500"
                  >
                    {employees.map(e => (
                      <option key={e.id} value={e.id}>
                        {e.name} ({e.code}) - {e.unit}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">دوره ارزیابی:</label>
                  <select
                    aria-label="دوره ارزیابی"
                    value={selectedPeriod}
                    onChange={(e) => setSelectedPeriod(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:border-emerald-500"
                  >
                    {availableEvaluationPeriods.map(period => <option key={period} value={period}>{period}{period === (activePeriod || CURRENT_ACTIVE_PERIOD) ? ' (دوره فعال)' : ''}</option>)}
                  </select>
                </div>
              </div>

              {/* Data Input Form for selected KPI */}
              {activeSelectedKpi && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  
                  {/* Left: Input fields */}
                  <div className="md:col-span-7 p-5 rounded-2xl bg-slate-950/40 border border-slate-800 space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                      <div>
                        <span className="text-xs font-black text-slate-200">
                          ورود داده‌های شاخص: {activeSelectedKpi.name}
                        </span>
                        <p className="text-[10px] font-mono text-emerald-400 mt-0.5">
                          فرمول سنجش: {activeSelectedKpi.formulaExpression || '(actual / target) * 100'}
                        </p>
                      </div>
                      <span className="text-[10px] bg-slate-800 px-2 py-1 rounded font-mono text-slate-300">
                        {activeSelectedKpi.code}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {(activeSelectedKpi.variables && activeSelectedKpi.variables.length > 0) ? (
                        activeSelectedKpi.variables.map(v => (
                          <div key={v.key} className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
                            <div>
                              <div className="text-xs font-bold text-slate-200">{v.label}</div>
                                  <div className="text-[10px] text-slate-500">{v.sourceCriterionId ? `منبع پایدار: ${criteria.find(criterion => criterion.id === v.sourceCriterionId) ? `[${criteria.find(criterion => criterion.id === v.sourceCriterionId)?.code}] ${criteria.find(criterion => criterion.id === v.sourceCriterionId)?.name}${criteria.find(criterion => criterion.id === v.sourceCriterionId)?.active === false ? ' (غیرفعال)' : ''}` : 'شاخص مورد استفاده در فرمول پیدا نشد.'}` : `ورودی دستی · ${v.key}`}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                aria-label={`مقدار ${v.label}`}
                                disabled={Boolean(v.sourceCriterionId)}
                                value={v.sourceCriterionId
                                  ? (selectedFormulaEvaluation?.scores.find(score => score.cid === v.sourceCriterionId && isNumericScoreRecorded(score))?.value ?? '')
                                  : dataInputs[v.key] ?? v.defaultValue ?? 0}
                                onChange={(e) => setDataInputs({ ...dataInputs, [v.key]: Number(e.target.value) })}
                                className="w-28 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm font-mono font-bold text-left focus:outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                                dir="ltr"
                              />
                              <span className="text-xs text-slate-400 w-12">{v.unit}</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        // Standard fallback inputs
                        <>
                          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
                            <div>
                              <div className="text-xs font-bold text-slate-200">عملکرد و تولید واقعی (Actual)</div>
                              <div className="text-[10px] text-slate-500">تعداد یا مقدار تحقق یافته</div>
                            </div>
                            <input
                              type="number"
                              aria-label="مقدار عملکرد واقعی"
                              value={dataInputs['actual'] ?? 95}
                              onChange={(e) => setDataInputs({ ...dataInputs, actual: Number(e.target.value) })}
                              className="w-28 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm font-mono font-bold text-left"
                              dir="ltr"
                            />
                          </div>

                          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
                            <div>
                              <div className="text-xs font-bold text-slate-200">تارگت و برنامه مصوب (Target)</div>
                              <div className="text-[10px] text-slate-500">هدف ابلاغی دوره</div>
                            </div>
                            <input
                              type="number"
                              aria-label="مقدار تارگت مصوب"
                              value={dataInputs['target'] ?? 100}
                              onChange={(e) => setDataInputs({ ...dataInputs, target: Number(e.target.value) })}
                              className="w-28 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm font-mono font-bold text-left"
                              dir="ltr"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Right: Calculated Live Score & Action */}
                  <div className="md:col-span-5 p-5 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-emerald-500/30 flex flex-col justify-between space-y-4">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-400">نتیجه محاسبه فرمول:</span>
                        <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full font-bold">
                          اتوماتیک
                        </span>
                      </div>

                      <div className="mt-4 p-4 rounded-2xl bg-slate-950/90 border border-slate-800 text-center space-y-2">
                        <div className="text-2xl font-black font-mono text-teal-400">
                          <span data-testid="formula-calculation-computed">{singleCalculationResult?.error ? '—' : singleCalculationResult?.computedValue ?? 0}</span> {activeSelectedKpi.unit || '%'}
                        </div>
                        <div className="text-xs text-slate-400">راندمان و شاخص عملکردی</div>

                        <div className="pt-3 border-t border-slate-800 flex items-center justify-center gap-3">
                          <span className="text-xs font-bold text-slate-300">امتیاز نهایی کارنامه:</span>
                          <span className="text-3xl font-black font-mono text-emerald-400 px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                            {singleCalculationResult?.score ?? 3}
                          </span>
                          <span className="text-xs text-slate-400">از ۵</span>
                        </div>

                        {singleCalculationResult?.error && (
                          <div role="alert" data-testid="formula-calculation-error" className="text-[11px] font-bold text-rose-300">
                            {singleCalculationResult.error}
                          </div>
                        )}
                        <div className={`text-[11px] font-bold pt-1 ${singleCalculationResult?.error ? 'text-rose-300' : 'text-emerald-400'}`}>
                          {singleCalculationResult?.statusLabel}
                        </div>
                      </div>

                      <p className={`text-[10px] mt-3 p-2 rounded-xl border ${singleCalculationResult?.error ? 'border-rose-500/30 bg-rose-500/5 text-rose-200' : 'border-slate-800 bg-slate-900/60 text-slate-400'}`}>
                        مستندات ثبت در کارنامه: {singleCalculationResult?.summaryText}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={!selectedEmpId || Boolean(singleCalculationResult?.error)}
                      onClick={handleApplySingleScore}
                      className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 cursor-pointer transition-all disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>محاسبه و درج مستقیم در کارنامه ارزیابی</span>
                    </button>
                  </div>

                </div>
              )}

            </div>
          )}

        </div>

        {/* FOOTER */}
        <div className={`p-4 px-6 border-t flex items-center justify-between shrink-0 ${
          theme === 'dark' ? 'bg-slate-950/80 border-slate-800' : 'bg-slate-50 border-slate-200'
        }`}>
          <span className="text-[11px] text-slate-400">
            سیستم ارزیابی عملکرد و توسعه شایستگی اصفهان چالاک • موتور فرمول‌ساز هوشمند
          </span>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold cursor-pointer transition-colors"
          >
            بستن پنجره
          </button>
        </div>

      </div>
    </div>,
    document.body
  ) : null;
}

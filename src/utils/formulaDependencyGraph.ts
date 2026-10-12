import type { Criterion } from '../types';
import { calculateKpiScore, type EvaluationFormulaResult } from './formulaEngine';

export type FormulaDependencyIssueKind = 'missing_dependency' | 'inactive_dependency' | 'invalid_source_type' | 'dependency_error' | 'cycle' | 'missing_value' | 'calculation_error';
export interface FormulaDependencyIssue {
  kind: FormulaDependencyIssueKind;
  criterionId: string;
  dependencyId?: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface FormulaGraphResult {
  dependencies: Record<string, string[]>;
  topologicalOrder: string[];
  issues: FormulaDependencyIssue[];
  computedValues: Record<string, number>;
  results: Record<string, EvaluationFormulaResult>;
}

const failureResult = (message: string): EvaluationFormulaResult => ({
  computedValue: 0,
  score: 1,
  status: 'critical',
  statusLabel: 'خطا در فرمول',
  summaryText: message,
  error: message,
});

export function evaluateCriterionFormulaGraph(
  criteria: Criterion[],
  sourceValues: Record<string, number | undefined>,
  manualInputsByCriterion: Record<string, Record<string, number | undefined>> = {},
): FormulaGraphResult {
  const byId = new Map(criteria.map(criterion => [criterion.id, criterion]));
  const formulas = criteria.filter(criterion => Boolean(criterion.calculationType || criterion.formulaExpression));
  const dependencies: Record<string, string[]> = {};
  const issues: FormulaDependencyIssue[] = [];

  for (const criterion of formulas) {
    const refs = Array.from(new Set((criterion.variables || []).flatMap(variable => variable.sourceCriterionId ? [variable.sourceCriterionId] : [])));
    dependencies[criterion.id] = refs;
    for (const dependencyId of refs) {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        issues.push({
          kind: 'missing_dependency', criterionId: criterion.id, dependencyId, severity: 'error',
          message: 'شاخص مورد استفاده در فرمول پیدا نشد.',
        });
      } else if (dependency.active === false) {
        issues.push({
          kind: 'inactive_dependency', criterionId: criterion.id, dependencyId, severity: 'error',
          message: 'شاخص مرجع غیرفعال شده است و در فرمول قابل استفاده نیست.',
        });
      } else if (dependency.dataType && !['number', 'percentage'].includes(dependency.dataType)) {
        issues.push({
          kind: 'invalid_source_type', criterionId: criterion.id, dependencyId, severity: 'warning',
          message: 'منبع انتخاب‌شده برای فرمول عددی نیست.',
        });
      }
    }
  }

  const order: string[] = [];
  const visited = new Set<string>();
  const visiting = new Map<string, number>();
  const visit = (criterionId: string, stack: string[]) => {
    if (visited.has(criterionId)) return;
    const cycleAt = visiting.get(criterionId);
    if (cycleAt !== undefined) {
      const cycle = stack.slice(cycleAt);
      for (const id of cycle) issues.push({
        kind: 'cycle', criterionId: id, dependencyId: criterionId, severity: 'error',
        message: 'وابستگی چرخه‌ای در فرمول شناسایی شد.',
      });
      return;
    }
    visiting.set(criterionId, stack.length);
    const nextStack = [...stack, criterionId];
    for (const dependencyId of dependencies[criterionId] || []) {
      const dependency = byId.get(dependencyId);
      if (dependency && (dependency.calculationType || dependency.formulaExpression)) visit(dependencyId, nextStack);
    }
    visiting.delete(criterionId);
    visited.add(criterionId);
    order.push(criterionId);
  };
  formulas.forEach(criterion => visit(criterion.id, []));

  const issueKeys = new Set<string>();
  const uniqueIssues = issues.filter(issue => {
    const key = `${issue.kind}:${issue.criterionId}:${issue.dependencyId || ''}`;
    if (issueKeys.has(key)) return false;
    issueKeys.add(key);
    return true;
  });
  const computedValues: Record<string, number> = {};
  for (const [criterionId, value] of Object.entries(sourceValues)) {
    if (typeof value === 'number' && Number.isFinite(value)) computedValues[criterionId] = value;
  }
  const results: Record<string, EvaluationFormulaResult> = {};

  for (const criterionId of order) {
    const criterion = byId.get(criterionId);
    if (!criterion) continue;
    const receivesManualInput = Object.prototype.hasOwnProperty.call(manualInputsByCriterion, criterionId);
    if (!receivesManualInput && !(dependencies[criterionId] || []).length) continue;
    delete computedValues[criterionId];
    const blocking = uniqueIssues.find(issue => issue.criterionId === criterionId && issue.severity === 'error');
    if (blocking) {
      results[criterionId] = failureResult(blocking.message);
      continue;
    }

    const inputs: Record<string, number | undefined> = { ...(manualInputsByCriterion[criterionId] || {}) };
    let missingDependency: string | undefined;
    let failedDependency: { id: string; message: string } | undefined;
    for (const variable of criterion.variables || []) {
      if (!variable.sourceCriterionId) continue;
      const value = computedValues[variable.sourceCriterionId];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        const upstreamIssue = uniqueIssues.find(issue =>
          issue.criterionId === variable.sourceCriterionId
          && issue.severity === 'error'
          && issue.kind !== 'missing_value',
        );
        const upstreamResult = results[variable.sourceCriterionId];
        const upstreamIsWaitingForValue = uniqueIssues.some(issue =>
          issue.criterionId === variable.sourceCriterionId
          && issue.severity === 'error'
          && issue.kind === 'missing_value',
        );
        if (upstreamIssue || (upstreamResult?.error && !upstreamIsWaitingForValue)) {
          failedDependency = {
            id: variable.sourceCriterionId,
            message: upstreamResult?.error || upstreamIssue!.message,
          };
          break;
        }
        missingDependency = variable.sourceCriterionId;
        break;
      }
      inputs[variable.key] = value;
    }

    if (failedDependency) {
      const dependencyName = byId.get(failedDependency.id)?.name || failedDependency.id;
      const message = `فرمول مرجع «${dependencyName}» دارای خطاست: ${failedDependency.message}`;
      uniqueIssues.push({
        kind: 'dependency_error', criterionId, dependencyId: failedDependency.id, severity: 'error', message,
      });
      results[criterionId] = failureResult(message);
      continue;
    }

    if (missingDependency) {
      const message = 'مقدار شاخص مرجع ثبت نشده یا در وضعیت «نیاز به امتیاز ندارد» است.';
      uniqueIssues.push({ kind: 'missing_value', criterionId, dependencyId: missingDependency, severity: 'error', message });
      results[criterionId] = failureResult(message);
      continue;
    }

    const result = calculateKpiScore(criterion, inputs);
    results[criterionId] = result;
    if (result.error) {
      uniqueIssues.push({ kind: 'calculation_error', criterionId, severity: 'error', message: result.error });
      continue;
    }
    computedValues[criterionId] = result.computedValue;
  }

  return { dependencies, topologicalOrder: order, issues: uniqueIssues, computedValues, results };
}

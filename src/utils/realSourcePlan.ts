import type { Criterion, Employee, Evaluation, JobProfile } from '../types';
import { canImport, type GranularPermissionPolicy } from './authorization';
import { canonicalEvaluationPeriodId, getEvaluationPeriodId, getEvaluationPeriodStartOrdinal } from './evaluationPeriod';
import { matchRawMetrics, type RawSourceMetric } from './realSourceMapping';
import { scoreConfiguredMetric } from './criterionSourceRegistry';

export function prepareRealSourcePlan(args: { records: RawSourceMetric[]; source: 'MIS' | 'KASRA'; kind: 'production' | 'maintenance' | 'kasra'; period: string; employees: Employee[]; evaluations: Evaluation[]; profiles: JobProfile[]; criteria: Criterion[]; actor: Employee; permissions?: GranularPermissionPolicy }) {
  const rejected: Array<{ reference: string; reason: string }> = [], grouped = new Map<string, RawSourceMetric[]>();
  const ordinal = getEvaluationPeriodStartOrdinal(args.period);
  const references = new Set<string>();
  if (ordinal === null || !['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'].some(m => args.period.includes(m))) throw new Error('دوره ماهانه مشخص و قابل تشخیص لازم است.');
  for (const { record, employee } of matchRawMetrics(args.records, args.employees)) {
    if (references.has(record.reference)) { rejected.push({ reference: record.reference, reason: 'فعالیت MIS تکراری؛ فقط یک‌بار محاسبه می‌شود' }); continue; }
    references.add(record.reference);
    const date = record.date.split('/').map(Number);
    let reason = !employee ? 'کد پرسنلی ناشناخته یا مبهم' : date[0] * 12 + date[1] !== ordinal ? 'تاریخ خارج از دوره انتخاب‌شده' : !canImport(args.actor, args.source === 'MIS' ? 'mis' : 'kasra', employee, args.permissions).allowed ? 'خارج از مجوز منبع' : '';
    if (reason) { rejected.push({ reference: record.reference, reason }); continue; }
    grouped.set(employee!.id, [...(grouped.get(employee!.id) || []), record]);
  }
  const profiles = new Map(args.profiles.map(p => [p.id, p])), criteria = new Map(args.criteria.map(c => [c.id, c])); const updates: Evaluation[] = []; let scoresUpdated = 0;
  const sum = (rows: RawSourceMetric[], key: string) => rows.every(r => typeof r.metrics[key] === 'number' && Number.isFinite(r.metrics[key])) ? rows.reduce((n, r) => n + r.metrics[key]!, 0) : null;
  const ratio = (a: number | null, b: number | null) => a !== null && b !== null && b > 0 ? a / b * 100 : null;
  for (const [employeeId, rows] of grouped) {
    const evaluation = args.evaluations.find(e => e.empId === employeeId && getEvaluationPeriodId(e) === canonicalEvaluationPeriodId(args.period));
    if (!evaluation || evaluation.status !== 'draft' || evaluation.stage === 'completed') { rejected.push(...rows.map(r => ({ reference: r.reference, reason: 'پرونده فعال ماهانه موجود نیست یا نهایی شده است' }))); continue; }
    const profile = profiles.get(evaluation.profileId); const values: Record<string, number | null> = {};
    const keys = new Set(rows.flatMap(r => Object.keys(r.metrics))); keys.forEach(k => values[k] = sum(rows, k));
    if (args.kind === 'production') { values.efficiency = ratio(values.earned_minutes, values.operating_minutes); values.scrap_rate = ratio(values.scrap_qty, values.output_qty); values.downtime = ratio(values.downtime_minutes, values.available_minutes); }
    if (args.kind === 'maintenance') values.maintenance_efficiency = ratio(values.maintenance_standard_minutes, values.maintenance_minutes);
    let changed = 0;
    const scores = evaluation.scores.map(score => {
      const criterion = criteria.get(score.cid); const field = criterion?.customMetricField;
      if (!criterion || !field || criterion.misMetricKey !== 'custom' || criterion.scoringSource !== args.source.toLowerCase() || criterion.autoPopulate === false || !profile?.items.some(i => i.cid === criterion.id) || ['not_applicable', 'exempt'].includes(score.scoreStatus || '')) return score;
      const raw = values[field]; if (typeof raw !== 'number' || raw < 0 || !Number.isFinite(raw)) return score;
      const value = scoreConfiguredMetric(criterion, raw); if (value === null) return score;
      changed++; return { ...score, value, rawMetricValue: raw, rawMetricLabel: `${args.source.toLowerCase()}_custom_metric:${criterion.id}`, scoreStatus: 'scored' as const, sourceType: args.source.toLowerCase() as 'mis' | 'kasra', autoPopulated: true, doc: `${args.source === 'MIS' ? 'داده خودکار MIS:' : 'داده کسری:'} ${args.kind}; ${args.period}; ${field}; ${rows.length} ردیف؛ ${rows.map(r => r.reference).slice(0, 5).join(', ')}` };
    });
    if (changed) { updates.push({ ...evaluation, scores }); scoresUpdated += changed; }
    else rejected.push(...rows.map(r => ({ reference: r.reference, reason: 'داده یا معیار منبع‌دار با فرمول/آستانه مصوب موجود نیست؛ نمره قبلی حفظ شد' })));
  }
  return { updates, rejected, scoresUpdated };
}

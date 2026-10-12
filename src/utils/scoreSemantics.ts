import type { ScoreDisposition, ScoreItem } from '../types';

export type ScoreValueField = 'value' | 'self' | 'peer';
type ScoreLike = Partial<Pick<ScoreItem, 'value' | 'self' | 'peer' | 'scoreStatus' | 'selfScoreStatus' | 'peerScoreStatus'>>;

function statusFieldFor(field: ScoreValueField): 'scoreStatus' | 'selfScoreStatus' | 'peerScoreStatus' {
  return field === 'value' ? 'scoreStatus' : field === 'self' ? 'selfScoreStatus' : 'peerScoreStatus';
}

/** Explicit states win. Old persisted scores remain compatible without treating blank zero as a score. */
export function getScoreDisposition(score: ScoreLike, field: ScoreValueField = 'value'): ScoreDisposition {
  const explicit = score[statusFieldFor(field)];
  if (explicit) return explicit;
  const value = score[field];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? 'scored' : 'pending';
}

export function isNumericScoreRecorded(score: ScoreLike, field: ScoreValueField = 'value'): boolean {
  return getScoreDisposition(score, field) === 'scored' &&
    typeof score[field] === 'number' && Number.isFinite(score[field]);
}

/** True only when at least one score is explicitly or compatibly numeric; N/A-only records are not numeric results. */
export function hasNumericEvaluationScore(scores: readonly ScoreLike[] | null | undefined): boolean {
  return Array.isArray(scores) && scores.some(score => isNumericScoreRecorded(score));
}

export function isScoreDispositionComplete(score: ScoreLike, field: ScoreValueField = 'value'): boolean {
  const disposition = getScoreDisposition(score, field);
  if (disposition === 'not_applicable' || disposition === 'exempt') return true;
  return disposition === 'scored' && isNumericScoreRecorded(score, field);
}

export function getScoreDisplayValue(score: ScoreLike, field: ScoreValueField = 'value'): string {
  const disposition = getScoreDisposition(score, field);
  if (disposition === 'not_applicable') return 'نیاز به امتیاز ندارد';
  if (disposition === 'exempt') return 'معاف از امتیاز';
  if (disposition === 'pending') return 'ثبت نشده';
  return String(score[field] ?? 0);
}

/** Weighted mean on the native 0–5 scale; null means there are no scored items. */
export function calculateWeightedScoreMean(
  scores: Array<ScoreLike & { weight: number }>,
  field: ScoreValueField = 'value',
): number | null {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const score of scores) {
    if (!isNumericScoreRecorded(score, field) || !Number.isFinite(score.weight) || score.weight <= 0) continue;
    weightedSum += score[field]! * score.weight;
    totalWeight += score.weight;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : null;
}


/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Criterion, Evaluation, JobProfile, ScoreItem } from '../types';

export interface EvaluationCriteriaConfigurationSnapshot {
  profile: Pick<JobProfile, 'id' | 'title' | 'code' | 'family' | 'items'> | null;
  criteria: Array<{
    id: string;
    code: string;
    name: string;
    def: string;
    source?: string;
    method?: string;
    dir?: Criterion['dir'];
    scoringSource?: Criterion['scoringSource'];
    misMetricKey?: Criterion['misMetricKey'];
    customMetricField?: string;
    autoPopulate?: boolean;
    misTargetValue?: number;
    unit?: string;
    targetValue?: number;
    scoreThresholds?: Criterion['scoreThresholds'];
    allowedScoreMin?: number;
    allowedScoreMax?: number;
    required?: boolean;
    active?: boolean;
    dataType?: Criterion['dataType'];
    aggregation?: Criterion['aggregation'];
    calculationType?: Criterion['calculationType'];
    formulaExpression?: string;
    variables?: Criterion['variables'];
    sourceOwnership?: string;
  } | null>;
}

/** Capture the current profile and selected criterion configuration for audit comparison. */
export function getEvaluationCriteriaConfigurationSnapshot(
  evaluation: Evaluation,
  profiles: JobProfile[],
  criteria: Criterion[],
): EvaluationCriteriaConfigurationSnapshot | null {
  if (evaluation.status === 'locked' || evaluation.stage === 'completed') return null;
  const profile = profiles.find(item => item.id === evaluation.profileId);
  const criteriaById = new Map(criteria.map(criterion => [criterion.id, criterion]));
  return {
    profile: profile ? {
      id: profile.id,
      title: profile.title,
      code: profile.code,
      family: profile.family,
      items: profile.items.map(item => ({ cid: item.cid, weight: item.weight })),
    } : null,
    criteria: (profile?.items || []).map(item => {
      const criterion = criteriaById.get(item.cid);
      if (!criterion) return null;
      return {
        id: criterion.id,
        code: criterion.code,
        name: criterion.name,
        def: criterion.def,
        source: criterion.source,
        method: criterion.method,
        dir: criterion.dir,
        scoringSource: criterion.scoringSource,
        misMetricKey: criterion.misMetricKey,
        customMetricField: criterion.customMetricField,
        autoPopulate: criterion.autoPopulate,
        misTargetValue: criterion.misTargetValue,
        unit: criterion.unit,
        targetValue: criterion.targetValue,
        scoreThresholds: criterion.scoreThresholds,
        allowedScoreMin: criterion.allowedScoreMin,
        allowedScoreMax: criterion.allowedScoreMax,
        required: criterion.required,
        active: criterion.active,
        dataType: criterion.dataType,
        aggregation: criterion.aggregation,
        calculationType: criterion.calculationType,
        formulaExpression: criterion.formulaExpression,
        variables: criterion.variables,
        sourceOwnership: criterion.sourceOwnership,
      };
    }),
  };
}

/**
 * Rebuilds score slots for a live evaluation from its current profile. Existing
 * values and evidence remain attached by stable criterion ID; finalized records
 * are immutable snapshots and are returned unchanged.
 */
export function reconcileEvaluationCriteria(
  evaluation: Evaluation,
  profile: JobProfile | undefined,
  criteria: Criterion[],
): Evaluation {
  if (!profile || evaluation.status === 'locked' || evaluation.stage === 'completed') return evaluation;

  const criteriaById = new Map(criteria.map(criterion => [criterion.id, criterion]));
  const activeProfileItems = profile.items.filter((item, index, items) =>
    items.findIndex(candidate => candidate.cid === item.cid) === index &&
    criteriaById.get(item.cid)?.active !== false
  );
  const profileCriterionIds = new Set(activeProfileItems.map(item => item.cid));
  const currentScores = new Map(evaluation.scores.map(score => [score.cid, score]));
  const retiredScores = new Map((evaluation.retiredScores || []).map(score => [score.cid, score]));

  // Keep removed/deactivated values out of active calculations, while retaining
  // their full score and evidence so a later reactivation can restore them.
  for (const score of evaluation.scores) {
    if (!profileCriterionIds.has(score.cid)) retiredScores.set(score.cid, score);
  }
  const refreshedSlots: ScoreItem[] = activeProfileItems.map(item => {
    const existing = currentScores.get(item.cid) || retiredScores.get(item.cid);
    if (!existing) return { cid: item.cid, weight: item.weight, value: 0, self: 0 };

    const criterion = criteriaById.get(item.cid);
    const configuredSource = criterion?.scoringSource;
    const priorSource = existing.sourceType || 'supervisor';
    const sourceChanged = configuredSource !== undefined && (
      priorSource !== configuredSource || (configuredSource === 'supervisor' && existing.autoPopulated === true)
    );
    const hasRecordedScore = existing.scoreStatus === 'scored' ||
      (existing.scoreStatus === undefined && existing.value > 0);
    const needsReview = sourceChanged && hasRecordedScore;

    // A score produced under a different source cannot silently count under the
    // new configuration. Preserve its value, evidence, and raw source fields,
    // but mark it pending until the configured source supplies a new result or
    // a supervisor records a replacement. When switching to manual scoring,
    // move the active ownership metadata to supervisor while the audit keeps
    // the previous source snapshot.
    const sourceMigration = configuredSource === 'supervisor' && sourceChanged
      ? { sourceType: 'supervisor' as const, autoPopulated: false }
      : {};
    const reconciled = {
      ...existing,
      weight: item.weight,
      ...sourceMigration,
      ...(needsReview ? { scoreStatus: 'pending' as const } : {}),
    };
    return JSON.stringify(reconciled) === JSON.stringify(existing) ? existing : reconciled;
  });
  const scores = refreshedSlots;
  const nextRetiredScores = [...retiredScores.values()].filter(score => !profileCriterionIds.has(score.cid));
  const nextRetiredValue = nextRetiredScores.length ? nextRetiredScores : undefined;

  if (JSON.stringify(scores) === JSON.stringify(evaluation.scores) &&
      JSON.stringify(nextRetiredScores) === JSON.stringify(evaluation.retiredScores || [])) return evaluation;
  return { ...evaluation, scores, retiredScores: nextRetiredValue };
}

export function reconcileActiveEvaluations(
  evaluations: Evaluation[],
  profiles: JobProfile[],
  criteria: Criterion[],
): Evaluation[] {
  const profilesById = new Map(profiles.map(profile => [profile.id, profile]));
  return evaluations.map(evaluation => reconcileEvaluationCriteria(
    evaluation,
    profilesById.get(evaluation.profileId),
    criteria,
  ));
}

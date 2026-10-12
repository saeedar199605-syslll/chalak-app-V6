/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Evaluation, WorkflowStageKey } from '../types';
import { getJalaliDateKey, parseTehranDateTime } from './iranDate';
import { isNumericScoreRecorded } from './scoreSemantics';

export type WorkflowSlaConfig = Partial<Record<Exclude<WorkflowStageKey, 'completed'>, number>>;

/** Existing organization policy, now shared by the workflow, notifications, and calendar. */
export const DEFAULT_WORKFLOW_SLA_DAYS: WorkflowSlaConfig = {
  self_review: 4,
  supervisor_review: 3,
  peer_review: 3,
  calibration_review: 2,
  hr_approval: 2,
  feedback_meeting: 4,
  rejected: 2,
  appealed: 3,
};

export const WORKFLOW_SLA_STAGES: Array<{
  key: Exclude<WorkflowStageKey, 'completed'>;
  label: string;
  optional?: boolean;
}> = [
  { key: 'self_review', label: 'خودارزیابی' },
  { key: 'supervisor_review', label: 'ارزیابی سرپرست' },
  { key: 'peer_review', label: 'بازخورد همتا' },
  { key: 'calibration_review', label: 'کالیبراسیون' },
  { key: 'hr_approval', label: 'تأیید منابع انسانی' },
  { key: 'feedback_meeting', label: 'جلسه بازخورد' },
  { key: 'hse_review', label: 'بررسی HSE', optional: true },
  { key: 'rejected', label: 'اصلاح پرونده' },
  { key: 'appealed', label: 'رسیدگی به اعتراض' },
];

const ALLOWED_STAGE_KEYS = new Set<string>(WORKFLOW_SLA_STAGES.map(stage => stage.key));
const DAY_MS = 24 * 60 * 60 * 1000;

export function isValidWorkflowSlaConfig(value: unknown): value is WorkflowSlaConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(([stage, days]) =>
    ALLOWED_STAGE_KEYS.has(stage) && Number.isInteger(days) && Number(days) >= 0 && Number(days) <= 365
  );
}

/** Fill established defaults while preserving the optional, unconfigured HSE detour. */
export function normalizeWorkflowSlaConfig(value: unknown): WorkflowSlaConfig {
  const config: WorkflowSlaConfig = { ...DEFAULT_WORKFLOW_SLA_DAYS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return config;
  for (const [stage, days] of Object.entries(value as Record<string, unknown>)) {
    if (ALLOWED_STAGE_KEYS.has(stage) && Number.isInteger(days) && Number(days) >= 0 && Number(days) <= 365) {
      config[stage as keyof WorkflowSlaConfig] = Number(days);
    }
  }
  return config;
}

export function getEvaluationWorkflowStage(evaluation: Evaluation): WorkflowStageKey {
  return evaluation.stage || (
    evaluation.status === 'calibrated' ? 'hr_approval' :
    evaluation.scores?.some(score => isNumericScoreRecorded(score)) ? 'calibration_review' :
    evaluation.scores?.some(score => isNumericScoreRecorded(score, 'self')) ? 'supervisor_review' : 'self_review'
  );
}

/** Return the latest real transition into this stage; only the initial stage may fall back to creation. */
export function getWorkflowStageStartedAt(evaluation: Evaluation, stage: WorkflowStageKey): Date | null {
  const transitionTimes = (evaluation.history || [])
    .filter(entry => entry.toStage === stage && typeof entry.timestamp === 'string')
    .map(entry => parseTehranDateTime(entry.timestamp))
    .filter(date => Number.isFinite(date.getTime()))
    .sort((left, right) => right.getTime() - left.getTime());
  if (transitionTimes[0]) return transitionTimes[0];
  if (stage === 'self_review' && typeof evaluation.created === 'number' && evaluation.created > 0) {
    const created = new Date(evaluation.created);
    return Number.isFinite(created.getTime()) ? created : null;
  }
  return null;
}

export interface WorkflowSlaStatus {
  stage: WorkflowStageKey;
  days: number;
  daysOverdue: number;
  maxAllowedDays?: number;
  isBreached: boolean;
  stageStartedAt: Date | null;
  deadline: Date | null;
}

export function getWorkflowSlaStatus(
  evaluation: Evaluation,
  configured: unknown,
  now: Date = new Date(),
): WorkflowSlaStatus {
  const stage = getEvaluationWorkflowStage(evaluation);
  const config = normalizeWorkflowSlaConfig(configured);
  const maxAllowedDays = stage === 'completed' ? undefined : config[stage];
  const stageStartedAt = getWorkflowStageStartedAt(evaluation, stage);
  const elapsed = stageStartedAt ? Math.max(0, now.getTime() - stageStartedAt.getTime()) : 0;
  const days = Math.floor(elapsed / DAY_MS);
  const deadline = stageStartedAt && maxAllowedDays !== undefined
    ? new Date(stageStartedAt.getTime() + maxAllowedDays * DAY_MS)
    : null;
  const daysOverdue = deadline && now.getTime() > deadline.getTime()
    ? Math.ceil((now.getTime() - deadline.getTime()) / DAY_MS)
    : 0;
  return {
    stage,
    days,
    daysOverdue,
    maxAllowedDays,
    isBreached: evaluation.status !== 'locked' && stage !== 'completed' && daysOverdue > 0,
    stageStartedAt,
    deadline,
  };
}

export function getWorkflowSlaDeadlineJalali(evaluation: Evaluation, configured: unknown): string | undefined {
  const status = getWorkflowSlaStatus(evaluation, configured);
  return status.deadline ? getJalaliDateKey(status.deadline) : undefined;
}

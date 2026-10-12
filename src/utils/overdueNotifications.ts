/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Evaluation, Employee, WorkflowStageKey, WORKFLOW_STAGES } from '../types';
import { getWorkflowSlaStatus } from './workflowSla';

export interface OverdueEvaluationItem {
  evalId: string;
  empId: string;
  empName: string;
  empCode: string;
  unit: string;
  period: string;
  stage: WorkflowStageKey;
  stageLabel: string;
  daysPending: number;
  maxAllowedDays: number;
  daysOverdue: number;
  reason: string;
  currentAssigneeName: string;
  urgency: 'critical' | 'high' | 'medium';
}

/** Calculate overdue evaluations only when a current-stage timestamp and an SLA exist. */
export function getOverdueEvaluations(
  evaluations: Evaluation[],
  employees: Employee[],
  currentUser: Employee,
  configuredSla?: unknown,
  now: Date = new Date(),
): OverdueEvaluationItem[] {
  if (!currentUser) return [];
  const overdueItems: OverdueEvaluationItem[] = [];

  evaluations.forEach(ev => {
    if (ev.status === 'locked' || ev.stage === 'completed') return;
    const emp = employees.find(employee => employee.id === ev.empId);
    if (!emp) return;

    const isSupervisor = currentUser.role === 'supervisor';
    const isAdmin = currentUser.role === 'admin';
    if (!isAdmin && !isSupervisor && emp.id !== currentUser.id) return;

    if (isSupervisor && !isAdmin) {
      const isDirectSubordinate = emp.supervisorId === currentUser.id;
      const isUnitSubordinate = !emp.supervisorId && emp.unit === currentUser.unit;
      const isAssignedToMe = ev.currentAssigneeId === currentUser.id;
      if (!isDirectSubordinate && !isUnitSubordinate && !isAssignedToMe) return;
    }

    const sla = getWorkflowSlaStatus(ev, configuredSla, now);
    const { stage, maxAllowedDays, days: daysPending, daysOverdue } = sla;
    if (!isAdmin && !isSupervisor && !['self_review', 'rejected', 'feedback_meeting'].includes(stage)) return;
    if (maxAllowedDays === undefined || !sla.stageStartedAt || !sla.isBreached) return;
    let reason = 'تاخیر در بررسی و تعیین تکلیف پرونده در مهلت مصوب سازمانی';
    let urgency: 'critical' | 'high' | 'medium' = 'medium';

    if (stage === 'supervisor_review') {
      reason = `عدم ثبت نمرات و بازخورد اولیه سرپرست مستقیم (${daysOverdue} روز فراتر از مهلت)`;
      urgency = daysOverdue >= 3 ? 'critical' : 'high';
    } else if (stage === 'self_review') {
      reason = `عدم تکمیل خودارزیابی توسط پرسنل (${daysOverdue} روز تاخیر)`;
      urgency = 'high';
    } else if (stage === 'feedback_meeting') {
      reason = 'عدم برگزاری جلسه دونفره مربیگری و ثبت برنامه توانمندسازی IDP';
      urgency = daysOverdue >= 2 ? 'critical' : 'high';
    } else if (stage === 'calibration_review') {
      reason = 'انتظار برای تایید کمیته کالیبراسیون و انطباق توزیع نمرات';
    } else if (stage === 'rejected') {
      reason = 'پرونده عودت‌داده شده نیازمند بازنگری فوری مستندات است';
      urgency = 'critical';
    } else if (stage === 'appealed') {
      reason = 'اعتراض ثبت‌شده کارمند نیازمند رسیدگی کمیته فرجام‌خواهی است';
      urgency = 'critical';
    }

    overdueItems.push({
      evalId: ev.id,
      empId: emp.id,
      empName: emp.name,
      empCode: emp.code,
      unit: emp.unit,
      period: ev.period,
      stage,
      stageLabel: WORKFLOW_STAGES[stage]?.label || 'در دست بررسی',
      daysPending,
      maxAllowedDays,
      daysOverdue,
      reason,
      currentAssigneeName: ev.currentAssigneeName || (isSupervisor ? currentUser.name : 'سرپرست مربوطه'),
      urgency,
    });
  });

  return overdueItems.sort((left, right) => {
    const urgencyWeight = { critical: 3, high: 2, medium: 1 };
    if (urgencyWeight[right.urgency] !== urgencyWeight[left.urgency]) {
      return urgencyWeight[right.urgency] - urgencyWeight[left.urgency];
    }
    return right.daysOverdue - left.daysOverdue;
  });
}

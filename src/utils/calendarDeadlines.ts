/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Employee, Evaluation, IDPItem } from '../types';
import { WORKFLOW_STAGES } from '../types';
import { getJalaliDateKey, jalaliDateKeyToGregorianICSDate } from './iranDate';
import { normalizeDigits } from './personnelSearch';
import { getWorkflowSlaStatus, type WorkflowSlaConfig } from './workflowSla';

export interface IdpCalendarDeadline {
  id: string;
  title: string;
  type: 'idp_deadline';
  dateStr: string;
  time: string;
  location: string;
  attendees: string;
  description: string;
  targetTab: 'workflow';
  readOnly: true;
}

export interface WorkflowCalendarDeadline {
  id: string;
  title: string;
  type: 'workflow_deadline';
  dateStr: string;
  time: string;
  location: string;
  attendees: string;
  description: string;
  targetTab: 'workflow';
  status: 'upcoming' | 'urgent';
  readOnly: true;
}

const ACTIVE_IDP_STATUSES = new Set<IDPItem['status']>(['planned', 'in_progress']);
const STATUS_LABEL: Record<IDPItem['status'], string> = {
  planned: 'برنامه‌ریزی‌شده',
  in_progress: 'در حال اجرا',
  completed: 'تکمیل‌شده',
  cancelled: 'لغوشده',
};

/**
 * Build calendar entries only from real, open IDP items visible to this actor.
 * Saved calendar events remain the editable source for manually scheduled items.
 */
export function getIdpCalendarDeadlines(
  evaluations: Evaluation[],
  employees: Employee[],
  currentUser: Employee | undefined,
): IdpCalendarDeadline[] {
  if (!currentUser) return [];

  const employeeById = new Map(employees.map(employee => [employee.id, employee]));
  const isAdmin = currentUser.role === 'admin';
  const deadlines: IdpCalendarDeadline[] = [];

  for (const evaluation of evaluations) {
    const employee = employeeById.get(evaluation.empId);
    if (!employee) continue;

    const inScope = isAdmin || evaluation.currentAssigneeId === currentUser.id ||
      employee.supervisorId === currentUser.id ||
      (!employee.supervisorId && employee.unit === currentUser.unit);
    if (!inScope) continue;

    for (const item of evaluation.idpItems || []) {
      if (!ACTIVE_IDP_STATUSES.has(item.status)) continue;
      const dateStr = normalizeDigits(item.targetDate || '').trim();
      if (!jalaliDateKeyToGregorianICSDate(dateStr)) continue;

      deadlines.push({
        id: `idp-deadline:${evaluation.id}:${item.id}`,
        title: item.title,
        type: 'idp_deadline',
        dateStr,
        time: '—',
        location: '—',
        attendees: `${employee.name} · ${evaluation.period}`,
        description: `${item.competencyArea} · ${STATUS_LABEL[item.status]}`,
        targetTab: 'workflow',
        readOnly: true,
      });
    }
  }

  return deadlines;
}

/** Build stage deadlines from the real transition timestamp and the shared SLA policy. */
export function getWorkflowCalendarDeadlines(
  evaluations: Evaluation[],
  employees: Employee[],
  currentUser: Employee | undefined,
  configuredSla: WorkflowSlaConfig,
  now: Date = new Date(),
): WorkflowCalendarDeadline[] {
  if (!currentUser) return [];
  const employeeById = new Map(employees.map(employee => [employee.id, employee]));
  const deadlines: WorkflowCalendarDeadline[] = [];

  for (const evaluation of evaluations) {
    if (evaluation.status === 'locked' || evaluation.stage === 'completed') continue;
    const employee = employeeById.get(evaluation.empId);
    if (!employee) continue;
    const inScope = currentUser.role === 'admin' || employee.id === currentUser.id ||
      evaluation.currentAssigneeId === currentUser.id || employee.supervisorId === currentUser.id ||
      (!employee.supervisorId && employee.unit === currentUser.unit);
    if (!inScope) continue;

    const sla = getWorkflowSlaStatus(evaluation, configuredSla, now);
    if (!sla.deadline || sla.maxAllowedDays === undefined) continue;
    const dateStr = getJalaliDateKey(sla.deadline);
    if (!jalaliDateKeyToGregorianICSDate(dateStr)) continue;

    deadlines.push({
      id: `workflow-deadline:${evaluation.id}:${sla.stage}`,
      title: `مهلت ${WORKFLOW_STAGES[sla.stage]?.label || 'مرحله گردش کار'}`,
      type: 'workflow_deadline',
      dateStr,
      time: '—',
      location: '—',
      attendees: employee.name,
      description: `پرونده ${evaluation.id} · ${evaluation.period} · مهلت ${sla.maxAllowedDays} روز${sla.isBreached ? ` · ${sla.days - sla.maxAllowedDays} روز تأخیر` : ''}`,
      targetTab: 'workflow',
      status: sla.isBreached ? 'urgent' : 'upcoming',
      readOnly: true,
    });
  }

  return deadlines;
}

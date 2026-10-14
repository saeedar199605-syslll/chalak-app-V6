import type { Employee, Evaluation } from '../types';
import { authorize, type GranularPermissionPolicy } from './authorization';
import { getEvaluationPeriodId, businessDateBelongsToPeriod } from './evaluationPeriod';
import { normalizePersonnelCode } from './personnelSearch';
import { getJalaliDateKey } from './iranDate';
import { parseBusinessDate } from './businessDate';

export type ViolationStatus = 'draft' | 'submitted' | 'review' | 'approved' | 'rejected' | 'appealed' | 'reversed';
export interface ViolationPolicy {
  version: string; active: boolean; approvalReference: string; effectiveFrom: string; effectiveUntil: string;
  maximumDeduction: number;
  categories: Array<{ id: string; title: string; attendanceRelated: boolean; points: Record<string, number> }>;
}
export interface ViolationRecord {
  id: string; employeeId: string; periodId: string; date: string; categoryId: string; severity: string;
  evidence: string; description: string; source: 'manual' | 'excel'; externalId?: string;
  status: ViolationStatus; reporterId: string; points: number; policyVersion?: string; policyCap?: number;
  history: Array<{ action: string; actorId: string; at: string; reason: string; operationId: string }>;
}
export type ViolationCommand = { action: 'create'; record: Omit<ViolationRecord, 'status' | 'reporterId' | 'points' | 'history' | 'policyVersion' | 'policyCap'> }
  | { action: 'submit' | 'review' | 'approve' | 'reject' | 'appeal' | 'reverse'; id: string; reason: string; attendanceJustification?: string };
export const EMPTY_VIOLATION_POLICY: ViolationPolicy = {
  version: 'draft', active: false, approvalReference: '', effectiveFrom: '', effectiveUntil: '', maximumDeduction: 0, categories: [],
};
export class ViolationError extends Error { constructor(message: string, public status = 400) { super(message); } }
const text = (v: unknown, max = 1000) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export function validViolationPolicy(value: unknown): value is ViolationPolicy {
  const p = value as ViolationPolicy;
  if (!p || !text(p.version, 100) || typeof p.active !== 'boolean' || !Number.isFinite(p.maximumDeduction) || p.maximumDeduction < 0 || p.maximumDeduction > 100 || !Array.isArray(p.categories) || p.categories.length > 100) return false;
  if (p.active && (!text(p.approvalReference) || !parseBusinessDate(p.effectiveFrom) || !parseBusinessDate(p.effectiveUntil) || parseBusinessDate(p.effectiveFrom)! > parseBusinessDate(p.effectiveUntil)!)) return false;
  return new Set(p.categories.map(c => c.id)).size === p.categories.length && p.categories.every(c => text(c.id, 100) && text(c.title, 200) && typeof c.attendanceRelated === 'boolean' && c.points && Object.keys(c.points).length > 0 && Object.entries(c.points).every(([key, n]) => text(key, 100) && Number.isFinite(n) && n >= 0 && n <= p.maximumDeduction));
}
function incidentKey(v: ViolationRecord): string { return [v.employeeId, v.periodId, v.date, v.categoryId, v.evidence.trim()].join('\u0000'); }

/** Runs only on the server, after revision/receipt validation; never accepts client history or deduction amounts. */
export function applyViolationCommands(args: { records: ViolationRecord[]; evaluations: Evaluation[]; employees: Employee[]; actor: Employee; permissions: GranularPermissionPolicy; policy: ViolationPolicy; commands: unknown; operationId: string; now: string }): { records: ViolationRecord[]; evaluations: Evaluation[]; audit: Array<Record<string, unknown>> } {
  if (!Array.isArray(args.commands) || args.commands.length < 1 || args.commands.length > 250) throw new ViolationError('هر عملیات باید شامل ۱ تا ۲۵۰ اقدام تخلف باشد.');
  const byId = new Map(args.records.map(r => [r.id, r]));
  const incidents = new Set(args.records.map(incidentKey));
  const external = new Set(args.records.filter(r => r.externalId).map(r => `${r.source}:${r.externalId}`));
  const employees = new Map(args.employees.map(e => [e.id, e]));
  const evaluations = new Map(args.evaluations.map(e => [`${e.empId}\u0000${getEvaluationPeriodId(e)}`, e]));
  const affected = new Set<string>(); const audit: Array<Record<string, unknown>> = [];
  for (const command of args.commands as ViolationCommand[]) {
    if (!command || typeof command !== 'object') throw new ViolationError('اقدام تخلف معتبر نیست.');
    const incoming = command.action === 'create' ? command.record : undefined;
    const old = incoming ? undefined : byId.get('id' in command ? command.id : '');
    const employee = employees.get(incoming?.employeeId || old?.employeeId || '');
    if (!employee) throw new ViolationError('کارمند تخلف پیدا نشد.');
    const capability = command.action === 'create' ? incoming?.source === 'excel' ? 'import' : 'create' : ['approve', 'reject', 'reverse'].includes(command.action) ? 'approve' : command.action === 'review' ? 'edit' : 'submit';
    const ownAppeal = command.action === 'appeal' && employee.id === args.actor.id;
    if (!ownAppeal && !authorize(args.actor, 'violations', capability, employee, args.permissions).allowed) throw new ViolationError('مجوز اقدام بر این تخلف را ندارید.', 403);
    let next: ViolationRecord;
    if (incoming) {
      if (!text(incoming.id, 100) || !text(incoming.periodId, 200) || !parseBusinessDate(incoming.date) || !text(incoming.categoryId, 100) || !text(incoming.severity, 100) || !text(incoming.evidence) || !text(incoming.description) || !['manual', 'excel'].includes(incoming.source) || incoming.externalId !== undefined && !text(incoming.externalId, 150)) throw new ViolationError('شناسه، تاریخ، دوره، دسته، شدت، شرح و مدرک معتبر الزامی است.');
      if (!args.policy.categories.some(c => c.id === incoming.categoryId && Object.hasOwn(c.points, incoming.severity))) throw new ViolationError('دسته یا شدت در سیاست ثبت نشده است.');
      if (!businessDateBelongsToPeriod(incoming.date, incoming.periodId)) throw new ViolationError('تاریخ تخلف داخل دوره ارزیابی قابل تشخیص نیست؛ دوره و تاریخ را بررسی کنید.');
      next = { id: incoming.id, employeeId: employee.id, periodId: incoming.periodId, date: getJalaliDateKey(parseBusinessDate(incoming.date)!), categoryId: incoming.categoryId, severity: incoming.severity, evidence: incoming.evidence.trim(), description: incoming.description.trim(), source: incoming.source, ...(incoming.externalId ? { externalId: incoming.externalId } : {}), status: 'draft', reporterId: args.actor.id, points: 0, history: [] };
      if (byId.has(next.id) || incidents.has(incidentKey(next)) || next.externalId && external.has(`${next.source}:${next.externalId}`)) throw new ViolationError('تخلف تکراری است؛ هیچ داده‌ای دوباره ثبت نشد.', 409);
      incidents.add(incidentKey(next)); if (next.externalId) external.add(`${next.source}:${next.externalId}`);
    } else {
      if (!old || !('reason' in command) || !text(command.reason)) throw new ViolationError('تخلف و دلیل اقدام معتبر الزامی است.');
      const transitions: Record<string, ViolationStatus[]> = { submit: ['draft'], review: ['submitted'], approve: ['review'], reject: ['submitted', 'review'], appeal: ['approved'], reverse: ['approved', 'appealed'] };
      if (!transitions[command.action]?.includes(old.status)) throw new ViolationError('وضعیت تخلف تغییر کرده یا اقدام مجاز نیست.', 409);
      const status: Record<string, ViolationStatus> = { submit: 'submitted', review: 'review', approve: 'approved', reject: 'rejected', appeal: 'appealed', reverse: 'reversed' };
      next = { ...old, status: status[command.action] };
      if (['approve', 'reverse'].includes(command.action)) {
        const evaluation = evaluations.get(`${old.employeeId}\u0000${old.periodId}`);
        if (!evaluation || evaluation.status !== 'draft' || evaluation.stage === 'completed') throw new ViolationError('کسر یا برگشت برای پرونده نهایی یا دوره فاقد پرونده فعال مجاز نیست.', 403);
        if (command.action === 'approve') {
          if (!businessDateBelongsToPeriod(old.date, old.periodId)) throw new ViolationError('تاریخ تخلف به این دوره تعلق ندارد؛ کسر امتیاز متوقف شد.', 403);
          const p = args.policy; const category = p.categories.find(c => c.id === old.categoryId); const date = parseBusinessDate(old.date)!;
          if (!validViolationPolicy(p) || !p.active || date < parseBusinessDate(p.effectiveFrom)! || date > parseBusinessDate(p.effectiveUntil)! || !category || !Object.hasOwn(category.points, old.severity)) throw new ViolationError('سیاست مصوب و فعال برای تاریخ تخلف موجود نیست.', 403);
          if (old.reporterId === args.actor.id || old.employeeId === args.actor.id) throw new ViolationError('ثبت‌کننده نمی‌تواند تخلف خودش را تأیید کند.', 403);
          if (category.attendanceRelated && (!('attendanceJustification' in command) || !text(command.attendanceJustification))) throw new ViolationError('برای جلوگیری از کسر دوباره کسری، توجیه مستقل مصوب لازم است.', 403);
          next = { ...next, points: category.points[old.severity], policyVersion: p.version, policyCap: p.maximumDeduction };
        }
        affected.add(`${old.employeeId}\u0000${old.periodId}`);
      }
    }
    const reason = 'reason' in command ? command.reason : next.description;
    next.history = [...next.history, { action: command.action, actorId: args.actor.id, at: args.now, reason, operationId: args.operationId }];
    byId.set(next.id, next);
    audit.push({ id: `audit:violation:${args.operationId}:${next.id}:${command.action}`, timestamp: args.now, actorId: args.actor.id, actorName: args.actor.name, actorRole: args.actor.role, action: `violation_${command.action}`, target: next.id, previousState: old || null, resultingState: next, result: 'accepted' });
  }
  const records = [...byId.values()];
  const deduction = new Map<string, { sum: number; cap: number }>();
  for (const record of records) if (['approved', 'appealed'].includes(record.status)) {
    const key = `${record.employeeId}\u0000${record.periodId}`; if (!affected.has(key)) continue;
    const value = deduction.get(key) || { sum: 0, cap: Infinity }; value.sum += record.points; value.cap = Math.min(value.cap, record.policyCap ?? 0); deduction.set(key, value);
  }
  return { records, audit, evaluations: args.evaluations.map(e => { const key = `${e.empId}\u0000${getEvaluationPeriodId(e)}`; if (!affected.has(key)) return e; const d = deduction.get(key); return { ...e, approvedDeduction: d ? Math.min(d.sum, d.cap) : 0 }; }) };
}

export function parseViolationRows(rows: unknown[][], employees: Employee[], periodId: string): { records: Array<Extract<ViolationCommand, { action: 'create' }>['record']>; rejected: Array<{ row: number; reason: string }> } {
  const headers = ['شناسه خارجی', 'کد پرسنلی', 'تاریخ', 'دسته', 'شدت', 'مدرک', 'شرح'];
  const positions = headers.map(h => rows[0]?.findIndex(v => String(v || '').trim() === h) ?? -1);
  if (positions.some(p => p < 0)) throw new ViolationError('سرستون‌های قالب تخلفات کامل نیستند.');
  const codes = new Map<string, Employee[]>(); for (const e of employees) { const code = normalizePersonnelCode(e.code); codes.set(code, [...(codes.get(code) || []), e]); }
  const records: Array<Extract<ViolationCommand, { action: 'create' }>['record']> = []; const rejected: Array<{ row: number; reason: string }> = []; const ids = new Set<string>();
  rows.slice(1).forEach((row, i) => { if (row.every(c => c == null || c === '')) return; const values = positions.map(p => String(row[p] ?? '').trim()); const [externalId, code, date, categoryId, severity, evidence, description] = values; const matches = codes.get(normalizePersonnelCode(code)) || [];
    if (matches.length !== 1 || values.some(v => !v) || !parseBusinessDate(date) || ids.has(externalId)) { rejected.push({ row: i + 2, reason: 'کد ناشناخته/مبهم، داده ناقص یا شناسه تکراری' }); return; }
    ids.add(externalId); records.push({ id: crypto.randomUUID(), employeeId: matches[0].id, periodId, date, categoryId, severity, evidence, description, externalId, source: 'excel' });
  }); return { records, rejected };
}

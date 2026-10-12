/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import type { Employee } from '../types';
import { db } from '../utils/db';
import { isValidWorkflowSlaConfig, normalizeWorkflowSlaConfig, WORKFLOW_SLA_STAGES, type WorkflowSlaConfig } from '../utils/workflowSla';

interface WorkflowSlaSettingsProps {
  currentUser: Employee;
}

type SaveFeedback = { kind: 'success' | 'warning' | 'error'; message: string } | null;

function toForm(config: WorkflowSlaConfig): Record<string, string> {
  return Object.fromEntries(WORKFLOW_SLA_STAGES.map(stage => [stage.key, config[stage.key] === undefined ? '' : String(config[stage.key])]));
}

export default function WorkflowSlaSettings({ currentUser }: WorkflowSlaSettingsProps) {
  const [form, setForm] = useState<Record<string, string>>(() => toForm(normalizeWorkflowSlaConfig(db.getMiscData('pe_workflow_sla', {}))));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<SaveFeedback>(null);

  useEffect(() => db.subscribe((key, value) => {
    if (key === 'pe_workflow_sla') setForm(toForm(normalizeWorkflowSlaConfig(value)));
  }), []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (currentUser.role !== 'admin') {
      setFeedback({ kind: 'error', message: 'فقط مدیر سیستم می‌تواند مهلت‌های سازمانی را تغییر دهد.' });
      return;
    }
    const next: WorkflowSlaConfig = {};
    for (const stage of WORKFLOW_SLA_STAGES) {
      const raw = form[stage.key]?.trim() ?? '';
      if (!raw && stage.optional) continue;
      if (!/^\d+$/.test(raw)) {
        setFeedback({ kind: 'error', message: `برای «${stage.label}» عدد صحیحی بین ۰ تا ۳۶۵ روز وارد کنید.` });
        return;
      }
      next[stage.key] = Number(raw);
    }
    if (!isValidWorkflowSlaConfig(next)) {
      setFeedback({ kind: 'error', message: 'یکی از مهلت‌ها خارج از بازه مجاز است.' });
      return;
    }

    setSaving(true);
    setFeedback(null);
    db.saveMiscData('pe_workflow_sla', next);
    try {
      const accepted = await db.pushStateToCloud(['pe_workflow_sla']);
      setFeedback(accepted
        ? { kind: 'success', message: 'مهلت‌ها در سرور ثبت شد و برای تقویم و پیگیری گردش کار اعمال می‌شود.' }
        : { kind: 'warning', message: 'تنظیمات روی این دستگاه ذخیره شد، اما سرور هنوز ثبت آن را تأیید نکرده است.' });
    } catch {
      setFeedback({ kind: 'warning', message: 'تنظیمات روی این دستگاه ذخیره شد، اما همگام‌سازی با سرور انجام نشد.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-3xl border border-slate-700 bg-slate-900/70 p-5 text-right shadow-lg" dir="rtl">
      <div className="mb-4 border-b border-slate-800 pb-4">
        <h2 className="text-base font-black text-slate-100">مهلت‌های سازمانی گردش کار</h2>
        <p className="mt-1 text-xs leading-6 text-slate-400">
          این مقادیر در کارت‌های گردش کار، هشدار تأخیر و تقویم سرپرست یکسان استفاده می‌شوند. تاریخ هر موعد از آخرین ورود واقعی پرونده به همان مرحله محاسبه می‌شود.
        </p>
      </div>

      {currentUser.role !== 'admin' ? (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-bold text-rose-200">فقط مدیر سیستم به تنظیم این مهلت‌ها دسترسی دارد.</p>
      ) : (
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {WORKFLOW_SLA_STAGES.map(stage => (
              <label key={stage.key} className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <span className="block text-xs font-bold text-slate-200">{stage.label}{stage.optional ? ' · اختیاری' : ''}</span>
                <span className="flex items-center gap-2">
                  <input
                    aria-label={`مهلت ${stage.label} به روز`}
                    type="number"
                    min={0}
                    max={365}
                    step={1}
                    required={!stage.optional}
                    value={form[stage.key] ?? ''}
                    onChange={event => setForm(current => ({ ...current, [stage.key]: event.target.value }))}
                    placeholder={stage.optional ? 'بدون مهلت' : undefined}
                    className="min-h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm font-bold text-slate-100 focus:border-teal-500 focus:outline-none"
                  />
                  <span className="shrink-0 text-xs text-slate-400">روز</span>
                </span>
              </label>
            ))}
          </div>

          {feedback && (
            <p role="status" className={`rounded-xl border p-3 text-xs font-bold ${feedback.kind === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : feedback.kind === 'warning' ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
              {feedback.message}
            </p>
          )}

          <button type="submit" disabled={saving} className="min-h-10 rounded-xl bg-teal-500 px-5 text-xs font-black text-slate-950 transition-colors hover:bg-teal-400 disabled:cursor-wait disabled:opacity-60">
            {saving ? 'در حال ثبت…' : 'ذخیره و اعمال مهلت‌ها'}
          </button>
        </form>
      )}
    </section>
  );
}

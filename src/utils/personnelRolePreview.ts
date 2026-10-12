import { JOB_FAMILIES, suggestJobFamily } from './jobFamilyRegistry';
import { ROLE_KPI_DRAFTS } from './roleKpiDrafts';
import { normalizeSearchText } from './personnelSearch';
import type { RosterPerson } from './realSourceMapping';

/** Candidate suggestions only. Description/unit evidence never approves a personnel assignment. */
export function personnelRolePreview(person: RosterPerson, reviewedFamily?: string) {
  const candidates = new Set<string>();
  const titleFamily = suggestJobFamily(person.jobTitle);
  if (titleFamily) candidates.add(titleFamily);
  const description = normalizeSearchText(person.internalJob);
  const unit = normalizeSearchText(person.unit);
  if (description.includes('نظام دهنده') || description.includes('تنظیم')) candidates.add('setup');
  if (description.includes('اپراتور') && /ماشین|cnc|ترانسفر|محور/.test(description)) candidates.add('machining');
  if (description.includes('تعمیر') && unit.includes('مکانیک')) candidates.add('mechanical');
  if (description.includes('تعمیر') && unit.includes('برق')) candidates.add('electrical');
  if (normalizeSearchText(person.jobTitle) === normalizeSearchText('کارگر صنعتی')) {
    const unitCandidates: Array<[string, string]> = [['ماشینکاری','machining'],['تک محور','machining'],['شش محور','machining'],['فورج','forge'],['مونتاژ','assembly'],['آبکاری','finishing'],['تجهیزات','tooling']];
    for (const [name, family] of unitCandidates) if (unit.includes(normalizeSearchText(name))) candidates.add(family);
  }
  const proposedFamily = candidates.size === 1 && titleFamily ? titleFamily : null;
  const family = reviewedFamily || proposedFamily;
  return {
    code: person.code, title: person.jobTitle, description: person.internalJob,
    candidates: [...candidates].map(id => ({ id, title: JOB_FAMILIES.find(f => f[0] === id)![1] })),
    needsReview: !proposedFamily || person.departed || !person.internalJob,
    note: candidates.size > 1 ? 'نقش ترکیبی: معیارهای هر مسئولیت جدا بررسی شوند؛ سهم زمانی و وزن ترکیبی نیازمند مصوبه است.' : !titleFamily ? 'کارگر صنعتی: خانواده بر پایه واحد پیشنهاد شده؛ شرح وظیفه و عنوان باید تأیید شوند.' : 'عنوان و شرح شغل برای همین کد پرسنلی باید تأیید شوند.',
    model: ROLE_KPI_DRAFTS.find(d => d.familyId === family) || null,
  };
}

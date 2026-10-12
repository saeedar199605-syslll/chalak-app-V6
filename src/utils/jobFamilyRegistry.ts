import { normalizeSearchText } from './personnelSearch';
import type { JobProfile, Criterion } from '../types';

/** Proposed registry. No existing employee/profile is reassigned without an explicit reviewed import. */
export const JOB_FAMILIES = [
  ['machining', 'اپراتوری ماشین‌کاری، CNC، ترانسفر، تک‌محور و شش‌محور', ['اپراتور ماشینکاری']],
  ['forge', 'اپراتوری فورج، آرایش و عملیات وابسته', ['اپراتور فورج']],
  ['finishing', 'اپراتوری آبکاری و عملیات تکمیلی', ['اپراتور آبکاری', 'اپراتور پلیسه خشک کن']],
  ['assembly', 'مونتاژ و بسته‌بندی', ['کارگر مونتاژ و بسته بندی', 'اپراتور مونتاژ و بسته بندی', 'تکنسین مونتاژ و بسته بندی']],
  ['setup', 'تکنسین‌های تنظیم و نظام‌دهنده', ['تکنسین نظام دهنده']],
  ['mechanical', 'مکانیک تعمیرات و نگهداری', ['تکنسین مکانیک']],
  ['electrical', 'برق، الکترونیک و اتوماسیون', ['تکنسین برق و الکترونیک', 'تکنسین اتوماسیون صنعتی', 'کارشناس اتوماسیون صنعتی']],
  ['preventive', 'نت نگهداری و پایش تجهیزات', ['تکنسین نگهداشت تجهیزات', 'کارمند نگهداری و تعمیرات']],
  ['tooling', 'تعمیرات قالب، ابزار و تجهیزات', ['تکنسین قالب', 'کارشناس قالب', 'تکنسین ابزار', 'تکنسین جوشکاری']],
  ['quality', 'کنترل کیفیت حین فرایند و نهایی', ['تکنسین کنترل کیفیت', 'تکنسین کنترل کیفیت حین فرایند', 'کارشناس کنترل کیفیت']],
  ['assurance', 'تضمین کیفیت و آزمایشگاه', ['کارشناس تضمین کیفیت', 'کارشناس آزمایشگاه']],
  ['warehouse', 'انبار، لجستیک و لیفتراک', ['انباردار', 'راننده لیفتراک']],
  ['statistics', 'آمار و اطلاعات تولید', ['کارمند آمار و اطلاعات']],
  ['planning', 'برنامه‌ریزی و کنترل تولید', ['کارشناس برنامه ریزی تولید']],
  ['engineering', 'طراحی و مهندسی و تحقیق و توسعه', ['کارشناس طراحی و مهندسی', 'کارشناس تحقیق و توسعه']],
  ['improvement', 'بهبود فرایندها و سیستم‌ها و روش‌ها', ['کارشناس بهبود فرآیند', 'کارشناس سیستمها و روشها']],
  ['administrative', 'منابع انسانی، اداری و حسابداری', ['کارمند اداری', 'کاردان اداری', 'مسئول دفتر', 'کارمند پذیرش']],
  ['hse', 'HSE و ایمنی', ['کارشناس HSE']],
  ['support', 'خدمات، حمل‌ونقل، پشتیبانی و رستوران', ['کارگر خدمات', 'کارگر رستوران', 'راننده']],
  ['supervisory', 'سرگروه‌ها، مسئولان شیفت و سرپرستان', ['سرپرست ماشینکاری', 'مسئول شیفت ماشینکاری', 'مسئول شیفت فورج', 'سرپرست فورج', 'سرپرست آبکاری', 'سرپرست مونتاژ و بسته بندی', 'مسئول مونتاژ و بسته بندی', 'سرپرست برق و الکترونیک', 'مسئول مکانیک', 'مسئول نگهداشت تجهیزات', 'مسئول اتوماسیون صنعتی', 'مسئول تجهیزات', 'سرپرست کنترل کیفیت و آزمایشگاه', 'سرپرست انبار', 'سرپرست برنامه ریزی تولید', 'سرپرست طراحی و مهندسی', 'رئیس بهبود فرآیند', 'سرپرست سیستم ها و روش ها', 'سرپرست اداری و منابع انسانی', 'مسئول خدمات']],
  ['management', 'مدیران واحدها و مدیریت ارشد', ['مدیر تولید', 'مدیر عامل']],
] as const;
export interface ApprovedFamilyAssignment { familyId: string; profileId: string; approvalReference: string; personnelCode?: string; jobTitle?: string; internalJob?: string }
export function suggestJobFamily(title: string): string | null {
  const normalized = normalizeSearchText(title);
  return JOB_FAMILIES.find(([, , titles]) => titles.some(t => normalizeSearchText(t) === normalized))?.[0] || null;
}
export function validateApprovedFamilyAssignment(assignment: ApprovedFamilyAssignment, profiles: JobProfile[], criteria: Criterion[]): boolean {
  const profile = profiles.find(p => p.id === assignment.profileId);
  return Boolean(JOB_FAMILIES.some(([id]) => id === assignment.familyId) && typeof assignment.approvalReference === 'string' && assignment.approvalReference.trim() && (assignment.personnelCode === undefined || (typeof assignment.personnelCode === 'string' && assignment.personnelCode.trim() && typeof assignment.jobTitle === 'string' && assignment.jobTitle.trim() && typeof assignment.internalJob === 'string' && assignment.internalJob.trim())) && profile && profile.items.length && Math.abs(profile.items.reduce((sum, item) => sum + item.weight, 0) - 100) < 0.0001 && profile.items.every(item => item.weight > 0 && criteria.some(c => c.id === item.cid)));
}

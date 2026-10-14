import { getJalaliDateKey, parseTehranDateInput } from './iranDate';
import type { Employee, JobProfile } from '../types';
import { normalizePersonnelCode, normalizeSearchText } from './personnelSearch';
import { parseBusinessDate } from './businessDate';
import type { ParsedWorkbook } from './excelWorkbook';

export type PersonnelStatus = 'NEW' | 'EXISTING_UNCHANGED' | 'EXISTING_UPDATED' | 'DUPLICATE_IN_FILE' | 'CONFLICT' | 'INACTIVE' | 'INVALID' | 'NEEDS_REVIEW';
export const PERSONNEL_ALIASES: Record<string, string[]> = {
  code: ['کد پرسنلی','شماره پرسنلی','کد پرسنل','Personnel Code','code'],
  name: ['نام و نام خانوادگی','نام پرسنل','نام کارمند','name'], firstName: ['نام'], lastName: ['نام خانوادگی'],
  unit: ['واحد','واحد سازمانی','واحد اصلی','unit'],
  approvedJobTitle: ['عنوان شغل بهکو (1402/04/28)','عنوان شغل','عنوان شغلی','سمت'],
  internalJobDescription: ['شرح شغل (داخلی)','شرح شغل داخلی','شرح شغل'],
  shift: ['شیفت جدید (آپدیت مرداد 1405)','شیفت به‌روزشده','شیفت'],
  employmentStart: ['تاریخ شروع همکاری'], employmentEnd: ['تاریخ ترک کار'],
};
export type PersonnelMapping = Record<string, number[]>;
export interface SavedPersonnelMapping { headers: string[]; mapping: PersonnelMapping }
/** Stored column positions are meaningful only with their original header identities. */
export function restorePersonnelMapping(rows: unknown[][], saved: unknown): PersonnelMapping | undefined {
  const value = saved as SavedPersonnelMapping | null;
  if (!value || !Array.isArray(value.headers) || !value.mapping || typeof value.mapping !== 'object') return undefined;
  let headers: string[];
  try { headers = identifyPersonnelHeaders(rows).headers; } catch { headers = (rows[0] || []).map(v => String(v ?? '').trim()); }
  const result: PersonnelMapping = {};
  for (const [field,indexes] of Object.entries(value.mapping)) {
    if (!Object.hasOwn(PERSONNEL_ALIASES,field) || !Array.isArray(indexes)) return undefined;
    const positions = new Set<number>();
    for (const index of indexes) {
      if (!Number.isInteger(index) || typeof value.headers[index] !== 'string' || !value.headers[index].trim()) return undefined;
      const matches = headers.flatMap((h,i) => normalizeSearchText(h) === normalizeSearchText(value.headers[index]) ? [i] : []);
      if (!matches.length) return undefined;
      matches.forEach(i => positions.add(i));
    }
    result[field] = [...positions];
  }
  return result;
}
export function personnelWorkbookSheets(workbook: ParsedWorkbook): string[] {
  if (['پرسنل چالاک','پرسنل چالاک 2'].every(n => workbook.rowsBySheet[n])) return ['پرسنل چالاک','پرسنل چالاک 2'];
  const matching = workbook.sheets.filter(n => { try { identifyPersonnelHeaders(workbook.rowsBySheet[n]); return true; } catch { return false; } });
  if (matching.length > 1) throw new Error('چند شیت پرسنلی مستقل یافت شد؛ شیت موردنظر را در یک فایل مستقل انتخاب کنید.');
  return matching.length ? matching : workbook.sheets.slice(0,1);
}
export interface PersonnelInput { row: number; sheet: string; data: Record<string, string>; issues: string[] }
export function identifyPersonnelHeaders(rows: unknown[][], overrides?: PersonnelMapping) {
  const normalize = normalizeSearchText;
  const headerIndex = rows.slice(0,25).findIndex(r => r.some(v => PERSONNEL_ALIASES.code.some(a => normalize(a) === normalize(String(v ?? '')))));
  if (headerIndex < 0 && !overrides) throw new Error('سرستون کد پرسنلی در ۲۵ سطر اول پیدا نشد.');
  const headers = rows[Math.max(0,headerIndex)].map(v => String(v ?? '').trim());
  const mapping: PersonnelMapping = overrides || Object.fromEntries(Object.entries(PERSONNEL_ALIASES).map(([key,aliases]) => {
    // Updated shift is authoritative only when explicitly present; do not compare it to the older shift.
    const match = aliases.map(a => headers.flatMap((h,i) => normalize(h) === normalize(a) ? [i] : []));
    return [key, key === 'shift' ? match.find(m => m.length) || [] : match.flat()];
  }));
  if (!mapping.code?.length || (!mapping.name?.length && !(mapping.firstName?.length && mapping.lastName?.length))) throw new Error('نگاشت کد و نام کامل یا نام/نام خانوادگی لازم است.');
  for (const indexes of Object.values(mapping)) if (indexes.some(i => !Number.isInteger(i) || i < 0 || i >= headers.length)) throw new Error('نگاشت ستون معتبر نیست.');
  return { headers, mapping, headerIndex: Math.max(0,headerIndex) };
}
export function parsePersonnelSheet(rows: unknown[][], sheet: string, overrides?: PersonnelMapping): PersonnelInput[] {
  const {mapping,headerIndex} = identifyPersonnelHeaders(rows, overrides);
  return rows.slice(headerIndex+1).flatMap((row,index) => {
    if (row.every(v => v == null || String(v).trim() === '')) return [];
    const issues: string[] = [], data: Record<string,string> = {};
    for (const [field,columns] of Object.entries(mapping)) {
      const dateValue = (v: unknown) => { if (v instanceof Date && Number.isFinite(v.getTime())) return getJalaliDateKey(v); const raw = String(v ?? '').trim(); if (/^20\d{2}-\d{2}-\d{2}$/.test(raw)) { const d = parseTehranDateInput(raw); if (d) return getJalaliDateKey(d); } return normalizeSearchText(raw); };
      const values = columns.map(i => field.startsWith('employment') ? dateValue(row[i]) : row[i]).filter(v => v != null && String(v).trim() !== '').map(v => field === 'code' ? normalizePersonnelCode(String(v)) : normalizeSearchText(String(v)));
      if (new Set(values).size > 1) issues.push(`ستون‌های متناقض برای ${field}`);
      if (values.length) data[field] = values[0];
    }
    data.name ||= [data.firstName,data.lastName].filter(Boolean).join(' ');
    delete data.firstName; delete data.lastName;
    return [{row:index+headerIndex+2,sheet,data,issues}];
  });
}
export function parsePersonnelWorkbook(workbook: ParsedWorkbook, mappings: Record<string,PersonnelMapping> = {}) {
  const names = personnelWorkbookSheets(workbook);
  const inputs = names.flatMap(n => parsePersonnelSheet(workbook.rowsBySheet[n], n, mappings[n]));
  const codes = (n: string) => new Set(inputs.filter(r => r.sheet === n).map(r => r.data.code).filter(Boolean));
  const main = codes(names[0]), secondary = names[1] ? codes(names[1]) : new Set<string>();
  const overlap = [...secondary].filter(c => main.has(c)).length;
  return { inputs, identityCounts: { main:main.size,secondary:secondary.size,overlap,secondaryOnly:secondary.size-overlap,distinct:new Set([...main,...secondary]).size } };
}
export function preparePersonnelImport(inputs: PersonnelInput[], employees: Employee[], profiles: JobProfile[], options: { approved?: boolean; reference?: string; effectiveDate?: string; newProfileId?: string } = {}) {
  const oldByCode = new Map<string,Employee[]>(), byCode = new Map<string,PersonnelInput[]>();
  for (const e of employees) { const k = normalizePersonnelCode(e.code); oldByCode.set(k,[...(oldByCode.get(k)||[]),e]); }
  for (const r of inputs) { const k = normalizePersonnelCode(r.data.code); byCode.set(k,[...(byCode.get(k)||[]),r]); }
  const updates: Employee[] = [], rows: Array<{input:PersonnelInput;status:PersonnelStatus;issues:string[];changes:Array<{field:string;before:string;after:string}>}> = [];
  const approved = options.approved && !!options.reference?.trim() && !!parseBusinessDate(options.effectiveDate || '');
  for (const [code,group] of byCode) {
    // Every conflicting version is quarantined; the first row never silently wins.
    const signatures = new Set(group.map(r => JSON.stringify(Object.entries(r.data).filter(([,v])=>v).sort(([a],[b])=>a.localeCompare(b)))));
    const owners = oldByCode.get(code) || [];
    group.forEach((input,i) => {
      let status: PersonnelStatus = 'NEEDS_REVIEW'; const issues = [...input.issues], changes: Array<{field:string;before:string;after:string}> = [];
      const old = owners[0]; const data = input.data;
      if (!code || !/^[A-Z0-9][A-Z0-9._/-]*$/.test(code) || !data.name || data.name.startsWith('#')) { status='INVALID'; issues.push('کد یا نام معتبر نیست؛ صفر ابتدایی و جداکننده کد حفظ می‌شود.'); }
      else if (signatures.size > 1 || owners.length > 1) { status='CONFLICT'; issues.push('کد مشترک با اطلاعات متفاوت؛ نیازمند بررسی انسانی.'); }
      else if (i > 0) status='DUPLICATE_IN_FILE';
      else if (issues.length) status='CONFLICT';
      else if (old?.personnelEffectiveDate && parseBusinessDate(old.personnelEffectiveDate) && parseBusinessDate(options.effectiveDate || '') && parseBusinessDate(options.effectiveDate!)! < parseBusinessDate(old.personnelEffectiveDate)!) { status='NEEDS_REVIEW'; issues.push('تاریخ مؤثر منبع قدیمی‌تر از اطلاعات پذیرفته‌شده است؛ اطلاعات فعلی حفظ شد.'); }
      else {
        const candidate: Employee = old ? {...old} : {id:crypto.randomUUID(),code,name:data.name,unit:data.unit||'',username:`user_${code.toLowerCase().replace(/[^a-z0-9]/g,'_')}`,role:'employee',profileId:options.newProfileId||'',employmentStatus:'unknown'};
        for (const field of ['name','unit','approvedJobTitle','internalJobDescription','shift','employmentStart','employmentEnd'] as const) {
          const v=data[field]; if (!v) continue;
          if (field.startsWith('employment') && !parseBusinessDate(v)) { issues.push('تاریخ استخدامی نامعتبر؛ نیازمند بررسی.'); continue; }
          if (normalizeSearchText(String(candidate[field]??'')) !== normalizeSearchText(v)) { changes.push({field,before:String(candidate[field]??''),after:v}); candidate[field]=v; }
        }
        if (!old) changes.unshift({field:'هویت',before:'',after:code});
        if (data.employmentEnd && !issues.length && candidate.employmentStatus!=='inactive') {changes.push({field:'employmentStatus',before:candidate.employmentStatus||'unknown',after:'inactive'});candidate.employmentStatus='inactive';}
        // An inactive employee is never reactivated by presence in a workbook.
        if (!old && !data.employmentEnd && approved && input.sheet === 'پرسنل چالاک') candidate.employmentStatus='active';
        if (issues.length) status='NEEDS_REVIEW';
        else if (!changes.length) status='EXISTING_UNCHANGED';
        else if (!approved || !profiles.some(p=>p.id===candidate.profileId) || (!old && candidate.employmentStatus==='unknown') || employees.some(e=>e.id!==candidate.id&&e.username===candidate.username)) {status='NEEDS_REVIEW';issues.push('منبع، تاریخ مؤثر و مرجع تأیید لازم است؛ کارمند جدید پروفایل مصوب و وضعیت استخدامی تأییدشده می‌خواهد.');}
        else {status=candidate.employmentStatus==='inactive'?'INACTIVE':old?'EXISTING_UPDATED':'NEW'; candidate.personnelSource=input.sheet;candidate.personnelEffectiveDate=options.effectiveDate;candidate.personnelApprovalReference=options.reference; updates.push(candidate);}
      }
      rows.push({input,status,issues,changes});
    });
  }
  const counts = Object.fromEntries(['NEW','EXISTING_UNCHANGED','EXISTING_UPDATED','DUPLICATE_IN_FILE','CONFLICT','INACTIVE','INVALID','NEEDS_REVIEW'].map(s=>[s,rows.filter(r=>r.status===s).length]));
  return {updates,rows,counts};
}

import { jalaliDateKeyToGregorianICSDate, parseTehranDateInput } from './iranDate';
import { normalizeDigits } from './personnelSearch';

/** Strict Jalali business date, using the existing calendar validation and Tehran conversion. */
export function parseBusinessDate(value: string): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(normalizeDigits(value).trim());
  if (!m || Number(m[1]) < 1300 || Number(m[1]) > 1600) return undefined;
  const key = `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
  const date = jalaliDateKeyToGregorianICSDate(key);
  return date ? parseTehranDateInput(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`) : undefined;
}

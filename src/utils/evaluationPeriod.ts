import type { Evaluation } from '../types';
import { normalizeDigits } from './personnelSearch';
import { getJalaliDateParts } from './iranDate';

/** Stable key for legacy periods while the persisted evaluation stores the key explicitly. */
export function canonicalEvaluationPeriodId(label: string): string {
  const canonical = normalizeDigits(String(label || '').normalize('NFKC'))
    .replace(/[\u200c\u200f\u0640]/g, '')
    .replace(/[‐‑‒–—]/g, '-')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
  return canonical ? `period:${encodeURIComponent(canonical)}` : '';
}

export function getEvaluationPeriodId(evaluation: Pick<Evaluation, 'period' | 'evaluationPeriodId'>): string {
  return evaluation.evaluationPeriodId?.trim() || canonicalEvaluationPeriodId(evaluation.period);
}

/**
 * Returns the Jalali year/month where a recognizable evaluation period starts.
 * Unknown free-form labels remain incomparable so archive logic can fail safe.
 */
export function getEvaluationPeriodStartOrdinal(label: string): number | null {
  const normalized = normalizeDigits(String(label || '').normalize('NFKC'))
    .replace(/[\u200c\u200f\u0640]/g, '')
    .replace(/[‐‑‒–—]/g, '-')
    .toLocaleLowerCase();
  const yearMatch = normalized.match(/(?:^|\D)(\d{4})(?=\D|$)/);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);
  const jalaliYear = year < 1700;

  let startMonth = 1;
  if (normalized.includes('بهار') || /\bspring\b/.test(normalized)) startMonth = 1;
  else if (normalized.includes('تابستان') || /\bsummer\b/.test(normalized)) startMonth = 4;
  else if (normalized.includes('پاییز') || normalized.includes('پائيز') || /\b(?:autumn|fall)\b/.test(normalized)) startMonth = 7;
  else if (normalized.includes('زمستان') || /\bwinter\b/.test(normalized)) startMonth = 10;
  else if (/نیمه\s*دوم|نيمه\s*دوم|\bh2\b|second\s+half/.test(normalized)) startMonth = 7;
  else if (/نیمه\s*اول|نيمه\s*اول|\bh1\b|first\s+half/.test(normalized)) startMonth = 1;
  else {
    const quarterMatch = normalized.match(/(?:سه\s*ماهه\s*(اول|دوم|سوم|چهارم)|\bq([1-4])\b|quarter\s*([1-4]))/);
    if (quarterMatch) {
      const quarter = quarterMatch[1]
        ? ['اول', 'دوم', 'سوم', 'چهارم'].indexOf(quarterMatch[1]) + 1
        : Number(quarterMatch[2] || quarterMatch[3]);
      startMonth = (quarter - 1) * 3 + 1;
    } else {
      const jalaliMonthIndex = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
        .findIndex(monthName => normalized.includes(monthName));
      if (jalaliMonthIndex >= 0) startMonth = jalaliMonthIndex + 1;
      else if (!jalaliYear) {
        const gregorianMonth = normalized.match(/(?:^|\D)(\d{4})-(\d{1,2})(?=\D|$)/);
        if (gregorianMonth) startMonth = Number(gregorianMonth[2]);
      }
    }
  }

  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) return null;
  if (!jalaliYear) {
    if (startMonth > 12) return null;
    const jalaliStart = getJalaliDateParts(new Date(Date.UTC(year, startMonth - 1, 15, 12)));
    return jalaliStart.year * 12 + jalaliStart.month;
  }
  return year * 12 + startMonth;
}

/** Compare recognizable period labels by their actual start month. */
export function compareEvaluationPeriods(left: string, right: string): -1 | 0 | 1 | null {
  const leftOrdinal = getEvaluationPeriodStartOrdinal(left);
  const rightOrdinal = getEvaluationPeriodStartOrdinal(right);
  if (leftOrdinal === null || rightOrdinal === null) return null;
  if (leftOrdinal === rightOrdinal) return 0;
  return leftOrdinal < rightOrdinal ? -1 : 1;
}

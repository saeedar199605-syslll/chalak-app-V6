/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const IRAN_TIME_ZONE = 'Asia/Tehran';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export interface JalaliDateParts {
  year: number;
  month: number;
  day: number;
}

export interface JalaliMonthDate extends JalaliDateParts {
  dateStr: string;
  weekdayIndex: number;
  gregorianDate: Date;
}

const jalaliPartsFormatter = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  timeZone: IRAN_TIME_ZONE,
});
const jalaliMonthCache = new Map<string, JalaliMonthDate[]>();
const tehranWallClockFormatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  timeZone: IRAN_TIME_ZONE,
});
const tehranGregorianDateFormatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: IRAN_TIME_ZONE,
});

function normalizeDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, digit => {
    const persianIndex = PERSIAN_DIGITS.indexOf(digit);
    return String(persianIndex >= 0 ? persianIndex : ARABIC_DIGITS.indexOf(digit));
  });
}

function formatDateKey({ year, month, day }: JalaliDateParts): string {
  return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
}

function toPersianDigits(value: number | string): string {
  return String(value).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

function utcWallClockTimestamp(year: number, month: number, day: number, hour: number, minute: number, second: number): number {
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(hour, minute, second, 0);
  return value.getTime();
}

/** Resolves Gregorian wall-clock components in Tehran without using host-local parsing. */
function parseTehranWallClock(year: number, month: number, day: number, hour: number, minute: number, second: number): Date {
  const requestedWallClock = utcWallClockTimestamp(year, month, day, hour, minute, second);
  let candidate = requestedWallClock;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = tehranWallClockFormatter.formatToParts(new Date(candidate));
    const part = (type: string) => Number(parts.find(item => item.type === type)?.value);
    const observedWallClock = utcWallClockTimestamp(
      part('year'), part('month'), part('day'), part('hour'), part('minute'), part('second'),
    );
    const correction = requestedWallClock - observedWallClock;
    candidate += correction;
    if (correction === 0) break;
  }
  return new Date(candidate);
}

/** Returns a Gregorian instant as a Persian-calendar date in the application's Tehran timezone. */
export function getJalaliDateParts(date: Date = new Date()): JalaliDateParts {
  const parts = jalaliPartsFormatter.formatToParts(date);
  const read = (type: 'year' | 'month' | 'day') => Number(parts.find(part => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day') };
}

export function getJalaliDateKey(date: Date = new Date()): string {
  return formatDateKey(getJalaliDateParts(date));
}

/** Returns the Gregorian YYYY-MM-DD date key for an instant in the Tehran timezone. */
export function getTehranGregorianDateKey(date: Date = new Date()): string {
  const parts = tehranGregorianDateFormatter.formatToParts(date);
  const read = (type: 'year' | 'month' | 'day') => parts.find(part => part.type === type)?.value ?? '';
  return `${read('year').padStart(4, '0')}-${read('month').padStart(2, '0')}-${read('day').padStart(2, '0')}`;
}

/** Current Jalali season label, derived in the application's Asia/Tehran timezone. */
export function getCurrentJalaliSeasonLabel(date: Date = new Date()): string {
  const { year, month } = getJalaliDateParts(date);
  const season = ['بهار', 'تابستان', 'پاییز', 'زمستان'][Math.floor((month - 1) / 3)];
  return `${season} ${toPersianDigits(year)}`;
}

/** Current Jalali quarter label for OKR and quarterly planning views. */
export function getCurrentJalaliQuarterLabel(date: Date = new Date()): string {
  const { year, month } = getJalaliDateParts(date);
  const quarter = ['اول', 'دوم', 'سوم', 'چهارم'][Math.floor((month - 1) / 3)];
  return `سه‌ماهه ${quarter} ${toPersianDigits(year)}`;
}

/**
 * Resolves the actual day layout for a Persian month through the platform's
 * Persian calendar implementation. This keeps leap years and weekdays correct.
 */
export function getJalaliMonthDates(year: number, month: number): JalaliMonthDate[] {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return [];
  const cacheKey = `${year}/${month}`;
  const cached = jalaliMonthCache.get(cacheKey);
  if (cached) return cached;

  const approximateGregorianYear = year + 621;
  const start = Date.UTC(approximateGregorianYear, 0, 1);
  const end = Date.UTC(approximateGregorianYear + 2, 0, 1);
  const dates: JalaliMonthDate[] = [];

  for (let timestamp = start; timestamp < end; timestamp += 24 * 60 * 60 * 1000) {
    const gregorianDate = new Date(timestamp);
    const parts = getJalaliDateParts(gregorianDate);
    if (parts.year !== year || parts.month !== month) continue;

    // JavaScript uses Sunday=0; the Persian calendar grid starts on Saturday.
    const weekdayIndex = (gregorianDate.getUTCDay() + 1) % 7;
    dates.push({ ...parts, dateStr: formatDateKey(parts), weekdayIndex, gregorianDate });
  }

  jalaliMonthCache.set(cacheKey, dates);
  return dates;
}

/** Converts a strict Jalali YYYY/MM/DD key to a Gregorian YYYYMMDD value for ICS. */
export function jalaliDateKeyToGregorianICSDate(dateKey: string): string | undefined {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(dateKey.trim());
  if (!match) return undefined;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1) return undefined;
  const matchDate = getJalaliMonthDates(year, month).find(candidate => candidate.day === day);
  if (!matchDate) return undefined;

  const gregorian = matchDate.gregorianDate;
  return `${gregorian.getUTCFullYear()}${String(gregorian.getUTCMonth() + 1).padStart(2, '0')}${String(gregorian.getUTCDate()).padStart(2, '0')}`;
}

function resolveDateInput(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return new Date(value);

  const legacy = normalizeDigits(value).replace(/[\u200e\u200f]/g, '').trim().match(
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s*,?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (legacy && Number(legacy[1]) < 1700) {
    const [, yearText, monthText, dayText, hourText = '0', minuteText = '0', secondText = '0'] = legacy;
    const jalaliKey = `${yearText}/${String(Number(monthText)).padStart(2, '0')}/${String(Number(dayText)).padStart(2, '0')}`;
    const gregorian = jalaliDateKeyToGregorianICSDate(jalaliKey);
    if (gregorian) {
      const [year, month, day] = [Number(gregorian.slice(0, 4)), Number(gregorian.slice(4, 6)), Number(gregorian.slice(6, 8))];
      return parseTehranWallClock(year, month, day, Number(hourText), Number(minuteText), Number(secondText));
    }
  }
  return new Date(value);
}

export function parseTehranDateTime(value: Date | string | number): Date {
  return resolveDateInput(value);
}

/**
 * Converts an HTML Gregorian date input into the selected Tehran calendar day's
 * inclusive start or end instant. Date-only strings are deliberately not passed
 * to Date.parse, which treats them as UTC and shifts the user's intended day.
 */
export function parseTehranDateInput(value: string, boundary: 'start' | 'end' = 'start'): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return undefined;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > daysInMonth) return undefined;

  // Resolve the Gregorian date as a Tehran wall-clock day without depending on
  // the host machine timezone or requiring a Jalali parser round-trip.
  const isEnd = boundary === 'end';
  const parsed = parseTehranWallClock(year, month, day, isEnd ? 23 : 0, isEnd ? 59 : 0, isEnd ? 59 : 0);
  if (Number.isNaN(parsed.getTime())) return undefined;
  if (boundary === 'end') parsed.setMilliseconds(999);
  return parsed;
}

export function formatTehranDate(date: Date | string | number): string {
  const resolved = resolveDateInput(date);
  if (Number.isNaN(resolved.getTime())) return '—';
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    dateStyle: 'short',
    timeZone: IRAN_TIME_ZONE,
  }).format(resolved);
}

export function formatTehranDateTime(date: Date | string | number): string {
  const resolved = resolveDateInput(date);
  if (Number.isNaN(resolved.getTime())) return '—';
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: IRAN_TIME_ZONE,
  }).format(resolved);
}

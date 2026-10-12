import type {
  KickidlerLiveStatus,
  KickidlerViolation,
  LiveEmployeeActivity,
  TimeCategoryBreakdown,
  WorkdayActivityRecord,
} from '../types';
import { getJalaliDateParts, getJalaliMonthDates, type JalaliDateParts } from './iranDate';

type DataRecord = Record<string, unknown>;

const asRecord = (value: unknown): DataRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;

const asText = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const asCount = (value: unknown): number => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
};

const asPercent = (value: unknown): number => Math.min(100, asCount(value));
const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
const arabicDigits = '٠١٢٣٤٥٦٧٨٩';

function normalizeDateDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, digit => {
    const persianIndex = persianDigits.indexOf(digit);
    return String(persianIndex >= 0 ? persianIndex : arabicDigits.indexOf(digit));
  }).replace(/[\u200e\u200f]/g, '').trim();
}

function isValidJalaliDate(year: number, month: number, day: number): boolean {
  return Number.isInteger(year) && year >= 1 && Number.isInteger(month) && month >= 1 && month <= 12 &&
    Number.isInteger(day) && getJalaliMonthDates(year, month).some(candidate => candidate.day === day);
}

/** Parses report dates in Jalali, Gregorian date-only, or timestamp form using the app's Tehran calendar. */
export function parseWorkdayJalaliDate(value: string): JalaliDateParts | null {
  const normalized = normalizeDateDigits(value);
  const dateOnly = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(normalized);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    if (year < 1700) return isValidJalaliDate(year, month, day) ? { year, month, day } : null;
    const gregorianDate = new Date(Date.UTC(year, month - 1, day, 12));
    if (gregorianDate.getUTCFullYear() !== year || gregorianDate.getUTCMonth() + 1 !== month || gregorianDate.getUTCDate() !== day) return null;
    return getJalaliDateParts(gregorianDate);
  }

  const timestamp = new Date(normalized);
  return Number.isFinite(timestamp.getTime()) ? getJalaliDateParts(timestamp) : null;
}

export interface WorkdayDatePeriod {
  start: JalaliDateParts;
  end: JalaliDateParts;
  label: string;
  usedActivePeriod: boolean;
}

function dateOrdinal(date: JalaliDateParts): number {
  return date.year * 10000 + date.month * 100 + date.day;
}

function jalaliMonthRange(year: number, firstMonth: number, lastMonth: number): Pick<WorkdayDatePeriod, 'start' | 'end'> | null {
  const first = getJalaliMonthDates(year, firstMonth);
  const last = getJalaliMonthDates(year, lastMonth);
  if (!first.length || !last.length) return null;
  return {
    start: { year, month: firstMonth, day: first[0].day },
    end: { year, month: lastMonth, day: last[last.length - 1].day },
  };
}

function gregorianPeriodRange(year: number, firstMonth: number, lastMonth: number): Pick<WorkdayDatePeriod, 'start' | 'end'> {
  return {
    start: getJalaliDateParts(new Date(Date.UTC(year, firstMonth - 1, 1, 12))),
    end: getJalaliDateParts(new Date(Date.UTC(year, lastMonth, 0, 12))),
  };
}

function parseActivePeriodRange(activePeriod: string): Pick<WorkdayDatePeriod, 'start' | 'end'> | null {
  const period = normalizeDateDigits(activePeriod);
  const seasons: Record<string, [number, number]> = {
    'بهار': [1, 3], 'تابستان': [4, 6], 'پاییز': [7, 9], 'زمستان': [10, 12],
  };
  const season = /(بهار|تابستان|پاییز|زمستان)\s*(\d{4})|(\d{4})\s*(بهار|تابستان|پاییز|زمستان)/.exec(period);
  if (season) {
    const name = season[1] || season[4];
    const year = Number(season[2] || season[3]);
    const [firstMonth, lastMonth] = seasons[name];
    return jalaliMonthRange(year, firstMonth, lastMonth);
  }

  const half = /نیمه\s*(اول|دوم)\s*(\d{4})|(\d{4})\s*نیمه\s*(اول|دوم)/.exec(period);
  if (half) {
    const firstHalf = (half[1] || half[4]) === 'اول';
    const year = Number(half[2] || half[3]);
    return jalaliMonthRange(year, firstHalf ? 1 : 7, firstHalf ? 6 : 12);
  }

  const gregorianHalf = /^(\d{4})\s*H([12])$/i.exec(period);
  if (gregorianHalf) {
    const year = Number(gregorianHalf[1]);
    const firstMonth = gregorianHalf[2] === '1' ? 1 : 7;
    return gregorianPeriodRange(year, firstMonth, firstMonth + 5);
  }

  const yearOnly = /^(\d{4})$/.exec(period);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    return year < 1700 ? jalaliMonthRange(year, 1, 12) : gregorianPeriodRange(year, 1, 12);
  }
  return null;
}

function currentJalaliMonthRange(now: Date): Pick<WorkdayDatePeriod, 'start' | 'end'> {
  const { year, month } = getJalaliDateParts(now);
  return jalaliMonthRange(year, month, month) || {
    start: { year, month, day: 1 },
    end: { year, month, day: 31 },
  };
}

/** Uses a recognized active Jalali/Gregorian period; otherwise falls back explicitly to the current Tehran Jalali month. */
export function resolveWorkdayDatePeriod(activePeriod: string | null | undefined, now: Date = new Date()): WorkdayDatePeriod {
  const normalizedPeriod = typeof activePeriod === 'string' ? activePeriod.trim() : '';
  const activeRange = normalizedPeriod ? parseActivePeriodRange(normalizedPeriod) : null;
  if (activeRange) return { ...activeRange, label: `دوره فعال: ${normalizedPeriod}`, usedActivePeriod: true };

  const { year, month } = getJalaliDateParts(now);
  const currentRange = currentJalaliMonthRange(now);
  const currentLabel = `ماه جاری شمسی: ${String(year).padStart(4, '0')}/${String(month).padStart(2, '0')}`;
  return {
    ...currentRange,
    label: normalizedPeriod ? `${currentLabel} (بازه دوره فعال قابل تشخیص نیست)` : currentLabel,
    usedActivePeriod: false,
  };
}

export function isWorkdayActivityInPeriod(date: string, period: WorkdayDatePeriod): boolean {
  const parsedDate = parseWorkdayJalaliDate(date);
  return Boolean(parsedDate && dateOrdinal(parsedDate) >= dateOrdinal(period.start) && dateOrdinal(parsedDate) <= dateOrdinal(period.end));
}

export function normalizeWorkdayActivityRecord(value: unknown): WorkdayActivityRecord | null {
  const row = asRecord(value);
  if (!row || typeof row.empId !== 'string' || !row.empId.trim()) return null;

  const breakdown = asRecord(row.timeBreakdown) || {};
  const timeBreakdown: TimeCategoryBreakdown = {
    productiveMinutes: asCount(breakdown.productiveMinutes),
    neutralMinutes: asCount(breakdown.neutralMinutes),
    unproductiveMinutes: asCount(breakdown.unproductiveMinutes),
    idleMinutes: asCount(breakdown.idleMinutes),
    totalWorkMinutes: asCount(breakdown.totalWorkMinutes),
  };
  const categoryTotal = timeBreakdown.productiveMinutes + timeBreakdown.neutralMinutes +
    timeBreakdown.unproductiveMinutes + timeBreakdown.idleMinutes;
  // Keep category percentages bounded when source totals contradict their component minutes.
  timeBreakdown.totalWorkMinutes = Math.max(timeBreakdown.totalWorkMinutes, categoryTotal);

  const productiveRatio = timeBreakdown.totalWorkMinutes > 0
    ? timeBreakdown.productiveMinutes / timeBreakdown.totalWorkMinutes * 100
    : 0;
  const appCategory = ['cad_cam', 'mes_erp', 'office_docs', 'browsing', 'idle'].includes(String(row.activeAppCategory))
    ? row.activeAppCategory as WorkdayActivityRecord['activeAppCategory']
    : 'idle';
  const burnoutCategory = ['optimal', 'high_workload', 'burnout_risk', 'underloaded'].includes(String(row.burnoutCategory))
    ? row.burnoutCategory as WorkdayActivityRecord['burnoutCategory']
    : 'underloaded';

  return {
    id: asText(row.id, `legacy:${row.empId}`),
    empId: row.empId,
    empName: asText(row.empName, 'نامشخص'),
    empCode: asText(row.empCode, '—'),
    unit: asText(row.unit, 'نامشخص'),
    date: asText(row.date, 'تاریخ ثبت نشده'),
    timeBreakdown,
    productivityIndex: typeof row.productivityIndex === 'number' && Number.isFinite(row.productivityIndex)
      ? asPercent(row.productivityIndex)
      : productiveRatio,
    keystrokesCount: asCount(row.keystrokesCount),
    mouseClicksCount: asCount(row.mouseClicksCount),
    activeAppTitle: asText(row.activeAppTitle, 'اطلاعات ثبت نشده'),
    activeAppCategory: appCategory,
    burnoutRiskScore: asPercent(row.burnoutRiskScore),
    burnoutCategory,
    violationsCount: asCount(row.violationsCount),
  };
}

export function normalizeLiveEmployeeActivity(value: unknown): LiveEmployeeActivity | null {
  const row = asRecord(value);
  if (!row || typeof row.empId !== 'string' || !row.empId.trim()) return null;
  const validStatuses: KickidlerLiveStatus[] = ['productive', 'neutral', 'unproductive', 'idle', 'offline'];
  const status = validStatuses.includes(row.status as KickidlerLiveStatus) ? row.status as KickidlerLiveStatus : 'offline';
  const intensityRate = ['high', 'medium', 'low'].includes(String(row.intensityRate))
    ? row.intensityRate as LiveEmployeeActivity['intensityRate']
    : 'low';
  return {
    empId: row.empId,
    empName: asText(row.empName, 'نامشخص'),
    empCode: asText(row.empCode, '—'),
    unit: asText(row.unit, 'نامشخص'),
    status,
    currentApp: asText(row.currentApp, 'اطلاعات ثبت نشده'),
    currentAppCategory: asText(row.currentAppCategory, 'نامشخص'),
    shiftStartTime: asText(row.shiftStartTime, '—'),
    activeDurationMinutes: asCount(row.activeDurationMinutes),
    todayProductivityRate: asPercent(row.todayProductivityRate),
    todayIdleMinutes: asCount(row.todayIdleMinutes),
    intensityRate,
    lastActiveTimestamp: asText(row.lastActiveTimestamp, ''),
    ...(typeof row.avatarColor === 'string' ? { avatarColor: row.avatarColor } : {}),
  };
}

export function normalizeKickidlerViolation(value: unknown): KickidlerViolation | null {
  const row = asRecord(value);
  if (!row || typeof row.id !== 'string' || !row.id.trim() || typeof row.empId !== 'string' || !row.empId.trim()) return null;
  const types: KickidlerViolation['type'][] = ['unproductive_site', 'prolonged_idle', 'late_arrival', 'early_departure', 'unauthorized_program'];
  const severities: KickidlerViolation['severity'][] = ['critical', 'high', 'medium', 'low'];
  const statuses: KickidlerViolation['status'][] = ['new', 'acknowledged', 'addressed'];
  return {
    id: row.id,
    empId: row.empId,
    empName: asText(row.empName, 'نامشخص'),
    empCode: asText(row.empCode, '—'),
    unit: asText(row.unit, 'نامشخص'),
    timestamp: asText(row.timestamp, 'زمان ثبت نشده'),
    type: types.includes(row.type as KickidlerViolation['type']) ? row.type as KickidlerViolation['type'] : 'unauthorized_program',
    title: asText(row.title, 'هشدار بدون عنوان'),
    description: asText(row.description),
    ...(row.durationMinutes === undefined ? {} : { durationMinutes: asCount(row.durationMinutes) }),
    severity: severities.includes(row.severity as KickidlerViolation['severity']) ? row.severity as KickidlerViolation['severity'] : 'low',
    status: statuses.includes(row.status as KickidlerViolation['status']) ? row.status as KickidlerViolation['status'] : 'new',
  };
}

export function readNormalizedKickidlerList<T>(key: string, normalize: (value: unknown) => T | null): T[] {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed.map(normalize).filter((item): item is T => item !== null) : [];
  } catch {
    return [];
  }
}

export function safeTimePercent(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, part / total * 100));
}

export interface WorkdayUnitProductivitySummary {
  unit: string;
  reportCount: number;
  employeeCount: number;
  averageProductivityIndex: number;
}

/** Describes recorded PEI by organizational unit without assuming an external target. */
export function summarizeProductivityByUnit(records: readonly WorkdayActivityRecord[]): WorkdayUnitProductivitySummary[] {
  const groups = new Map<string, { total: number; reportCount: number; employeeIds: Set<string> }>();
  for (const record of records) {
    const unit = record.unit.trim() || 'نامشخص';
    const group = groups.get(unit) || { total: 0, reportCount: 0, employeeIds: new Set<string>() };
    group.total += Number.isFinite(record.productivityIndex) ? Math.min(100, Math.max(0, record.productivityIndex)) : 0;
    group.reportCount += 1;
    group.employeeIds.add(record.empId);
    groups.set(unit, group);
  }

  return [...groups.entries()]
    .map(([unit, group]) => ({
      unit,
      reportCount: group.reportCount,
      employeeCount: group.employeeIds.size,
      averageProductivityIndex: Number((group.total / group.reportCount).toFixed(1)),
    }))
    .sort((left, right) => left.averageProductivityIndex - right.averageProductivityIndex || left.unit.localeCompare(right.unit, 'fa'));
}

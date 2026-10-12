/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jalaliDateKeyToGregorianICSDate } from './iranDate';

export interface CalendarWorkflowEvent {
  id: string;
  title: string;
  description: string;
  location?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  allDay?: boolean;
  startTime?: string; // HH:mm in Asia/Tehran
  endTime?: string;   // HH:mm in Asia/Tehran
}

export interface SavedCalendarEvent {
  id: string;
  title: string;
  description: string;
  location?: string;
  dateStr: string; // Jalali YYYY/MM/DD
  time?: string;
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function normalizeDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, digit => {
    const persianIndex = PERSIAN_DIGITS.indexOf(digit);
    return String(persianIndex >= 0 ? persianIndex : ARABIC_DIGITS.indexOf(digit));
  });
}

function formatICSDate(dateStr: string, isAllDay: boolean, time?: string): string {
  const clean = dateStr.replace(/-/g, '');
  if (isAllDay) return clean;
  const match = /^(\d{2}):(\d{2})$/.exec(normalizeDigits(time || '08:30'));
  const normalizedTime = match ? `${match[1]}${match[2]}00` : '083000';
  return `${clean}T${normalizedTime}`;
}

function addGregorianDay(yyyymmdd: string): string {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function addOneHour(yyyymmdd: string, time: string): { date: string; time: string } {
  const [year, month, day] = [Number(yyyymmdd.slice(0, 4)), Number(yyyymmdd.slice(4, 6)), Number(yyyymmdd.slice(6, 8))];
  const [hour, minute] = normalizeDigits(time).split(':').map(Number);
  const end = new Date(Date.UTC(year, month - 1, day, hour, minute + 60));
  return {
    date: end.toISOString().slice(0, 10),
    time: `${String(end.getUTCHours()).padStart(2, '0')}:${String(end.getUTCMinutes()).padStart(2, '0')}`,
  };
}

/** Map only user-saved calendar records to exportable events; never invent workflow deadlines. */
export function calendarEventsToWorkflowEvents(events: SavedCalendarEvent[]): CalendarWorkflowEvent[] {
  return events.flatMap<CalendarWorkflowEvent>(event => {
    const gregorian = jalaliDateKeyToGregorianICSDate(event.dateStr);
    if (!gregorian) return [];
    const startDate = `${gregorian.slice(0, 4)}-${gregorian.slice(4, 6)}-${gregorian.slice(6, 8)}`;
    const normalizedTime = normalizeDigits(event.time || '');
    const timeMatch = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalizedTime);
    const description = [event.description?.trim(), timeMatch ? `ساعت: ${normalizedTime}` : '']
      .filter(Boolean)
      .join('\n');

    if (!timeMatch) {
      return [{
        id: event.id,
        title: event.title,
        description,
        location: event.location,
        startDate,
        endDate: addGregorianDay(gregorian),
        allDay: true,
      }];
    }

    const end = addOneHour(gregorian, normalizedTime);
    return [{
      id: event.id,
      title: event.title,
      description,
      location: event.location,
      startDate,
      endDate: end.date,
      startTime: normalizedTime,
      endTime: end.time,
      allDay: false,
    }];
  });
}

export function downloadCalendarEventsICS(events: SavedCalendarEvent[]): boolean {
  const workflowEvents = calendarEventsToWorkflowEvents(events);
  if (!workflowEvents.length) return false;
  downloadWorkflowCalendarICS(workflowEvents, 'chalak_calendar_events.ics');
  return true;
}

/**
 * Generate iCalendar RFC-5545 text format
 */
export function generateICSContent(events: CalendarWorkflowEvent[]): string {
  const nowStr = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Chalak Performance Management//Workflow Deadlines//FA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:تقویم سررسید ارزیابی عملکرد اصفهان چالاک',
    'X-WR-TIMEZONE:Asia/Tehran',
    'X-WR-CALDESC:مهلت‌های زمانی و سررسید گام‌های ارزیابی عملکرد پرسنل'
  ];

  events.forEach(evt => {
    const allDay = evt.allDay !== false;
    const startFormatted = formatICSDate(evt.startDate, allDay, evt.startTime);
    const endFormatted = formatICSDate(evt.endDate, allDay, evt.endTime);
    const dateLines = allDay
      ? [`DTSTART;VALUE=DATE:${startFormatted}`, `DTEND;VALUE=DATE:${endFormatted}`]
      : [`DTSTART;TZID=Asia/Tehran:${startFormatted}`, `DTEND;TZID=Asia/Tehran:${endFormatted}`];

    ics.push(
      'BEGIN:VEVENT',
      `UID:${evt.id}-${nowStr}@chalak-performance.local`,
      `DTSTAMP:${nowStr}`,
      ...dateLines,
      `SUMMARY:${evt.title.replace(/,/g, '\\,')}`,
      `DESCRIPTION:${evt.description.replace(/\n/g, '\\n').replace(/,/g, '\\,')}`,
      evt.location ? `LOCATION:${evt.location.replace(/,/g, '\\,')}` : 'LOCATION:سامانه ارزیابی عملکرد اصفهان چالاک',
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-P1D',
      'ACTION:DISPLAY',
      `DESCRIPTION:یادآوری: ۱ روز مانده به ${evt.title}`,
      'END:VALARM',
      'END:VEVENT'
    );
  });

  ics.push('END:VCALENDAR');
  return ics.join('\r\n');
}

/**
 * Trigger download of .ics file
 */
export function downloadWorkflowCalendarICS(events: CalendarWorkflowEvent[], filename = 'chalak_evaluation_deadlines.ics') {
  const content = generateICSContent(events);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}


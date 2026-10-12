/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  Calendar as CalendarIcon, 
  ChevronRight, 
  ChevronLeft, 
  Clock, 
  MapPin, 
  Users, 
  Plus, 
  CheckCircle2, 
  AlertCircle, 
  CalendarDays,
  Target,
  Scale,
  Sparkles,
  ClipboardList,
  Filter,
  ArrowUpRight,
  X,
  Edit2,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Employee, Evaluation } from '../types';
import { db } from '../utils/db';
import { getJalaliDateKey, getJalaliDateParts, getJalaliMonthDates, jalaliDateKeyToGregorianICSDate } from '../utils/iranDate';
import { normalizeDigits } from '../utils/personnelSearch';
import { getIdpCalendarDeadlines, getWorkflowCalendarDeadlines } from '../utils/calendarDeadlines';
import { normalizeWorkflowSlaConfig } from '../utils/workflowSla';
import { Button, IconButton } from './ui/Primitives';

export type CalendarEventType = 'evaluation' | 'calibration' | 'okr' | 'one_on_one' | 'idp_deadline' | 'workflow_deadline';

export interface CalendarEvent {
  id: string;
  title: string;
  type: CalendarEventType;
  dateStr: string; // Jalali YYYY/MM/DD
  time: string;
  location: string;
  attendees: string;
  description: string;
  targetTab?: string;
  status?: 'upcoming' | 'urgent' | 'completed';
  readOnly?: boolean;
}

interface CalendarWidgetProps {
  currentUser?: Employee;
  evaluations?: Evaluation[];
  employees?: Employee[];
  onNavigate?: (tab: string) => void;
  theme?: 'dark' | 'light';
}

const PERSIAN_MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];

const WEEKDAY_NAMES = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

// Do not insert demonstration or historical deadlines into a real user's calendar.
const DEFAULT_EVENTS: CalendarEvent[] = [];

export default function CalendarWidget({
  currentUser,
  evaluations = [],
  employees = [],
  onNavigate,
  theme = 'light'
}: CalendarWidgetProps) {
  const [todayDate, setTodayDate] = useState<Date>(() => new Date());
  const todayParts = getJalaliDateParts(todayDate);
  const todayDateKey = getJalaliDateKey(todayDate);
  const previousTodayRef = useRef({ ...todayParts, dateKey: todayDateKey });
  const [currentYear, setCurrentYear] = useState<number>(() => todayParts.year);
  const [currentMonthIndex, setCurrentMonthIndex] = useState<number>(() => todayParts.month - 1);
  const [selectedDate, setSelectedDate] = useState<string>(() => getJalaliDateKey());
  const [activeFilter, setActiveFilter] = useState<'all' | CalendarEventType>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  // New Event Form State
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventType, setNewEventType] = useState<CalendarEventType>('evaluation');
  const [newEventDate, setNewEventDate] = useState(() => getJalaliDateKey());
  const [newEventTime, setNewEventTime] = useState('۱۰:۰۰');
  const [newEventLocation, setNewEventLocation] = useState('سالن جلسات کارخانه');
  const [newEventAttendees, setNewEventAttendees] = useState('سرپرستان خط و مدیر تولید');
  const [newEventDesc, setNewEventDesc] = useState('');

  // Persisted Calendar Events
  const [events, setEvents] = useState<CalendarEvent[]>(() => {
    const saved = localStorage.getItem('pe_supervisor_calendar_events');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return DEFAULT_EVENTS;
      }
    }
    return DEFAULT_EVENTS;
  });
  const [workflowSlaConfig, setWorkflowSlaConfig] = useState(() => normalizeWorkflowSlaConfig(db.getMiscData('pe_workflow_sla', {})));

  useEffect(() => {
    const timer = window.setInterval(() => setTodayDate(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const previousToday = previousTodayRef.current;
    const changedMonth = previousToday.year !== todayParts.year || previousToday.month !== todayParts.month;
    if (changedMonth) {
      // Keep a calendar that was following today in sync, but don't interrupt month browsing.
      if (currentYear === previousToday.year && currentMonthIndex === previousToday.month - 1) {
        setCurrentYear(todayParts.year);
        setCurrentMonthIndex(todayParts.month - 1);
      }
      if (selectedDate === previousToday.dateKey) setSelectedDate(todayDateKey);
    }
    previousTodayRef.current = { ...todayParts, dateKey: todayDateKey };
  }, [currentMonthIndex, currentYear, selectedDate, todayDateKey, todayParts.year, todayParts.month]);

  const saveEvents = (updated: CalendarEvent[]) => {
    setEvents(updated);
    db.saveMiscData('pe_supervisor_calendar_events', updated);
  };

  useEffect(() => db.subscribe((key, data) => {
    if (key === 'pe_supervisor_calendar_events' && Array.isArray(data)) setEvents(data);
    if (key === 'pe_workflow_sla') setWorkflowSlaConfig(normalizeWorkflowSlaConfig(data));
  }), []);

  const calendarEvents = useMemo<CalendarEvent[]>(() => [
    ...events,
    ...getIdpCalendarDeadlines(evaluations, employees, currentUser),
    ...getWorkflowCalendarDeadlines(evaluations, employees, currentUser, workflowSlaConfig, todayDate),
  ], [events, evaluations, employees, currentUser, workflowSlaConfig, todayDate]);

  const openEventEditor = (event: CalendarEvent) => {
    setEditingEventId(event.id);
    setNewEventTitle(event.title);
    setNewEventType(event.type);
    setNewEventDate(event.dateStr);
    setNewEventTime(event.time);
    setNewEventLocation(event.location);
    setNewEventAttendees(event.attendees);
    setNewEventDesc(event.description);
    setIsAddModalOpen(true);
  };

  const closeEventEditor = () => {
    setIsAddModalOpen(false);
    setEditingEventId(null);
    setNewEventTitle('');
    setNewEventDesc('');
  };

  const deleteEvent = (event: CalendarEvent) => {
    if (currentUser?.role !== 'admin' || !window.confirm(`رویداد «${event.title}» حذف شود؟`)) return;
    saveEvents(events.filter(item => item.id !== event.id));
  };

  const handlePrevMonth = () => {
    if (currentMonthIndex === 0) {
      setCurrentMonthIndex(11);
      setCurrentYear(prev => prev - 1);
    } else {
      setCurrentMonthIndex(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonthIndex === 11) {
      setCurrentMonthIndex(0);
      setCurrentYear(prev => prev + 1);
    } else {
      setCurrentMonthIndex(prev => prev + 1);
    }
  };

  const handleGoToday = () => {
    const now = new Date();
    const today = getJalaliDateParts(now);
    setTodayDate(now);
    setCurrentYear(today.year);
    setCurrentMonthIndex(today.month - 1);
    setSelectedDate(getJalaliDateKey(now));
    setNewEventDate(getJalaliDateKey(now));
  };

  // Month days computation (Standard Persian calendar: months 1-6 have 31 days, 7-11 have 30 days, 12 has 29)
  const monthDates = useMemo(
    () => getJalaliMonthDates(currentYear, currentMonthIndex + 1),
    [currentYear, currentMonthIndex]
  );
  const totalDaysInMonth = monthDates.length;
  const firstDayOffset = monthDates[0]?.weekdayIndex ?? 0;

  // Filtered events
  const filteredEvents = useMemo(() => {
    return calendarEvents.filter(evt => {
      if (activeFilter === 'all') return true;
      return evt.type === activeFilter;
    });
  }, [calendarEvents, activeFilter]);

  // Map of date string -> events on that date
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    filteredEvents.forEach(evt => {
      const existing = map.get(evt.dateStr) || [];
      existing.push(evt);
      map.set(evt.dateStr, existing);
    });
    return map;
  }, [filteredEvents]);

  // Selected date events
  const selectedDayEvents = useMemo(() => {
    return filteredEvents.filter(e => e.dateStr === selectedDate);
  }, [filteredEvents, selectedDate]);

  // Handle adding new event
  const handleCreateEvent = (e: React.FormEvent) => {
    e.preventDefault();
    const eventDate = normalizeDigits(newEventDate.trim());
    if (!newEventTitle.trim() || !jalaliDateKeyToGregorianICSDate(eventDate)) {
      window.alert('عنوان رویداد و تاریخ شمسی معتبر را وارد کنید.');
      return;
    }

    const newEvt: CalendarEvent = {
      id: `evt-${Date.now()}`,
      title: newEventTitle.trim(),
      type: newEventType,
      dateStr: eventDate,
      time: newEventTime.trim() || '۰۹:۰۰',
      location: newEventLocation.trim() || 'سالن جلسات',
      attendees: newEventAttendees.trim() || 'سرپرستان خط',
      description: newEventDesc.trim(),
      status: 'upcoming',
      targetTab: newEventType === 'evaluation' ? 'evaluations' : newEventType === 'calibration' ? 'calibration' : 'lattice-hub'
    };

    const updated = editingEventId
      ? events.map(item => item.id === editingEventId ? { ...newEvt, id: editingEventId } : item)
      : [...events, newEvt];
    saveEvents(updated);
    setSelectedDate(eventDate);
    setIsAddModalOpen(false);
    setEditingEventId(null);

    // Reset Form
    setNewEventTitle('');
    setNewEventDesc('');
  };

  const getTypeBadge = (type: CalendarEventType) => {
    switch (type) {
      case 'evaluation':
        return {
          label: 'سررسید ارزیابی',
          color: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30',
          dot: 'bg-rose-500',
          icon: ClipboardList
        };
      case 'calibration':
        return {
          label: 'کمیته کالیبراسیون',
          color: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30',
          dot: 'bg-purple-500',
          icon: Scale
        };
      case 'okr':
        return {
          label: 'پایان دوره OKR',
          color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30',
          dot: 'bg-emerald-500',
          icon: Target
        };
      case 'one_on_one':
        return {
          label: 'جلسه ۱به۱ مربیگری',
          color: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30',
          dot: 'bg-blue-500',
          icon: Users
        };
      case 'idp_deadline':
        return {
          label: 'مهلت برنامه توسعه فردی',
          color: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30',
          dot: 'bg-amber-500',
          icon: Target
        };
      case 'workflow_deadline':
        return {
          label: 'مهلت مرحله گردش کار',
          color: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30',
          dot: 'bg-cyan-500',
          icon: Clock
        };
    }
  };

  return (
    <div className="bg-slate-900/60 dark:bg-slate-900/70 light:bg-white border border-slate-700/60 dark:border-slate-800 rounded-3xl p-5 md:p-6 space-y-6 shadow-xl transition-all">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-teal-500/20 to-indigo-500/20 border border-teal-500/30 flex items-center justify-center text-teal-400 shadow-inner">
            <CalendarIcon className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-slate-100 tracking-tight">
                تقویم تعاملی سرپرستان و سررسیدهای سازمانی
              </h2>
              <span className="text-[10px] font-bold bg-teal-500/15 text-teal-400 border border-teal-500/30 px-2 py-0.5 rounded-full">
                ویژه راهبری خطوط
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              پایش بصری مواعد ارزیابی عملکرد، جلسات هم‌ترازی کالیبراسیون و پایان دوره‌های فصلی OKR
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" className="text-xs" onClick={handleGoToday}>
            امروز
          </Button>

          <Button variant="primary" className="text-xs" onClick={() => setIsAddModalOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            <span>ثبت سررسید / رویداد</span>
          </Button>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        <span className="text-slate-400 text-[11px] font-bold shrink-0 flex items-center gap-1">
          <Filter className="w-3.5 h-3.5" />
          فیلتر دسته‌ها:
        </span>
        <button
          type="button"
          onClick={() => setActiveFilter('all')}
          className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer shrink-0 ${
            activeFilter === 'all'
              ? 'bg-slate-700 text-white shadow-sm'
              : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
          }`}
        >
          همه رویدادها ({calendarEvents.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveFilter('evaluation')}
          className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
            activeFilter === 'evaluation'
              ? 'bg-rose-500 text-white shadow-sm'
              : 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-rose-400" />
          <span>سررسید ارزیابی‌ها</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveFilter('calibration')}
          className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
            activeFilter === 'calibration'
              ? 'bg-purple-600 text-white shadow-sm'
              : 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-purple-400" />
          <span>جلسات کالیبراسیون</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveFilter('okr')}
          className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
            activeFilter === 'okr'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>پایان دوره OKR</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveFilter('one_on_one')}
          className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
            activeFilter === 'one_on_one'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-blue-400" />
          <span>جلسات ۱به۱ مربیگری</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveFilter('workflow_deadline')}
          className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
            activeFilter === 'workflow_deadline'
              ? 'bg-cyan-600 text-white shadow-sm'
              : 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/20 border border-cyan-500/20'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-cyan-500" />
          <span>مهلت‌های گردش کار ({calendarEvents.filter(event => event.type === 'workflow_deadline').length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveFilter('idp_deadline')}
          className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
            activeFilter === 'idp_deadline'
              ? 'bg-amber-600 text-white shadow-sm'
              : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 border border-amber-500/20'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          <span>مهلت‌های برنامه توسعه فردی ({calendarEvents.filter(event => event.type === 'idp_deadline').length})</span>
        </button>
      </div>

      {/* Main Calendar & Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Monthly Calendar View (7 cols) */}
        <div className="lg:col-span-7 bg-slate-950/40 border border-slate-800/80 rounded-2xl p-4 space-y-4">
          {/* Month Navigation Header */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
              title="ماه قبل"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <div className="text-center">
              <h3 className="text-sm font-black text-slate-100 font-mono">
                {PERSIAN_MONTH_NAMES[currentMonthIndex]} {currentYear}
              </h3>
              <span className="text-[10px] text-teal-400 font-semibold">
                امروز: {todayDateKey}
              </span>
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
              title="ماه بعد"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday Names Header */}
          <div className="grid grid-cols-7 text-center text-[11px] font-bold text-slate-400 pb-1 border-b border-slate-800">
            {WEEKDAY_NAMES.map((wd, i) => (
              <div key={i} className={i === 6 ? 'text-rose-400' : ''}>
                {wd}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1.5 text-xs">
            {/* Empty padding slots before first day */}
            {Array.from({ length: firstDayOffset }).map((_, i) => (
              <div key={`empty-${i}`} className="h-14 rounded-xl opacity-10 bg-slate-800/20 pointer-events-none" />
            ))}

            {/* Month Day Cells */}
            {Array.from({ length: totalDaysInMonth }).map((_, i) => {
              const dayNum = i + 1;
              const monthDate = monthDates[dayNum - 1];
              const dateStr = monthDate?.dateStr || '';
              const isSelected = selectedDate === dateStr;
              const isToday = todayDateKey === dateStr;
              const dayEvents = eventsByDate.get(dateStr) || [];
              const hasEvents = dayEvents.length > 0;
              const isFriday = monthDate?.weekdayIndex === 6;

              return (
                <button
                  type="button"
                  key={dayNum}
                  onClick={() => setSelectedDate(dateStr)}
                  aria-label={`${dateStr}${isToday ? ' (امروز)' : ''}`}
                  title={dateStr}
                  className={`h-14 rounded-xl p-1 flex flex-col justify-between items-center transition-all cursor-pointer relative border ${
                    isSelected
                      ? 'bg-teal-500/20 border-teal-500 text-teal-300 font-bold shadow-md ring-2 ring-teal-500/20'
                      : isToday
                      ? 'bg-teal-500/10 border-teal-500/60 text-teal-300'
                      : hasEvents
                      ? 'bg-slate-900 border-slate-700/80 hover:border-slate-600 text-slate-200'
                      : 'bg-slate-900/30 border-slate-800/60 hover:bg-slate-800/40 text-slate-400'
                  }`}
                >
                  {/* Day Number */}
                  <span className={`text-[11px] font-mono ${isFriday && !isSelected ? 'text-rose-400' : ''}`}>
                    {dayNum}
                  </span>

                  {/* Indicator Dots / Event markers */}
                  <div className="flex items-center justify-center gap-1 w-full overflow-hidden px-0.5">
                    {dayEvents.slice(0, 3).map((evt, idx) => {
                      const badge = getTypeBadge(evt.type);
                      return (
                        <span
                          key={idx}
                          className={`w-1.5 h-1.5 rounded-full ${badge.dot}`}
                          title={evt.title}
                        />
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <span className="text-[8px] font-mono text-slate-400">+{dayEvents.length - 3}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Quick Legend */}
          <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between flex-wrap gap-2 text-[10px] text-slate-400">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>سررسید ارزیابی</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-500" />
              <span>جلسه کالیبراسیون</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>پایان دوره OKR</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span>جلسه ۱به۱ مربیگری</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>مهلت برنامه توسعه فردی</span>
            </div>
          </div>
        </div>

        {/* Right: Selected Day Events & Action Panel (5 cols) */}
        <div className="lg:col-span-5 bg-slate-950/40 border border-slate-800/80 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-teal-400" />
              <h4 className="text-xs font-bold text-slate-200">
                رویدادهای تاریخ: <span className="text-teal-400 font-mono font-black">{selectedDate}</span>
              </h4>
            </div>
            <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-md font-mono">
              {selectedDayEvents.length} سررسید
            </span>
          </div>

          {/* List of events for this selected day */}
          <div className="space-y-3 max-h-[380px] overflow-y-auto pr-0.5">
            {selectedDayEvents.length > 0 ? (
              selectedDayEvents.map(evt => {
                const badge = getTypeBadge(evt.type);
                const IconComponent = badge.icon;
                return (
                  <div
                    key={evt.id}
                    data-testid={evt.type === 'workflow_deadline' ? 'calendar-workflow-deadline' : undefined}
                    className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5 hover:border-slate-700 transition-all shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md inline-flex items-center gap-1 ${badge.color}`}>
                          <IconComponent className="w-3 h-3" />
                          <span>{badge.label}</span>
                        </span>
                        <h5 className="text-xs font-bold text-slate-100 leading-snug">{evt.title}</h5>
                      </div>
                      {evt.status === 'urgent' && (
                        <span className="text-[9px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 px-1.5 py-0.5 rounded animate-pulse">
                          فوری
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {evt.description}
                    </p>

                    <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-slate-850">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span className="font-mono">{evt.time}</span>
                      </div>
                      <div className="flex items-center gap-1 truncate">
                        <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
                        <span className="truncate">{evt.location}</span>
                      </div>
                      <div className="col-span-2 flex items-center gap-1 truncate text-slate-400">
                        <Users className="w-3 h-3 text-slate-500 shrink-0" />
                        <span className="truncate">{evt.attendees}</span>
                      </div>
                    </div>

                    {currentUser?.role === 'admin' && !evt.readOnly && (
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => openEventEditor(evt)} className="action-secondary text-[11px] font-bold text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 py-1.5 rounded-lg flex items-center justify-center gap-1">
                          <Edit2 className="w-3.5 h-3.5" /> ویرایش
                        </button>
                        <button type="button" onClick={() => deleteEvent(evt)} className="action-danger text-[11px] font-bold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 py-1.5 rounded-lg flex items-center justify-center gap-1">
                          <Trash2 className="w-3.5 h-3.5" /> حذف
                        </button>
                      </div>
                    )}

                    {/* Quick navigation link */}
                    {evt.targetTab && onNavigate && (
                      <button
                        type="button"
                        onClick={() => onNavigate(evt.targetTab!)}
                        className="action-secondary w-full text-[11px] font-bold text-teal-400 hover:text-teal-300 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/20 py-1.5 px-3 rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer"
                      >
                        <span>ورود به بخش مربوطه</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="py-12 text-center text-slate-500 space-y-2">
                <CalendarDays className="w-8 h-8 text-slate-700 mx-auto" />
                <p className="text-xs font-semibold">هیچ سررسیدی برای این تاریخ ثبت نشده است.</p>
                <button
                  type="button"
                  onClick={() => {
                    setNewEventDate(selectedDate);
                    setIsAddModalOpen(true);
                  }}
                  className="text-[11px] font-bold text-teal-400 hover:underline inline-block mt-1"
                >
                  + ثبت سررسید جدید در این روز
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* =========================================================================
         ADD NEW EVENT MODAL
         ========================================================================= */}
      {isAddModalOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm layer-modal flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="calendar-event-dialog-title">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-teal-400" />
                <h3 id="calendar-event-dialog-title" className="text-sm font-bold text-slate-100">{editingEventId ? 'ویرایش رویداد تقویم' : 'ثبت سررسید یا رویداد جدید در تقویم'}</h3>
              </div>
              <IconButton label="بستن ویرایش رویداد" onClick={closeEventEditor} className="min-h-10 min-w-10">
                <X className="w-4 h-4" aria-hidden="true" />
              </IconButton>
            </div>

            <form onSubmit={handleCreateEvent} className="space-y-3 text-right">
              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1">عنوان سررسید یا جلسه</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: جلسه کالیبراسیون نمرات واحد ماشین‌کاری..."
                  value={newEventTitle}
                  onChange={(e) => setNewEventTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 focus:outline-none focus:border-teal-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">دسته‌بندی رویداد</label>
                  <select
                    value={newEventType}
                    onChange={(e) => setNewEventType(e.target.value as CalendarEventType)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-teal-500 cursor-pointer"
                  >
                    <option value="evaluation">سررسید ارزیابی</option>
                    <option value="calibration">کمیته کالیبراسیون</option>
                    <option value="okr">پایان دوره OKR</option>
                    <option value="one_on_one">جلسه ۱به۱ مربیگری</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">تاریخ سررسید (شمسی)</label>
                  <input
                    type="text"
                    required
                    placeholder="سال/ماه/روز"
                    value={newEventDate}
                    onChange={(e) => setNewEventDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 font-mono text-center focus:outline-none focus:border-teal-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">ساعت برگزاری</label>
                  <input
                    type="text"
                    placeholder="۱۰:۳۰"
                    value={newEventTime}
                    onChange={(e) => setNewEventTime(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 font-mono text-center focus:outline-none focus:border-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">محل یا لینک برگزاری</label>
                  <input
                    type="text"
                    placeholder="اتاق جلسات مدیریت تولید"
                    value={newEventLocation}
                    onChange={(e) => setNewEventLocation(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 focus:outline-none focus:border-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1">افراد یا واحدهای حاضر</label>
                <input
                  type="text"
                  placeholder="سرپرستان خط ۱ و ۲، مدیر منابع انسانی"
                  value={newEventAttendees}
                  onChange={(e) => setNewEventAttendees(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 focus:outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1">توضیحات و دستور جلسه</label>
                <textarea
                  rows={2}
                  placeholder="اقدامات لازم یا مستندات مورد نیاز برای جلسه..."
                  value={newEventDesc}
                  onChange={(e) => setNewEventDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 focus:outline-none focus:border-teal-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="secondary" className="text-xs" onClick={closeEventEditor}>
                  انصراف
                </Button>
                <Button variant="primary" type="submit" className="text-xs">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{editingEventId ? 'ذخیره ویرایش' : 'ثبت در تقویم'}</span>
                </Button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

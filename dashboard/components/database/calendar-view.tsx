'use client';

import { useState, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { STATUS_MAP, type StatusKey } from '@/lib/constants';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export interface CalendarViewProps<TData extends Record<string, unknown>> {
  data: TData[];
  dateField: string;
  titleField: string;
  statusField?: string;
  onDayClick?: (date: Date, items: TData[]) => void;
  onCardClick?: (row: TData) => void;
}

export function CalendarView<TData extends Record<string, unknown>>({
  data,
  dateField,
  titleField,
  statusField,
  onCardClick,
}: CalendarViewProps<TData>) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const prevMonth = useCallback(() => {
    setMonth((m) => {
      if (m === 0) { setYear((y) => y - 1); return 11; }
      return m - 1;
    });
  }, []);

  const nextMonth = useCallback(() => {
    setMonth((m) => {
      if (m === 11) { setYear((y) => y + 1); return 0; }
      return m + 1;
    });
  }, []);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, TData[]>();
    data.forEach((row) => {
      const val = row[dateField];
      if (!val) return;
      try {
        const d = new Date(String(val));
        if (isNaN(d.getTime())) return;
        if (d.getFullYear() !== year || d.getMonth() !== month) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(row);
      } catch { /* skip invalid dates */ }
    });
    return map;
  }, [data, dateField, year, month]);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const weeks: (number | null)[][] = [];
  let currentWeek: (number | null)[] = Array(firstDay).fill(null);

  for (let day = 1; day <= daysInMonth; day++) {
    currentWeek.push(day);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push(null);
    weeks.push(currentWeek);
  }

  const isToday = (d: number) =>
    d === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  const dateKey = (d: number) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading text-sm font-medium text-text-primary">
          {MONTHS[month]} {year}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={prevMonth}
            className="p-1.5 rounded hover:bg-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={nextMonth}
            className="p-1.5 rounded hover:bg-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        <div className="grid grid-cols-7 bg-surface border-b border-border">
          {DAYS.map((d) => (
            <div key={d} className="py-2 text-center text-xs font-heading uppercase tracking-wide text-text-muted">
              {d}
            </div>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-border/50 last:border-b-0">
            {week.map((day, di) => {
              if (!day) return <div key={di} className="min-h-24 bg-surface/30" />;
              const key = dateKey(day);
              const dayItems = itemsByDay.get(key) ?? [];
              const todayClass = isToday(day) ? 'bg-accent/10' : '';

              return (
                <div key={di} className={`min-h-24 p-1.5 border-r border-border/50 last:border-r-0 ${todayClass}`}>
                  <span className={`inline-flex items-center justify-center w-6 h-6 text-xs rounded-full ${
                    isToday(day) ? 'bg-accent text-bg-base font-semibold' : 'text-text-secondary'
                  }`}>
                    {day}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {dayItems.slice(0, 3).map((item, i) => {
                      const title = String(item[titleField] ?? '');
                      const status = statusField ? String(item[statusField] ?? '').toLowerCase() as StatusKey : null;
                      return (
                        <div
                          key={i}
                          onClick={() => onCardClick?.(item)}
                          className="text-xs px-1.5 py-0.5 rounded bg-elevated border border-border/50 text-text-primary truncate cursor-pointer hover:bg-hover transition-colors"
                        >
                          {status && STATUS_MAP[status] ? (
                            <span className="flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                status === 'healthy' ? 'bg-status-healthy' :
                                status === 'warning' ? 'bg-status-warning' :
                                status === 'critical' ? 'bg-status-critical' : 'bg-text-muted'
                              }`} />
                              {title}
                            </span>
                          ) : title}
                        </div>
                      );
                    })}
                    {dayItems.length > 3 && (
                      <span className="text-xs text-text-muted px-1.5">+{dayItems.length - 3} more</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

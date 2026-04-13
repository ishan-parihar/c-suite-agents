import { z } from "zod";

export const PERIOD_VALUES = ["past_day", "past_week", "past_month"] as const;
export type Period = (typeof PERIOD_VALUES)[number];

export interface ResolvedDateRange {
  date_from: string;
  date_to: string;
  date_from_ts: string;
  date_to_ts: string;
  label: string;
  rangeLabel: string;
  calendarDays: number;
}

const PERIOD_DAYS: Record<Period, number> = {
  past_day: 1,
  past_week: 7,
  past_month: 30,
};

const PERIOD_DESCRIPTIONS: Record<Period, string> = {
  past_day: "past_day: midnight of yesterday → now (2 calendar days: yesterday + today)",
  past_week: "past_week: midnight of 7 days ago → now (8 calendar days: 7 full days + today)",
  past_month: "past_month: midnight of 30 days ago → now (31 calendar days: 30 full days + today)",
};

export const PERIOD_PARAM = z
  .enum(PERIOD_VALUES)
  .optional()
  .describe(
    "Time period preset. " +
    "past_day: midnight of yesterday → now (2 calendar days: yesterday + today). " +
    "past_week: midnight of 7 days ago → now (8 calendar days: 7 full days + today). " +
    "past_month: midnight of 30 days ago → now (31 calendar days: 30 full days + today). " +
    "Always includes today up to the current moment. Overrides date_from/date_to."
  );

export const DATE_FROM_PARAM = z
  .string()
  .optional()
  .describe("Start date (YYYY-MM-DD). If omitted, defaults to 7 days ago.");

export const DATE_TO_PARAM = z
  .string()
  .optional()
  .describe("End date (YYYY-MM-DD). If omitted, defaults to today.");

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function computeCalendarDays(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)) + 1);
}

export function resolveDates(
  period?: Period,
  date_from?: string,
  date_to?: string
): ResolvedDateRange {
  const now = new Date();

  if (period) {
    const days = PERIOD_DAYS[period];
    const start = startOfDay(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
    const from = toISODate(start);
    const to = toISODate(now);
    const calendarDays = computeCalendarDays(from, to);

    return {
      date_from: from,
      date_to: to,
      date_from_ts: start.toISOString(),
      date_to_ts: now.toISOString(),
      label: period,
      rangeLabel: `${from} → ${to} (${period}, ${calendarDays}d)`,
      calendarDays,
    };
  }

  const from = date_from || toISODate(startOfDay(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)));
  const to = date_to || toISODate(now);
  const calendarDays = computeCalendarDays(from, to);

  return {
    date_from: from,
    date_to: to,
    date_from_ts: `${from}T00:00:00.000Z`,
    date_to_ts: date_to ? `${to}T23:59:59.000Z` : now.toISOString(),
    label: "custom",
    rangeLabel: `${from} → ${to} (${calendarDays}d)`,
    calendarDays,
  };
}

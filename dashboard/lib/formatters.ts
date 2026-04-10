import { format, formatDistanceToNow, isValid } from "date-fns";

export function formatDate(date: Date | string | null | undefined, pattern = "yyyy-MM-dd"): string {
  if (!date) return "\u2014";
  const d = typeof date === "string" ? new Date(date) : date;
  if (!isValid(d)) return "\u2014";
  return format(d, pattern);
}

export function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return "\u2014";
  const d = typeof date === "string" ? new Date(date) : date;
  if (!isValid(d)) return "\u2014";
  return formatDistanceToNow(d, { addSuffix: true });
}

export function formatCurrency(amount: number | null | undefined, currency = "\u20B9"): string {
  if (amount == null) return "\u2014";
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  return `${sign}${currency}${abs.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "\u2014";
  return `${value.toFixed(1)}%`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "\u2014";
  return n.toLocaleString("en-IN");
}

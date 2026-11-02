import type { IsoDate, IsoDateTime } from "@scope/contracts";

const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Parse an ISO date (YYYY-MM-DD) as a local calendar date. */
export function parseIsoDate(value: IsoDate): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Difference in whole days between today and the given ISO date. */
export function daysUntil(value: IsoDate, now = new Date()): number {
  return Math.round((startOfDay(parseIsoDate(value)).getTime() - startOfDay(now).getTime()) / DAY_MS);
}

export function isOverdue(value: IsoDate | null, now = new Date()): boolean {
  return value !== null && daysUntil(value, now) < 0;
}

/** "Today", "Tomorrow", "In 3 days", "2 days ago", or a short date. */
export function formatDueDate(value: IsoDate | null, now = new Date()): string {
  if (!value) return "No due date";
  const diff = daysUntil(value, now);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff <= 7) return `In ${diff} days`;
  if (diff < -1 && diff >= -7) return `${Math.abs(diff)} days ago`;
  return formatShortDate(value);
}

export function formatShortDate(value: IsoDate | IsoDateTime | null): string {
  if (!value) return "—";
  const date = value.length === 10 ? parseIsoDate(value) : new Date(value);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function formatLongDate(value: IsoDate | IsoDateTime | null): string {
  if (!value) return "—";
  const date = value.length === 10 ? parseIsoDate(value) : new Date(value);
  return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(date);
}

/** "Nov 2, 2026, 10:22 AM" — used wherever a logged timestamp must be exact. */
export function formatDateTime(value: IsoDateTime | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

/** "10:22 AM" */
export function formatTime(value: IsoDateTime): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

/** Relative time for activity feeds: "just now", "5m ago", "3h ago", "2d ago". */
export function formatRelative(value: IsoDateTime, now = new Date()): string {
  const diffMs = now.getTime() - new Date(value).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatShortDate(value);
}

export function toIsoDate(d: Date): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

import {
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  isSameMonth,
  isSameYear,
  isValid,
  parseISO,
} from "date-fns";
import { DEFAULT_CURRENCY } from "@/lib/constants";
import { toNumber } from "@/lib/utils";

export type DateInput = Date | string | number | null | undefined;

/**
 * MySQL hands back "2026-07-25" and "2026-07-25 14:30:00". The space form is
 * not valid ISO-8601, and `new Date()` parses it inconsistently across engines
 * (Safari returns Invalid Date), so normalise before parsing.
 */
export function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return isValid(value) ? value : null;
  if (typeof value === "number") {
    const d = new Date(value);
    return isValid(d) ? d : null;
  }

  const raw = value.trim();
  // "0000-00-00" is MySQL's zero date and means "not set".
  if (raw === "" || raw.startsWith("0000-00-00")) return null;

  const iso = raw.includes(" ") && !raw.includes("T") ? raw.replace(" ", "T") : raw;
  const parsed = parseISO(iso);
  return isValid(parsed) ? parsed : null;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

// Intl.NumberFormat construction is measurably slow and money renders in every
// table cell, so formatters are built once per currency/precision combination.
const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string, decimals: number): Intl.NumberFormat {
  const key = `${currency}:${decimals}`;
  let fmt = moneyFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    moneyFormatters.set(key, fmt);
  }
  return fmt;
}

export interface MoneyOptions {
  /** Drop the ".00" tail when the amount is whole. Default false. */
  compactZeros?: boolean;
  /** Render null/undefined as this. Default "—". */
  placeholder?: string;
}

/**
 * `formatMoney(125000)` -> "₹1,25,000.00" (en-IN grouping: lakh/crore).
 * Accepts strings because DECIMAL columns arrive as strings over JSON.
 */
export function formatMoney(
  value: number | string | null | undefined,
  currency: string = DEFAULT_CURRENCY,
  options: MoneyOptions = {},
): string {
  const { compactZeros = false, placeholder = "—" } = options;
  if (value === null || value === undefined || value === "") return placeholder;

  const amount = toNumber(value, Number.NaN);
  if (!Number.isFinite(amount)) return placeholder;

  const decimals = compactZeros && Number.isInteger(amount) ? 0 : 2;
  return moneyFormatter(currency, decimals).format(amount);
}

/** Bare grouped number, no symbol — for chart axes and CSV-ish cells. */
export function formatNumber(value: number | string | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = toNumber(value, Number.NaN);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/** "₹12.5L" / "₹1.2Cr" — for stat tiles where the full figure will not fit. */
export function formatMoneyShort(
  value: number | string | null | undefined,
  currency: string = DEFAULT_CURRENCY,
): string {
  const n = toNumber(value, Number.NaN);
  if (!Number.isFinite(n)) return "—";

  const symbol = currency === "INR" ? "₹" : `${currency} `;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";

  if (abs >= 1_00_00_000) return `${sign}${symbol}${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}${symbol}${(abs / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(1)}K`;
  return formatMoney(n, currency, { compactZeros: true });
}

export function formatPercent(value: number | string | null | undefined, decimals = 1): string {
  const n = toNumber(value, Number.NaN);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(decimals)}%`;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export const DATE_FORMAT = "dd MMM yyyy";
export const DATETIME_FORMAT = "dd MMM yyyy, h:mm a";

export function formatDate(value: DateInput, pattern: string = DATE_FORMAT): string {
  const d = toDate(value);
  return d ? format(d, pattern) : "—";
}

export function formatDateTime(value: DateInput, pattern: string = DATETIME_FORMAT): string {
  const d = toDate(value);
  return d ? format(d, pattern) : "—";
}

/** ISO date for API payloads and <input type="date">. */
export function toISODate(value: DateInput): string | null {
  const d = toDate(value);
  return d ? format(d, "yyyy-MM-dd") : null;
}

/**
 * Collapses shared parts of the range:
 *   same month -> "12 – 18 Aug 2026"
 *   same year  -> "28 Aug – 3 Sep 2026"
 *   otherwise  -> "28 Dec 2026 – 3 Jan 2027"
 */
export function formatDateRange(from: DateInput, to: DateInput): string {
  const start = toDate(from);
  const end = toDate(to);

  if (!start && !end) return "—";
  if (start && !end) return format(start, DATE_FORMAT);
  if (!start && end) return format(end, DATE_FORMAT);
  if (!start || !end) return "—"; // unreachable, narrows for TS

  if (start.getTime() === end.getTime()) return format(start, DATE_FORMAT);
  if (isSameMonth(start, end) && isSameYear(start, end)) {
    return `${format(start, "d")} – ${format(end, "d MMM yyyy")}`;
  }
  if (isSameYear(start, end)) {
    return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;
  }
  return `${format(start, DATE_FORMAT)} – ${format(end, DATE_FORMAT)}`;
}

/** "3 days ago" / "in 2 months". */
export function relativeTime(value: DateInput): string {
  const d = toDate(value);
  return d ? formatDistanceToNowStrict(d, { addSuffix: true }) : "—";
}

/** Hotel nights, i.e. calendar days between check-in and check-out. */
export function nightsBetween(from: DateInput, to: DateInput): number {
  const start = toDate(from);
  const end = toDate(to);
  if (!start || !end) return 0;
  return Math.max(0, differenceInCalendarDays(end, start));
}

/** Trip length in days — a 3-night trip is 4 days. */
export function daysBetween(from: DateInput, to: DateInput): number {
  const nights = nightsBetween(from, to);
  return nights === 0 ? 0 : nights + 1;
}

/** Negative when the date is in the past — drives overdue badges. */
export function daysUntil(value: DateInput): number | null {
  const d = toDate(value);
  return d ? differenceInCalendarDays(d, new Date()) : null;
}

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

/** `formatPax(2, 1, 1)` -> "2A · 1C · 1I". Zero counts are omitted. */
export function formatPax(adults: number, children = 0, infants = 0): string {
  const parts: string[] = [];
  if (adults > 0) parts.push(`${adults}A`);
  if (children > 0) parts.push(`${children}C`);
  if (infants > 0) parts.push(`${infants}I`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export function totalPax(adults: number, children = 0, infants = 0): number {
  return adults + children + infants;
}

/** "3N / 4D" — the standard way tour durations are quoted in this market. */
export function formatDuration(nights: number): string {
  if (nights <= 0) return "—";
  return `${nights}N / ${nights + 1}D`;
}

/** +91 98765 43210 for the 10-digit Indian numbers the CRM stores. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return value;
}

/** Bytes -> "2.4 MB", for the attachments list. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

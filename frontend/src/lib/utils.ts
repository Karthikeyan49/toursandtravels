import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** "Ravi Kumar Menon" -> "RM". Used by avatars and voucher stamps. */
export function initials(name: string | null | undefined, max = 2): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const picked = parts.length === 1 ? [parts[0]] : [parts[0], parts[parts.length - 1]];
  return picked
    .slice(0, max)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
}

/** "confirmed_by_ops" / "confirmed-by-ops" -> "Confirmed by ops". */
export function humanize(value: string | null | undefined): string {
  if (!value) return "";
  const spaced = value.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Normalise any status-ish string to a lowercase, dash-free slug. */
export function slugifyStatus(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

/** Coerce API numerics — MySQL DECIMAL columns arrive as strings over JSON. */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/** Money comparison tolerance, mirroring the backend Money helper's EPSILON. */
const MONEY_EPSILON = 0.005;

export function moneyEquals(a: number, b: number): boolean {
  return Math.abs(a - b) < MONEY_EPSILON;
}

export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/** Stable sort helper for client-side table sorting. */
export function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (isBlank(a)) return 1; // blanks always sink
  if (isBlank(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** Download a blob the browser has already built (CSV/XLSX/PDF exports). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick — Safari cancels the download if the URL dies first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Scalar aliases shared by every API module.
 *
 * Entity types live beside the module that owns them; only the cross-cutting
 * primitives — the ones every table repeats — live here, so a DECIMAL column is
 * described the same way in `bookings.ts` and in `expenses.ts`.
 */

/**
 * MySQL DECIMAL columns arrive as JSON strings ("12500.00") because PDO does not
 * cast them, while values that pass through the PHP `Money` helper arrive as
 * numbers. Every money field is therefore both — `formatMoney` and `toNumber`
 * accept the union directly.
 */
export type Decimal = number | string;

/** "2026-07-25" */
export type ISODate = string;

/** "2026-07-25 14:30:00" — MySQL DATETIME/TIMESTAMP, not ISO-8601. */
export type ISODateTime = string;

/** "14:00:00" */
export type TimeString = string;

/** MySQL TINYINT(1). PDO hands these back as 0/1, occasionally as "0"/"1". */
export type Flag = 0 | 1;

export type SortDir = "asc" | "desc";

/** Severity vocabulary shared by alerts, notifications and ops blockers. */
export type Severity = "info" | "warning" | "critical";

/** Rows returned by an endpoint that answers with a bare array, not a page. */
export type Options = readonly OptionRow[];

export interface OptionRow {
  id: number;
  name: string;
}

/**
 * Cross-cutting constants. Anything an operator can change without a deploy
 * lives in the backend `settings` table, not here — this file holds only the
 * values the UI itself is built around.
 */

export const APP_NAME = import.meta.env.VITE_APP_NAME ?? "Tours & Travel ERP";
export const DEFAULT_CURRENCY = import.meta.env.VITE_DEFAULT_CURRENCY ?? "INR";

/** localStorage keys — one namespace so a stale key is easy to spot. */
export const STORAGE_KEYS = {
  session: "tt_session",
  activeModule: "tt_active_module",
  theme: "tt_theme",
  sidebarCollapsed: "tt_sidebar_collapsed",
} as const;

/** Window events the app dispatches on itself. */
export const APP_EVENTS = {
  authExpired: "tt:auth-expired",
} as const;

export const PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

/** Debounce for search inputs that hit the API on every keystroke. */
export const SEARCH_DEBOUNCE_MS = 350;

// ---------------------------------------------------------------------------
// Domain vocabularies. These mirror the backend ENUM columns; keeping them here
// means a select and a StatusBadge can never drift apart.
// ---------------------------------------------------------------------------

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "proposal_sent",
  "negotiation",
  "won",
  "lost",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const QUOTATION_STATUSES = ["draft", "sent", "revised", "accepted", "rejected", "expired"] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const BOOKING_STATUSES = [
  "draft",
  "pending",
  "confirmed",
  "vouchered",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const PAYMENT_STATUSES = ["unpaid", "partial", "paid", "overdue", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_MODES = [
  "cash",
  "upi",
  "bank_transfer",
  "cheque",
  "card",
  "wallet",
  "adjustment",
] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const SUPPLIER_BILL_STATUSES = ["draft", "pending", "approved", "paid", "overdue", "disputed"] as const;

export const TRIP_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;

export const VOUCHER_STATUSES = ["draft", "issued", "confirmed", "cancelled"] as const;

export const SUPPLIER_TYPES = [
  "hotel",
  "transport",
  "airline",
  "activity",
  "guide",
  "visa",
  "insurance",
  "dmc",
  "other",
] as const;

export const ROOM_TYPES = ["single", "double", "twin", "triple", "quad", "suite", "dormitory"] as const;

export const MEAL_PLANS = ["EP", "CP", "MAP", "AP", "AI"] as const;

/** Long-form labels for the meal-plan codes printed on vouchers. */
export const MEAL_PLAN_LABELS: Record<(typeof MEAL_PLANS)[number], string> = {
  EP: "Room only",
  CP: "Breakfast",
  MAP: "Breakfast + 1 meal",
  AP: "All meals",
  AI: "All inclusive",
};

export const STAFF_ROLES = [
  "owner",
  "manager",
  "sales",
  "operations",
  "accounts",
  "visa",
  "support",
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Recharts series colours — index into the chart-* theme tokens. */
export const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
] as const;

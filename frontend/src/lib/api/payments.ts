import { apiGet, apiPost, buildQuery } from "@/lib/api/client";
import type { Decimal, ISODate, ISODateTime } from "@/lib/api/common";
import type { BookingDetail } from "@/lib/api/bookings";

/**
 * The polymorphic payment ledger — one table behind booking advances,
 * instalments, invoice receipts, supplier payouts and refunds.
 *
 * A row with `status: "scheduled"` and no `paid_on` is a planned instalment,
 * not money in the bank; only `status: "paid"` rows move a balance.
 */

export const PAYMENT_REF_TYPES = [
  "booking",
  "invoice",
  "supplier_bill",
  "commission",
  "refund",
  "expense",
] as const;
export type PaymentRefType = (typeof PAYMENT_REF_TYPES)[number];

export const PAYMENT_MODES = [
  "cash",
  "bank_transfer",
  "upi",
  "cheque",
  "card",
  "wallet",
  "adjustment",
  "online_gateway",
] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** Modes the API insists on a UTR / cheque / reference number for. */
export const PAYMENT_MODES_NEEDING_REFERENCE: readonly PaymentMode[] = ["bank_transfer", "upi", "cheque"];

export const PAYMENT_STATUSES = ["scheduled", "paid", "bounced", "void"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type PaymentDirection = "in" | "out";

export interface Payment {
  id: number;
  payment_no: string;
  ref_type: PaymentRefType;
  ref_id: number;
  /** Instalment number within the reference. */
  seq: number;
  label: string | null;
  direction: PaymentDirection;
  amount: Decimal;
  currency: string;
  fx_rate: Decimal;
  mode: PaymentMode;
  utr_no: string | null;
  bank_account: string | null;
  gateway_ref: string | null;
  due_on: ISODate | null;
  paid_on: ISODate | null;
  status: PaymentStatus;
  remarks: string | null;
  voided_by: number | null;
  voided_at: ISODateTime | null;
  void_reason: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
  recorded_by?: string | null;
}

export interface BookingLedger {
  payments: Payment[];
  grand_total: number;
  received: number;
  scheduled: number;
  outstanding: number;
  status: string;
}

export interface DaybookEntry {
  id: number;
  payment_no: string;
  ref_type: PaymentRefType;
  ref_id: number;
  label: string | null;
  direction: PaymentDirection;
  amount: Decimal;
  mode: PaymentMode;
  utr_no: string | null;
  paid_on: ISODate | null;
  remarks: string | null;
  /** Booking / invoice / bill number the entry settles. */
  ref_no: string | null;
  recorded_by?: string | null;
}

export interface DaybookModeTotal {
  mode: PaymentMode;
  in: number;
  out: number;
}

export interface Daybook {
  entries: DaybookEntry[];
  summary: {
    from: ISODate;
    to: ISODate;
    total_in: number;
    total_out: number;
    net: number;
    by_mode: DaybookModeTotal[];
  };
}

export interface RecordPaymentInput {
  amount: number;
  mode?: PaymentMode;
  utr_no?: string | null;
  bank_account?: string | null;
  gateway_ref?: string | null;
  paid_on?: ISODate | null;
  label?: string | null;
  remarks?: string | null;
  direction?: PaymentDirection;
}

export interface InstalmentInput {
  amount: number;
  due_on?: ISODate | null;
  label?: string | null;
}

export interface MarkPaidInput {
  paid_on?: ISODate | null;
  mode?: PaymentMode;
  utr_no?: string | null;
  bank_account?: string | null;
  remarks?: string | null;
}

export interface RecordBookingPaymentResult {
  payment: Payment;
  booking: BookingDetail;
}

export type DaybookFilters = {
  from?: ISODate;
  to?: ISODate;
  mode?: PaymentMode;
};

export async function getBookingLedger(bookingId: number) {
  return apiGet<BookingLedger>(`/bookings/${bookingId}/payments`);
}

export async function recordBookingPayment(bookingId: number, input: RecordPaymentInput) {
  return apiPost<RecordBookingPaymentResult>(`/bookings/${bookingId}/payments`, input);
}

/** Replaces any existing *scheduled* rows; received payments are untouched. */
export async function scheduleInstalments(bookingId: number, instalments: InstalmentInput[]) {
  return apiPost<Payment[]>(`/bookings/${bookingId}/payment-plan`, { instalments });
}

export async function markPaymentPaid(paymentId: number, input: MarkPaidInput = {}) {
  return apiPost<Payment>(`/payments/${paymentId}/mark-paid`, input);
}

export async function voidPayment(paymentId: number, reason: string) {
  return apiPost<Payment>(`/payments/${paymentId}/void`, { reason });
}

export async function getDaybook(params: DaybookFilters = {}) {
  return apiGet<Daybook>(`/payments/daybook${buildQuery(params)}`);
}

/** True when the API will reject the payment without a reference number. */
export function requiresReference(mode: PaymentMode): boolean {
  return PAYMENT_MODES_NEEDING_REFERENCE.includes(mode);
}

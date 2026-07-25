import { apiGet, apiList, apiPost, buildQuery } from "@/lib/api/client";
import type { Decimal, Flag, ISODate, ISODateTime, SortDir } from "@/lib/api/common";
import type { CompanyProfile } from "@/lib/api/settings";
import type { Payment } from "@/lib/api/payments";

/**
 * Sales invoices — the receivable side.
 *
 * `invoice_type` carries two legally distinct documents: a GST `tax_invoice`
 * and a Non-GST `cash_bill`, selected explicitly per document, never merged.
 * `is_gst_applicable` says which regime applied at the time it was raised —
 * a cash bill must never show GST/CGST/SGST/IGST rows, tax_invoice always
 * does. `proforma`/`credit_note`/`debit_note` exist in the schema but are not
 * raised from a booking the way the other two are.
 */

export const INVOICE_TYPES = ["tax_invoice", "cash_bill", "proforma", "credit_note", "debit_note"] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const INVOICE_STATUSES = ["draft", "issued", "sent", "paid", "cancelled", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_PAYMENT_STATUSES = ["unpaid", "partially_paid", "paid", "overdue", "written_off"] as const;
export type InvoicePaymentStatus = (typeof INVOICE_PAYMENT_STATUSES)[number];

export interface InvoiceItem {
  id: number;
  invoice_id: number;
  description: string;
  sac_code: string | null;
  quantity: Decimal;
  unit: string;
  unit_price: Decimal;
  discount_pct: Decimal;
  taxable_value: Decimal;
  gst_pct: Decimal;
  gst_amount: Decimal;
  line_total: Decimal;
  sort_order: number;
}

export interface Invoice {
  id: number;
  invoice_no: string;
  booking_id: number | null;
  customer_id: number;
  agency_id: number | null;
  invoice_type: InvoiceType;
  /** A cash bill always carries 0 here; a tax invoice always carries 1. */
  is_gst_applicable: Flag;
  invoice_date: ISODate;
  due_date: ISODate | null;
  place_of_supply: string | null;
  seller_state: string | null;
  customer_state: string | null;
  customer_gstin: string | null;
  currency: string;
  fx_rate: Decimal;
  subtotal: Decimal;
  discount_amount: Decimal;
  taxable_amount: Decimal;
  cgst_amount: Decimal;
  sgst_amount: Decimal;
  igst_amount: Decimal;
  tcs_amount: Decimal;
  round_off: Decimal;
  grand_total: Decimal;
  amount_paid: Decimal;
  payment_status: InvoicePaymentStatus;
  last_payment_at: ISODateTime | null;
  status: InvoiceStatus;
  notes: string | null;
  terms: string | null;
  voided_by: number | null;
  voided_at: ISODateTime | null;
  void_reason: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
}

export interface InvoiceListItem extends Invoice {
  outstanding: Decimal;
  customer_name: string | null;
  customer_phone: string | null;
  booking_no: string | null;
  travel_from: ISODate | null;
  days_overdue: number | null;
}

export interface InvoiceDetail extends Invoice {
  outstanding: Decimal;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address: string | null;
  customer_city: string | null;
  customer_pincode: string | null;
  booking_no: string | null;
  travel_from: ISODate | null;
  travel_to: ISODate | null;
  adults: number | null;
  children: number | null;
  destination_name: string | null;
  package_name: string | null;
  items: InvoiceItem[];
  payments: Payment[];
  company: CompanyProfile;
  amount_in_words: string;
}

export type InvoiceFilters = {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  dir?: SortDir;
  status?: InvoiceStatus;
  payment_status?: InvoicePaymentStatus;
  customer_id?: number;
  booking_id?: number;
  from?: ISODate;
  to?: ISODate;
  overdue?: boolean;
  /** Client-side only: the API does not filter by invoice_type, so the page
   *  narrows the fetched page's rows itself when this is set. */
  invoice_type?: InvoiceType;
};

export interface RaiseInvoiceInput {
  invoice_date?: ISODate;
  due_days?: number;
  notes?: string;
  terms?: string;
  /** Only tax_invoice/proforma are valid here — a cash bill goes through raiseCashBill. */
  invoice_type?: Extract<InvoiceType, "tax_invoice" | "proforma">;
}

export interface RaiseCashBillInput {
  invoice_date?: ISODate;
  due_days?: number;
  notes?: string;
  terms?: string;
}

export interface RecordInvoicePaymentInput {
  amount: number;
  mode?: string;
  utr_no?: string | null;
  bank_account?: string | null;
  paid_on?: ISODate | null;
  remarks?: string | null;
}

export interface RecordInvoicePaymentResult {
  payment: Payment;
  invoice: InvoiceDetail;
}

export async function listInvoices(params: InvoiceFilters = {}) {
  // invoice_type is not a backend filter param yet; strip it from the query
  // string and let callers filter the returned page client-side.
  const { invoice_type: _invoiceType, ...serverParams } = params;
  return apiList<InvoiceListItem>(`/invoices${buildQuery(serverParams)}`);
}

export async function getInvoice(id: number) {
  return apiGet<InvoiceDetail>(`/invoices/${id}`);
}

/** Raises a GST tax invoice (or proforma) from a confirmed booking. */
export async function raiseInvoice(bookingId: number, input: RaiseInvoiceInput = {}) {
  return apiPost<InvoiceDetail>(`/bookings/${bookingId}/invoice`, input);
}

/**
 * Raises a Non-GST cash bill from a confirmed booking.
 *
 * NOTE: as of this writing, `POST /bookings/{id}/cash-bill` is being added to
 * FinanceController in parallel with this module (see raiseInvoice() in
 * api/controllers/FinanceController.php, which this sits beside). Calling
 * this before that lands will 404 — the frontend contract is wired ahead of
 * the endpoint so no second frontend change is needed once it ships.
 */
export async function raiseCashBill(bookingId: number, input: RaiseCashBillInput = {}) {
  return apiPost<InvoiceDetail>(`/bookings/${bookingId}/cash-bill`, input);
}

export async function recordInvoicePayment(invoiceId: number, input: RecordInvoicePaymentInput) {
  return apiPost<RecordInvoicePaymentResult>(`/invoices/${invoiceId}/payments`, input);
}

export async function voidInvoice(id: number, reason: string) {
  return apiPost<InvoiceDetail>(`/invoices/${id}/void`, { reason });
}

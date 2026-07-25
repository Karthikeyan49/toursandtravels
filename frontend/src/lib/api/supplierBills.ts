import { apiGet, apiList, apiPost, buildQuery } from "@/lib/api/client";
import type { Decimal, ISODate, ISODateTime, SortDir } from "@/lib/api/common";
import type { Payment } from "@/lib/api/payments";

/**
 * Payables — bills raised against a supplier, optionally against a booking.
 * Like every financial document here, a wrong bill is voided (with a reason),
 * never deleted; `draft` is the only status that may still be edited before
 * approval freezes it against a booking's margin calculation.
 */

export const SUPPLIER_BILL_STATUSES = ["draft", "approved", "paid", "cancelled", "void"] as const;
export type SupplierBillStatus = (typeof SUPPLIER_BILL_STATUSES)[number];

export const SUPPLIER_BILL_PAYMENT_STATUSES = ["unpaid", "partially_paid", "paid", "overdue", "disputed"] as const;
export type SupplierBillPaymentStatus = (typeof SUPPLIER_BILL_PAYMENT_STATUSES)[number];

export interface SupplierBillItem {
  id: number;
  supplier_bill_id: number;
  booking_service_id: number | null;
  description: string;
  quantity: Decimal;
  unit_cost: Decimal;
  tax_pct: Decimal;
  line_total: Decimal;
  sort_order: number;
}

export interface SupplierBill {
  id: number;
  bill_no: string;
  supplier_ref_no: string | null;
  supplier_id: number;
  booking_id: number | null;
  bill_date: ISODate;
  due_date: ISODate | null;
  currency: string;
  fx_rate: Decimal;
  subtotal: Decimal;
  tax_amount: Decimal;
  tds_amount: Decimal;
  grand_total: Decimal;
  amount_paid: Decimal;
  payment_status: SupplierBillPaymentStatus;
  status: SupplierBillStatus;
  approved_by: number | null;
  approved_at: ISODateTime | null;
  notes: string | null;
  voided_by: number | null;
  voided_at: ISODateTime | null;
  void_reason: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
}

export interface SupplierBillListItem extends SupplierBill {
  outstanding: Decimal;
  supplier_name: string;
  supplier_type: string;
  booking_no: string | null;
  travel_from: ISODate | null;
  days_overdue: number | null;
}

export interface SupplierBillDetail extends SupplierBill {
  outstanding: Decimal;
  supplier_name: string;
  supplier_gstin: string | null;
  booking_no: string | null;
  items: SupplierBillItem[];
  payments: Payment[];
}

export type SupplierBillFilters = {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  dir?: SortDir;
  supplier_id?: number;
  booking_id?: number;
  payment_status?: SupplierBillPaymentStatus;
  due_only?: boolean;
  from?: ISODate;
  to?: ISODate;
};

export interface SupplierBillItemInput {
  description: string;
  unit_cost: number;
  booking_service_id?: number | null;
  quantity?: number;
  tax_pct?: number;
}

export interface SupplierBillInput {
  supplier_id: number;
  bill_date: ISODate;
  items: SupplierBillItemInput[];
  supplier_ref_no?: string | null;
  booking_id?: number | null;
  due_date?: ISODate | null;
  currency?: string;
  fx_rate?: number;
  tds_amount?: number;
  notes?: string | null;
}

export interface PaySupplierBillInput {
  amount: number;
  mode?: string;
  utr_no?: string | null;
  bank_account?: string | null;
  paid_on?: ISODate | null;
  remarks?: string | null;
}

export interface PaySupplierBillResult {
  payment: Payment;
  bill: SupplierBillDetail;
}

export async function listSupplierBills(params: SupplierBillFilters = {}) {
  return apiList<SupplierBillListItem>(`/supplier-bills${buildQuery(params)}`);
}

export async function getSupplierBill(id: number) {
  return apiGet<SupplierBillDetail>(`/supplier-bills/${id}`);
}

export async function createSupplierBill(input: SupplierBillInput) {
  return apiPost<SupplierBillDetail>("/supplier-bills", input);
}

/** Only a draft bill may be approved; approval is the gate before payment. */
export async function approveSupplierBill(id: number) {
  return apiPost<SupplierBillDetail>(`/supplier-bills/${id}/approve`);
}

export async function paySupplierBill(id: number, input: PaySupplierBillInput) {
  return apiPost<PaySupplierBillResult>(`/supplier-bills/${id}/payments`, input);
}

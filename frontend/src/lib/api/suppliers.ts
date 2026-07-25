import { apiDelete, apiGet, apiList, apiPost, apiPut, buildQuery } from "@/lib/api/client";
import type { Decimal, Flag, ISODate, ISODateTime, SortDir } from "@/lib/api/common";
import type { PaymentMode, PaymentStatus } from "@/lib/api/payments";

/** Suppliers — every vendor the agency buys from, plus their bill/payment ledger. */

export const SUPPLIER_TYPES = [
  "hotel",
  "transport",
  "activity",
  "dmc",
  "airline",
  "visa",
  "insurance",
  "guide",
  "other",
] as const;
export type SupplierType = (typeof SUPPLIER_TYPES)[number];

export interface Supplier {
  id: number;
  code: string;
  name: string;
  supplier_type: SupplierType;
  destination_id: number | null;
  contact_person: string | null;
  phone: string | null;
  alt_phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country_id: number | null;
  gstin: string | null;
  pan: string | null;
  currency: string;
  credit_days: number;
  credit_limit: Decimal;
  bank_name: string | null;
  bank_account: string | null;
  bank_ifsc: string | null;
  /** 0.00–5.00, recomputed from post-tour feedback and incidents. */
  rating: Decimal | null;
  notes: string | null;
  is_active: Flag;
  is_deleted: Flag;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
}

export interface SupplierListItem extends Supplier {
  destination_name: string | null;
  total_billed: Decimal;
  total_paid: Decimal;
  outstanding: Decimal;
}

export interface SupplierOption {
  id: number;
  code: string;
  name: string;
  supplier_type: SupplierType;
  currency: string;
  credit_days: number;
}

export interface SupplierLedgerBill {
  id: number;
  bill_no: string;
  supplier_ref_no: string | null;
  bill_date: ISODate;
  due_date: ISODate | null;
  grand_total: Decimal;
  amount_paid: Decimal;
  payment_status: string;
  status: string;
  booking_no: string | null;
}

export interface SupplierLedgerPayment {
  id: number;
  payment_no: string;
  amount: Decimal;
  mode: PaymentMode;
  utr_no: string | null;
  paid_on: ISODate | null;
  status: PaymentStatus;
  remarks: string | null;
  bill_no: string | null;
}

export interface SupplierLedger {
  bills: SupplierLedgerBill[];
  payments: SupplierLedgerPayment[];
}

export interface SupplierDetail extends Supplier {
  ledger: SupplierLedger;
}

export type SupplierFilters = {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  dir?: SortDir;
  supplier_type?: SupplierType;
  destination_id?: number;
  is_active?: boolean;
};

export type SupplierOptionFilters = {
  type?: SupplierType;
  destination_id?: number;
};

export type SupplierLedgerFilters = {
  from?: ISODate;
  to?: ISODate;
};

export interface SupplierInput {
  name: string;
  supplier_type: SupplierType;
  code?: string | null;
  destination_id?: number | null;
  contact_person?: string | null;
  phone?: string | null;
  alt_phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country_id?: number | null;
  gstin?: string | null;
  pan?: string | null;
  currency?: string;
  credit_days?: number;
  credit_limit?: number;
  bank_name?: string | null;
  bank_account?: string | null;
  bank_ifsc?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export type SupplierUpdateInput = Partial<SupplierInput>;

export async function listSuppliers(params: SupplierFilters = {}) {
  return apiList<SupplierListItem>(`/suppliers${buildQuery(params)}`);
}

export async function listSupplierOptions(params: SupplierOptionFilters = {}) {
  return apiGet<SupplierOption[]>(`/suppliers/options${buildQuery(params)}`);
}

export async function getSupplier(id: number, params: SupplierLedgerFilters = {}) {
  return apiGet<SupplierDetail>(`/suppliers/${id}${buildQuery(params)}`);
}

export async function createSupplier(input: SupplierInput) {
  return apiPost<Supplier>("/suppliers", input);
}

export async function updateSupplier(id: number, input: SupplierUpdateInput) {
  return apiPut<Supplier>(`/suppliers/${id}`, input);
}

/** Soft delete — refused while the supplier still has an outstanding balance. */
export async function archiveSupplier(id: number) {
  return apiDelete<null>(`/suppliers/${id}`);
}

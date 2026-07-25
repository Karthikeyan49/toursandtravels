import { apiGet, apiList, apiPost, apiPut, buildQuery } from "@/lib/api/client";
import type { Decimal, Flag, ISODate, ISODateTime, SortDir } from "@/lib/api/common";
import type { Payment } from "@/lib/api/payments";

/**
 * Overheads and booking-attached direct costs.
 *
 * `total_amount` is always `amount + tax_amount`, recomputed server-side — the
 * client never posts a total directly. There is no DELETE: a wrong expense is
 * voided (with a reason) and stays in the ledger.
 */

export const EXPENSE_MODES = ["cash", "bank_transfer", "upi", "cheque", "card"] as const;
export type ExpenseMode = (typeof EXPENSE_MODES)[number];

export const EXPENSE_STATUSES = ["draft", "submitted", "approved", "rejected", "paid", "void"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

/** Only these may still be edited; approval freezes the document. */
export const EXPENSE_EDITABLE_STATUSES: readonly ExpenseStatus[] = ["draft", "submitted", "rejected"];

export interface ExpenseAttachment {
  id: number;
  category: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: ISODateTime;
}

export interface Expense {
  id: number;
  expense_no: string;
  expense_date: ISODate;
  category: string;
  subcategory: string | null;
  booking_id: number | null;
  supplier_id: number | null;
  description: string;
  amount: Decimal;
  tax_amount: Decimal;
  total_amount: Decimal;
  mode: ExpenseMode;
  paid_by: number | null;
  is_reimbursable: Flag;
  reimbursed_at: ISODateTime | null;
  status: ExpenseStatus;
  approved_by: number | null;
  approved_at: ISODateTime | null;
  rejection_reason: string | null;
  voided_by: number | null;
  voided_at: ISODateTime | null;
  void_reason: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
}

export interface ExpenseListItem extends Expense {
  booking_no: string | null;
  travel_from: ISODate | null;
  supplier_name: string | null;
  paid_by_name: string | null;
  approved_by_name: string | null;
  created_by_name: string | null;
  attachment_count: number;
}

export interface ExpenseDetail extends Expense {
  booking_no: string | null;
  travel_from: ISODate | null;
  travel_to: ISODate | null;
  supplier_name: string | null;
  supplier_type: string | null;
  paid_by_name: string | null;
  approved_by_name: string | null;
  created_by_name: string | null;
  voided_by_name: string | null;
  attachments: ExpenseAttachment[];
  payments: Payment[];
}

export type ExpenseFilters = {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  dir?: SortDir;
  category?: string;
  subcategory?: string;
  status?: ExpenseStatus | ExpenseStatus[];
  booking_id?: number;
  supplier_id?: number;
  paid_by?: number;
  mode?: ExpenseMode;
  from?: ISODate;
  to?: ISODate;
  min_amount?: number;
  max_amount?: number;
  reimbursable_only?: boolean;
  overheads_only?: boolean;
  direct_only?: boolean;
};

export interface ExpenseCategoryUsage {
  category: string;
  usage_count: number;
  last_used: ISODate | null;
}

export interface ExpenseSummaryByCategory {
  category: string;
  expense_count: number;
  net_amount: Decimal;
  tax_amount: Decimal;
  total_amount: Decimal;
  overhead_amount: Decimal;
  direct_amount: Decimal;
}

export interface ExpenseSummaryByStatus {
  status: ExpenseStatus;
  expense_count: number;
  total_amount: Decimal;
}

export interface ExpenseSummaryByMonth {
  period: string;
  expense_count: number;
  total_amount: Decimal;
}

export interface ExpenseSummary {
  by_category: ExpenseSummaryByCategory[];
  by_status: ExpenseSummaryByStatus[];
  by_month: ExpenseSummaryByMonth[];
  totals: {
    expense_count: number;
    net_amount: Decimal;
    tax_amount: Decimal;
    total_amount: Decimal;
    overhead_amount: Decimal;
    direct_amount: Decimal;
  };
}

export interface ExpenseInput {
  expense_date: ISODate;
  category: string;
  description: string;
  amount: number;
  subcategory?: string | null;
  booking_id?: number | null;
  supplier_id?: number | null;
  tax_amount?: number;
  mode?: ExpenseMode;
  paid_by?: number | null;
  is_reimbursable?: boolean;
  /** Only draft/submitted are valid on create; approval happens via its own action. */
  status?: Extract<ExpenseStatus, "draft" | "submitted">;
}

export type ExpenseUpdateInput = Partial<ExpenseInput>;

export async function listExpenses(params: ExpenseFilters = {}) {
  return apiList<ExpenseListItem>(`/expenses${buildQuery(params)}`);
}

export async function getExpenseSummary(params: ExpenseFilters = {}) {
  return apiGet<ExpenseSummary>(`/expenses/summary${buildQuery(params)}`);
}

export async function listExpenseCategories() {
  return apiGet<ExpenseCategoryUsage[]>("/expenses/categories");
}

export async function getExpense(id: number) {
  return apiGet<ExpenseDetail>(`/expenses/${id}`);
}

export async function createExpense(input: ExpenseInput) {
  return apiPost<ExpenseDetail>("/expenses", input);
}

export async function updateExpense(id: number, input: ExpenseUpdateInput) {
  return apiPut<ExpenseDetail>(`/expenses/${id}`, input);
}

export async function submitExpense(id: number) {
  return apiPost<ExpenseDetail>(`/expenses/${id}/submit`);
}

export async function approveExpense(id: number) {
  return apiPost<ExpenseDetail>(`/expenses/${id}/approve`);
}

export async function rejectExpense(id: number, reason: string) {
  return apiPost<ExpenseDetail>(`/expenses/${id}/reject`, { reason });
}

export async function markExpensePaid(id: number, paidOn?: ISODate) {
  return apiPost<ExpenseDetail>(`/expenses/${id}/mark-paid`, { paid_on: paidOn });
}

export async function voidExpense(id: number, reason: string) {
  return apiPost<ExpenseDetail>(`/expenses/${id}/void`, { reason });
}

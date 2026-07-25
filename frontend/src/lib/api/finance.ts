import { apiGet, buildQuery } from "@/lib/api/client";
import type { Decimal, ISODate } from "@/lib/api/common";

/**
 * Statement-level finance: ageing (payables/receivables), the GST summary
 * that feeds GSTR-1 preparation, and the period profit & loss. Day-to-day
 * payment recording lives in `payments.ts`; invoice/bill CRUD in
 * `invoices.ts`/`supplierBills.ts`. This module is the roll-ups.
 */

export interface PayableRow {
  supplier_id: number;
  supplier_name: string;
  supplier_type: string;
  bill_count: number;
  outstanding: Decimal;
  not_due: Decimal;
  days_1_30: Decimal;
  days_31_60: Decimal;
  days_60_plus: Decimal;
}

export interface Payables {
  suppliers: PayableRow[];
  totals: {
    outstanding: Decimal;
    not_due: Decimal;
    days_1_30: Decimal;
    days_31_60: Decimal;
    days_60_plus: Decimal;
  };
}

export interface ReceivableRow {
  customer_id: number;
  customer_name: string;
  phone: string | null;
  booking_count: number;
  outstanding: Decimal;
  next_departure: ISODate | null;
  due_within_7_days: Decimal;
}

export interface Receivables {
  customers: ReceivableRow[];
  totals: {
    outstanding: Decimal;
    due_within_7_days: Decimal;
  };
}

export interface GstSummaryPeriod {
  period: string;
  invoice_count: number;
  taxable_amount: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  tcs: Decimal;
  grand_total: Decimal;
}

export interface GstSummary {
  periods: GstSummaryPeriod[];
  from: ISODate;
  to: ISODate;
}

export interface ProfitAndLossOverheadLine {
  category: string;
  amount: Decimal;
}

export interface ProfitAndLoss {
  period: { from: ISODate; to: ISODate };
  revenue: Decimal;
  booking_count: number;
  pax: number;
  cogs: {
    supplier_bills: Decimal;
    direct_expenses: Decimal;
    agent_commission: Decimal;
    total: Decimal;
  };
  gross_profit: Decimal;
  gross_margin_pct: number;
  overheads: ProfitAndLossOverheadLine[];
  overhead_total: Decimal;
  net_profit: Decimal;
  net_margin_pct: number;
  revenue_per_pax: Decimal;
}

export type PeriodParams = { from?: ISODate; to?: ISODate };

export async function getPayables() {
  return apiGet<Payables>("/finance/payables");
}

export async function getReceivables() {
  return apiGet<Receivables>("/finance/receivables");
}

export async function getGstSummary(params: PeriodParams = {}) {
  return apiGet<GstSummary>(`/finance/gst-summary${buildQuery(params)}`);
}

export async function getProfitAndLoss(params: PeriodParams = {}) {
  return apiGet<ProfitAndLoss>(`/finance/pl${buildQuery(params)}`);
}

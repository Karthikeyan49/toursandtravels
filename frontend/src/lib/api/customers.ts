import { apiGet, apiList, apiPost, apiPut, buildQuery } from "@/lib/api/client";
import type { Decimal, Flag, ISODate, ISODateTime, SortDir } from "@/lib/api/common";

/** Customers — the traveller or corporate account a booking belongs to. */

export const CUSTOMER_TYPES = ["individual", "corporate", "agency"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export interface Customer {
  id: number;
  code: string;
  full_name: string;
  email: string | null;
  phone: string;
  alt_phone: string | null;
  whatsapp: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country_id: number | null;
  date_of_birth: ISODate | null;
  anniversary: ISODate | null;
  gstin: string | null;
  customer_type: CustomerType;
  agency_id: number | null;
  source: string | null;
  notes: string | null;
  is_active: Flag;
  is_deleted: Flag;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
}

export interface CustomerListItem extends Customer {
  agency_name: string | null;
  booking_count: number;
  lifetime_value: Decimal;
}

export interface CustomerBookingRef {
  id: number;
  booking_no: string;
  travel_from: ISODate;
  travel_to: ISODate;
  status: string;
  payment_status: string;
  grand_total: Decimal;
  amount_paid: Decimal;
  outstanding: Decimal;
  destination_name: string | null;
  package_name: string | null;
}

export interface CustomerStats {
  total_bookings: number;
  lifetime_value: Decimal;
  outstanding: Decimal;
  last_travelled: ISODate | null;
}

export interface CustomerOpenLead {
  id: number;
  lead_no: string;
  status: string;
  destination_id: number | null;
  travel_date: ISODate | null;
  created_at: ISODateTime;
}

export interface CustomerDetail extends Customer {
  bookings: CustomerBookingRef[];
  stats: CustomerStats;
  open_leads: CustomerOpenLead[];
}

export type CustomerFilters = {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  dir?: SortDir;
  customer_type?: CustomerType;
  agency_id?: number;
  city?: string;
  is_active?: boolean;
};

export interface CustomerInput {
  full_name: string;
  phone: string;
  email?: string | null;
  alt_phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country_id?: number | null;
  date_of_birth?: ISODate | null;
  anniversary?: ISODate | null;
  gstin?: string | null;
  customer_type?: CustomerType;
  agency_id?: number | null;
  source?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export type CustomerUpdateInput = Partial<CustomerInput>;

export async function listCustomers(params: CustomerFilters = {}) {
  return apiList<CustomerListItem>(`/customers${buildQuery(params)}`);
}

export async function getCustomer(id: number) {
  return apiGet<CustomerDetail>(`/customers/${id}`);
}

export async function createCustomer(input: CustomerInput) {
  return apiPost<Customer>("/customers", input);
}

export async function updateCustomer(id: number, input: CustomerUpdateInput) {
  return apiPut<Customer>(`/customers/${id}`, input);
}

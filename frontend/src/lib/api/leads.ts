import { apiGet, apiList, apiPost, apiPut, buildQuery } from "@/lib/api/client";
import type { Decimal, Flag, ISODate, ISODateTime, SortDir } from "@/lib/api/common";
import type { Customer } from "@/lib/api/customers";

/**
 * Enquiries (leads), their follow-up timeline and the pipeline board.
 *
 * Enum unions mirror `api/migrations/004_crm.sql` exactly — note that a lead
 * goes new → contacted → quoted → negotiating, not the generic CRM vocabulary.
 */

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "quoted",
  "negotiating",
  "won",
  "lost",
  "dropped",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** A lead in one of these no longer sits on the pipeline board. */
export const LEAD_CLOSED_STATUSES: readonly LeadStatus[] = ["won", "lost", "dropped"];

export const LEAD_PRIORITIES = ["low", "medium", "high", "hot"] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];

export const FOLLOWUP_CHANNELS = ["call", "whatsapp", "email", "meeting", "sms", "other"] as const;
export type FollowupChannel = (typeof FOLLOWUP_CHANNELS)[number];

export const FOLLOWUP_DIRECTIONS = ["outbound", "inbound"] as const;
export type FollowupDirection = (typeof FOLLOWUP_DIRECTIONS)[number];

export const FOLLOWUP_OUTCOMES = [
  "connected",
  "no_answer",
  "busy",
  "interested",
  "not_interested",
  "callback",
  "quoted",
  "closed",
] as const;
export type FollowupOutcome = (typeof FOLLOWUP_OUTCOMES)[number];

/** Transitions the backend will accept — mirrors Lead::TRANSITIONS. */
export const LEAD_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ["contacted", "quoted", "dropped"],
  contacted: ["quoted", "negotiating", "lost", "dropped"],
  quoted: ["negotiating", "won", "lost", "dropped"],
  negotiating: ["quoted", "won", "lost", "dropped"],
  won: [],
  lost: ["contacted"],
  dropped: ["contacted"],
};

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Lead {
  id: number;
  lead_no: string;
  customer_id: number | null;
  contact_name: string;
  phone: string;
  email: string | null;
  city: string | null;
  source_id: number | null;
  agency_id: number | null;
  destination_id: number | null;
  package_id: number | null;
  travel_date: ISODate | null;
  travel_date_flexible: Flag;
  nights: number | null;
  adults: number;
  children: number;
  infants: number;
  budget_min: Decimal | null;
  budget_max: Decimal | null;
  requirement: string | null;
  status: LeadStatus;
  previous_status: string | null;
  lost_reason: string | null;
  priority: LeadPriority;
  assigned_to: number | null;
  next_followup_at: ISODateTime | null;
  last_contacted_at: ISODateTime | null;
  converted_booking_id: number | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
}

/** Row shape from GET /leads — the base row plus joined labels and counters. */
export interface LeadListItem extends Lead {
  destination_name: string | null;
  package_name: string | null;
  source_name: string | null;
  assigned_to_name: string | null;
  followup_count: number;
  quote_count: number;
  /** Hours since last_contacted_at, falling back to created_at. */
  hours_since_contact: number | null;
}

export interface LeadFollowup {
  id: number;
  lead_id: number;
  channel: FollowupChannel;
  direction: FollowupDirection;
  outcome: FollowupOutcome;
  note: string | null;
  next_action: string | null;
  next_due_at: ISODateTime | null;
  done_at: ISODateTime;
  actor_id: number | null;
  created_at: ISODateTime;
  actor_name: string | null;
}

export interface LeadQuotationRef {
  id: number;
  quote_no: string;
  version: number;
  quote_date: ISODate;
  valid_until: ISODate | null;
  grand_total: Decimal;
  status: string;
}

export interface LeadDetail extends Lead {
  destination_name: string | null;
  package_name: string | null;
  source_name: string | null;
  assigned_to_name: string | null;
  customer_name: string | null;
  customer_code: string | null;
  followups: LeadFollowup[];
  quotations: LeadQuotationRef[];
}

export interface LeadSource {
  id: number;
  name: string;
  is_paid: Flag;
}

export interface PipelineColumn {
  status: LeadStatus;
  lead_count: number;
  potential_value: number;
  total_pax: number;
}

export interface IdleLead {
  id: number;
  lead_no: string;
  contact_name: string;
  phone: string;
  status: LeadStatus;
  priority: LeadPriority;
  assigned_to: number | null;
  assigned_to_name: string | null;
  last_touch: ISODateTime;
  idle_hours: number;
}

export interface LeadPipeline {
  /** Every status, including the empty ones, so the board never reflows. */
  board: PipelineColumn[];
  open_count: number;
  win_rate: number;
  overdue: IdleLead[];
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type LeadFilters = {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  dir?: SortDir;
  status?: LeadStatus | readonly LeadStatus[];
  open_only?: boolean;
  priority?: LeadPriority;
  assigned_to?: number;
  destination_id?: number;
  source_id?: number;
  from?: ISODate;
  to?: ISODate;
  overdue?: boolean;
};

export type PipelineFilters = {
  assigned_to?: number;
  from?: ISODate;
  to?: ISODate;
};

export interface LeadInput {
  contact_name: string;
  phone: string;
  email?: string | null;
  city?: string | null;
  source_id?: number | null;
  agency_id?: number | null;
  destination_id?: number | null;
  package_id?: number | null;
  travel_date?: ISODate | null;
  travel_date_flexible?: boolean;
  nights?: number | null;
  adults?: number;
  children?: number;
  infants?: number;
  budget_min?: number | null;
  budget_max?: number | null;
  requirement?: string | null;
  priority?: LeadPriority;
  assigned_to?: number | null;
  next_followup_at?: ISODateTime | null;
  customer_id?: number | null;
}

export type LeadUpdateInput = Partial<LeadInput>;

export interface FollowupInput {
  channel?: FollowupChannel;
  direction?: FollowupDirection;
  outcome?: FollowupOutcome;
  note?: string | null;
  next_action?: string | null;
  next_due_at?: ISODateTime | null;
  done_at?: ISODateTime | null;
}

export interface LeadStatusInput {
  status: LeadStatus;
  /** Required by the API when closing a lead as lost or dropped. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export async function listLeads(params: LeadFilters = {}) {
  return apiList<LeadListItem>(`/leads${buildQuery(params)}`);
}

export async function getLead(id: number) {
  return apiGet<LeadDetail>(`/leads/${id}`);
}

export async function createLead(input: LeadInput) {
  return apiPost<LeadDetail>("/leads", input);
}

export async function updateLead(id: number, input: LeadUpdateInput) {
  return apiPut<LeadDetail>(`/leads/${id}`, input);
}

export async function changeLeadStatus(id: number, input: LeadStatusInput) {
  return apiPost<LeadDetail>(`/leads/${id}/status`, input);
}

export async function logFollowup(id: number, input: FollowupInput) {
  return apiPost<LeadDetail>(`/leads/${id}/followups`, input);
}

export async function getPipeline(params: PipelineFilters = {}) {
  return apiGet<LeadPipeline>(`/leads/pipeline${buildQuery(params)}`);
}

export async function listLeadSources() {
  return apiGet<LeadSource[]>("/leads/sources");
}

/** Promotes the enquirer to a customer record, reusing a match on phone. */
export async function convertLeadToCustomer(id: number) {
  return apiPost<Customer>(`/leads/${id}/convert-customer`);
}

import { apiBlob, apiDelete, apiGet, apiList, apiPost, buildQuery } from "@/lib/api/client";
import type { Decimal, ISODate, ISODateTime, Severity, TimeString } from "@/lib/api/common";
import type { ServiceType, SupplierStatus } from "@/lib/api/bookings";

/**
 * On-the-ground operations: the day board, the transport row on it, the
 * departures readiness checklist, supplier confirmation and trip incidents.
 * Also home to the polymorphic attachment store (OpsController owns it since
 * passports, receipts and trip photos are all uploaded through the same
 * endpoint).
 */

export const DAYSHEET_STATUSES = ["pending", "ready", "in_progress", "done", "issue"] as const;
export type DaysheetStatus = (typeof DAYSHEET_STATUSES)[number];

export const INCIDENT_CATEGORIES = [
  "hotel",
  "transport",
  "activity",
  "guide",
  "medical",
  "weather",
  "flight",
  "customer",
  "other",
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = ["open", "investigating", "resolved", "closed"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Day board
// ---------------------------------------------------------------------------

export interface ChecklistItem {
  label: string;
  done: boolean;
  by: number | null;
  at: ISODateTime | null;
}

export interface Daysheet {
  id: number;
  booking_id: number;
  sheet_date: ISODate;
  day_no: number;
  city_id: number | null;
  hotel_id: number | null;
  summary: string | null;
  status: DaysheetStatus;
  issue_note: string | null;
  owner_id: number | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  booking_no: string;
  lead_pax_name: string | null;
  contact_phone: string | null;
  adults: number;
  children: number;
  travel_from: ISODate;
  travel_to: ISODate;
  booking_status: string;
  customer_name: string | null;
  destination_name: string | null;
  city_name: string | null;
  hotel_name: string | null;
  owner_name: string | null;
  transport_assigned: number;
  checklist: ChecklistItem[];
  checklist_done: number;
  checklist_total: number;
}

export interface OpsTransportRow {
  id: number;
  booking_id: number;
  from_date: ISODate;
  to_date: ISODate;
  status: string;
  pickup_point: string | null;
  pickup_time: TimeString | null;
  drop_point: string | null;
  route_summary: string | null;
  booking_no: string;
  lead_pax_name: string | null;
  contact_phone: string | null;
  registration_no: string | null;
  vehicle_type_name: string | null;
  driver_name: string | null;
  driver_phone: string | null;
}

export interface OpsBoardBookingRow {
  id: number;
  booking_no: string;
  lead_pax_name: string | null;
  contact_phone: string | null;
  adults: number;
  children: number;
  travel_from: ISODate;
  travel_to: ISODate;
  customer_name: string | null;
  destination_name: string | null;
  payment_status?: string;
  outstanding?: Decimal;
}

export interface OpsBoard {
  date: ISODate;
  daysheets: Daysheet[];
  transport: OpsTransportRow[];
  departures: OpsBoardBookingRow[];
  arrivals: OpsBoardBookingRow[];
  summary: {
    bookings_on_road: number;
    pax_on_road: number;
    by_status: Record<DaysheetStatus, number>;
  };
}

export type OpsBoardFilters = {
  date?: ISODate;
  status?: DaysheetStatus;
  owner_id?: number;
  destination_id?: number;
};

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface OpsCalendarBooking {
  id: number;
  booking_no: string;
  travel_from: ISODate;
  travel_to: ISODate;
  status: string;
  payment_status: string;
  adults: number;
  children: number;
  infants: number;
  lead_pax_name: string | null;
  contact_phone: string | null;
  outstanding: Decimal;
  customer_name: string | null;
  destination_name: string | null;
  package_name: string | null;
  ops_owner_name: string | null;
  daysheet_status: DaysheetStatus | null;
}

export interface OpsCalendarDay {
  date: ISODate;
  weekday: string;
  departures: OpsCalendarBooking[];
  arrivals: OpsCalendarBooking[];
  on_road: OpsCalendarBooking[];
  pax: number;
}

export interface OpsCalendar {
  from: ISODate;
  to: ISODate;
  days: OpsCalendarDay[];
  total_bookings: number;
}

// ---------------------------------------------------------------------------
// Departures readiness checklist
// ---------------------------------------------------------------------------

export interface ReadinessFlag {
  code: string;
  severity: Severity;
  message: string;
}

export interface DepartureChecklistRow {
  id: number;
  booking_no: string;
  travel_from: ISODate;
  travel_to: ISODate;
  status: string;
  payment_status: string;
  adults: number;
  children: number;
  infants: number;
  lead_pax_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  grand_total: Decimal;
  amount_paid: Decimal;
  outstanding: Decimal;
  days_to_departure: number;
  customer_name: string | null;
  destination_name: string | null;
  destination_scope: "domestic" | "international" | null;
  package_name: string | null;
  batch_code: string | null;
  owner_name: string | null;
  ops_owner_name: string | null;
  service_count: number;
  unconfirmed_services: number;
  pax_rows: number;
  pax_missing_passport: number;
  pax_passport_expired: number;
  pax_passport_short: number;
  pax_visa_pending: number;
  pax_visa_rejected: number;
  pax_unnamed: number;
  unissued_vouchers: number;
  issued_vouchers: number;
  unassigned_transport: number;
  assignment_count: number;
  incomplete_assignments: number;
  open_incidents: number;
  daysheet_issues: number;
  pax_total: number;
  international: boolean;
  blockers: ReadinessFlag[];
  warnings: ReadinessFlag[];
  is_ready: boolean;
  readiness_pct: number;
}

export interface DeparturesChecklist {
  window_days: number;
  settings: { balance_due_days_before: number; passport_expiry_alert_days: number };
  summary: {
    bookings: number;
    pax: number;
    ready: number;
    blocked: number;
    unconfirmed_services: number;
    unissued_vouchers: number;
    unassigned_transport: number;
    pax_document_issues: number;
    outstanding_amount: Decimal;
  };
  departures: DepartureChecklistRow[];
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export interface TripIncident {
  id: number;
  booking_id: number;
  incident_date: ISODate;
  category: IncidentCategory;
  supplier_id: number | null;
  severity: IncidentSeverity;
  title: string;
  description: string | null;
  action_taken: string | null;
  cost_impact: Decimal;
  status: IncidentStatus;
  resolved_at: ISODateTime | null;
  reported_by: number | null;
  assigned_to: number | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface TripIncidentListItem extends TripIncident {
  booking_no: string;
  travel_from: ISODate;
  travel_to: ISODate;
  customer_name: string | null;
  supplier_name: string | null;
  supplier_type: string | null;
  reported_by_name: string | null;
  assigned_to_name: string | null;
}

export type IncidentFilters = {
  page?: number;
  limit?: number;
  search?: string;
  status?: IncidentStatus;
  open_only?: boolean;
  severity?: IncidentSeverity;
  category?: IncidentCategory;
  supplier_id?: number;
  booking_id?: number;
  from?: ISODate;
  to?: ISODate;
};

export interface IncidentInput {
  category: IncidentCategory;
  title: string;
  incident_date?: ISODate;
  supplier_id?: number | null;
  severity?: IncidentSeverity;
  description?: string | null;
  action_taken?: string | null;
  cost_impact?: number;
  assigned_to?: number | null;
}

export interface ResolveIncidentInput {
  action_taken: string;
  cost_impact?: number;
  status?: "resolved" | "closed";
}

// ---------------------------------------------------------------------------
// Supplier confirmation
// ---------------------------------------------------------------------------

export interface ConfirmServiceInput {
  confirmation_no?: string;
  supplier_status?: SupplierStatus;
  notes?: string;
}

export interface ConfirmedServiceRow {
  id: number;
  booking_id: number;
  service_type: ServiceType;
  description: string;
  supplier_id: number | null;
  supplier_status: SupplierStatus;
  confirmation_no: string | null;
  confirmed_at: ISODateTime | null;
  notes: string | null;
  supplier_name: string | null;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export const ATTACHMENT_CATEGORIES = [
  "passport",
  "visa",
  "customer_doc",
  "voucher",
  "supplier_bill",
  "expense_receipt",
  "package_image",
  "hotel_image",
  "import",
] as const;
export type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number];

export const ATTACHABLE_ENTITY_TYPES = [
  "booking",
  "booking_pax",
  "booking_service",
  "customer",
  "supplier",
  "supplier_bill",
  "expense",
  "voucher",
  "invoice",
  "package",
  "hotel",
  "trip_sheet",
  "trip_incident",
] as const;
export type AttachableEntityType = (typeof ATTACHABLE_ENTITY_TYPES)[number];

export interface Attachment {
  id: number;
  entity_type: string;
  entity_id: number;
  category: AttachmentCategory;
  file_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: number | null;
  created_at: ISODateTime;
}

// --- Day board ---------------------------------------------------------

export async function getOpsBoard(params: OpsBoardFilters = {}) {
  return apiGet<OpsBoard>(`/ops/board${buildQuery(params)}`);
}

export async function getOpsCalendar(from: ISODate, to: ISODate) {
  return apiGet<OpsCalendar>(`/ops/calendar${buildQuery({ from, to })}`);
}

export async function toggleDaysheetChecklist(daysheetId: number, index: number, done: boolean) {
  return apiPost<{ checklist: ChecklistItem[]; status: DaysheetStatus }>(
    `/ops/daysheets/${daysheetId}/checklist`,
    { index, done },
  );
}

export async function flagDaysheetIssue(daysheetId: number, note: string) {
  return apiPost<Daysheet>(`/ops/daysheets/${daysheetId}/issue`, { note });
}

export async function getDeparturesChecklist(days = 7) {
  return apiGet<DeparturesChecklist>(`/ops/departures-checklist${buildQuery({ days })}`);
}

// --- Supplier confirmation ----------------------------------------------

export async function confirmBookingService(serviceId: number, input: ConfirmServiceInput) {
  return apiPost<ConfirmedServiceRow>(`/booking-services/${serviceId}/confirm`, input);
}

// --- Incidents ------------------------------------------------------------

export async function listIncidents(params: IncidentFilters = {}) {
  return apiList<TripIncidentListItem>(`/ops/incidents${buildQuery(params)}`);
}

export async function reportIncident(bookingId: number, input: IncidentInput) {
  return apiPost<TripIncident>(`/bookings/${bookingId}/incidents`, input);
}

export async function resolveIncident(id: number, input: ResolveIncidentInput) {
  return apiPost<TripIncident>(`/incidents/${id}/resolve`, input);
}

// --- Attachments ------------------------------------------------------------

export async function listAttachments(entityType: AttachableEntityType, entityId: number, category?: AttachmentCategory) {
  return apiGet<Attachment[]>(`/attachments${buildQuery({ entity_type: entityType, entity_id: entityId, category })}`);
}

export async function uploadAttachment(
  entityType: AttachableEntityType,
  entityId: number,
  category: AttachmentCategory,
  file: File,
  label?: string,
) {
  const form = new FormData();
  form.append("file", file);
  form.append("entity_type", entityType);
  form.append("entity_id", String(entityId));
  form.append("category", category);
  if (label) form.append("label", label);
  return apiPost<Attachment>("/attachments", form);
}

export async function deleteAttachment(id: number) {
  return apiDelete<null>(`/attachments/${id}`);
}

/**
 * Streaming an attachment needs the Authorization header, so a plain <a href>
 * cannot point at it directly — fetch the blob and hand the caller an object
 * URL it is responsible for revoking.
 */
export async function downloadAttachment(id: number): Promise<Blob> {
  return apiBlob(`/attachments/${id}`);
}

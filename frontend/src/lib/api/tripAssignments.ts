import { apiGet, apiList, apiPost, apiPut, buildQuery } from "@/lib/api/client";
import type { Decimal, Flag, ISODate, ISODateTime, SortDir, TimeString } from "@/lib/api/common";

/**
 * Vehicle/driver assignment and the trip sheet it produces.
 *
 * Double-booking is rejected server-side with a 409 (BusinessRuleException),
 * not a 422 — there is no single offending field, the conflict is between two
 * whole assignments. Callers should catch `ApiError` and check `status === 409`
 * rather than looking for a field error.
 */

export const TRIP_ASSIGNMENT_STATUSES = [
  "planned",
  "confirmed",
  "dispatched",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type TripAssignmentStatus = (typeof TRIP_ASSIGNMENT_STATUSES)[number];

/** Mirrors TripAssignment::TRANSITIONS — only offer moves the API will accept. */
export const TRIP_ASSIGNMENT_TRANSITIONS: Record<TripAssignmentStatus, readonly TripAssignmentStatus[]> = {
  planned: ["confirmed", "cancelled"],
  confirmed: ["dispatched", "cancelled"],
  dispatched: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export const GUIDE_SOURCES = ["staff", "supplier"] as const;
export type GuideSource = (typeof GUIDE_SOURCES)[number];

export const TRIP_SHEET_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type TripSheetStatus = (typeof TRIP_SHEET_STATUSES)[number];

export interface TripAssignment {
  id: number;
  booking_id: number;
  booking_service_id: number | null;
  vehicle_id: number | null;
  driver_id: number | null;
  guide_id: number | null;
  guide_source: GuideSource;
  supplier_id: number | null;
  from_date: ISODate;
  to_date: ISODate;
  pickup_point: string | null;
  pickup_time: TimeString | null;
  drop_point: string | null;
  route_summary: string | null;
  estimated_km: number;
  status: TripAssignmentStatus;
  previous_status: string | null;
  driver_notified_at: ISODateTime | null;
  notes: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
}

export interface TripAssignmentListItem extends TripAssignment {
  booking_no: string;
  lead_pax_name: string | null;
  contact_phone: string | null;
  adults: number;
  children: number;
  travel_from: ISODate;
  travel_to: ISODate;
  booking_status: string;
  customer_name: string | null;
  registration_no: string | null;
  vehicle_type_name: string | null;
  seat_count: number | null;
  driver_name: string | null;
  driver_phone: string | null;
  supplier_name: string | null;
  service_description: string | null;
  sheet_count: number;
  actual_cost: Decimal;
}

export interface TripSheet {
  id: number;
  trip_assignment_id: number;
  sheet_date: ISODate;
  start_km: number;
  end_km: number;
  total_km: number;
  start_time: TimeString | null;
  end_time: TimeString | null;
  fuel_amount: Decimal;
  toll_amount: Decimal;
  parking_amount: Decimal;
  driver_allowance: Decimal;
  other_amount: Decimal;
  total_amount: Decimal;
  odometer_photo: string | null;
  remarks: string | null;
  status: TripSheetStatus;
  approved_by: number | null;
  approved_at: ISODateTime | null;
  rejection_reason: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
  approved_by_name: string | null;
  submitted_by_name: string | null;
}

export interface TripAssignmentPax {
  pax_no: number;
  title: string;
  first_name: string;
  last_name: string | null;
  pax_type: string;
  phone: string | null;
  is_lead_pax: Flag;
}

export interface TripAssignmentDetail extends TripAssignment {
  booking_no: string;
  lead_pax_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  adults: number;
  children: number;
  infants: number;
  travel_from: ISODate;
  travel_to: ISODate;
  booking_status: string;
  agency_id: number | null;
  special_requests: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  registration_no: string | null;
  model_year: number | null;
  vehicle_type_name: string | null;
  seat_count: number | null;
  is_ac: Flag | null;
  driver_name: string | null;
  driver_phone: string | null;
  driver_alt_phone: string | null;
  licence_no: string | null;
  languages: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  service_description: string | null;
  service_date: ISODate | null;
  service_end_date: ISODate | null;
  guide_name: string | null;
  trip_sheets: TripSheet[];
  allowed_transitions: TripAssignmentStatus[];
  pax: TripAssignmentPax[];
}

export type TripAssignmentFilters = {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  dir?: SortDir;
  from?: ISODate;
  to?: ISODate;
  vehicle_id?: number;
  driver_id?: number;
  supplier_id?: number;
  status?: TripAssignmentStatus | TripAssignmentStatus[];
  booking_id?: number;
};

export interface TripAssignmentInput {
  from_date: ISODate;
  to_date: ISODate;
  booking_service_id?: number | null;
  vehicle_id?: number | null;
  driver_id?: number | null;
  guide_id?: number | null;
  guide_source?: GuideSource;
  supplier_id?: number | null;
  pickup_point?: string | null;
  pickup_time?: TimeString | null;
  drop_point?: string | null;
  route_summary?: string | null;
  estimated_km?: number;
  notes?: string | null;
}

export type TripAssignmentUpdateInput = Partial<TripAssignmentInput>;

export interface TripSheetInput {
  start_km: number;
  end_km: number;
  sheet_date?: ISODate;
  start_time?: TimeString | null;
  end_time?: TimeString | null;
  fuel_amount?: number;
  toll_amount?: number;
  parking_amount?: number;
  driver_allowance?: number;
  other_amount?: number;
  odometer_photo?: string | null;
  remarks?: string | null;
}

export async function listTripAssignments(params: TripAssignmentFilters = {}) {
  return apiList<TripAssignmentListItem>(`/trip-assignments${buildQuery(params)}`);
}

export async function getTripAssignment(id: number) {
  return apiGet<TripAssignmentDetail>(`/trip-assignments/${id}`);
}

/** Rejects with a 409 when the vehicle or driver is already committed over an overlapping window. */
export async function createTripAssignment(bookingId: number, input: TripAssignmentInput) {
  return apiPost<TripAssignmentDetail>(`/bookings/${bookingId}/trip-assignments`, input);
}

export async function updateTripAssignment(id: number, input: TripAssignmentUpdateInput) {
  return apiPut<TripAssignmentDetail>(`/trip-assignments/${id}`, input);
}

export async function changeTripAssignmentStatus(id: number, status: TripAssignmentStatus, note?: string) {
  return apiPost<TripAssignmentDetail>(`/trip-assignments/${id}/status`, { status, note });
}

/** total_km / total_amount are always recomputed server-side, never trusted from the client. */
export async function submitTripSheet(assignmentId: number, input: TripSheetInput) {
  return apiPost<{ trip_sheet: TripSheet; assignment: TripAssignmentDetail }>(
    `/trip-assignments/${assignmentId}/trip-sheet`,
    input,
  );
}

export async function approveTripSheet(sheetId: number) {
  return apiPost<TripSheet>(`/trip-sheets/${sheetId}/approve`);
}

export async function rejectTripSheet(sheetId: number, reason: string) {
  return apiPost<TripSheet>(`/trip-sheets/${sheetId}/reject`, { reason });
}

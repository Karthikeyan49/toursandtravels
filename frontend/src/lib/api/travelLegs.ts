import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api/client";
import type { ISODate, TimeString } from "@/lib/api/common";

/**
 * The actual travel logistics captured once a quote has converted to a
 * booking (api/migrations/011_travel_legs.sql — `booking_travel_legs`): real
 * flight/train/bus numbers, PNR, exact departure/arrival timings and the
 * finalised baggage rules that go on the printable itinerary handout.
 *
 * Deliberately separate from `booking_services` (which drives supplier costing
 * and billing) — a leg is operational data for the handout and may exist even
 * when there is no corresponding costed service line.
 */

export const TRAVEL_LEG_MODES = ["flight", "train", "bus", "car", "other"] as const;
export type TravelLegMode = (typeof TRAVEL_LEG_MODES)[number];

export const TRAVEL_LEG_DIRECTIONS = ["onward", "return", "internal"] as const;
export type TravelLegDirection = (typeof TRAVEL_LEG_DIRECTIONS)[number];

export const TRAVEL_LEG_CONFIRMATION_STATUSES = ["pending", "confirmed", "cancelled"] as const;
export type TravelLegConfirmationStatus = (typeof TRAVEL_LEG_CONFIRMATION_STATUSES)[number];

export interface TravelLeg {
  id: number;
  booking_id: number;
  leg_no: number;
  mode: TravelLegMode;
  direction: TravelLegDirection;
  /** Airline / rail operator / bus company. */
  carrier_name: string | null;
  /** Flight no / train no / bus no. */
  vehicle_number: string | null;
  pnr: string | null;
  /** Economy, Sleeper 3AC, AC Seater, … */
  seat_class: string | null;
  from_location: string;
  to_location: string;
  departure_date: ISODate;
  departure_time: TimeString | null;
  arrival_date: ISODate | null;
  arrival_time: TimeString | null;
  /** e.g. "15kg check-in + 7kg cabin". */
  baggage_allowance: string | null;
  confirmation_status: TravelLegConfirmationStatus;
  notes: string | null;
  sort_order: number;
}

export interface TravelLegInput {
  leg_no?: number;
  mode: TravelLegMode;
  direction?: TravelLegDirection;
  carrier_name?: string | null;
  vehicle_number?: string | null;
  pnr?: string | null;
  seat_class?: string | null;
  from_location: string;
  to_location: string;
  departure_date: ISODate;
  departure_time?: TimeString | null;
  arrival_date?: ISODate | null;
  arrival_time?: TimeString | null;
  baggage_allowance?: string | null;
  confirmation_status?: TravelLegConfirmationStatus;
  notes?: string | null;
}

/** GET /bookings/{id}/travel-legs */
export async function listTravelLegs(bookingId: number) {
  return apiGet<TravelLeg[]>(`/bookings/${bookingId}/travel-legs`);
}

/** PUT /bookings/{id}/travel-legs — replaces the whole leg list in one call. */
export async function replaceTravelLegs(bookingId: number, legs: TravelLegInput[]) {
  return apiPut<TravelLeg[]>(`/bookings/${bookingId}/travel-legs`, { legs });
}

/** POST /bookings/{id}/travel-legs — appends a single leg. */
export async function addTravelLeg(bookingId: number, input: TravelLegInput) {
  return apiPost<TravelLeg>(`/bookings/${bookingId}/travel-legs`, input);
}

/** PUT /bookings/{id}/travel-legs/{legId} */
export async function updateTravelLeg(bookingId: number, legId: number, input: Partial<TravelLegInput>) {
  return apiPut<TravelLeg>(`/bookings/${bookingId}/travel-legs/${legId}`, input);
}

/** DELETE /bookings/{id}/travel-legs/{legId} */
export async function removeTravelLeg(bookingId: number, legId: number) {
  return apiDelete<null>(`/bookings/${bookingId}/travel-legs/${legId}`);
}

/** POST /bookings/{id}/travel-legs/{legId}/confirm — records the issued PNR. */
export async function confirmTravelLeg(bookingId: number, legId: number, pnr?: string) {
  return apiPost<TravelLeg>(`/bookings/${bookingId}/travel-legs/${legId}/confirm`, { pnr: pnr ?? null });
}

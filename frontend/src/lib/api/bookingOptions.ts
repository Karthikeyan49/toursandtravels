import { apiPut } from "@/lib/api/client";
import type { Flag } from "@/lib/api/common";
import {
  type DietType,
  type RoomCategory,
  type TransportMode,
} from "@/lib/api/quotationOptions";

/**
 * Same toggle set as `quotationOptions.ts`, copied onto `booking_options`
 * (api/migrations/010_quotation_builder.sql) when a quote converts. Editing it
 * on a live booking is a distinct, audited action — not a side effect of
 * re-opening the original quote — hence the separate table and endpoint.
 */

export interface BookingOptions {
  transport_mode: TransportMode;
  room_category: RoomCategory;
  food_included: Flag;
  diet_type: DietType;
  baggage_included: Flag;
  baggage_notes: string | null;
  local_transport_included: Flag;
  sightseeing_included: Flag;
  insurance_included: Flag;
}

export type BookingOptionsInput = Partial<BookingOptions>;

/** PUT /bookings/{id}/options */
export async function saveBookingOptions(bookingId: number, input: BookingOptionsInput) {
  return apiPut<BookingOptions>(`/bookings/${bookingId}/options`, input);
}

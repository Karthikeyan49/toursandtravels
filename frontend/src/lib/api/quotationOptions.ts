import { apiPut } from "@/lib/api/client";
import type { Flag } from "@/lib/api/common";

/**
 * The toggle set behind the "Dynamic Quotation Builder"
 * (api/migrations/010_quotation_builder.sql — `quotation_options`, one row per
 * quotation). Staff pick these instead of typing free text; the choices carry
 * over verbatim to `booking_options` once the quote converts (see
 * bookingOptions.ts).
 */

export const TRANSPORT_MODES = ["flight", "train", "bus", "mixed", "none"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const ROOM_CATEGORIES = [
  "normal",
  "ac",
  "non_ac",
  "deluxe",
  "super_deluxe",
  "executive",
  "suite",
  "other",
] as const;
export type RoomCategory = (typeof ROOM_CATEGORIES)[number];

export const DIET_TYPES = ["veg", "non_veg", "brahmin", "jain"] as const;
export type DietType = (typeof DIET_TYPES)[number];

export interface QuotationOptions {
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

export type QuotationOptionsInput = Partial<QuotationOptions>;

/** PUT /quotations/{id}/options — upserts the toggle set for this quotation. */
export async function saveQuotationOptions(quotationId: number, input: QuotationOptionsInput) {
  return apiPut<QuotationOptions>(`/quotations/${quotationId}/options`, input);
}

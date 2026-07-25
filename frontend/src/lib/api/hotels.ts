import { apiDelete, apiGet, apiList, apiPost, apiPut, buildQuery } from "@/lib/api/client";
import type { Decimal, Flag, ISODate, ISODateTime, SortDir, TimeString } from "@/lib/api/common";

/** Hotels, their room types and the contracted seasonal rate card. */

export const HOTEL_PROPERTY_CATEGORIES = [
  "budget",
  "2star",
  "3star",
  "4star",
  "5star",
  "luxury",
  "resort",
  "homestay",
  "houseboat",
  "camp",
] as const;
export type HotelPropertyCategory = (typeof HOTEL_PROPERTY_CATEGORIES)[number];

/**
 * Client's standard room-type picklist (migration 009_client_vocab_patch.sql
 * added `hotel_room_types.room_category`), shown alongside the hotel's own
 * free-text room name rather than replacing it.
 */
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

/** Rate-card meal plans. Narrower than the voucher vocabulary — no AI here. */
export const RATE_MEAL_PLANS = ["EP", "CP", "MAP", "AP"] as const;
export type RateMealPlan = (typeof RATE_MEAL_PLANS)[number];

export const RATE_BASES = ["per_room", "per_person"] as const;
export type RateBasis = (typeof RATE_BASES)[number];

export interface Hotel {
  id: number;
  supplier_id: number | null;
  code: string;
  name: string;
  destination_id: number;
  city_id: number | null;
  category: HotelPropertyCategory;
  address: string | null;
  phone: string | null;
  email: string | null;
  check_in_time: TimeString;
  check_out_time: TimeString;
  child_free_age: number;
  amenities: string | null;
  notes: string | null;
  is_active: Flag;
  is_deleted: Flag;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
}

export interface HotelListItem extends Hotel {
  destination_name: string | null;
  city_name: string | null;
  supplier_name: string | null;
  room_type_count: number;
  live_rate_count: number;
}

export interface HotelRoomType {
  id: number;
  hotel_id: number;
  name: string;
  /**
   * NOTE: the backend column exists (see migration 009) but
   * MasterController::storeRoomType() does not yet accept or persist this
   * field — it will read back as the column default ("normal") until that
   * validator is updated. Included here so the type is forward-compatible.
   */
  room_category: RoomCategory;
  max_adults: number;
  max_children: number;
  extra_beds: number;
  is_active: Flag;
  is_deleted: Flag;
}

export interface HotelRate {
  id: number;
  hotel_id: number;
  room_type_id: number;
  season_name: string;
  valid_from: ISODate;
  valid_to: ISODate;
  meal_plan: RateMealPlan;
  rate_basis: RateBasis;
  currency: string;
  cost_single: Decimal;
  cost_double: Decimal;
  cost_triple: Decimal;
  cost_extra_bed: Decimal;
  cost_child_no_bed: Decimal;
  tax_pct: Decimal;
  is_active: Flag;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
  room_type_name: string | null;
}

export interface HotelDetail extends Hotel {
  room_types: HotelRoomType[];
  rates: HotelRate[];
}

export interface HotelOption {
  id: number;
  code: string;
  name: string;
  category: HotelPropertyCategory;
  destination_id: number;
  city_name: string | null;
}

export type HotelFilters = {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  dir?: SortDir;
  destination_id?: number;
  city_id?: number;
  category?: HotelPropertyCategory;
  is_active?: boolean;
};

export type HotelOptionFilters = {
  destination_id?: number;
  category?: HotelPropertyCategory;
};

export interface HotelInput {
  code: string;
  name: string;
  destination_id: number;
  supplier_id?: number | null;
  city_id?: number | null;
  category?: HotelPropertyCategory;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  check_in_time?: TimeString | null;
  check_out_time?: TimeString | null;
  child_free_age?: number;
  amenities?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export type HotelUpdateInput = Partial<HotelInput>;

export interface RoomTypeInput {
  name: string;
  /** See the note on HotelRoomType.room_category — not yet persisted by the API. */
  room_category?: RoomCategory;
  max_adults?: number;
  max_children?: number;
  extra_beds?: number;
}

export interface HotelRateInput {
  room_type_id: number;
  valid_from: ISODate;
  valid_to: ISODate;
  season_name?: string;
  meal_plan?: RateMealPlan;
  rate_basis?: RateBasis;
  currency?: string;
  cost_single?: number;
  cost_double?: number;
  cost_triple?: number;
  cost_extra_bed?: number;
  cost_child_no_bed?: number;
  tax_pct?: number;
}

export async function listHotels(params: HotelFilters = {}) {
  return apiList<HotelListItem>(`/hotels${buildQuery(params)}`);
}

export async function listHotelOptions(params: HotelOptionFilters = {}) {
  return apiGet<HotelOption[]>(`/hotels/options${buildQuery(params)}`);
}

export async function getHotel(id: number) {
  return apiGet<HotelDetail>(`/hotels/${id}`);
}

export async function createHotel(input: HotelInput) {
  return apiPost<HotelDetail>("/hotels", input);
}

export async function updateHotel(id: number, input: HotelUpdateInput) {
  return apiPut<HotelDetail>(`/hotels/${id}`, input);
}

/** Soft delete — refused while upcoming bookings still use the property. */
export async function archiveHotel(id: number) {
  return apiDelete<null>(`/hotels/${id}`);
}

export async function createRoomType(hotelId: number, input: RoomTypeInput) {
  return apiPost<HotelRoomType>(`/hotels/${hotelId}/room-types`, input);
}

/** Rejected when an active rate already covers the same room, plan and dates. */
export async function createHotelRate(hotelId: number, input: HotelRateInput) {
  return apiPost<HotelRate>(`/hotels/${hotelId}/rates`, input);
}

import { apiDelete, apiGet, apiList, apiPost, apiPut, buildQuery } from "@/lib/api/client";
import type { Flag, ISODateTime, SortDir } from "@/lib/api/common";

/** Destinations, their cities and the country reference table. */

export const DESTINATION_SCOPES = ["domestic", "international"] as const;
export type DestinationScope = (typeof DESTINATION_SCOPES)[number];

export interface Destination {
  id: number;
  code: string;
  name: string;
  country_id: number | null;
  region: string | null;
  scope: DestinationScope;
  description: string | null;
  best_season: string | null;
  hero_image: string | null;
  is_active: Flag;
  is_deleted: Flag;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
}

export interface DestinationListItem extends Destination {
  country_name: string | null;
  package_count: number;
  hotel_count: number;
}

/** Lightweight rows for selects — GET /destinations/options. */
export interface DestinationOption {
  id: number;
  code: string;
  name: string;
  scope: DestinationScope;
}

export interface City {
  id: number;
  name: string;
  airport_code: string | null;
}

export interface Country {
  id: number;
  iso2: string;
  name: string;
  currency: string;
  dial_code: string | null;
  visa_required: Flag;
}

export type DestinationFilters = {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  dir?: SortDir;
  scope?: DestinationScope;
  country_id?: number;
  is_active?: boolean;
};

export interface DestinationInput {
  code: string;
  name: string;
  scope: DestinationScope;
  country_id?: number | null;
  region?: string | null;
  description?: string | null;
  best_season?: string | null;
  hero_image?: string | null;
}

export type DestinationUpdateInput = Partial<DestinationInput> & { is_active?: boolean };

export interface CityInput {
  destination_id: number;
  name: string;
  airport_code?: string | null;
}

export async function listDestinations(params: DestinationFilters = {}) {
  return apiList<DestinationListItem>(`/destinations${buildQuery(params)}`);
}

export async function listDestinationOptions() {
  return apiGet<DestinationOption[]>("/destinations/options");
}

export async function createDestination(input: DestinationInput) {
  return apiPost<Destination>("/destinations", input);
}

export async function updateDestination(id: number, input: DestinationUpdateInput) {
  return apiPut<Destination>(`/destinations/${id}`, input);
}

/** Soft delete — refused while active packages still point at it. */
export async function archiveDestination(id: number) {
  return apiDelete<null>(`/destinations/${id}`);
}

export async function listCities(destinationId: number) {
  return apiGet<City[]>(`/cities${buildQuery({ destination_id: destinationId })}`);
}

export async function createCity(input: CityInput) {
  return apiPost<City>("/cities", input);
}

export async function listCountries() {
  return apiGet<Country[]>("/countries");
}

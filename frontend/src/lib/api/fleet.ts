import { apiGet, apiList, buildQuery } from "@/lib/api/client";
import type { Decimal, Flag, ISODate, ISODateTime } from "@/lib/api/common";

/**
 * Vehicles and drivers.
 *
 * The list endpoints sort by whichever compliance document expires first, so
 * the fleet screen opens on the paperwork that is about to lapse.
 */

export interface VehicleType {
  id: number;
  name: string;
  seat_count: number;
  luggage_cap: string | null;
  is_ac: Flag;
}

export interface Vehicle {
  id: number;
  supplier_id: number | null;
  vehicle_type_id: number;
  registration_no: string;
  model_year: number | null;
  destination_id: number | null;
  permit_expiry: ISODate | null;
  insurance_expiry: ISODate | null;
  fitness_expiry: ISODate | null;
  puc_expiry: ISODate | null;
  /** 1 when the agency owns it, 0 when it belongs to a transport supplier. */
  is_owned: Flag;
  is_active: Flag;
  is_deleted: Flag;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  vehicle_type_name: string;
  seat_count: number;
  is_ac: Flag;
  supplier_name: string | null;
  destination_name: string | null;
  /** Days until the soonest of permit/insurance/fitness/PUC; 9999 when unset. */
  days_to_next_expiry: number;
}

export interface Driver {
  id: number;
  supplier_id: number | null;
  full_name: string;
  phone: string;
  alt_phone: string | null;
  licence_no: string | null;
  licence_expiry: ISODate | null;
  languages: string | null;
  destination_id: number | null;
  rating: Decimal | null;
  is_active: Flag;
  is_deleted: Flag;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  supplier_name: string | null;
  destination_name: string | null;
  licence_days_left: number | null;
}

export type VehicleFilters = {
  page?: number;
  limit?: number;
  search?: string;
  owned_only?: boolean;
  /** Anything with a document lapsing inside 45 days. */
  expiring?: boolean;
};

export type DriverFilters = {
  page?: number;
  limit?: number;
  search?: string;
  destination_id?: number;
};

export async function listVehicles(params: VehicleFilters = {}) {
  return apiList<Vehicle>(`/vehicles${buildQuery(params)}`);
}

export async function listDrivers(params: DriverFilters = {}) {
  return apiList<Driver>(`/drivers${buildQuery(params)}`);
}

export async function listVehicleTypes() {
  return apiGet<VehicleType[]>("/vehicle-types");
}

/** Compliance columns in the order the fleet table shows them. */
export const VEHICLE_DOCUMENTS = [
  { key: "permit_expiry", label: "Permit" },
  { key: "insurance_expiry", label: "Insurance" },
  { key: "fitness_expiry", label: "Fitness" },
  { key: "puc_expiry", label: "PUC" },
] as const satisfies readonly { key: keyof Vehicle; label: string }[];

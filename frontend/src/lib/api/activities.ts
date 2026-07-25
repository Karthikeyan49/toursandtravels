import { apiList, apiPost, buildQuery } from "@/lib/api/client";
import type { Decimal, Flag, ISODateTime } from "@/lib/api/common";

/** Sightseeing, entry tickets and other sellable add-ons. */

export const ACTIVITY_TYPES = [
  "sightseeing",
  "adventure",
  "cruise",
  "show",
  "entry_ticket",
  "wellness",
  "transfer",
  "meal",
  "other",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const PRICING_BASES = ["per_person", "per_group", "per_vehicle"] as const;
export type PricingBasis = (typeof PRICING_BASES)[number];

export interface Activity {
  id: number;
  code: string;
  name: string;
  destination_id: number;
  supplier_id: number | null;
  activity_type: ActivityType;
  duration_hours: Decimal | null;
  pricing_basis: PricingBasis;
  /** Buying price. Stripped for roles without `view_costs`. */
  cost_adult?: Decimal;
  /** Buying price. Stripped for roles without `view_costs`. */
  cost_child?: Decimal;
  sell_adult: Decimal;
  sell_child: Decimal;
  tax_pct: Decimal;
  min_pax: number;
  description: string | null;
  is_active: Flag;
  is_deleted: Flag;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  created_by: number | null;
}

export interface ActivityListItem extends Activity {
  destination_name: string | null;
  supplier_name: string | null;
}

export type ActivityFilters = {
  page?: number;
  limit?: number;
  search?: string;
  destination_id?: number;
  activity_type?: ActivityType;
};

export interface ActivityInput {
  code: string;
  name: string;
  destination_id: number;
  sell_adult: number;
  supplier_id?: number | null;
  activity_type?: ActivityType;
  duration_hours?: number | null;
  pricing_basis?: PricingBasis;
  cost_adult?: number;
  cost_child?: number;
  sell_child?: number;
  tax_pct?: number;
  min_pax?: number;
  description?: string | null;
}

export async function listActivities(params: ActivityFilters = {}) {
  return apiList<ActivityListItem>(`/activities${buildQuery(params)}`);
}

/** The API rejects a sell price below the supplied adult cost. */
export async function createActivity(input: ActivityInput) {
  return apiPost<Activity>("/activities", input);
}

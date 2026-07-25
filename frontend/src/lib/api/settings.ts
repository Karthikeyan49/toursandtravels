import { apiGet, apiPut } from "@/lib/api/client";
import type { ISODateTime } from "@/lib/api/common";

/**
 * Operator-editable configuration: the company letterhead profile, the flat
 * settings map that drives pricing/alerts, and the document numbering series.
 *
 * The settings key space is closed server-side — `updateSettings` can only
 * ever change keys that already exist (see AdminController::isWritable), so a
 * typo'd key comes back in `ignored` rather than silently creating a row.
 */

export type SettingValueType = "string" | "int" | "decimal" | "bool" | "json";

export interface SettingRow {
  key: string;
  value: string | number | boolean | Record<string, unknown> | null;
  type: SettingValueType;
  description: string | null;
  is_public: boolean;
  updated_at: ISODateTime | null;
}

/** Flat key -> cast value, e.g. settings.map.company_name. */
export type SettingsMap = Record<string, string | number | boolean | Record<string, unknown> | null | undefined>;

export interface CompanyBank {
  name: string;
  account_name: string;
  account_no: string;
  ifsc: string;
  upi_id: string;
}

/** Populates the PDF letterhead on every invoice, cash bill and voucher. */
export interface CompanyProfile {
  name: string;
  legal_name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  website: string;
  gstin: string;
  pan: string;
  logo: string;
  primary_color: string;
  iata_number: string;
  bank: CompanyBank;
}

export interface SettingsResponse {
  settings: SettingRow[];
  map: SettingsMap;
  company: CompanyProfile;
}

export interface UpdateSettingsResult {
  updated: string[];
  ignored: string[];
  map: SettingsMap;
}

/** doc_type => 'INV' | 'CASH' | 'BKG' | 'QTN' | 'PAY' | 'VCH' | 'SB' | 'EXP' | 'COM' | 'PKG' | 'CUS' | 'SUP' | 'AGY' | 'TRP' | 'LEAD' */
export type NumberingPolicy = "yearly" | "monthly" | "financial_year" | "continuous";

export interface NumberingSeries {
  doc_type: string;
  prefix: string;
  policy: NumberingPolicy;
  padding: number;
  /** Preview only — does not consume the sequence. */
  next: string;
}

/** Arbitrary company_*/bank_*/default_*/seq_* keys, or the small named allowlist. */
export type SettingsUpdateInput = Record<string, string | number | boolean | null>;

export async function getSettings() {
  return apiGet<SettingsResponse>("/settings");
}

export async function updateSettings(input: SettingsUpdateInput) {
  return apiPut<UpdateSettingsResult>("/settings", { settings: input });
}

export async function getNumberingSettings() {
  return apiGet<NumberingSeries[]>("/settings/numbering");
}

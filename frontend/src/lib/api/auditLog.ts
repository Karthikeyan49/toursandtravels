import { apiList, buildQuery } from "@/lib/api/client";
import type { ISODate, ISODateTime } from "@/lib/api/common";
import type { StaffRole } from "@/lib/constants";

/**
 * The append-only trail every write in the API leaves behind. `old_value` and
 * `new_value` are JSON-encoded server-side (see Audit::log) — this module
 * exposes them as the raw string; a page that wants to render them prettily
 * should `JSON.parse` defensively, since a very old row can predate a field.
 */

export interface AuditLogEntry {
  id: number;
  user_id: number | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  /** JSON-encoded snapshot of the columns that changed, or null. */
  old_value: string | null;
  /** JSON-encoded snapshot of the columns that changed, or null. */
  new_value: string | null;
  note: string | null;
  ip_address: string | null;
  created_at: ISODateTime;
  actor_name: string | null;
  actor_role: StaffRole | null;
}

export type AuditLogFilters = {
  page?: number;
  limit?: number;
  search?: string;
  entity_type?: string;
  entity_id?: number;
  user_id?: number;
  action?: string;
  from?: ISODate;
  to?: ISODate;
};

export async function listAuditLog(params: AuditLogFilters = {}) {
  return apiList<AuditLogEntry>(`/audit-log${buildQuery(params)}`);
}

/** Parses a stored old_value/new_value column into a plain object for display. */
export function parseAuditValue(raw: string | null): Record<string, unknown> | null {
  if (raw === null || raw.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

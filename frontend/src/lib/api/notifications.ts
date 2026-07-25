import { apiGet, apiList, apiPost, buildQuery } from "@/lib/api/client";
import type { ISODateTime, Severity } from "@/lib/api/common";

/**
 * The in-app inbox. A notification is addressed either to the caller
 * specifically (`user_id`) or to their role (`role_scope`) — the backend
 * resolves that scoping, this module only reads the result.
 */

export interface Notification {
  id: number;
  user_id: number | null;
  role_scope: string | null;
  /** e.g. payment_due | departure_soon | doc_expiring | lead_idle | ops_issue | trip_incident */
  kind: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: number | null;
  severity: Severity;
  read_at: ISODateTime | null;
  created_at: ISODateTime;
}

export interface UnreadCount {
  unread: number;
  by_severity: Record<Severity, number>;
}

export type NotificationFilters = {
  unread?: boolean;
  page?: number;
  limit?: number;
};

export async function listNotifications(params: NotificationFilters = {}) {
  return apiList<Notification>(`/notifications${buildQuery(params)}`);
}

export async function getUnreadCount() {
  return apiGet<UnreadCount>("/notifications/unread-count");
}

export async function markNotificationRead(id: number) {
  return apiPost<{ id: number; read: boolean }>(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead() {
  return apiPost<{ marked: number }>("/notifications/read-all");
}

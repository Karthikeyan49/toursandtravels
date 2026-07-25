import { apiGet, apiList, apiPost, apiPut, buildQuery } from "@/lib/api/client";
import type { Flag, ISODateTime, SortDir } from "@/lib/api/common";
import type { StaffRole } from "@/lib/constants";

/**
 * Staff account administration. `password_hash` never appears here — every
 * read goes through the API's public column list (see User::findPublic), so
 * there is nothing to accidentally render even if a caller got careless.
 */

export const USER_TYPES = ["staff", "agent", "customer"] as const;
export type UserType = (typeof USER_TYPES)[number];

export interface StaffUser {
  id: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  user_type: UserType;
  staff_role: StaffRole | null;
  agency_id: number | null;
  avatar_path: string | null;
  is_active: Flag;
  last_login_at: ISODateTime | null;
  must_change_pw: Flag;
  created_at: ISODateTime;
}

export type UserFilters = {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  dir?: SortDir;
  user_type?: UserType;
  staff_role?: StaffRole;
  is_active?: boolean;
};

export interface CreateUserInput {
  full_name: string;
  user_type: UserType;
  email?: string | null;
  phone?: string | null;
  /** Left blank to have the API generate one, returned once in the response. */
  password?: string;
  staff_role?: StaffRole;
  agency_id?: number | null;
}

export interface UpdateUserInput {
  full_name?: string;
  email?: string | null;
  phone?: string | null;
  staff_role?: StaffRole;
  agency_id?: number | null;
  is_active?: boolean;
}

/** A generated temporary password is shown exactly once — never persisted client-side. */
export interface UserCredentialResult {
  user: StaffUser;
  temporary_password: string | null;
}

export async function listUsers(params: UserFilters = {}) {
  return apiList<StaffUser>(`/users${buildQuery(params)}`);
}

export async function getUser(id: number) {
  return apiGet<StaffUser>(`/users/${id}`);
}

export async function createUser(input: CreateUserInput) {
  return apiPost<UserCredentialResult>("/users", input);
}

export async function updateUser(id: number, input: UpdateUserInput) {
  return apiPut<StaffUser>(`/users/${id}`, input);
}

/** Deactivates the account and revokes every live session immediately. */
export async function deactivateUser(id: number) {
  return apiPost<StaffUser>(`/users/${id}/deactivate`);
}

export async function activateUser(id: number) {
  return apiPost<StaffUser>(`/users/${id}/activate`);
}

/** Leave `password` blank to have the API generate one. Forces a change at next sign-in. */
export async function resetUserPassword(id: number, password?: string) {
  return apiPost<UserCredentialResult>(`/users/${id}/reset-password`, password ? { password } : undefined);
}

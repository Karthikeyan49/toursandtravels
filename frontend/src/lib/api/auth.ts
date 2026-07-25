import { apiGet, apiPost, type AuthUser, type Session } from "@/lib/api/client";

/**
 * Sign-in, session lifecycle and password management.
 *
 * `AuthContext` owns login/logout/refresh because they also mutate stored
 * session state; these wrappers exist for the flows that live outside it —
 * the change-password screen and the forgot/reset pair on the login page.
 */

export type { AuthUser, Session };

export interface ChangePasswordInput {
  current_password: string;
  new_password: string;
}

export interface ResetPasswordInput {
  token: string;
  new_password: string;
}

export async function login(identifier: string, password: string): Promise<Session> {
  return apiPost<Session>("/auth/login", { identifier, password });
}

export async function refreshSession(refreshToken: string): Promise<Session> {
  return apiPost<Session>("/auth/refresh", { refresh_token: refreshToken });
}

export async function logout(refreshToken?: string): Promise<null> {
  return apiPost<null>("/auth/logout", { refresh_token: refreshToken ?? null });
}

export async function me(): Promise<AuthUser> {
  return apiGet<AuthUser>("/auth/me");
}

export async function changePassword(input: ChangePasswordInput): Promise<null> {
  return apiPost<null>("/auth/change-password", input);
}

/** Always resolves the same way whether or not the account exists. */
export async function forgotPassword(identifier: string): Promise<null> {
  return apiPost<null>("/auth/forgot-password", { identifier });
}

export async function resetPassword(input: ResetPasswordInput): Promise<null> {
  return apiPost<null>("/auth/reset-password", input);
}

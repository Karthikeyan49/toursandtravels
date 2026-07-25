import { QueryClient } from "@tanstack/react-query";
import { APP_EVENTS, STORAGE_KEYS, type StaffRole } from "@/lib/constants";

/**
 * The one and only fetch wrapper. Nothing else in the app may call `fetch`
 * against the API directly — token injection, envelope unwrapping and the
 * 401 handshake all live here.
 */
export const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

/** Every endpoint returns this shape — see api/core/Response.php. */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  /** Present only on list endpoints (Response::paginated). */
  pagination?: Pagination;
  /** Present only on 422 responses. */
  errors?: FieldErrors;
}

export interface Paginated<T> {
  items: T[];
  pagination: Pagination;
}

/** 422 body: `{ email: ["Email is required"] }`. */
export type FieldErrors = Record<string, string[]>;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export const PERMISSIONS = [
  "view_costs",
  "view_margins",
  "edit_prices",
  "manage_users",
  "manage_settings",
  "confirm_booking",
  "cancel_booking",
  "record_payment",
  "void_document",
  "approve_expense",
  "manage_operations",
  "manage_visa",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** The backend may add flags before the frontend knows about them. */
export type PermissionMap = Partial<Record<Permission, boolean>> & Record<string, boolean | undefined>;

export interface AuthUser {
  id: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  user_type: "staff" | "customer" | "agent";
  staff_role: StaffRole | null;
  agency_id: number | null;
  permissions: PermissionMap;
}

export interface Session {
  user: AuthUser;
  token: string;
  refresh_token: string;
  /** Epoch milliseconds — the backend already multiplies by 1000 for JS. */
  expires_at: number;
  must_change_password?: boolean;
}

function isSession(value: unknown): value is Session {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<Session>;
  return (
    typeof s.token === "string" &&
    s.token !== "" &&
    typeof s.expires_at === "number" &&
    typeof s.user === "object" &&
    s.user !== null &&
    typeof s.user.id === "number"
  );
}

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.session);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSession(parsed)) {
      // Shape changed across a deploy, or the value was tampered with.
      localStorage.removeItem(STORAGE_KEYS.session);
      return null;
    }
    return parsed;
  } catch {
    // Private-mode Safari throws on localStorage access; treat as signed out.
    return null;
  }
}

export function setSession(session: Session): void {
  try {
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
  } catch {
    // Storage full or blocked — the in-memory session still works this tab.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.session);
  } catch {
    /* nothing recoverable to do */
  }
}

export function getToken(): string | null {
  return getSession()?.token ?? null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  readonly status: number;
  /** Field -> messages, straight from the backend validator. */
  readonly errors: FieldErrors;

  constructor(message: string, status: number, errors: FieldErrors = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
    // Required for `instanceof` to survive the ES5 downlevel some tools apply.
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  get isValidation(): boolean {
    return this.status === 422;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** First message for a field — what a form control shows inline. */
  fieldError(field: string): string | undefined {
    return this.errors[field]?.[0];
  }
}

/** Narrowing helper so callers do not have to import the class everywhere. */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

// ---------------------------------------------------------------------------
// Query string
// ---------------------------------------------------------------------------

export type QueryValue = string | number | boolean | undefined | null | readonly (string | number)[];

/**
 * Builds "?page=2&status=confirmed", dropping undefined, null and empty
 * strings so an untouched filter never reaches the API. Returns "" when
 * nothing survives, which makes `` `/leads${buildQuery(f)}` `` always valid.
 */
export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      // Repeated key: ?tag=a&tag=b — PHP reads these with a []-suffixed name,
      // so send the suffix explicitly.
      for (const entry of value) {
        if (entry === "" ) continue;
        search.append(`${key}[]`, String(entry));
      }
      continue;
    }

    const str = String(value).trim();
    if (str === "") continue;
    search.set(key, str);
  }

  const qs = search.toString();
  return qs === "" ? "" : `?${qs}`;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

function joinUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A PHP fatal or an HTML error page from the host — surface the raw text.
    return { success: false, message: text.slice(0, 300) };
  }
}

function extractError(body: unknown, status: number): ApiError {
  const fallback =
    status >= 500
      ? "Something went wrong on the server. Please try again."
      : "The request could not be completed.";

  if (typeof body === "object" && body !== null) {
    const b = body as { message?: unknown; errors?: unknown };
    const message = typeof b.message === "string" && b.message !== "" ? b.message : fallback;

    let errors: FieldErrors = {};
    if (typeof b.errors === "object" && b.errors !== null) {
      // Normalise: the validator sends string[] but some handlers send a string.
      errors = Object.entries(b.errors as Record<string, unknown>).reduce<FieldErrors>((acc, [field, value]) => {
        if (Array.isArray(value)) acc[field] = value.map(String);
        else if (typeof value === "string") acc[field] = [value];
        return acc;
      }, {});
    }
    return new ApiError(message, status, errors);
  }

  return new ApiError(fallback, status);
}

/**
 * Performs the request and returns the FULL envelope, so callers that need
 * `message` or `pagination` can reach them. Most code wants apiGet/apiPost.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;

  // Let the browser set the multipart boundary; setting it by hand corrupts it.
  if (!isFormData && init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  headers.set("X-Client-Type", "web");

  const token = getToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(joinUrl(path), { ...init, headers });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    // Offline, DNS failure, CORS rejection — status 0 marks "never reached".
    throw new ApiError("Cannot reach the server. Check your connection.", 0);
  }

  const body = await readBody(response);

  if (!response.ok) {
    if (response.status === 401 && token) {
      // Only a *rejected existing session* is an expiry. A 401 from the login
      // form is just wrong credentials and must not trigger a global logout.
      clearSession();
      window.dispatchEvent(new Event(APP_EVENTS.authExpired));
    }
    throw extractError(body, response.status);
  }

  // 204 and other empty successes still have to satisfy ApiEnvelope<T>.
  if (body === null) {
    return { success: true, data: null as T };
  }

  const envelope = body as ApiEnvelope<T>;
  if (typeof envelope !== "object" || !("success" in envelope)) {
    // A 2xx that is not an envelope means a proxy or cache answered instead.
    throw new ApiError("Unexpected response from the server.", response.status);
  }
  if (envelope.success === false) {
    throw extractError(envelope, response.status);
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// Unwrapping helpers — what pages and API modules actually call
// ---------------------------------------------------------------------------

type JsonBody = unknown;

function bodyInit(payload: JsonBody): BodyInit | undefined {
  if (payload === undefined) return undefined;
  if (typeof FormData !== "undefined" && payload instanceof FormData) return payload;
  return JSON.stringify(payload);
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return (await apiFetch<T>(path, { ...init, method: "GET" })).data;
}

export async function apiPost<T>(path: string, payload?: JsonBody, init?: RequestInit): Promise<T> {
  return (await apiFetch<T>(path, { ...init, method: "POST", body: bodyInit(payload) })).data;
}

export async function apiPut<T>(path: string, payload?: JsonBody, init?: RequestInit): Promise<T> {
  return (await apiFetch<T>(path, { ...init, method: "PUT", body: bodyInit(payload) })).data;
}

export async function apiPatch<T>(path: string, payload?: JsonBody, init?: RequestInit): Promise<T> {
  return (await apiFetch<T>(path, { ...init, method: "PATCH", body: bodyInit(payload) })).data;
}

export async function apiDelete<T = null>(path: string, init?: RequestInit): Promise<T> {
  return (await apiFetch<T>(path, { ...init, method: "DELETE" })).data;
}

/**
 * List endpoints. Always yields a `pagination` object, synthesising one for the
 * handful of endpoints that return a plain array (dropdown lookups), so table
 * components never branch on its absence.
 */
export async function apiList<T>(path: string, init?: RequestInit): Promise<Paginated<T>> {
  const envelope = await apiFetch<T[]>(path, { ...init, method: "GET" });
  const items = Array.isArray(envelope.data) ? envelope.data : [];

  return {
    items,
    pagination: envelope.pagination ?? {
      page: 1,
      limit: items.length,
      total: items.length,
      total_pages: items.length > 0 ? 1 : 0,
    },
  };
}

/** Binary downloads (PDF vouchers, XLSX exports) bypass the JSON envelope. */
export async function apiBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const headers = new Headers(init.headers);
  headers.set("X-Client-Type", "web");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(joinUrl(path), { ...init, headers });
  if (!response.ok) {
    throw extractError(await readBody(response), response.status);
  }
  return response.blob();
}

// ---------------------------------------------------------------------------
// React Query
// ---------------------------------------------------------------------------

/**
 * React Query is the GET cache — there is deliberately no hand-rolled one here.
 * A factory rather than a singleton so tests get an isolated cache per case.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // A 4xx will fail identically on retry; only retry transport/5xx.
          if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
          return failureCount < 1;
        },
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

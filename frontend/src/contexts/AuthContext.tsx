import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  apiGet,
  apiPost,
  BASE_URL,
  clearSession,
  getSession,
  setSession,
  type AuthUser,
  type Permission,
  type Session,
} from "@/lib/api/client";
import { APP_EVENTS } from "@/lib/constants";

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** True until the stored session has been validated or discarded. */
  loading: boolean;
  /** Backend flag: the user signed in with a temporary password. */
  mustChangePassword: boolean;
  login: (identifier: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Refresh this long before the access token dies, so a long-open tab survives. */
const REFRESH_LEEWAY_MS = 60_000;

function apiUrl(path: string): string {
  const base = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;
  return `${base}${path}`;
}

/**
 * Exchanges a refresh token for a new session using a RAW fetch. It must not go
 * through apiFetch: a failing refresh returns 401, which apiFetch turns into a
 * `tt:auth-expired` event — and this function runs *from* that handler.
 */
async function rawRefresh(refreshToken: string): Promise<Session | null> {
  try {
    const response = await fetch(apiUrl("/auth/refresh"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Client-Type": "web",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) return null;

    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;

    const envelope = body as { success?: boolean; data?: Session };
    if (envelope.success !== true || !envelope.data?.token) return null;

    return envelope.data;
  } catch {
    // Offline at startup: treat as "cannot refresh" rather than "signed out",
    // the caller decides what to do with the still-valid stored session.
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loading, setLoading] = useState(true);

  // Scheduled proactive refresh; cleared on every session change and unmount.
  const refreshTimer = useRef<number | null>(null);

  const cancelScheduledRefresh = useCallback(() => {
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  const applySession = useCallback((session: Session) => {
    setSession(session);
    setUser(session.user);
    setMustChangePassword(session.must_change_password === true);
  }, []);

  const clear = useCallback(() => {
    cancelScheduledRefresh();
    clearSession();
    setUser(null);
    setMustChangePassword(false);
    // Another user must never see the previous one's cached rows.
    queryClient.clear();
  }, [cancelScheduledRefresh, queryClient]);

  const refresh = useCallback(async (): Promise<boolean> => {
    const stored = getSession();
    if (!stored?.refresh_token) {
      clear();
      return false;
    }

    const next = await rawRefresh(stored.refresh_token);
    if (!next) {
      clear();
      return false;
    }

    applySession(next);
    return true;
  }, [applySession, clear]);

  // Keep the newest refresh callback reachable from the timer without making
  // the scheduling effect re-run (and reschedule) on every render.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // --- Boot: validate whatever is in localStorage before rendering routes ---
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const stored = getSession();

      if (!stored) {
        if (!cancelled) setLoading(false);
        return;
      }

      if (stored.expires_at > Date.now()) {
        if (!cancelled) {
          setUser(stored.user);
          setMustChangePassword(stored.must_change_password === true);
          setLoading(false);
        }

        // Revalidate in the background: a role change made while this tab was
        // closed must not leave stale permission flags driving the menu.
        try {
          const fresh = await apiGet<AuthUser>("/auth/me");
          if (!cancelled) {
            setUser(fresh);
            setSession({ ...stored, user: fresh });
          }
        } catch {
          // A 401 here already fired tt:auth-expired; anything else is transient.
        }
        return;
      }

      const renewed = await rawRefresh(stored.refresh_token);
      if (cancelled) return;

      if (renewed) applySession(renewed);
      else clear();

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // Runs once: the boot decision must not be re-taken on callback identity
    // changes, or a re-render would replay the whole handshake.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Proactive refresh while the tab stays open ---
  useEffect(() => {
    cancelScheduledRefresh();
    if (!user) return;

    const session = getSession();
    if (!session) return;

    const delay = session.expires_at - Date.now() - REFRESH_LEEWAY_MS;
    // Never schedule into the past; setTimeout would fire in a tight loop.
    refreshTimer.current = window.setTimeout(() => {
      void refreshRef.current();
    }, Math.max(1_000, delay));

    return cancelScheduledRefresh;
  }, [user, cancelScheduledRefresh]);

  // --- Global 401 handshake ---
  useEffect(() => {
    const onExpired = () => {
      clear();
      navigate("/login", { replace: true, state: { reason: "expired" } });
    };

    window.addEventListener(APP_EVENTS.authExpired, onExpired);
    return () => window.removeEventListener(APP_EVENTS.authExpired, onExpired);
  }, [clear, navigate]);

  const login = useCallback(
    async (identifier: string, password: string): Promise<AuthUser> => {
      // apiPost is safe here: no token is attached, so a 401 from bad
      // credentials cannot be mistaken for an expired session.
      const session = await apiPost<Session>("/auth/login", { identifier, password });
      queryClient.clear();
      applySession(session);
      return session.user;
    },
    [applySession, queryClient],
  );

  const logout = useCallback(async (): Promise<void> => {
    const stored = getSession();
    try {
      if (stored) {
        await apiPost("/auth/logout", { refresh_token: stored.refresh_token });
      }
    } catch {
      // The server-side revocation is best-effort; the local session goes
      // regardless, otherwise a network blip traps the user signed in.
    } finally {
      clear();
      navigate("/login", { replace: true });
    }
  }, [clear, navigate]);

  const can = useCallback(
    (permission: Permission): boolean => user?.permissions?.[permission] === true,
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      loading,
      mustChangePassword,
      login,
      logout,
      refresh,
      can,
    }),
    [user, loading, mustChangePassword, login, logout, refresh, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return context;
}

export type { AuthContextValue };

import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { Permission } from "@/lib/api/client";
import { EmptyState } from "@/components/EmptyState";
import { ShieldAlert } from "lucide-react";

export interface ProtectedRouteProps {
  children: ReactNode;
  /**
   * Route-level gate. The backend enforces this too — this only stops a user
   * landing on a page that will 403 every request it makes.
   */
  permission?: Permission;
}

export function ProtectedRoute({ children, permission }: ProtectedRouteProps) {
  const { isAuthenticated, loading, can } = useAuth();
  const location = useLocation();

  // AuthContext holds `loading` until the stored session is resolved, so this
  // never flashes the login screen for an already-signed-in user.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // `from` lets the login page send the user back where they were headed.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (permission && !can(permission)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <EmptyState
          icon={ShieldAlert}
          title="You do not have access to this page"
          description="Ask an owner or manager to grant the permission if you need it."
        />
      </div>
    );
  }

  return <>{children}</>;
}

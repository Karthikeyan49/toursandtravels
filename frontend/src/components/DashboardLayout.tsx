import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { STORAGE_KEYS } from "@/lib/constants";
import { AppSidebar } from "@/components/AppSidebar";
import { TopNavbar } from "@/components/TopNavbar";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.sidebarCollapsed) === "1";
  } catch {
    return false;
  }
}

export interface DashboardLayoutProps {
  /** Optional: when omitted the layout renders the matched child route. */
  children?: ReactNode;
}

/**
 * App shell: fixed sidebar on desktop, a sheet on mobile, sticky top bar, and a
 * scrolling content column. The content column — not the page body — owns
 * vertical scroll so the sidebar and top bar never move.
 */
export function DashboardLayout({ children }: DashboardLayoutProps) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  // Route change closes the mobile drawer; without this it stays open behind
  // the new page after a link is tapped.
  useEffect(() => setMobileOpen(false), [location.pathname]);

  const toggleCollapse = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, next ? "1" : "0");
      } catch {
        /* preference simply will not persist */
      }
      return next;
    });
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="hidden shrink-0 lg:block">
        <AppSidebar collapsed={collapsed} />
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 border-none bg-sidebar p-0" hideClose>
          {/* Radix requires a title/description for screen readers even when
              the drawer is purely navigational. */}
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Main application menu</SheetDescription>
          <AppSidebar onNavigate={() => setMobileOpen(false)} className="w-full" />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopNavbar
          onMenuClick={() => setMobileOpen(true)}
          onToggleCollapse={toggleCollapse}
          collapsed={collapsed}
        />

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] space-y-5 p-4 md:p-6">{children ?? <Outlet />}</div>
        </main>
      </div>
    </div>
  );
}

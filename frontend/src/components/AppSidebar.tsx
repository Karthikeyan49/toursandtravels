import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, Plane } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";
import { useAuth } from "@/contexts/AuthContext";
import {
  findSectionByPath,
  isPathUnder,
  readActiveModule,
  visibleNavigation,
  writeActiveModule,
} from "@/lib/navigation";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface AppSidebarProps {
  /** Icon rail. Desktop only — the mobile sheet always renders expanded. */
  collapsed?: boolean;
  /** Called after a link is followed, so the mobile sheet can close itself. */
  onNavigate?: () => void;
  className?: string;
}

export function AppSidebar({ collapsed = false, onNavigate, className }: AppSidebarProps) {
  const location = useLocation();
  const { can } = useAuth();

  const sections = useMemo(() => visibleNavigation(can), [can]);

  // Remembered across sessions; the current route always wins over the memory.
  const [openSection, setOpenSection] = useState<string | null>(
    () => findSectionByPath(location.pathname)?.label ?? readActiveModule(),
  );

  useEffect(() => {
    const section = findSectionByPath(location.pathname);
    if (section) {
      setOpenSection(section.label);
      writeActiveModule(section.label);
    }
  }, [location.pathname]);

  return (
    <aside
      className={cn(
        "flex h-full flex-col bg-sidebar text-sidebar-foreground",
        collapsed ? "w-[4.25rem]" : "w-64",
        className,
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4", collapsed && "justify-center px-0")}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <Plane className="h-4 w-4" aria-hidden />
        </span>
        {!collapsed && (
          <span className="truncate text-sm font-semibold text-sidebar-accent-foreground">{APP_NAME}</span>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-2 py-3" aria-label="Main">
        {sections.map((section) => {
          const isOpen = collapsed || openSection === section.label;
          const hasActiveChild = section.items.some((item) => isPathUnder(location.pathname, item.url));
          const SectionIcon = section.icon;

          return (
            <div key={section.label}>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => {
                    const next = isOpen ? null : section.label;
                    setOpenSection(next);
                    if (next) writeActiveModule(next);
                  }}
                  aria-expanded={isOpen}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold uppercase tracking-wide transition-colors",
                    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    hasActiveChild ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/70",
                  )}
                >
                  <SectionIcon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="flex-1 text-left">{section.label}</span>
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")}
                    aria-hidden
                  />
                </button>
              )}

              {isOpen && (
                <ul className={cn("space-y-0.5", collapsed ? "py-1" : "mt-0.5 pb-1 pl-3")}>
                  {section.items.map((item) => {
                    const ItemIcon = item.icon;

                    const link = (
                      <NavLink
                        to={item.url}
                        end={item.url === "/"}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          cn(
                            "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                            collapsed && "justify-center px-0",
                            isActive
                              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                              : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                          )
                        }
                      >
                        <ItemIcon className="h-4 w-4 shrink-0" aria-hidden />
                        {!collapsed && <span className="truncate">{item.title}</span>}
                      </NavLink>
                    );

                    return (
                      <li key={item.url}>
                        {collapsed ? (
                          <Tooltip>
                            <TooltipTrigger asChild>{link}</TooltipTrigger>
                            <TooltipContent side="right">{item.title}</TooltipContent>
                          </Tooltip>
                        ) : (
                          link
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

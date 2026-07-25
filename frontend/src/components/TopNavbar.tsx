import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  LogOut,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { cn, initials, humanize } from "@/lib/utils";
import { MENU_ITEMS, findItemByPath, visibleNavigation } from "@/lib/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { NotificationBell } from "@/components/NotificationBell";

export interface TopNavbarProps {
  /** Opens the mobile navigation sheet. */
  onMenuClick: () => void;
  /** Desktop rail toggle. */
  onToggleCollapse: () => void;
  collapsed: boolean;
  className?: string;
}

function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // next-themes only knows the resolved theme after hydration; rendering the
  // icon before then flashes the wrong one.
  useEffect(() => setMounted(true), []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme">
          {mounted && theme === "dark" ? <Moon /> : <Sun />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setTheme("light")}>
          <Sun />
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("dark")}>
          <Moon />
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("system")}>
          <Monitor />
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopNavbar({ onMenuClick, onToggleCollapse, collapsed, className }: TopNavbarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, can } = useAuth();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const currentTitle = findItemByPath(location.pathname)?.title;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The palette lists only what this user may open.
  const sections = visibleNavigation(can);

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        className,
      )}
    >
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick} aria-label="Open navigation">
        <Menu />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="hidden lg:inline-flex"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
      </Button>

      {currentTitle && <span className="hidden truncate text-sm font-medium md:inline">{currentTitle}</span>}

      <div className="flex-1" />

      <Button
        variant="outline"
        size="sm"
        onClick={() => setPaletteOpen(true)}
        className="hidden gap-2 text-muted-foreground sm:inline-flex"
      >
        <Search />
        <span>Search…</span>
        <kbd className="ml-2 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
      </Button>
      <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => setPaletteOpen(true)} aria-label="Search">
        <Search />
      </Button>

      <NotificationBell />
      <ThemeMenu />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials(user?.full_name)}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <p className="truncate text-sm font-medium">{user?.full_name ?? "Signed in"}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email ?? user?.phone ?? ""}</p>
            {user?.staff_role && (
              <p className="mt-1 text-xs text-muted-foreground">{humanize(user.staff_role)}</p>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {can("manage_settings") && (
            <DropdownMenuItem onSelect={() => navigate("/settings/company")}>
              <Settings />
              Settings
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => void logout()}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <CommandInput placeholder="Jump to…" />
        <CommandList>
          <CommandEmpty>No matching page.</CommandEmpty>
          {sections.map((section) => (
            <CommandGroup key={section.label} heading={section.label}>
              {section.items.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <CommandItem
                    key={item.url}
                    // cmdk matches on `value`; including the section makes
                    // "finance inv" find Invoices.
                    value={`${section.label} ${item.title}`}
                    onSelect={() => {
                      setPaletteOpen(false);
                      navigate(item.url);
                    }}
                  >
                    <ItemIcon />
                    {item.title}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </header>
  );
}

/** Exported for tests: every menu entry must resolve to a routed page. */
export const ALL_MENU_URLS = MENU_ITEMS.map((item) => item.url);

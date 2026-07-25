import {
  Activity,
  BadgeIndianRupee,
  Bus,
  Building2,
  CalendarRange,
  ClipboardList,
  Contact,
  FileSpreadsheet,
  FileText,
  Gauge,
  Hotel,
  LayoutDashboard,
  Map,
  MapPinned,
  Package,
  Receipt,
  ScrollText,
  Settings2,
  ShieldCheck,
  Ticket,
  TrendingUp,
  TriangleAlert,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { STORAGE_KEYS } from "@/lib/constants";
import type { Permission } from "@/lib/api/client";

export interface MenuItem {
  title: string;
  url: string;
  icon: LucideIcon;
  /**
   * Hides the item unless AuthContext.can(permission) is true. Only used for
   * permissions that describe *visibility* (view_costs, view_margins) or an
   * admin surface (manage_users, manage_settings). Action permissions such as
   * record_payment gate buttons inside a page, not the menu entry — a user who
   * may read a ledger but not post to it still needs the link.
   */
  permission?: Permission;
}

export interface MenuSection {
  /** Unique across the menu; also the value persisted as the active module. */
  label: string;
  icon: LucideIcon;
  items: MenuItem[];
}

export const NAVIGATION: MenuSection[] = [
  {
    label: "Overview",
    icon: LayoutDashboard,
    items: [{ title: "Dashboard", url: "/", icon: Gauge }],
  },
  {
    label: "Sales",
    icon: TrendingUp,
    items: [
      { title: "Enquiries", url: "/leads", icon: ClipboardList },
      { title: "Quotations", url: "/quotations", icon: FileText },
      { title: "Bookings", url: "/bookings", icon: CalendarRange },
      { title: "Customers", url: "/customers", icon: Contact },
    ],
  },
  {
    label: "Products",
    icon: Package,
    items: [
      { title: "Packages", url: "/packages", icon: Package },
      { title: "Departures", url: "/departures", icon: CalendarRange },
      { title: "Destinations", url: "/destinations", icon: MapPinned },
      { title: "Activities", url: "/activities", icon: Activity },
    ],
  },
  {
    label: "Suppliers",
    icon: Building2,
    items: [
      { title: "Suppliers", url: "/suppliers", icon: Building2 },
      { title: "Hotels", url: "/hotels", icon: Hotel },
      { title: "Fleet", url: "/fleet", icon: Bus },
    ],
  },
  {
    label: "Operations",
    icon: Map,
    items: [
      { title: "Ops Board", url: "/ops", icon: Map },
      { title: "Trip Assignments", url: "/trip-assignments", icon: Truck },
      { title: "Vouchers", url: "/vouchers", icon: Ticket },
      { title: "Incidents", url: "/incidents", icon: TriangleAlert },
    ],
  },
  {
    label: "Finance",
    icon: Wallet,
    items: [
      { title: "Invoices", url: "/invoices", icon: Receipt },
      { title: "Payments", url: "/payments", icon: BadgeIndianRupee },
      { title: "Supplier Bills", url: "/supplier-bills", icon: FileText, permission: "view_costs" },
      { title: "Expenses", url: "/expenses", icon: Wallet, permission: "view_costs" },
      { title: "Receivables", url: "/receivables", icon: FileSpreadsheet },
      { title: "Payables", url: "/payables", icon: FileSpreadsheet, permission: "view_costs" },
      { title: "P&L", url: "/profit-loss", icon: TrendingUp, permission: "view_margins" },
    ],
  },
  {
    label: "Reports",
    icon: FileSpreadsheet,
    items: [{ title: "Reports", url: "/reports", icon: FileSpreadsheet }],
  },
  {
    label: "Settings",
    icon: Settings2,
    items: [
      { title: "Users", url: "/settings/users", icon: Users, permission: "manage_users" },
      { title: "Company", url: "/settings/company", icon: Building2, permission: "manage_settings" },
      { title: "Numbering", url: "/settings/numbering", icon: ScrollText, permission: "manage_settings" },
      { title: "Audit Log", url: "/settings/audit", icon: ShieldCheck, permission: "manage_settings" },
    ],
  },
];

/** Flat view of every menu item — cheap lookups for breadcrumbs and search. */
export const MENU_ITEMS: readonly MenuItem[] = NAVIGATION.flatMap((section) => section.items);

/** Persisted so the sidebar reopens on the section the user was last working in. */
export const ACTIVE_MODULE_KEY = STORAGE_KEYS.activeModule;

/**
 * True when `pathname` is inside `url`. "/" only ever matches itself, otherwise
 * the Dashboard would own every route.
 */
export function isPathUnder(pathname: string, url: string): boolean {
  if (url === "/") return pathname === "/";
  return pathname === url || pathname.startsWith(`${url}/`);
}

/**
 * The section owning a route, including detail routes (/bookings/42 -> Sales).
 * Matches the longest url first so /settings/users beats a hypothetical
 * /settings entry.
 */
export function findSectionByPath(pathname: string): MenuSection | undefined {
  let best: { section: MenuSection; length: number } | undefined;

  for (const section of NAVIGATION) {
    for (const item of section.items) {
      if (isPathUnder(pathname, item.url) && (best === undefined || item.url.length > best.length)) {
        best = { section, length: item.url.length };
      }
    }
  }

  return best?.section;
}

export function findItemByPath(pathname: string): MenuItem | undefined {
  let best: MenuItem | undefined;
  for (const item of MENU_ITEMS) {
    if (isPathUnder(pathname, item.url) && (best === undefined || item.url.length > best.url.length)) {
      best = item;
    }
  }
  return best;
}

export function findSectionByLabel(label: string | null): MenuSection | undefined {
  if (!label) return undefined;
  return NAVIGATION.find((section) => section.label === label);
}

export function readActiveModule(): string | null {
  try {
    const stored = localStorage.getItem(ACTIVE_MODULE_KEY);
    return findSectionByLabel(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function writeActiveModule(label: string): void {
  try {
    localStorage.setItem(ACTIVE_MODULE_KEY, label);
  } catch {
    /* storage unavailable — the sidebar just will not remember */
  }
}

/** Filters the menu down to what a given permission set may see. */
export function visibleNavigation(can: (permission: Permission) => boolean): MenuSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.permission === undefined || can(item.permission)),
  })).filter((section) => section.items.length > 0);
}

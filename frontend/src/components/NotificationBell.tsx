import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, CheckCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { apiList, apiPost, isApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/EmptyState";

/** Mirrors the `notifications` table (api/migrations/001_core.sql). */
export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: number | null;
  severity: "info" | "warning" | "critical";
  read_at: string | null;
  created_at: string;
}

const SEVERITY_ICON = {
  info: Info,
  warning: TriangleAlert,
  critical: AlertTriangle,
} as const;

const SEVERITY_CLASS = {
  info: "text-status-in-progress",
  warning: "text-status-pending",
  critical: "text-status-overdue",
} as const;

/** Entity types the feed can deep-link into. */
const ENTITY_ROUTES: Record<string, string> = {
  booking: "/bookings",
  quotation: "/quotations",
  lead: "/leads",
  customer: "/customers",
  supplier: "/suppliers",
  package: "/packages",
  invoice: "/invoices",
};

function notificationHref(item: AppNotification): string | null {
  if (!item.entity_type || item.entity_id === null) return null;
  const base = ENTITY_ROUTES[item.entity_type];
  return base ? `${base}/${item.entity_id}` : null;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => apiList<AppNotification>("/notifications?status=unread&limit=15"),
    // The feed is the one thing that should go stale quickly.
    staleTime: 30_000,
    refetchInterval: open ? false : 120_000,
    retry: false,
  });

  const items = data?.items ?? [];
  const unread = items.filter((item) => item.read_at === null).length;

  const markRead = useMutation({
    mutationFn: (id: number) => apiPost(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => apiPost("/notifications/read-all"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  function handleOpen(item: AppNotification) {
    if (item.read_at === null) markRead.mutate(item.id);
    const href = notificationHref(item);
    if (href) {
      setOpen(false);
      navigate(href);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}>
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheck />
              Mark all read
            </Button>
          )}
        </div>
        <Separator />

        <ScrollArea className="max-h-80">
          {isLoading && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>}

          {!isLoading && items.length === 0 && (
            <EmptyState compact icon={Bell} title="All caught up" description="Nothing needs your attention." />
          )}

          {items.map((item) => {
            const Icon = SEVERITY_ICON[item.severity] ?? Info;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleOpen(item)}
                className={cn(
                  "flex w-full gap-2.5 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent/60",
                  item.read_at === null && "bg-accent/30",
                )}
              >
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", SEVERITY_CLASS[item.severity] ?? "")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.title}</span>
                  {item.body && <span className="mt-0.5 block text-xs text-muted-foreground">{item.body}</span>}
                  <span className="mt-1 block text-[11px] text-muted-foreground">{relativeTime(item.created_at)}</span>
                </span>
              </button>
            );
          })}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

/**
 * True when the feed endpoint is simply not deployed yet. Kept exported so a
 * caller can hide the bell entirely rather than showing an empty popover.
 */
export function isFeedUnavailable(error: unknown): boolean {
  return isApiError(error) && error.isNotFound;
}

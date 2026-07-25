import type * as React from "react";
import { Link } from "react-router-dom";
import { TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Colour accents reuse the status tokens so tiles match the badges below them. */
export type StatTone = "default" | "positive" | "negative" | "warning" | "info";

const TONE_ICON: Record<StatTone, string> = {
  default: "bg-muted text-muted-foreground",
  positive: "bg-status-paid-bg text-status-paid",
  negative: "bg-status-overdue-bg text-status-overdue",
  warning: "bg-status-pending-bg text-status-pending",
  info: "bg-status-in-progress-bg text-status-in-progress",
};

export interface StatCardProps {
  label: string;
  /** Pre-formatted: pass <MoneyText/> for currency, a string for counts. */
  value: React.ReactNode;
  icon?: LucideIcon;
  tone?: StatTone;
  /** Secondary line, e.g. "12 due this week". */
  hint?: string;
  /** Percentage change vs the comparison period. Sign drives the arrow. */
  delta?: number;
  deltaLabel?: string;
  loading?: boolean;
  /** Makes the whole tile a link — usually to the filtered list behind it. */
  to?: string;
  className?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "default",
  hint,
  delta,
  deltaLabel,
  loading = false,
  to,
  className,
}: StatCardProps) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const DeltaIcon = hasDelta && delta < 0 ? TrendingDown : TrendingUp;

  const body = (
    <Card
      className={cn(
        "h-full p-4 transition-colors",
        to && "hover:border-primary/40 hover:bg-accent/40",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>

          {loading ? (
            <Skeleton className="h-7 w-28" />
          ) : (
            <div className="truncate text-2xl font-semibold tracking-tight tabular">{value}</div>
          )}

          {(hint || hasDelta) && !loading && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              {hasDelta && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 font-medium",
                    delta < 0 ? "text-status-overdue" : "text-status-paid",
                  )}
                >
                  <DeltaIcon className="h-3 w-3" aria-hidden />
                  {Math.abs(delta).toFixed(1)}%
                  {deltaLabel && <span className="font-normal text-muted-foreground">{deltaLabel}</span>}
                </span>
              )}
              {hint && <span className="text-muted-foreground">{hint}</span>}
            </div>
          )}
        </div>

        {Icon && (
          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", TONE_ICON[tone])}>
            <Icon className="h-4 w-4" aria-hidden />
          </div>
        )}
      </div>
    </Card>
  );

  return to ? (
    <Link to={to} className="block focus-visible:rounded-lg">
      {body}
    </Link>
  ) : (
    body
  );
}

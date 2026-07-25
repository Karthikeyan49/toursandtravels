import type * as React from "react";
import { Inbox, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void; icon?: LucideIcon };
  /** Rendered instead of `action` when a link or a menu is needed. */
  children?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  children,
  className,
  compact = false,
}: EmptyStateProps) {
  const ActionIcon = action?.icon;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-muted text-muted-foreground",
          compact ? "h-9 w-9" : "h-12 w-12",
        )}
      >
        <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} aria-hidden />
      </div>

      <div className="space-y-1">
        <p className={cn("font-medium", compact ? "text-sm" : "text-base")}>{title}</p>
        {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      </div>

      {action && (
        <Button size="sm" onClick={action.onClick} className="mt-1">
          {ActionIcon && <ActionIcon aria-hidden />}
          {action.label}
        </Button>
      )}
      {children}
    </div>
  );
}

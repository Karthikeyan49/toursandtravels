import { useCallback, useState, type ReactNode } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for cancellations, voids and deletes. */
  destructive?: boolean;
  icon?: LucideIcon;
  /**
   * May be async. The dialog stays open with a spinner until it settles, and
   * closes only on success — so a failed cancellation does not look like it
   * worked.
   */
  onConfirm: () => void | Promise<void>;
  /** Extra content between the description and the buttons (e.g. a reason box). */
  children?: ReactNode;
  /** Blocks confirm while the caller's own preconditions are unmet. */
  confirmDisabled?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  icon: Icon,
  onConfirm,
  children,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);

  const handleConfirm = useCallback(async () => {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      toast.fromError(error, "The action could not be completed", true);
    } finally {
      setPending(false);
    }
  }, [onConfirm, onOpenChange]);

  return (
    <AlertDialog
      open={open}
      // Ignore outside clicks and Escape while the action is in flight.
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {Icon && (
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full",
                  destructive ? "bg-status-cancelled-bg text-status-cancelled" : "bg-accent text-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </span>
            )}
            {title}
          </AlertDialogTitle>
          {description && <AlertDialogDescription asChild><div>{description}</div></AlertDialogDescription>}
        </AlertDialogHeader>

        {children}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || confirmDisabled}
            // Radix closes on click by default; the async handler owns closing.
            onClick={(event) => {
              event.preventDefault();
              void handleConfirm();
            }}
            className={cn(destructive && buttonVariants({ variant: "destructive" }))}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

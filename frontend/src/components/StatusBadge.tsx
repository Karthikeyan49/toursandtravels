import { cn, humanize, slugifyStatus } from "@/lib/utils";

/** The status-* colour groups defined in index.css. */
export type StatusToken =
  | "draft"
  | "confirmed"
  | "vouchered"
  | "in-progress"
  | "completed"
  | "cancelled"
  | "pending"
  | "paid"
  | "overdue"
  | "won"
  | "lost";

/**
 * Class strings are written out in full on purpose. Tailwind's scanner reads
 * source text, so an interpolated `bg-status-${token}-bg` would never be
 * generated and every badge would render transparent.
 */
const TOKEN_CLASS: Record<StatusToken, string> = {
  draft: "bg-status-draft-bg text-status-draft",
  confirmed: "bg-status-confirmed-bg text-status-confirmed",
  vouchered: "bg-status-vouchered-bg text-status-vouchered",
  "in-progress": "bg-status-in-progress-bg text-status-in-progress",
  completed: "bg-status-completed-bg text-status-completed",
  cancelled: "bg-status-cancelled-bg text-status-cancelled",
  pending: "bg-status-pending-bg text-status-pending",
  paid: "bg-status-paid-bg text-status-paid",
  overdue: "bg-status-overdue-bg text-status-overdue",
  won: "bg-status-won-bg text-status-won",
  lost: "bg-status-lost-bg text-status-lost",
};

interface StatusMeta {
  token: StatusToken;
  label: string;
}

/**
 * One table for every document type in the app. Where two modules share a word
 * they deliberately share a colour: purple always means "a document has gone
 * out to the customer or supplier", amber always means "waiting on someone".
 */
const STATUS_MAP: Record<string, StatusMeta> = {
  // --- Leads / enquiries ---
  new: { token: "pending", label: "New" },
  contacted: { token: "in-progress", label: "Contacted" },
  qualified: { token: "in-progress", label: "Qualified" },
  proposal_sent: { token: "vouchered", label: "Proposal sent" },
  negotiation: { token: "pending", label: "Negotiation" },
  won: { token: "won", label: "Won" },
  lost: { token: "lost", label: "Lost" },
  dropped: { token: "lost", label: "Dropped" },

  // --- Quotations ---
  draft: { token: "draft", label: "Draft" },
  sent: { token: "vouchered", label: "Sent" },
  revised: { token: "in-progress", label: "Revised" },
  accepted: { token: "won", label: "Accepted" },
  rejected: { token: "lost", label: "Rejected" },
  expired: { token: "overdue", label: "Expired" },

  // --- Bookings ---
  pending: { token: "pending", label: "Pending" },
  confirmed: { token: "confirmed", label: "Confirmed" },
  vouchered: { token: "vouchered", label: "Vouchered" },
  in_progress: { token: "in-progress", label: "In progress" },
  completed: { token: "completed", label: "Completed" },
  cancelled: { token: "cancelled", label: "Cancelled" },
  no_show: { token: "cancelled", label: "No show" },
  on_hold: { token: "pending", label: "On hold" },

  // --- Payments / invoices ---
  unpaid: { token: "pending", label: "Unpaid" },
  partial: { token: "in-progress", label: "Part paid" },
  partially_paid: { token: "in-progress", label: "Part paid" },
  paid: { token: "paid", label: "Paid" },
  overdue: { token: "overdue", label: "Overdue" },
  refunded: { token: "draft", label: "Refunded" },
  failed: { token: "cancelled", label: "Failed" },
  voided: { token: "cancelled", label: "Voided" },
  void: { token: "cancelled", label: "Voided" },

  // --- Supplier bills ---
  approved: { token: "confirmed", label: "Approved" },
  disputed: { token: "cancelled", label: "Disputed" },

  // --- Trips / operations ---
  scheduled: { token: "confirmed", label: "Scheduled" },
  assigned: { token: "confirmed", label: "Assigned" },
  unassigned: { token: "pending", label: "Unassigned" },

  // --- Vouchers ---
  issued: { token: "vouchered", label: "Issued" },

  // --- Incidents ---
  open: { token: "pending", label: "Open" },
  investigating: { token: "in-progress", label: "Investigating" },
  resolved: { token: "completed", label: "Resolved" },
  closed: { token: "draft", label: "Closed" },
  escalated: { token: "overdue", label: "Escalated" },

  // --- Generic record states ---
  active: { token: "confirmed", label: "Active" },
  inactive: { token: "draft", label: "Inactive" },
  archived: { token: "draft", label: "Archived" },
};

/** Resolves a raw backend status to its token + display label. */
export function statusMeta(status: string | null | undefined): StatusMeta {
  const key = slugifyStatus(status);
  if (key === "") return { token: "draft", label: "—" };
  // Unknown values still render, greyed, with a readable label — a new backend
  // enum value must never blank out a table cell.
  return STATUS_MAP[key] ?? { token: "draft", label: humanize(key) };
}

export function statusToken(status: string | null | undefined): StatusToken {
  return statusMeta(status).token;
}

export interface StatusBadgeProps {
  status: string | null | undefined;
  /** Overrides the derived label; the colour still comes from `status`. */
  label?: string;
  size?: "sm" | "default";
  /** Adds a leading dot — useful in dense tables where colour alone is subtle. */
  dot?: boolean;
  className?: string;
}

export function StatusBadge({ status, label, size = "default", dot = false, className }: StatusBadgeProps) {
  const meta = statusMeta(status);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-0.5 text-xs",
        TOKEN_CLASS[meta.token],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {label ?? meta.label}
    </span>
  );
}

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { qk } from "@/lib/api/queries";
import { exportReportCsv, type ReportSlug } from "@/lib/api/reports";
import { listDestinationOptions } from "@/lib/api/destinations";
import { listPackageOptions } from "@/lib/api/packages";
import { listUsers } from "@/lib/api/users";
import { listCustomers } from "@/lib/api/customers";
import { formatPercent, toISODate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TableCell } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Bits every sub-report of the Reports hub repeats: the CSV export button, the
 * four filter pickers, and the percentage/total cells. Kept in one place so the
 * six tabs stay readable and the filter controls behave identically.
 */

/** The shape `exportReportCsv` accepts — the on-screen filters, flattened. */
export type ExportParams = Record<string, string | number | boolean | undefined>;

export const ALL_OPTION = "__all__";

/** Reports default to the last three whole months up to today. */
export function defaultReportRange(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  return { from: toISODate(start) ?? "", to: toISODate(now) ?? "" };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function ExportButton({
  slug,
  params,
  disabled = false,
}: {
  slug: ReportSlug;
  params: ExportParams;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      // Server-rendered CSV — the same rows the table above is showing.
      const blob = await exportReportCsv(slug, params);
      downloadCsv(blob, `${slug}-${toISODate(new Date()) ?? "export"}.csv`);
      toast.success("Export downloaded");
    } catch (error) {
      toast.fromError(error, "Could not export this report", true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={download} disabled={disabled || busy}>
      <Download />
      {busy ? "Exporting…" : "Export CSV"}
    </Button>
  );
}

/** Object URLs leak until revoked; Safari cancels the download if revoked too soon. */
function downloadCsv(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** The filter strip above every report table. */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-4">{children}</CardContent>
    </Card>
  );
}

/** Right-aligned numeric cell for a DataTable `footer` totals row. */
export function TotalCell({
  children,
  align = "right",
  className,
  hideOnMobile = false,
}: {
  children?: ReactNode;
  align?: "left" | "right";
  className?: string;
  hideOnMobile?: boolean;
}) {
  return (
    <TableCell
      className={cn(
        "font-medium",
        align === "right" ? "text-right" : "text-left",
        hideOnMobile && "hidden md:table-cell",
        className,
      )}
    >
      {children}
    </TableCell>
  );
}

/**
 * Percentages that the API may not be able to compute (no spend attributed, no
 * services booked) come back `null` and must read as "unknown", never as zero.
 */
export function PercentText({
  value,
  decimals = 1,
  tone = "none",
  className,
}: {
  value: number | null | undefined;
  decimals?: number;
  /** "good-high" — green when high; "good-low" — green when low. */
  tone?: "none" | "good-high" | "good-low";
  className?: string;
}) {
  const known = typeof value === "number" && Number.isFinite(value);
  const good = !known
    ? undefined
    : tone === "good-high"
      ? value >= 90
      : tone === "good-low"
        ? value <= 2
        : undefined;
  const bad = !known
    ? undefined
    : tone === "good-high"
      ? value < 70
      : tone === "good-low"
        ? value > 10
        : undefined;

  return (
    <span
      className={cn(
        "tabular whitespace-nowrap",
        !known && "text-muted-foreground",
        good && "text-status-paid",
        bad && "text-status-overdue",
        className,
      )}
    >
      {known ? formatPercent(value, decimals) : "—"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Filter pickers — every report draws its lookups from the same cached queries
// ---------------------------------------------------------------------------

export function DestinationSelect({
  value,
  onChange,
  className = "w-44",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const query = useQuery({ queryKey: qk.destinations.options, queryFn: listDestinationOptions });

  return (
    <Select value={value || ALL_OPTION} onValueChange={(v) => onChange(v === ALL_OPTION ? "" : v)}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Destination" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_OPTION}>All destinations</SelectItem>
        {(query.data ?? []).map((d) => (
          <SelectItem key={d.id} value={String(d.id)}>
            {d.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PackageSelect({
  value,
  onChange,
  destinationId,
  className = "w-48",
}: {
  value: string;
  onChange: (value: string) => void;
  /** Narrows the list to one destination, matching the destination filter. */
  destinationId?: number;
  className?: string;
}) {
  const query = useQuery({
    queryKey: qk.packages.options(destinationId),
    queryFn: () => listPackageOptions(destinationId),
  });

  return (
    <Select value={value || ALL_OPTION} onValueChange={(v) => onChange(v === ALL_OPTION ? "" : v)}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Package" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_OPTION}>All packages</SelectItem>
        {(query.data ?? []).map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const OWNER_FILTERS = { is_active: true, limit: 200 } as const;

export function OwnerSelect({
  value,
  onChange,
  className = "w-44",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const query = useQuery({
    queryKey: qk.users.list(OWNER_FILTERS),
    queryFn: () => listUsers(OWNER_FILTERS),
  });

  return (
    <Select value={value || ALL_OPTION} onValueChange={(v) => onChange(v === ALL_OPTION ? "" : v)}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Owner" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_OPTION}>Everyone</SelectItem>
        {(query.data?.items ?? []).map((u) => (
          <SelectItem key={u.id} value={String(u.id)}>
            {u.full_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const CUSTOMER_FILTERS = { is_active: true, limit: 200, sort: "full_name", dir: "asc" } as const;

export function CustomerSelect({
  value,
  onChange,
  className = "w-52",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const query = useQuery({
    queryKey: qk.customers.list(CUSTOMER_FILTERS),
    queryFn: () => listCustomers(CUSTOMER_FILTERS),
  });

  return (
    <Select value={value || ALL_OPTION} onValueChange={(v) => onChange(v === ALL_OPTION ? "" : v)}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Customer" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_OPTION}>All customers</SelectItem>
        {(query.data?.items ?? []).map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            {c.full_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

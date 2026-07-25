import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { qk } from "@/lib/api/queries";
import { getNumberingSettings, type NumberingPolicy, type NumberingSeries } from "@/lib/api/settings";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";

/** One entry per document type in NumberSequence::DOCUMENTS. */
const DOC_TYPE_LABELS: Record<string, string> = {
  LEAD: "Lead / enquiry",
  QTN: "Quotation",
  BKG: "Booking",
  INV: "Tax invoice",
  CASH: "Cash bill",
  PAY: "Payment receipt",
  VCH: "Voucher",
  SB: "Supplier bill",
  EXP: "Expense",
  COM: "Commission note",
  PKG: "Package code",
  CUS: "Customer code",
  SUP: "Supplier code",
  AGY: "Agency code",
  TRP: "Trip assignment",
};

const POLICY_LABELS: Record<NumberingPolicy, string> = {
  yearly: "Calendar year",
  monthly: "Monthly",
  financial_year: "Financial year",
  continuous: "Continuous",
};

const POLICY_HINTS: Record<NumberingPolicy, string> = {
  yearly: "Counter restarts every January",
  monthly: "Counter restarts every month",
  financial_year: "Counter restarts every April",
  continuous: "Never restarts",
};

export default function NumberingSettings() {
  const numberingQuery = useQuery({ queryKey: qk.settings.numbering, queryFn: getNumberingSettings });

  const columns: Column<NumberingSeries>[] = [
    {
      key: "doc_type",
      header: "Document",
      render: (row) => (
        <div>
          <p className="font-medium">{DOC_TYPE_LABELS[row.doc_type] ?? row.doc_type}</p>
          <p className="text-xs text-muted-foreground">{row.doc_type}</p>
        </div>
      ),
    },
    {
      key: "prefix",
      header: "Prefix",
      render: (row) => <span className="font-mono text-sm">{row.prefix}</span>,
    },
    {
      key: "policy",
      header: "Reset policy",
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={row.policy} label={POLICY_LABELS[row.policy]} size="sm" />
          <span className="text-[11px] text-muted-foreground">{POLICY_HINTS[row.policy]}</span>
        </div>
      ),
    },
    { key: "padding", header: "Padding", align: "right", render: (row) => row.padding },
    {
      key: "next",
      header: "Next number",
      align: "right",
      render: (row) => <span className="font-mono text-sm">{row.next}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Document numbering"
        description="The number series behind every lead, quotation, booking, invoice and voucher."
      />

      <Card>
        <CardContent className="flex gap-3 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-medium">This screen is read-only</p>
            <p className="text-muted-foreground">
              Series are allocated by the API inside the transaction that creates the document, so a number can never be
              skipped or reused. The prefixes are stored as <span className="font-mono text-xs">seq_&lt;type&gt;_prefix</span>{" "}
              settings and the reset policy is fixed in code — there is no endpoint to change either from here. The
              "next number" column is a preview and does not consume the sequence.
            </p>
          </div>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={numberingQuery.data ?? []}
        rowKey={(row) => row.doc_type}
        loading={numberingQuery.isLoading}
        skeletonRows={15}
        empty={<EmptyState title="No numbering series" description="The API returned no document sequences." />}
        ariaLabel="Document numbering series"
      />
    </div>
  );
}

import { useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/useDebounce";
import { qk } from "@/lib/api/queries";
import { getSupplier } from "@/lib/api/suppliers";
import { formatDate } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { MoneyText } from "@/components/MoneyText";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

export default function SupplierDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { can } = useAuth();
  const canViewCosts = can("view_costs");

  const [from, setFrom] = useState<string | undefined>(undefined);
  const [to, setTo] = useState<string | undefined>(undefined);
  const debouncedFrom = useDebounce(from);
  const debouncedTo = useDebounce(to);

  const supplierQuery = useQuery({
    queryKey: [...qk.suppliers.detail(id), debouncedFrom, debouncedTo],
    queryFn: () => getSupplier(id, { from: debouncedFrom, to: debouncedTo }),
    enabled: Number.isFinite(id),
  });
  const supplier = supplierQuery.data;

  if (supplierQuery.isLoading || !supplier) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={supplier.name}
        backTo="/suppliers"
        meta={<StatusBadge status={supplier.is_active ? "active" : "inactive"} />}
        description={`${supplier.code} · ${humanize(supplier.supplier_type)}`}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Contact" value={supplier.contact_person ?? "—"} />
            <DetailRow label="Phone" value={supplier.phone ?? "—"} />
            {supplier.alt_phone && <DetailRow label="Alt phone" value={supplier.alt_phone} />}
            <DetailRow label="Email" value={supplier.email ?? "—"} />
            <DetailRow label="Address" value={supplier.address ?? "—"} />
            <DetailRow label="City / State" value={[supplier.city, supplier.state].filter(Boolean).join(", ") || "—"} />
            <DetailRow label="GSTIN" value={supplier.gstin ?? "—"} />
            <DetailRow label="Credit days" value={String(supplier.credit_days)} />
            {canViewCosts && <DetailRow label="Credit limit" value={<MoneyText value={supplier.credit_limit} />} />}
            <DetailRow label="Rating" value={supplier.rating ? Number(supplier.rating).toFixed(2) : "Not yet rated"} />
            {(supplier.bank_name || supplier.bank_account) && (
              <>
                <Separator />
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Bank details</p>
                <DetailRow label="Bank" value={supplier.bank_name ?? "—"} />
                <DetailRow label="Account" value={supplier.bank_account ?? "—"} />
                <DetailRow label="IFSC" value={supplier.bank_ifsc ?? "—"} />
              </>
            )}
            {supplier.notes && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
                <p className="mt-1 whitespace-pre-wrap">{supplier.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle>Ledger</CardTitle>
            <div className="flex items-center gap-2">
              <Input type="date" value={from ?? ""} onChange={(e) => setFrom(e.target.value || undefined)} className="w-40" aria-label="From date" />
              <Input type="date" value={to ?? ""} onChange={(e) => setTo(e.target.value || undefined)} className="w-40" aria-label="To date" />
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Bills</p>
              {supplier.ledger.bills.length === 0 ? (
                <EmptyState compact title="No bills yet" description="Supplier bills raised against this vendor will appear here." />
              ) : (
                <div className="space-y-1.5">
                  {supplier.ledger.bills.map((bill) => (
                    <div key={bill.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium">{bill.bill_no}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(bill.bill_date)}{bill.booking_no ? ` · ${bill.booking_no}` : ""}
                          {bill.supplier_ref_no ? ` · Ref ${bill.supplier_ref_no}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <MoneyText value={bill.grand_total} />
                        <StatusBadge status={bill.payment_status} size="sm" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Payments</p>
              {supplier.ledger.payments.length === 0 ? (
                <EmptyState compact title="No payments recorded" description="Payments made to this supplier will appear here." />
              ) : (
                <div className="space-y-1.5">
                  {supplier.ledger.payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium">{payment.payment_no}</p>
                        <p className="text-xs text-muted-foreground">
                          {payment.paid_on ? formatDate(payment.paid_on) : "Scheduled"} · {humanize(payment.mode)}
                          {payment.bill_no ? ` · ${payment.bill_no}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <MoneyText value={payment.amount} />
                        <StatusBadge status={payment.status} size="sm" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

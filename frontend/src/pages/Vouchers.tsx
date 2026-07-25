import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Loader2, Plus, Search, Send, XCircle } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  cancelVoucher,
  issueAllVouchers,
  issueVoucher,
  listVouchers,
  markVoucherSent,
  VOUCHER_STATUSES,
  VOUCHER_TYPES,
  type VoucherFilters,
  type VoucherListItem,
  type VoucherStatus,
  type VoucherType,
} from "@/lib/api/vouchers";
import { listBookings, type BookingListItem } from "@/lib/api/bookings";
import { formatDate, formatDateTime } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "@/hooks/use-toast";
import { applyApiErrors, SelectField, type SelectOption } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Minimal in-file booking search combobox. */
function BookingPicker({ value, onSelect }: { value: BookingListItem | null; onSelect: (booking: BookingListItem | null) => void }) {
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query);
  const searchQuery = useQuery({
    queryKey: qk.bookings.list({ search: debounced, limit: 8 }),
    queryFn: () => listBookings({ search: debounced, limit: 8 }),
    enabled: debounced.length >= 2,
  });

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">Booking</label>
      {value ? (
        <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
          <span>{value.booking_no} · {value.customer_name ?? value.lead_pax_name}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onSelect(null)}>Change</Button>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search booking no, customer…" className="pl-8" />
          {query.length >= 2 && (searchQuery.data?.items.length ?? 0) > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
              {searchQuery.data?.items.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => { onSelect(b); setQuery(""); }}
                >
                  <span>{b.booking_no} · {b.customer_name ?? b.lead_pax_name}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(b.travel_from)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const issueSchema = z.object({ voucher_type: z.enum(VOUCHER_TYPES).optional() });
type IssueFormValues = z.infer<typeof issueSchema>;

function IssueVoucherDialog() {
  const [open, setOpen] = useState(false);
  const [booking, setBooking] = useState<BookingListItem | null>(null);
  const queryClient = useQueryClient();

  const { control, handleSubmit, reset, setError, formState: { isSubmitting } } = useForm<IssueFormValues>({
    resolver: zodResolver(issueSchema),
  });

  const typeOptions: SelectOption[] = VOUCHER_TYPES.map((t) => ({ value: t, label: humanize(t) }));

  const onSubmit = handleSubmit(async (values) => {
    if (!booking) { toast.error("Select a booking first"); return; }
    try {
      await issueVoucher(booking.id, values);
      toast.success("Voucher issued");
      await queryClient.invalidateQueries({ queryKey: qk.vouchers.all });
      reset();
      setBooking(null);
      setOpen(false);
    } catch (error) {
      if (!applyApiErrors(error, setError, ["voucher_type"])) {
        toast.fromError(error, "Could not issue this voucher", true);
      }
    }
  });

  const issueAllMutation = useMutation({
    mutationFn: () => issueAllVouchers(booking!.id),
    onSuccess: async (result) => {
      toast.success(`${result.issued.length} voucher(s) issued`, {
        description: result.skipped.length > 0 ? `${result.skipped.length} service(s) skipped — see the list for reasons.` : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: qk.vouchers.all });
      setOpen(false);
      setBooking(null);
    },
    onError: (error) => toast.fromError(error, "Could not issue vouchers for this booking", true),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { reset(); setBooking(null); } }}>
      <DialogTrigger asChild>
        <Button><Plus /> Issue voucher</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue a voucher</DialogTitle>
          <DialogDescription>One voucher per confirmed service, or issue everything outstanding at once.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <BookingPicker value={booking} onSelect={setBooking} />
          <SelectField control={control} name="voucher_type" label="Voucher type" options={typeOptions} placeholder="Derive from the service" />
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              disabled={!booking || issueAllMutation.isPending}
              onClick={() => issueAllMutation.mutate()}
            >
              {issueAllMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Layers />}
              Issue all for booking
            </Button>
            <Button type="submit" disabled={!booking || isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Issue voucher
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Vouchers() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [voucherType, setVoucherType] = useState<VoucherType | "">("");
  const [status, setStatus] = useState<VoucherStatus | "">("");
  const [page, setPage] = useState(1);
  const [cancelTarget, setCancelTarget] = useState<VoucherListItem | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const filters: VoucherFilters = useMemo(
    () => ({ page, limit: 25, search: debouncedSearch || undefined, voucher_type: voucherType || undefined, status: status || undefined }),
    [page, debouncedSearch, voucherType, status],
  );

  const listQuery = useQuery({ queryKey: qk.vouchers.list(filters), queryFn: () => listVouchers(filters) });

  const cancelMutation = useMutation({
    mutationFn: () => cancelVoucher(cancelTarget!.id, cancelReason.trim()),
    onSuccess: async () => {
      toast.success("Voucher cancelled");
      await queryClient.invalidateQueries({ queryKey: qk.vouchers.all });
      setCancelTarget(null);
      setCancelReason("");
    },
    onError: (error) => toast.fromError(error, "Could not cancel this voucher", true),
  });

  const sentMutation = useMutation({
    mutationFn: (id: number) => markVoucherSent(id),
    onSuccess: async () => { toast.success("Marked as sent"); await queryClient.invalidateQueries({ queryKey: qk.vouchers.all }); },
    onError: (error) => toast.fromError(error, "Could not update this voucher", true),
  });

  const columns: Column<VoucherListItem>[] = [
    {
      key: "voucher_no",
      header: "Voucher",
      render: (row) => (
        <div>
          <p className="font-medium">{row.voucher_no}</p>
          <p className="text-xs text-muted-foreground">{row.booking_no} · {humanize(row.voucher_type)}</p>
        </div>
      ),
    },
    { key: "issued_to", header: "Issued to", render: (row) => row.issued_to ?? row.customer_name ?? "—" },
    { key: "supplier_name", header: "Supplier", render: (row) => row.supplier_name ?? "—", hideOnMobile: true },
    {
      key: "valid_from",
      header: "Valid",
      render: (row) => (row.valid_from ? `${formatDate(row.valid_from)} – ${formatDate(row.valid_to)}` : "—"),
      hideOnMobile: true,
    },
    { key: "issued_at", header: "Issued", render: (row) => (row.issued_at ? formatDateTime(row.issued_at) : "—"), hideOnMobile: true },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {row.status === "issued" && (
            <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); sentMutation.mutate(row.id); }} aria-label="Mark sent">
              <Send />
            </Button>
          )}
          {(row.status === "issued" || row.status === "sent") && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => { e.stopPropagation(); setCancelTarget(row); setCancelReason(""); }}
              aria-label="Cancel"
            >
              <XCircle className="text-destructive" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Vouchers" description="Guest-facing hotel, transport and activity vouchers." actions={<IssueVoucherDialog />} />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search voucher no, booking…" className="pl-8" />
          </div>
          <Select value={voucherType || "__all__"} onValueChange={(v) => { setVoucherType(v === "__all__" ? "" : (v as VoucherType)); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All types</SelectItem>
              {VOUCHER_TYPES.map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status || "__all__"} onValueChange={(v) => { setStatus(v === "__all__" ? "" : (v as VoucherStatus)); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              {VOUCHER_STATUSES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={listQuery.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={listQuery.isLoading}
        empty={<EmptyState title="No vouchers" description="Issued vouchers will appear here." />}
        pagination={listQuery.data?.pagination}
        onPageChange={setPage}
      />

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => { if (!open) setCancelTarget(null); }}
        title="Cancel this voucher?"
        description="A reason is required — the guest and supplier facing document is voided, not deleted."
        confirmLabel="Cancel voucher"
        destructive
        confirmDisabled={cancelReason.trim() === ""}
        onConfirm={async () => {
          await cancelMutation.mutateAsync();
        }}
      >
        <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} placeholder="Reason…" />
      </ConfirmDialog>
    </div>
  );
}

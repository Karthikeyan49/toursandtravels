import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Plus, Search } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  listIncidents,
  reportIncident,
  resolveIncident,
  type IncidentCategory,
  type IncidentFilters,
  type IncidentSeverity,
  type IncidentStatus,
  type TripIncidentListItem,
} from "@/lib/api/ops";
import { listBookings, type BookingListItem } from "@/lib/api/bookings";
import { listSupplierOptions } from "@/lib/api/suppliers";
import { formatDate } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "@/hooks/use-toast";
import { applyApiErrors, NumberField, SelectField, TextareaField, TextField, type SelectOption } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { MoneyText } from "@/components/MoneyText";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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

const SEVERITY_TONE: Record<IncidentSeverity, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-status-in-progress-bg text-status-in-progress",
  high: "bg-status-pending-bg text-status-pending",
  critical: "bg-status-overdue-bg text-status-overdue",
};

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

const incidentSchema = z.object({
  category: z.enum(INCIDENT_CATEGORIES),
  title: z.string().trim().min(1, "Title is required").max(200),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  supplier_id: z.string().optional(),
  incident_date: z.string().optional(),
  description: z.string().trim().max(4000).optional(),
  cost_impact: z.number().min(0).optional(),
});
type IncidentFormValues = z.infer<typeof incidentSchema>;

function ReportIncidentDialog() {
  const [open, setOpen] = useState(false);
  const [booking, setBooking] = useState<BookingListItem | null>(null);
  const queryClient = useQueryClient();

  const { control, handleSubmit, reset, setError, formState: { isSubmitting } } = useForm<IncidentFormValues>({
    resolver: zodResolver(incidentSchema),
    defaultValues: { severity: "low" },
  });

  const suppliersQuery = useQuery({ queryKey: qk.suppliers.options(undefined), queryFn: () => listSupplierOptions(), enabled: open });
  const supplierOptions: SelectOption[] = (suppliersQuery.data ?? []).map((s) => ({ value: String(s.id), label: s.name }));
  const categoryOptions: SelectOption[] = INCIDENT_CATEGORIES.map((c) => ({ value: c, label: humanize(c) }));
  const severityOptions: SelectOption[] = INCIDENT_SEVERITIES.map((s) => ({ value: s, label: humanize(s) }));

  const onSubmit = handleSubmit(async (values) => {
    if (!booking) { toast.error("Select a booking first"); return; }
    try {
      await reportIncident(booking.id, {
        category: values.category,
        title: values.title,
        severity: values.severity,
        supplier_id: values.supplier_id ? Number(values.supplier_id) : null,
        incident_date: values.incident_date,
        description: values.description || null,
        cost_impact: values.cost_impact,
      });
      toast.success("Incident logged");
      await queryClient.invalidateQueries({ queryKey: ["ops", "incidents"] });
      reset({ severity: "low" });
      setBooking(null);
      setOpen(false);
    } catch (error) {
      if (!applyApiErrors(error, setError, ["category", "title", "severity", "supplier_id", "incident_date", "description", "cost_impact"])) {
        toast.fromError(error, "Could not log this incident", true);
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { reset(); setBooking(null); } }}>
      <DialogTrigger asChild>
        <Button><Plus /> Report incident</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Report an incident</DialogTitle>
          <DialogDescription>Feeds supplier ratings and post-tour service recovery.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><BookingPicker value={booking} onSelect={setBooking} /></div>
          <SelectField control={control} name="category" label="Category" options={categoryOptions} required />
          <SelectField control={control} name="severity" label="Severity" options={severityOptions} />
          <TextField control={control} name="title" label="Title" required className="sm:col-span-2" />
          <SelectField control={control} name="supplier_id" label="Supplier" options={supplierOptions} placeholder="Select supplier" />
          <TextField control={control} name="incident_date" label="Incident date" placeholder="YYYY-MM-DD" />
          <NumberField control={control} name="cost_impact" label="Cost impact" min={0} />
          <TextareaField control={control} name="description" label="Description" className="sm:col-span-2" />
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Log incident
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const resolveSchema = z.object({
  action_taken: z.string().trim().min(1, "Describe the action taken").max(4000),
  cost_impact: z.number().min(0).optional(),
  status: z.enum(["resolved", "closed"]).optional(),
});
type ResolveFormValues = z.infer<typeof resolveSchema>;

function ResolveIncidentDialog({ incident, onOpenChange }: { incident: TripIncidentListItem | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { control, handleSubmit, reset, formState: { isSubmitting } } = useForm<ResolveFormValues>({
    resolver: zodResolver(resolveSchema),
    defaultValues: { status: "resolved" },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!incident) return;
    try {
      await resolveIncident(incident.id, values);
      toast.success("Incident updated");
      await queryClient.invalidateQueries({ queryKey: ["ops", "incidents"] });
      reset({ status: "resolved" });
      onOpenChange(false);
    } catch (error) {
      toast.fromError(error, "Could not resolve this incident", true);
    }
  });

  return (
    <Dialog open={incident !== null} onOpenChange={(open) => { onOpenChange(open); if (!open) reset({ status: "resolved" }); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve incident</DialogTitle>
          <DialogDescription>{incident?.title}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <TextareaField control={control} name="action_taken" label="Action taken" required rows={4} />
          <NumberField control={control} name="cost_impact" label="Cost impact (final)" min={0} />
          <SelectField
            control={control}
            name="status"
            label="Outcome"
            options={[{ value: "resolved", label: "Resolved" }, { value: "closed", label: "Closed" }]}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Incidents() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [category, setCategory] = useState<IncidentCategory | "">("");
  const [severity, setSeverity] = useState<IncidentSeverity | "">("");
  const [status, setStatus] = useState<IncidentStatus | "">("");
  const [page, setPage] = useState(1);
  const [resolveTarget, setResolveTarget] = useState<TripIncidentListItem | null>(null);

  const filters: IncidentFilters = useMemo(
    () => ({
      page,
      limit: 25,
      search: debouncedSearch || undefined,
      category: category || undefined,
      severity: severity || undefined,
      status: status || undefined,
      // No explicit status chosen -> default to open/investigating, matching the "Open only" label.
      open_only: status === "" ? true : undefined,
    }),
    [page, debouncedSearch, category, severity, status],
  );

  const listQuery = useQuery({ queryKey: qk.ops.incidents(filters), queryFn: () => listIncidents(filters) });

  const columns: Column<TripIncidentListItem>[] = [
    {
      key: "title",
      header: "Incident",
      render: (row) => (
        <div>
          <p className="font-medium">{row.title}</p>
          <p className="text-xs text-muted-foreground">{row.booking_no} · {row.customer_name ?? "—"}</p>
        </div>
      ),
    },
    { key: "category", header: "Category", render: (row) => humanize(row.category), hideOnMobile: true },
    {
      key: "severity",
      header: "Severity",
      render: (row) => (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_TONE[row.severity]}`}>
          {humanize(row.severity)}
        </span>
      ),
    },
    { key: "supplier_name", header: "Supplier", render: (row) => row.supplier_name ?? "—", hideOnMobile: true },
    { key: "incident_date", header: "Date", render: (row) => formatDate(row.incident_date), hideOnMobile: true },
    { key: "cost_impact", header: "Cost impact", align: "right", render: (row) => <MoneyText value={row.cost_impact} />, hideOnMobile: true },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        ["open", "investigating"].includes(row.status) ? (
          <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); setResolveTarget(row); }} aria-label="Resolve">
            <CheckCircle2 />
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Trip incidents" description="Anything that went wrong on tour — feeds supplier ratings and service recovery." actions={<ReportIncidentDialog />} />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search title, booking…" className="pl-8" />
          </div>
          <Select value={category || "__all__"} onValueChange={(v) => { setCategory(v === "__all__" ? "" : (v as IncidentCategory)); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All categories</SelectItem>
              {INCIDENT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{humanize(c)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={severity || "__all__"} onValueChange={(v) => { setSeverity(v === "__all__" ? "" : (v as IncidentSeverity)); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All severities</SelectItem>
              {INCIDENT_SEVERITIES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status || "__all__"} onValueChange={(v) => { setStatus(v === "__all__" ? "" : (v as IncidentStatus)); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Open only</SelectItem>
              {INCIDENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={listQuery.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={listQuery.isLoading}
        empty={<EmptyState title="No incidents" description="Nothing reported for the current filters." />}
        pagination={listQuery.data?.pagination}
        onPageChange={setPage}
      />

      <ResolveIncidentDialog incident={resolveTarget} onOpenChange={(open) => { if (!open) setResolveTarget(null); }} />
    </div>
  );
}

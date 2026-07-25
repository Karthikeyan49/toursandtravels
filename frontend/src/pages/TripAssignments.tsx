import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, Plus, Search } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  approveTripSheet,
  changeTripAssignmentStatus,
  createTripAssignment,
  getTripAssignment,
  listTripAssignments,
  rejectTripSheet,
  submitTripSheet,
  TRIP_ASSIGNMENT_STATUSES,
  type TripAssignmentFilters,
  type TripAssignmentListItem,
  type TripAssignmentStatus,
} from "@/lib/api/tripAssignments";
import { listBookings, type BookingListItem } from "@/lib/api/bookings";
import { listDrivers, listVehicles } from "@/lib/api/fleet";
import { isApiError } from "@/lib/api/client";
import { formatDate, formatMoney } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { applyApiErrors, NumberField, SelectField, TextField, type SelectOption } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { MoneyText } from "@/components/MoneyText";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

/** Minimal in-file booking search combobox — no shared component may be added. */
function BookingPicker({ value, onSelect }: { value: BookingListItem | null; onSelect: (booking: BookingListItem | null) => void }) {
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query);
  const searchQuery = useQuery({
    queryKey: qk.bookings.list({ search: debounced, limit: 8 }),
    queryFn: () => listBookings({ search: debounced, limit: 8 }),
    enabled: debounced.length >= 2,
  });

  return (
    <div className="space-y-1.5 sm:col-span-2">
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

const assignmentSchema = z.object({
  from_date: z.string().min(1, "Start date is required"),
  to_date: z.string().min(1, "End date is required"),
  vehicle_id: z.string().optional(),
  driver_id: z.string().optional(),
  pickup_point: z.string().trim().max(255).optional(),
  pickup_time: z.string().optional(),
  drop_point: z.string().trim().max(255).optional(),
  estimated_km: z.number().min(0).max(100000).optional(),
  notes: z.string().trim().max(500).optional(),
});
type AssignmentFormValues = z.infer<typeof assignmentSchema>;

function CreateAssignmentDialog() {
  const [open, setOpen] = useState(false);
  const [booking, setBooking] = useState<BookingListItem | null>(null);
  const queryClient = useQueryClient();

  const { control, handleSubmit, reset, setError, formState: { isSubmitting } } = useForm<AssignmentFormValues>({
    resolver: zodResolver(assignmentSchema),
  });

  const vehiclesQuery = useQuery({ queryKey: qk.fleet.vehicles({ limit: 200 }), queryFn: () => listVehicles({ limit: 200 }), enabled: open });
  const driversQuery = useQuery({ queryKey: qk.fleet.drivers({ limit: 200 }), queryFn: () => listDrivers({ limit: 200 }), enabled: open });

  const vehicleOptions: SelectOption[] = (vehiclesQuery.data?.items ?? []).map((v) => ({ value: String(v.id), label: `${v.registration_no} · ${v.vehicle_type_name}` }));
  const driverOptions: SelectOption[] = (driversQuery.data?.items ?? []).map((d) => ({ value: String(d.id), label: d.full_name }));

  const onSubmit = handleSubmit(async (values) => {
    if (!booking) {
      toast.error("Select a booking first");
      return;
    }
    try {
      await createTripAssignment(booking.id, {
        from_date: values.from_date,
        to_date: values.to_date,
        vehicle_id: values.vehicle_id ? Number(values.vehicle_id) : null,
        driver_id: values.driver_id ? Number(values.driver_id) : null,
        pickup_point: values.pickup_point || null,
        pickup_time: values.pickup_time || null,
        drop_point: values.drop_point || null,
        estimated_km: values.estimated_km,
        notes: values.notes || null,
      });
      toast.success("Transport assigned");
      await queryClient.invalidateQueries({ queryKey: qk.tripAssignments.all });
      reset();
      setBooking(null);
      setOpen(false);
    } catch (error) {
      // A clash comes back as a 409 with no field to attach to — it belongs in the banner, not a form field.
      if (isApiError(error) && error.status === 409) {
        toast.error("Assignment conflict", { description: error.message });
        return;
      }
      if (!applyApiErrors(error, setError, ["from_date", "to_date", "vehicle_id", "driver_id", "pickup_point", "pickup_time", "drop_point", "estimated_km", "notes"])) {
        toast.fromError(error, "Could not create this assignment", true);
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { reset(); setBooking(null); } }}>
      <DialogTrigger asChild>
        <Button><Plus /> Assign transport</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Assign a vehicle / driver</DialogTitle>
          <DialogDescription>A double-booked vehicle or driver over an overlapping window is rejected.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <BookingPicker value={booking} onSelect={setBooking} />
          <TextField control={control} name="from_date" label="From date" required placeholder="YYYY-MM-DD" />
          <TextField control={control} name="to_date" label="To date" required placeholder="YYYY-MM-DD" />
          <SelectField control={control} name="vehicle_id" label="Vehicle" options={vehicleOptions} placeholder="Select vehicle" />
          <SelectField control={control} name="driver_id" label="Driver" options={driverOptions} placeholder="Select driver" />
          <TextField control={control} name="pickup_point" label="Pickup point" />
          <TextField control={control} name="pickup_time" label="Pickup time" placeholder="HH:MM" />
          <TextField control={control} name="drop_point" label="Drop point" />
          <NumberField control={control} name="estimated_km" label="Estimated km" min={0} max={100000} />
          <TextField control={control} name="notes" label="Notes" className="sm:col-span-2" />
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Assign
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const tripSheetSchema = z.object({
  sheet_date: z.string().optional(),
  start_km: z.number().min(0).max(9999999),
  end_km: z.number().min(0).max(9999999),
  fuel_amount: z.number().min(0).optional(),
  toll_amount: z.number().min(0).optional(),
  parking_amount: z.number().min(0).optional(),
  driver_allowance: z.number().min(0).optional(),
  other_amount: z.number().min(0).optional(),
  remarks: z.string().trim().max(500).optional(),
});
type TripSheetFormValues = z.infer<typeof tripSheetSchema>;

function AssignmentDetailSheet({ assignmentId, onOpenChange }: { assignmentId: number | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canApprove = can("manage_operations") || can("record_payment");

  const detailQuery = useQuery({
    queryKey: qk.tripAssignments.detail(assignmentId ?? 0),
    queryFn: () => getTripAssignment(assignmentId as number),
    enabled: assignmentId !== null,
  });
  const assignment = detailQuery.data;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.tripAssignments.detail(assignmentId ?? 0) });

  const statusMutation = useMutation({
    mutationFn: (status: TripAssignmentStatus) => changeTripAssignmentStatus(assignmentId as number, status),
    onSuccess: async () => { toast.success("Status updated"); await invalidate(); await queryClient.invalidateQueries({ queryKey: qk.tripAssignments.all }); },
    onError: (error) => toast.fromError(error, "Could not update the trip status", true),
  });

  const approveMutation = useMutation({
    mutationFn: (sheetId: number) => approveTripSheet(sheetId),
    onSuccess: async () => { toast.success("Trip sheet approved"); await invalidate(); },
    onError: (error) => toast.fromError(error, "Could not approve this trip sheet", true),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ sheetId, reason }: { sheetId: number; reason: string }) => rejectTripSheet(sheetId, reason),
    onSuccess: async () => { toast.success("Trip sheet rejected"); await invalidate(); },
    onError: (error) => toast.fromError(error, "Could not reject this trip sheet", true),
  });

  const { control, handleSubmit, reset, formState: { isSubmitting } } = useForm<TripSheetFormValues>({
    resolver: zodResolver(tripSheetSchema),
    defaultValues: { start_km: 0, end_km: 0 },
  });

  const onSubmitSheet = handleSubmit(async (values) => {
    if (!assignmentId) return;
    try {
      await submitTripSheet(assignmentId, values);
      toast.success("Trip sheet submitted");
      await invalidate();
      reset({ start_km: 0, end_km: 0 });
    } catch (error) {
      toast.fromError(error, "Could not submit the trip sheet", true);
    }
  });

  return (
    <Sheet open={assignmentId !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{assignment ? assignment.booking_no : "Trip assignment"}</SheetTitle>
          <SheetDescription>Transport window, status and driver trip sheets.</SheetDescription>
        </SheetHeader>

        {!assignment ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <StatusBadge status={assignment.status} />
              <span className="text-xs text-muted-foreground">{formatDate(assignment.from_date)} – {formatDate(assignment.to_date)}</span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Vehicle</p><p>{assignment.registration_no ?? "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Driver</p><p>{assignment.driver_name ?? "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Pickup</p><p>{assignment.pickup_point ?? "—"} {assignment.pickup_time ?? ""}</p></div>
              <div><p className="text-xs text-muted-foreground">Drop</p><p>{assignment.drop_point ?? "—"}</p></div>
            </div>

            {assignment.allowed_transitions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {assignment.allowed_transitions.map((next) => (
                  <Button key={next} size="sm" variant="outline" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate(next)}>
                    {humanize(next)}
                  </Button>
                ))}
              </div>
            )}

            <Separator />

            <div>
              <h3 className="mb-2 text-sm font-medium">Trip sheets</h3>
              {assignment.trip_sheets.length === 0 ? (
                <EmptyState compact title="No trip sheets yet" description="Submitted after dispatch, with odometer and cost readings." />
              ) : (
                <div className="space-y-2">
                  {assignment.trip_sheets.map((ts) => (
                    <div key={ts.id} className="rounded-md border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{formatDate(ts.sheet_date)}</p>
                        <StatusBadge status={ts.status} size="sm" />
                      </div>
                      <p className="text-xs text-muted-foreground">{ts.total_km} km · {formatMoney(ts.total_amount)}</p>
                      {ts.rejection_reason && <p className="mt-1 text-xs text-status-overdue">{ts.rejection_reason}</p>}
                      {canApprove && ts.status === "submitted" && (
                        <div className="mt-2 flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => approveMutation.mutate(ts.id)} disabled={approveMutation.isPending}>
                            <CheckCircle2 /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => {
                              const reason = window.prompt("Reason for rejecting this trip sheet");
                              if (reason && reason.trim()) rejectMutation.mutate({ sheetId: ts.id, reason: reason.trim() });
                            }}
                            disabled={rejectMutation.isPending}
                          >
                            <AlertCircle /> Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {["confirmed", "dispatched", "in_progress"].includes(assignment.status) && (
              <>
                <Separator />
                <form onSubmit={onSubmitSheet} noValidate className="grid grid-cols-2 gap-3 rounded-lg border p-3">
                  <h3 className="col-span-2 text-sm font-medium">Submit trip sheet</h3>
                  <TextField control={control} name="sheet_date" label="Sheet date" placeholder="YYYY-MM-DD" />
                  <NumberField control={control} name="start_km" label="Start km" required min={0} />
                  <NumberField control={control} name="end_km" label="End km" required min={0} />
                  <NumberField control={control} name="fuel_amount" label="Fuel" min={0} />
                  <NumberField control={control} name="toll_amount" label="Toll" min={0} />
                  <NumberField control={control} name="parking_amount" label="Parking" min={0} />
                  <NumberField control={control} name="driver_allowance" label="Driver allowance" min={0} />
                  <NumberField control={control} name="other_amount" label="Other" min={0} />
                  <TextField control={control} name="remarks" label="Remarks" className="col-span-2" />
                  <div className="col-span-2">
                    <Button type="submit" size="sm" disabled={isSubmitting}>
                      {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                      Submit trip sheet
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function TripAssignments() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [status, setStatus] = useState<TripAssignmentStatus | "">("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<number | null>(null);

  const filters: TripAssignmentFilters = useMemo(
    () => ({ page, limit: 25, search: debouncedSearch || undefined, status: status || undefined }),
    [page, debouncedSearch, status],
  );

  const listQuery = useQuery({ queryKey: qk.tripAssignments.list(filters), queryFn: () => listTripAssignments(filters) });

  const columns: Column<TripAssignmentListItem>[] = [
    {
      key: "booking_no",
      header: "Booking",
      render: (row) => (
        <div>
          <p className="font-medium">{row.booking_no}</p>
          <p className="text-xs text-muted-foreground">{row.customer_name ?? row.lead_pax_name}</p>
        </div>
      ),
    },
    {
      key: "from_date",
      header: "Window",
      render: (row) => (
        <div>
          <p>{formatDate(row.from_date)} – {formatDate(row.to_date)}</p>
          <p className="text-xs text-muted-foreground">{row.pickup_time ?? ""} {row.pickup_point ?? ""}</p>
        </div>
      ),
    },
    { key: "registration_no", header: "Vehicle", render: (row) => row.registration_no ?? "—", hideOnMobile: true },
    { key: "driver_name", header: "Driver", render: (row) => row.driver_name ?? "—", hideOnMobile: true },
    { key: "actual_cost", header: "Actual cost", align: "right", render: (row) => <MoneyText value={row.actual_cost} />, hideOnMobile: true },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Trip assignments"
        description="Vehicle and driver assignments, with trip-sheet reconciliation."
        actions={<CreateAssignmentDialog />}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search booking, vehicle, driver…" className="pl-8" />
          </div>
          <Select value={status || "__all__"} onValueChange={(v) => { setStatus(v === "__all__" ? "" : (v as TripAssignmentStatus)); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              {TRIP_ASSIGNMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={listQuery.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={listQuery.isLoading}
        onRowClick={(row) => setDetailId(row.id)}
        pagination={listQuery.data?.pagination}
        onPageChange={setPage}
      />

      <AssignmentDetailSheet assignmentId={detailId} onOpenChange={(open) => { if (!open) setDetailId(null); }} />
    </div>
  );
}


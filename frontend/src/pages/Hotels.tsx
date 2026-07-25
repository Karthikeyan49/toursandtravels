import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Search } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  archiveHotel,
  createHotel,
  createHotelRate,
  createRoomType,
  getHotel,
  HOTEL_PROPERTY_CATEGORIES,
  listHotels,
  RATE_BASES,
  RATE_MEAL_PLANS,
  ROOM_CATEGORIES,
  updateHotel,
  type Hotel,
  type HotelFilters,
  type HotelListItem,
  type HotelPropertyCategory,
} from "@/lib/api/hotels";
import { listDestinationOptions } from "@/lib/api/destinations";
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
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const hotelSchema = z.object({
  code: z.string().trim().min(1, "Code is required").max(20),
  name: z.string().trim().min(1, "Name is required").max(160),
  destination_id: z.string().min(1, "Destination is required"),
  category: z.enum(HOTEL_PROPERTY_CATEGORIES).optional(),
  address: z.string().trim().max(400).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  child_free_age: z.number().min(0).max(18).optional(),
});
type HotelFormValues = z.infer<typeof hotelSchema>;

const KNOWN_FIELDS = ["code", "name", "destination_id", "category", "address", "phone", "email", "child_free_age"] as const;

function HotelDialog({ hotel, open, onOpenChange }: { hotel: Hotel | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const isEdit = hotel !== null;

  const { control, handleSubmit, reset, setError, formState: { isSubmitting } } = useForm<HotelFormValues>({
    resolver: zodResolver(hotelSchema),
    defaultValues: hotel
      ? {
          code: hotel.code,
          name: hotel.name,
          destination_id: String(hotel.destination_id),
          category: hotel.category,
          address: hotel.address ?? undefined,
          phone: hotel.phone ?? undefined,
          email: hotel.email ?? undefined,
          child_free_age: hotel.child_free_age,
        }
      : { category: "3star" },
  });

  const destinationsQuery = useQuery({ queryKey: qk.destinations.options, queryFn: listDestinationOptions, enabled: open });
  const destinationOptions: SelectOption[] = (destinationsQuery.data ?? []).map((d) => ({ value: String(d.id), label: d.name }));
  const categoryOptions: SelectOption[] = HOTEL_PROPERTY_CATEGORIES.map((c) => ({ value: c, label: humanize(c) }));

  const onSubmit = handleSubmit(async (values) => {
    const input = {
      code: values.code,
      name: values.name,
      destination_id: Number(values.destination_id),
      category: values.category,
      address: values.address || null,
      phone: values.phone || null,
      email: values.email || null,
      child_free_age: values.child_free_age,
    };

    try {
      if (isEdit) {
        await updateHotel(hotel.id, input);
        toast.success("Hotel updated");
      } else {
        await createHotel(input);
        toast.success("Hotel created");
      }
      await queryClient.invalidateQueries({ queryKey: qk.hotels.all });
      onOpenChange(false);
    } catch (error) {
      if (!applyApiErrors(error, setError, KNOWN_FIELDS)) {
        toast.fromError(error, "Could not save this hotel", true);
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit hotel" : "New hotel"}</DialogTitle>
          <DialogDescription>The property record; add room types and the rate card afterwards.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField control={control} name="code" label="Code" required />
          <TextField control={control} name="name" label="Name" required />
          <SelectField control={control} name="destination_id" label="Destination" options={destinationOptions} required placeholder="Select destination" />
          <SelectField control={control} name="category" label="Category" options={categoryOptions} />
          <TextField control={control} name="address" label="Address" className="sm:col-span-2" />
          <TextField control={control} name="phone" label="Phone" />
          <TextField control={control} name="email" label="Email" type="email" />
          <NumberField control={control} name="child_free_age" label="Child free up to age" min={0} max={18} />
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {isEdit ? "Save changes" : "Create hotel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const roomTypeSchema = z.object({
  name: z.string().trim().min(1, "Room name is required").max(120),
  room_category: z.enum(ROOM_CATEGORIES).optional(),
  max_adults: z.number().min(1).max(10).optional(),
  max_children: z.number().min(0).max(10).optional(),
  extra_beds: z.number().min(0).max(5).optional(),
});
type RoomTypeFormValues = z.infer<typeof roomTypeSchema>;

function AddRoomTypeForm({ hotelId }: { hotelId: number }) {
  const queryClient = useQueryClient();
  const { control, handleSubmit, reset, formState: { isSubmitting } } = useForm<RoomTypeFormValues>({
    resolver: zodResolver(roomTypeSchema),
    defaultValues: { max_adults: 2, max_children: 1, extra_beds: 0, room_category: "normal" },
  });

  const categoryOptions: SelectOption[] = ROOM_CATEGORIES.map((c) => ({ value: c, label: humanize(c) }));

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createRoomType(hotelId, values);
      toast.success("Room type added");
      await queryClient.invalidateQueries({ queryKey: qk.hotels.detail(hotelId) });
      reset({ max_adults: 2, max_children: 1, extra_beds: 0, room_category: "normal", name: "" });
    } catch (error) {
      toast.fromError(error, "Could not add this room type", true);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3 rounded-lg border p-3">
      <TextField control={control} name="name" label="Room name" required placeholder="e.g. Deluxe Garden View" className="col-span-2" />
      <SelectField control={control} name="room_category" label="Category" options={categoryOptions} />
      <NumberField control={control} name="max_adults" label="Max adults" min={1} max={10} />
      <NumberField control={control} name="max_children" label="Max children" min={0} max={10} />
      <NumberField control={control} name="extra_beds" label="Extra beds" min={0} max={5} />
      <div className="col-span-2">
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Add room type
        </Button>
      </div>
    </form>
  );
}

const rateSchema = z.object({
  room_type_id: z.string().min(1, "Room type is required"),
  valid_from: z.string().min(1, "Start date is required"),
  valid_to: z.string().min(1, "End date is required"),
  season_name: z.string().trim().max(80).optional(),
  meal_plan: z.enum(RATE_MEAL_PLANS).optional(),
  rate_basis: z.enum(RATE_BASES).optional(),
  cost_single: z.number().min(0).optional(),
  cost_double: z.number().min(0).optional(),
  cost_triple: z.number().min(0).optional(),
  cost_extra_bed: z.number().min(0).optional(),
  tax_pct: z.number().min(0).max(100).optional(),
});
type RateFormValues = z.infer<typeof rateSchema>;

function AddRateForm({ hotelId, roomTypeOptions }: { hotelId: number; roomTypeOptions: SelectOption[] }) {
  const queryClient = useQueryClient();
  const { control, handleSubmit, reset, setError, formState: { isSubmitting } } = useForm<RateFormValues>({
    resolver: zodResolver(rateSchema),
    defaultValues: { meal_plan: "CP", rate_basis: "per_room" },
  });

  const mealPlanOptions: SelectOption[] = RATE_MEAL_PLANS.map((m) => ({ value: m, label: m }));
  const basisOptions: SelectOption[] = RATE_BASES.map((b) => ({ value: b, label: humanize(b) }));

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createHotelRate(hotelId, { ...values, room_type_id: Number(values.room_type_id) });
      toast.success("Rate added");
      await queryClient.invalidateQueries({ queryKey: qk.hotels.detail(hotelId) });
      reset({ meal_plan: "CP", rate_basis: "per_room" });
    } catch (error) {
      if (!applyApiErrors(error, setError, ["room_type_id", "valid_from", "valid_to", "season_name", "meal_plan", "rate_basis", "cost_single", "cost_double", "cost_triple", "cost_extra_bed", "tax_pct"])) {
        toast.fromError(error, "Could not add this rate", true);
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3 rounded-lg border p-3">
      <SelectField control={control} name="room_type_id" label="Room type" options={roomTypeOptions} required placeholder="Select room type" className="col-span-2" />
      <TextField control={control} name="valid_from" label="Valid from" required placeholder="YYYY-MM-DD" />
      <TextField control={control} name="valid_to" label="Valid to" required placeholder="YYYY-MM-DD" />
      <TextField control={control} name="season_name" label="Season" placeholder="e.g. Peak" />
      <SelectField control={control} name="meal_plan" label="Meal plan" options={mealPlanOptions} />
      <SelectField control={control} name="rate_basis" label="Basis" options={basisOptions} />
      <NumberField control={control} name="cost_double" label="Cost (double)" min={0} />
      <NumberField control={control} name="cost_single" label="Cost (single)" min={0} />
      <NumberField control={control} name="cost_triple" label="Cost (triple)" min={0} />
      <NumberField control={control} name="cost_extra_bed" label="Cost (extra bed)" min={0} />
      <NumberField control={control} name="tax_pct" label="Tax %" min={0} max={100} />
      <div className="col-span-2">
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Add rate
        </Button>
      </div>
    </form>
  );
}

function HotelDetailSheet({
  hotelId,
  onOpenChange,
  canManageRates,
}: {
  hotelId: number | null;
  onOpenChange: (open: boolean) => void;
  canManageRates: boolean;
}) {
  const detailQuery = useQuery({
    queryKey: qk.hotels.detail(hotelId ?? 0),
    queryFn: () => getHotel(hotelId as number),
    enabled: hotelId !== null,
  });
  const hotel = detailQuery.data;

  const roomTypeOptions: SelectOption[] = (hotel?.room_types ?? []).map((rt) => ({ value: String(rt.id), label: rt.name }));

  return (
    <Sheet open={hotelId !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{hotel ? hotel.name : "Hotel"}</SheetTitle>
          <SheetDescription>Room types and the contracted seasonal rate card.</SheetDescription>
        </SheetHeader>

        {!hotel ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="mb-2 text-sm font-medium">Room types</h3>
              {hotel.room_types.length === 0 ? (
                <EmptyState compact title="No room types yet" description="Add the property's room types below." />
              ) : (
                <div className="mb-3 space-y-1.5">
                  {hotel.room_types.map((rt) => (
                    <div key={rt.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium">{rt.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {humanize(rt.room_category)} · {rt.max_adults} adults, {rt.max_children} children
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {hotelId !== null && <AddRoomTypeForm hotelId={hotelId} />}
            </div>

            <Separator />

            <div>
              <h3 className="mb-2 text-sm font-medium">Rate card</h3>
              {hotel.rates.length === 0 ? (
                <EmptyState compact title="No rates yet" description="Add a seasonal rate for each room type." />
              ) : (
                <div className="mb-3 space-y-1.5">
                  {hotel.rates.map((r) => (
                    <div key={r.id} className="rounded-md border px-3 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{r.room_type_name} · {r.meal_plan}</p>
                        <StatusBadge status={r.is_active ? "active" : "inactive"} size="sm" />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {r.valid_from} – {r.valid_to}{r.season_name ? ` · ${r.season_name}` : ""}
                      </p>
                      <p className="mt-1 text-xs">
                        Double <MoneyText value={r.cost_double} /> · Single <MoneyText value={r.cost_single} /> · Triple <MoneyText value={r.cost_triple} />
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {canManageRates && hotelId !== null && roomTypeOptions.length > 0 && (
                <AddRateForm hotelId={hotelId} roomTypeOptions={roomTypeOptions} />
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function Hotels() {
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [category, setCategory] = useState<HotelPropertyCategory | "">("");
  const [page, setPage] = useState(1);
  const [dialogTarget, setDialogTarget] = useState<Hotel | null | "new">(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const filters: HotelFilters = useMemo(
    () => ({ page, limit: 25, search: debouncedSearch || undefined, category: category || undefined }),
    [page, debouncedSearch, category],
  );

  const listQuery = useQuery({ queryKey: qk.hotels.list(filters), queryFn: () => listHotels(filters) });

  const canManageRates = can("edit_prices") || can("manage_operations");

  const columns: Column<HotelListItem>[] = [
    {
      key: "name",
      header: "Hotel",
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-xs text-muted-foreground">{row.code}{row.city_name ? ` · ${row.city_name}` : ""}</p>
        </div>
      ),
    },
    { key: "destination_name", header: "Destination", hideOnMobile: true },
    { key: "category", header: "Category", render: (row) => humanize(row.category) },
    { key: "room_type_count", header: "Room types", align: "right", hideOnMobile: true },
    { key: "live_rate_count", header: "Live rates", align: "right", hideOnMobile: true },
    { key: "is_active", header: "Status", render: (row) => <StatusBadge status={row.is_active ? "active" : "inactive"} /> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); setDialogTarget(row); }} aria-label="Edit">
          <Pencil />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Hotels"
        description="Properties, room types and the contracted seasonal rate card."
        actions={<Button onClick={() => setDialogTarget("new")}><Plus /> Add hotel</Button>}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name or code…" className="pl-8" />
          </div>
          <Select value={category || "__all__"} onValueChange={(v) => { setCategory(v === "__all__" ? "" : (v as HotelPropertyCategory)); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All categories</SelectItem>
              {HOTEL_PROPERTY_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{humanize(c)}</SelectItem>)}
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

      {dialogTarget !== null && (
        <HotelDialog
          hotel={dialogTarget === "new" ? null : dialogTarget}
          open={dialogTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDialogTarget(null);
            void queryClient.invalidateQueries({ queryKey: qk.hotels.all });
          }}
        />
      )}

      <HotelDetailSheet
        hotelId={detailId}
        onOpenChange={(open) => { if (!open) setDetailId(null); }}
        canManageRates={canManageRates}
      />
    </div>
  );
}

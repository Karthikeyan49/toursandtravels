import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, GripVertical, Loader2, Plus, Rocket, Trash2 } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  archivePackage,
  createDeparture,
  createPackagePrice,
  deactivatePackagePrice,
  DAY_MEAL_PLANS,
  DEPARTURE_STATUSES,
  getPackage,
  PACKAGE_HOTEL_CATEGORIES,
  publishPackage,
  savePackageItinerary,
  type PackageDayInput,
} from "@/lib/api/packages";
import { listCities } from "@/lib/api/destinations";
import { formatDate, formatDuration } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { applyApiErrors, NumberField, SelectField, TextField, TextareaField, type SelectOption } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { MoneyText } from "@/components/MoneyText";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// --- Itinerary -------------------------------------------------------------

const itineraryDaySchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(2000).optional(),
  meal_plan: z.enum(DAY_MEAL_PLANS).optional(),
  city_id: z.string().optional(),
});
const itinerarySchema = z.object({ days: z.array(itineraryDaySchema).min(1, "Add at least one day") });
type ItineraryFormValues = z.infer<typeof itinerarySchema>;

function ItineraryEditor({ packageId, days, destinationId }: { packageId: number; days: PackageDayInput[]; destinationId: number }) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canEdit = can("edit_prices") || can("manage_operations");

  const { control, handleSubmit, formState: { isSubmitting, isDirty } } = useForm<ItineraryFormValues>({
    resolver: zodResolver(itinerarySchema),
    defaultValues: {
      days: days.length > 0
        ? days.map((d) => ({
            title: d.title,
            description: d.description ?? undefined,
            meal_plan: d.meal_plan,
            city_id: d.city_id ? String(d.city_id) : undefined,
          }))
        : [{ title: "Day 1", meal_plan: "none" }],
    },
  });
  const { fields, append, remove, move } = useFieldArray({ control, name: "days" });

  const citiesQuery = useQuery({ queryKey: ["cities", destinationId], queryFn: () => listCities(destinationId), enabled: Boolean(destinationId) });
  const cityOptions: SelectOption[] = (citiesQuery.data ?? []).map((c) => ({ value: String(c.id), label: c.name }));
  const mealPlanOptions: SelectOption[] = DAY_MEAL_PLANS.map((m) => ({ value: m, label: m === "none" ? "No meals" : m }));

  const onSubmit = handleSubmit(async (values) => {
    try {
      await savePackageItinerary(
        packageId,
        values.days.map((d, i) => ({
          day_no: i + 1,
          title: d.title,
          description: d.description || null,
          meal_plan: d.meal_plan,
          city_id: d.city_id ? Number(d.city_id) : null,
        })),
      );
      toast.success("Itinerary saved");
      await queryClient.invalidateQueries({ queryKey: qk.packages.detail(packageId) });
    } catch (error) {
      toast.fromError(error, "Could not save the itinerary", true);
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-3">
        {fields.map((field, index) => (
          <div key={field.id} className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <GripVertical className="h-4 w-4 text-muted-foreground" aria-hidden />
                Day {index + 1}
              </span>
              {canEdit && fields.length > 1 && (
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(index)} aria-label="Remove day">
                  <Trash2 className="text-destructive" />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField control={control} name={`days.${index}.title`} label="Title" required disabled={!canEdit} />
              <SelectField control={control} name={`days.${index}.city_id`} label="City" options={cityOptions} placeholder="Select city" disabled={!canEdit} />
              <SelectField control={control} name={`days.${index}.meal_plan`} label="Meal plan" options={mealPlanOptions} disabled={!canEdit} />
              <TextareaField control={control} name={`days.${index}.description`} label="Description" className="sm:col-span-2" disabled={!canEdit} rows={2} />
            </div>
            <div className="mt-2 flex gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={index === 0 || !canEdit} onClick={() => move(index, index - 1)}>Move up</Button>
              <Button type="button" variant="ghost" size="sm" disabled={index === fields.length - 1 || !canEdit} onClick={() => move(index, index + 1)}>Move down</Button>
            </div>
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => append({ title: `Day ${fields.length + 1}`, meal_plan: "none" })}>
            <Plus /> Add day
          </Button>
          <Button type="submit" size="sm" disabled={isSubmitting || !isDirty}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Save itinerary
          </Button>
        </div>
      )}
    </form>
  );
}

// --- Rate slabs -------------------------------------------------------------

const priceSchema = z.object({
  label: z.string().trim().max(80).optional(),
  hotel_category: z.enum(PACKAGE_HOTEL_CATEGORIES).optional(),
  pax_from: z.number().min(1).max(999).optional(),
  pax_to: z.number().min(1).max(999).optional(),
  valid_from: z.string().min(1, "Start date is required"),
  valid_to: z.string().min(1, "End date is required"),
  cost_per_adult: z.number().min(0).optional(),
  price_single: z.number().min(0).optional(),
  price_double: z.number().min(0.01, "Twin-sharing price is required"),
  price_triple: z.number().min(0).optional(),
  price_child_bed: z.number().min(0).optional(),
  price_child_nobed: z.number().min(0).optional(),
  price_infant: z.number().min(0).optional(),
});
type PriceFormValues = z.infer<typeof priceSchema>;

function RateSlabTab({ packageId, prices, canViewCosts, canEdit }: { packageId: number; prices: import("@/lib/api/packages").PackagePrice[]; canViewCosts: boolean; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [deactivateTarget, setDeactivateTarget] = useState<number | null>(null);

  const { control, handleSubmit, reset, setError, formState: { isSubmitting } } = useForm<PriceFormValues>({
    resolver: zodResolver(priceSchema),
    defaultValues: { hotel_category: "3star", pax_from: 1, pax_to: 999 },
  });

  const categoryOptions: SelectOption[] = PACKAGE_HOTEL_CATEGORIES.map((c) => ({ value: c, label: humanize(c) }));

  const deactivateMutation = useMutation({
    mutationFn: (priceId: number) => deactivatePackagePrice(packageId, priceId),
    onSuccess: async () => {
      toast.success("Rate slab deactivated");
      await queryClient.invalidateQueries({ queryKey: qk.packages.detail(packageId) });
      setDeactivateTarget(null);
    },
    onError: (error) => { toast.fromError(error, "Could not deactivate this slab", true); setDeactivateTarget(null); },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createPackagePrice(packageId, values);
      toast.success("Rate slab added");
      await queryClient.invalidateQueries({ queryKey: qk.packages.detail(packageId) });
      reset({ hotel_category: "3star", pax_from: 1, pax_to: 999 });
    } catch (error) {
      if (!applyApiErrors(error, setError, ["label", "hotel_category", "pax_from", "pax_to", "valid_from", "valid_to", "cost_per_adult", "price_single", "price_double", "price_triple", "price_child_bed", "price_child_nobed", "price_infant"])) {
        toast.fromError(error, "Could not add this rate slab", true);
      }
    }
  });

  return (
    <div className="space-y-5">
      {prices.length === 0 ? (
        <EmptyState compact title="No rate slabs yet" description="Publishing requires at least one live, current slab." />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Pax range</th>
                <th className="px-3 py-2 text-left">Valid</th>
                {canViewCosts && <th className="px-3 py-2 text-right">Cost/adult</th>}
                <th className="px-3 py-2 text-right">Single</th>
                <th className="px-3 py-2 text-right">Double</th>
                <th className="px-3 py-2 text-right">Triple</th>
                <th className="px-3 py-2 text-center">Status</th>
                {canEdit && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {prices.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-2">{humanize(p.hotel_category)}{p.label ? ` · ${p.label}` : ""}</td>
                  <td className="px-3 py-2">{p.pax_from}–{p.pax_to}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(p.valid_from)} – {formatDate(p.valid_to)}</td>
                  {canViewCosts && <td className="px-3 py-2 text-right"><MoneyText value={p.cost_per_adult} /></td>}
                  <td className="px-3 py-2 text-right"><MoneyText value={p.price_single} /></td>
                  <td className="px-3 py-2 text-right"><MoneyText value={p.price_double} /></td>
                  <td className="px-3 py-2 text-right"><MoneyText value={p.price_triple} /></td>
                  <td className="px-3 py-2 text-center"><StatusBadge status={p.is_active ? "active" : "inactive"} size="sm" /></td>
                  {canEdit && (
                    <td className="px-3 py-2 text-right">
                      {p.is_active === 1 && (
                        <Button variant="ghost" size="icon-sm" onClick={() => setDeactivateTarget(p.id)} aria-label="Deactivate">
                          <Trash2 className="text-destructive" />
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3 rounded-lg border p-3 sm:grid-cols-4">
          <SelectField control={control} name="hotel_category" label="Hotel category" options={categoryOptions} />
          <TextField control={control} name="label" label="Label" placeholder="e.g. Peak season" />
          <NumberField control={control} name="pax_from" label="Pax from" min={1} max={999} />
          <NumberField control={control} name="pax_to" label="Pax to" min={1} max={999} />
          <TextField control={control} name="valid_from" label="Valid from" required placeholder="YYYY-MM-DD" />
          <TextField control={control} name="valid_to" label="Valid to" required placeholder="YYYY-MM-DD" />
          {canViewCosts && <NumberField control={control} name="cost_per_adult" label="Cost / adult" min={0} />}
          <NumberField control={control} name="price_double" label="Price (double)" required min={0} />
          <NumberField control={control} name="price_single" label="Price (single)" min={0} />
          <NumberField control={control} name="price_triple" label="Price (triple)" min={0} />
          <NumberField control={control} name="price_child_bed" label="Child (with bed)" min={0} />
          <NumberField control={control} name="price_child_nobed" label="Child (no bed)" min={0} />
          <NumberField control={control} name="price_infant" label="Infant" min={0} />
          <div className="col-span-2 sm:col-span-4">
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Add rate slab
            </Button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={deactivateTarget !== null}
        onOpenChange={(open) => { if (!open) setDeactivateTarget(null); }}
        title="Deactivate this rate slab?"
        description="Quotations already using it are unaffected; new quotes will not see it."
        confirmLabel="Deactivate"
        destructive
        onConfirm={async () => { if (deactivateTarget) await deactivateMutation.mutateAsync(deactivateTarget); }}
      />
    </div>
  );
}

// --- Departures --------------------------------------------------------------

const departureSchema = z.object({
  departure_date: z.string().min(1, "Departure date is required"),
  return_date: z.string().optional(),
  seats_total: z.number().min(1, "At least 1 seat").max(2000),
  batch_code: z.string().trim().max(30).optional(),
});
type DepartureFormValues = z.infer<typeof departureSchema>;

function DeparturesTab({ packageId, departures, canEdit }: { packageId: number; departures: import("@/lib/api/packages").Departure[]; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { control, handleSubmit, reset, setError, formState: { isSubmitting } } = useForm<DepartureFormValues>({
    resolver: zodResolver(departureSchema),
    defaultValues: { seats_total: 20 },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createDeparture(packageId, values);
      toast.success("Departure created");
      await queryClient.invalidateQueries({ queryKey: qk.packages.detail(packageId) });
      await queryClient.invalidateQueries({ queryKey: qk.departures.all });
      reset({ seats_total: 20 });
    } catch (error) {
      if (!applyApiErrors(error, setError, ["departure_date", "return_date", "seats_total", "batch_code"])) {
        toast.fromError(error, "Could not create this departure", true);
      }
    }
  });

  return (
    <div className="space-y-5">
      {departures.length === 0 ? (
        <EmptyState compact title="No departures yet" description="Fixed-departure batches with seat inventory appear here." />
      ) : (
        <div className="space-y-1.5">
          {departures.map((d) => {
            const fillPct = d.seats_total > 0 ? Math.round((d.seats_booked / d.seats_total) * 100) : 0;
            return (
              <div key={d.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{d.batch_code}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(d.departure_date)} – {formatDate(d.return_date)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{d.seats_booked}/{d.seats_total} seats ({fillPct}%)</span>
                  <StatusBadge status={d.status} size="sm" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canEdit && (
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-3 rounded-lg border p-3 sm:grid-cols-4">
          <TextField control={control} name="departure_date" label="Departure date" required placeholder="YYYY-MM-DD" />
          <TextField control={control} name="return_date" label="Return date" placeholder="Auto from nights" />
          <NumberField control={control} name="seats_total" label="Seats" required min={1} max={2000} />
          <TextField control={control} name="batch_code" label="Batch code" placeholder="Auto-generated" />
          <div className="col-span-2 sm:col-span-4">
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Add departure
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// --- Page --------------------------------------------------------------------

export default function PackageDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canEdit = can("edit_prices") || can("manage_operations");
  const canViewCosts = can("view_costs");
  const canPublish = can("edit_prices");

  const [confirmAction, setConfirmAction] = useState<"publish" | "archive" | null>(null);

  const packageQuery = useQuery({ queryKey: qk.packages.detail(id), queryFn: () => getPackage(id), enabled: Number.isFinite(id) });
  const pkg = packageQuery.data;

  const publishMutation = useMutation({
    mutationFn: () => publishPackage(id),
    onSuccess: async () => { toast.success("Package published"); await queryClient.invalidateQueries({ queryKey: qk.packages.detail(id) }); setConfirmAction(null); },
    onError: (error) => { toast.fromError(error, "Could not publish this package", true); setConfirmAction(null); },
  });
  const archiveMutation = useMutation({
    mutationFn: () => archivePackage(id),
    onSuccess: async () => { toast.success("Package archived"); await queryClient.invalidateQueries({ queryKey: qk.packages.detail(id) }); setConfirmAction(null); },
    onError: (error) => { toast.fromError(error, "Could not archive this package", true); setConfirmAction(null); },
  });

  const dayInputs: PackageDayInput[] = useMemo(
    () => (pkg?.days ?? []).map((d) => ({ day_no: d.day_no, title: d.title, description: d.description, meal_plan: d.meal_plan, city_id: d.city_id })),
    [pkg],
  );

  if (packageQuery.isLoading || !pkg) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={pkg.name}
        backTo="/packages"
        meta={<StatusBadge status={pkg.status} />}
        description={`${pkg.code} · ${formatDuration(pkg.nights)}`}
        actions={
          canPublish && (
            <>
              {pkg.status === "draft" && (
                <Button onClick={() => setConfirmAction("publish")} disabled={publishMutation.isPending}>
                  <Rocket /> Publish
                </Button>
              )}
              {pkg.status !== "archived" && (
                <Button variant="outline" onClick={() => setConfirmAction("archive")} disabled={archiveMutation.isPending}>
                  <Archive /> Archive
                </Button>
              )}
            </>
          )
        }
      />

      <Card>
        <CardHeader><CardTitle>Overview</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">Type</p><p className="font-medium">{humanize(pkg.package_type)}</p></div>
          <div><p className="text-xs text-muted-foreground">Scope</p><p className="font-medium">{humanize(pkg.scope)}</p></div>
          <div><p className="text-xs text-muted-foreground">Pax range</p><p className="font-medium">{pkg.min_pax}–{pkg.max_pax || "∞"}</p></div>
          <div><p className="text-xs text-muted-foreground">From</p><p className="font-medium"><MoneyText value={pkg.base_price_adult} /></p></div>
          {pkg.summary && <p className="col-span-2 text-muted-foreground sm:col-span-4">{pkg.summary}</p>}
        </CardContent>
      </Card>

      <Tabs defaultValue="itinerary">
        <TabsList>
          <TabsTrigger value="itinerary">Itinerary</TabsTrigger>
          <TabsTrigger value="rates">Rate slabs</TabsTrigger>
          <TabsTrigger value="departures">Departures</TabsTrigger>
        </TabsList>
        <TabsContent value="itinerary" className="mt-4">
          <Card><CardContent className="pt-6"><ItineraryEditor packageId={id} days={dayInputs} destinationId={pkg.destination_id} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="rates" className="mt-4">
          <Card><CardContent className="pt-6"><RateSlabTab packageId={id} prices={pkg.prices} canViewCosts={canViewCosts} canEdit={canEdit} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="departures" className="mt-4">
          <Card><CardContent className="pt-6"><DeparturesTab packageId={id} departures={pkg.departures} canEdit={canEdit} /></CardContent></Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => { if (!open) setConfirmAction(null); }}
        title={confirmAction === "publish" ? "Publish this package?" : "Archive this package?"}
        description={
          confirmAction === "publish"
            ? "Requires an itinerary and at least one current rate slab. Once published it becomes bookable."
            : "Refused while any upcoming booking still uses this package."
        }
        destructive={confirmAction === "archive"}
        confirmLabel={confirmAction === "publish" ? "Publish" : "Archive"}
        onConfirm={async () => {
          if (confirmAction === "publish") await publishMutation.mutateAsync();
          else if (confirmAction === "archive") await archiveMutation.mutateAsync();
        }}
      />
    </div>
  );
}

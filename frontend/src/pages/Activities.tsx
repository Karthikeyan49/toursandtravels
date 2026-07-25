import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  ACTIVITY_TYPES,
  createActivity,
  listActivities,
  PRICING_BASES,
  type ActivityFilters,
  type ActivityListItem,
  type ActivityType,
} from "@/lib/api/activities";
import { listDestinationOptions } from "@/lib/api/destinations";
import { listSupplierOptions } from "@/lib/api/suppliers";
import { humanize } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { applyApiErrors, NumberField, SelectField, TextareaField, TextField, type SelectOption } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { MoneyText } from "@/components/MoneyText";
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

const activitySchema = z
  .object({
    code: z.string().trim().min(1, "Code is required").max(20),
    name: z.string().trim().min(1, "Name is required").max(160),
    destination_id: z.string().min(1, "Destination is required"),
    supplier_id: z.string().optional(),
    activity_type: z.enum(ACTIVITY_TYPES).optional(),
    pricing_basis: z.enum(PRICING_BASES).optional(),
    duration_hours: z.number().min(0).max(240).optional(),
    cost_adult: z.number().min(0).optional(),
    cost_child: z.number().min(0).optional(),
    sell_adult: z.number().min(0.01, "Selling price is required"),
    sell_child: z.number().min(0).optional(),
    tax_pct: z.number().min(0).max(100).optional(),
    min_pax: z.number().min(1).max(200).optional(),
    description: z.string().trim().max(4000).optional(),
  })
  .refine((v) => v.cost_adult === undefined || v.cost_adult <= v.sell_adult, {
    message: "Selling price is below cost",
    path: ["sell_adult"],
  });
type ActivityFormValues = z.infer<typeof activitySchema>;

const KNOWN_FIELDS = [
  "code", "name", "destination_id", "supplier_id", "activity_type", "duration_hours",
  "pricing_basis", "cost_adult", "cost_child", "sell_adult", "sell_child", "tax_pct", "min_pax", "description",
] as const;

function AddActivityDialog({ canViewCosts }: { canViewCosts: boolean }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { control, handleSubmit, reset, setError, formState: { isSubmitting } } = useForm<ActivityFormValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: { min_pax: 1 },
  });

  const destinationsQuery = useQuery({ queryKey: qk.destinations.options, queryFn: listDestinationOptions, enabled: open });
  const suppliersQuery = useQuery({
    queryKey: qk.suppliers.options("activity"),
    queryFn: () => listSupplierOptions({ type: "activity" }),
    enabled: open,
  });

  const destinationOptions: SelectOption[] = (destinationsQuery.data ?? []).map((d) => ({ value: String(d.id), label: d.name }));
  const supplierOptions: SelectOption[] = (suppliersQuery.data ?? []).map((s) => ({ value: String(s.id), label: s.name }));
  const typeOptions: SelectOption[] = ACTIVITY_TYPES.map((t) => ({ value: t, label: humanize(t) }));
  const basisOptions: SelectOption[] = PRICING_BASES.map((b) => ({ value: b, label: humanize(b) }));

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createActivity({
        code: values.code,
        name: values.name,
        destination_id: Number(values.destination_id),
        supplier_id: values.supplier_id ? Number(values.supplier_id) : null,
        activity_type: values.activity_type,
        pricing_basis: values.pricing_basis,
        duration_hours: values.duration_hours ?? null,
        cost_adult: values.cost_adult,
        cost_child: values.cost_child,
        sell_adult: values.sell_adult,
        sell_child: values.sell_child,
        tax_pct: values.tax_pct,
        min_pax: values.min_pax,
        description: values.description || null,
      });
      toast.success("Activity created");
      await queryClient.invalidateQueries({ queryKey: qk.activities.all });
      reset();
      setOpen(false);
    } catch (error) {
      if (!applyApiErrors(error, setError, KNOWN_FIELDS)) {
        toast.fromError(error, "Could not save this activity", true);
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <Button><Plus /> Add activity</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New activity</DialogTitle>
          <DialogDescription>Sightseeing, entry tickets and other sellable add-ons.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField control={control} name="code" label="Code" required />
          <TextField control={control} name="name" label="Name" required />
          <SelectField control={control} name="destination_id" label="Destination" options={destinationOptions} required placeholder="Select destination" />
          <SelectField control={control} name="supplier_id" label="Supplier" options={supplierOptions} placeholder="Select supplier" />
          <SelectField control={control} name="activity_type" label="Type" options={typeOptions} placeholder="Select type" />
          <SelectField control={control} name="pricing_basis" label="Pricing basis" options={basisOptions} placeholder="Per person" />
          <NumberField control={control} name="duration_hours" label="Duration (hours)" min={0} max={240} />
          <NumberField control={control} name="min_pax" label="Minimum pax" min={1} max={200} />
          {canViewCosts && <NumberField control={control} name="cost_adult" label="Cost (adult)" min={0} />}
          {canViewCosts && <NumberField control={control} name="cost_child" label="Cost (child)" min={0} />}
          <NumberField control={control} name="sell_adult" label="Sell price (adult)" required min={0} />
          <NumberField control={control} name="sell_child" label="Sell price (child)" min={0} />
          <NumberField control={control} name="tax_pct" label="Tax %" min={0} max={100} />
          <TextareaField control={control} name="description" label="Description" className="sm:col-span-2" />
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Create activity
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Activities() {
  const { can } = useAuth();
  const canViewCosts = can("view_costs");

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [activityType, setActivityType] = useState<ActivityType | "">("");
  const [destinationId, setDestinationId] = useState("");
  const [page, setPage] = useState(1);

  const filters: ActivityFilters = useMemo(
    () => ({
      page,
      limit: 25,
      search: debouncedSearch || undefined,
      activity_type: activityType || undefined,
      destination_id: destinationId ? Number(destinationId) : undefined,
    }),
    [page, debouncedSearch, activityType, destinationId],
  );

  const listQuery = useQuery({ queryKey: qk.activities.list(filters), queryFn: () => listActivities(filters) });
  const destinationsQuery = useQuery({ queryKey: qk.destinations.options, queryFn: listDestinationOptions });

  const columns: Column<ActivityListItem>[] = [
    {
      key: "name",
      header: "Activity",
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-xs text-muted-foreground">{row.code}</p>
        </div>
      ),
    },
    { key: "destination_name", header: "Destination", hideOnMobile: true },
    { key: "activity_type", header: "Type", render: (row) => humanize(row.activity_type) },
    { key: "supplier_name", header: "Supplier", render: (row) => row.supplier_name ?? "—", hideOnMobile: true },
    { key: "min_pax", header: "Min pax", align: "right", hideOnMobile: true },
    ...(canViewCosts
      ? [{ key: "cost_adult", header: "Cost (A)", align: "right" as const, render: (row: ActivityListItem) => <MoneyText value={row.cost_adult} /> }]
      : []),
    { key: "sell_adult", header: "Sell (A)", align: "right", render: (row) => <MoneyText value={row.sell_adult} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Activities"
        description="Sightseeing, entry tickets and other sellable add-ons used in packages and quotations."
        actions={<AddActivityDialog canViewCosts={canViewCosts} />}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name or code…" className="pl-8" />
          </div>
          <Select value={destinationId || "__all__"} onValueChange={(v) => { setDestinationId(v === "__all__" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Destination" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All destinations</SelectItem>
              {(destinationsQuery.data ?? []).map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={activityType || "__all__"} onValueChange={(v) => { setActivityType(v === "__all__" ? "" : (v as ActivityType)); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All types</SelectItem>
              {ACTIVITY_TYPES.map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={listQuery.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={listQuery.isLoading}
        pagination={listQuery.data?.pagination}
        onPageChange={setPage}
      />
    </div>
  );
}

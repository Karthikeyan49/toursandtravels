import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  createPackage,
  listPackages,
  PACKAGE_TYPES,
  type PackageFilters,
  type PackageListItem,
  type PackageStatus,
  type PackageType,
} from "@/lib/api/packages";
import { DESTINATION_SCOPES, listDestinationOptions, type DestinationScope } from "@/lib/api/destinations";
import { formatDuration } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "@/hooks/use-toast";
import { applyApiErrors, NumberField, SelectField, TextField, type SelectOption } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
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

const packageSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  destination_id: z.string().min(1, "Destination is required"),
  package_type: z.enum(PACKAGE_TYPES).optional(),
  scope: z.enum(DESTINATION_SCOPES).optional(),
  nights: z.number().min(0).max(60).optional(),
  days: z.number().min(1).max(61).optional(),
  base_price_adult: z.number().min(0).optional(),
  summary: z.string().trim().max(500).optional(),
});
type PackageFormValues = z.infer<typeof packageSchema>;

const KNOWN_FIELDS = ["name", "destination_id", "package_type", "scope", "nights", "days", "base_price_adult", "summary"] as const;

function AddPackageDialog() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { control, handleSubmit, reset, setError, formState: { isSubmitting } } = useForm<PackageFormValues>({
    resolver: zodResolver(packageSchema),
    defaultValues: { package_type: "fixed_departure", scope: "domestic" },
  });

  const destinationsQuery = useQuery({ queryKey: qk.destinations.options, queryFn: listDestinationOptions, enabled: open });
  const destinationOptions: SelectOption[] = (destinationsQuery.data ?? []).map((d) => ({ value: String(d.id), label: d.name }));
  const typeOptions: SelectOption[] = PACKAGE_TYPES.map((t) => ({ value: t, label: humanize(t) }));
  const scopeOptions: SelectOption[] = DESTINATION_SCOPES.map((s) => ({ value: s, label: humanize(s) }));

  const onSubmit = handleSubmit(async (values) => {
    try {
      const pkg = await createPackage({
        name: values.name,
        destination_id: Number(values.destination_id),
        package_type: values.package_type,
        scope: values.scope,
        nights: values.nights,
        days: values.days,
        base_price_adult: values.base_price_adult,
        summary: values.summary || null,
      });
      toast.success("Package created as a draft");
      await queryClient.invalidateQueries({ queryKey: qk.packages.all });
      reset();
      setOpen(false);
      navigate(`/packages/${pkg.id}`);
    } catch (error) {
      if (!applyApiErrors(error, setError, KNOWN_FIELDS)) {
        toast.fromError(error, "Could not create this package", true);
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <Button><Plus /> Add package</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New package</DialogTitle>
          <DialogDescription>Created as a draft — add the itinerary and a rate slab before publishing.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField control={control} name="name" label="Name" required className="sm:col-span-2" />
          <SelectField control={control} name="destination_id" label="Destination" options={destinationOptions} required placeholder="Select destination" />
          <SelectField control={control} name="package_type" label="Type" options={typeOptions} />
          <SelectField control={control} name="scope" label="Scope" options={scopeOptions} />
          <NumberField control={control} name="nights" label="Nights" min={0} max={60} />
          <NumberField control={control} name="days" label="Days" min={1} max={61} />
          <NumberField control={control} name="base_price_adult" label="Indicative price (adult)" min={0} />
          <TextField control={control} name="summary" label="Summary" className="sm:col-span-2" />
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Create package
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Packages() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [destinationId, setDestinationId] = useState("");
  const [packageType, setPackageType] = useState<PackageType | "">("");
  const [scope, setScope] = useState<DestinationScope | "">("");
  const [status, setStatus] = useState<PackageStatus | "">("");
  const [page, setPage] = useState(1);

  const filters: PackageFilters = useMemo(
    () => ({
      page,
      limit: 25,
      search: debouncedSearch || undefined,
      destination_id: destinationId ? Number(destinationId) : undefined,
      package_type: packageType || undefined,
      scope: scope || undefined,
      status: status || undefined,
    }),
    [page, debouncedSearch, destinationId, packageType, scope, status],
  );

  const listQuery = useQuery({ queryKey: qk.packages.list(filters), queryFn: () => listPackages(filters) });
  const destinationsQuery = useQuery({ queryKey: qk.destinations.options, queryFn: listDestinationOptions });

  const columns: Column<PackageListItem>[] = [
    {
      key: "name",
      header: "Package",
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-xs text-muted-foreground">{row.code} · {row.destination_name ?? "—"}</p>
        </div>
      ),
    },
    { key: "package_type", header: "Type", render: (row) => humanize(row.package_type), hideOnMobile: true },
    { key: "nights", header: "Duration", render: (row) => formatDuration(row.nights) },
    { key: "base_price_adult", header: "From", align: "right", render: (row) => <MoneyText value={row.base_price_adult} short /> },
    { key: "open_departures", header: "Open departures", align: "right", hideOnMobile: true },
    { key: "booking_count", header: "Bookings", align: "right", hideOnMobile: true },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Packages"
        description="Tour itineraries, rate slabs and fixed-departure batches."
        actions={<AddPackageDialog />}
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
          <Select value={packageType || "__all__"} onValueChange={(v) => { setPackageType(v === "__all__" ? "" : (v as PackageType)); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All types</SelectItem>
              {PACKAGE_TYPES.map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={scope || "__all__"} onValueChange={(v) => { setScope(v === "__all__" ? "" : (v as DestinationScope)); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Scope" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All scopes</SelectItem>
              {DESTINATION_SCOPES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status || "__all__"} onValueChange={(v) => { setStatus(v === "__all__" ? "" : (v as PackageStatus)); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={listQuery.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={listQuery.isLoading}
        onRowClick={(row) => navigate(`/packages/${row.id}`)}
        pagination={listQuery.data?.pagination}
        onPageChange={setPage}
      />
    </div>
  );
}

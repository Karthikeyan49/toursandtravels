import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Loader2, Pencil, Plus, Search } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  archiveDestination,
  createDestination,
  DESTINATION_SCOPES,
  listCountries,
  listDestinations,
  updateDestination,
  type Destination,
  type DestinationFilters,
  type DestinationListItem,
  type DestinationScope,
} from "@/lib/api/destinations";
import { humanize } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { applyApiErrors, SelectField, TextareaField, TextField, type SelectOption } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const destinationSchema = z.object({
  code: z.string().trim().min(1, "Code is required").max(20),
  name: z.string().trim().min(1, "Name is required").max(120),
  scope: z.enum(DESTINATION_SCOPES),
  country_id: z.string().optional(),
  region: z.string().trim().max(80).optional(),
  best_season: z.string().trim().max(120).optional(),
  description: z.string().trim().max(8000).optional(),
});
type DestinationFormValues = z.infer<typeof destinationSchema>;

const KNOWN_FIELDS = ["code", "name", "scope", "country_id", "region", "best_season", "description"] as const;

function DestinationDialog({
  destination,
  open,
  onOpenChange,
}: {
  destination: Destination | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = destination !== null;

  const { control, handleSubmit, reset, setError, formState: { isSubmitting } } = useForm<DestinationFormValues>({
    resolver: zodResolver(destinationSchema),
    defaultValues: destination
      ? {
          code: destination.code,
          name: destination.name,
          scope: destination.scope,
          country_id: destination.country_id ? String(destination.country_id) : undefined,
          region: destination.region ?? undefined,
          best_season: destination.best_season ?? undefined,
          description: destination.description ?? undefined,
        }
      : { scope: "domestic" },
  });

  const countriesQuery = useQuery({ queryKey: ["countries"], queryFn: listCountries, enabled: open });
  const countryOptions: SelectOption[] = (countriesQuery.data ?? []).map((c) => ({ value: String(c.id), label: c.name }));
  const scopeOptions: SelectOption[] = DESTINATION_SCOPES.map((s) => ({ value: s, label: humanize(s) }));

  const onSubmit = handleSubmit(async (values) => {
    const input = {
      code: values.code,
      name: values.name,
      scope: values.scope,
      country_id: values.country_id ? Number(values.country_id) : null,
      region: values.region || null,
      best_season: values.best_season || null,
      description: values.description || null,
    };

    try {
      if (isEdit) {
        await updateDestination(destination.id, input);
        toast.success("Destination updated");
      } else {
        await createDestination(input);
        toast.success("Destination created");
      }
      await queryClient.invalidateQueries({ queryKey: qk.destinations.all });
      onOpenChange(false);
    } catch (error) {
      if (!applyApiErrors(error, setError, KNOWN_FIELDS)) {
        toast.fromError(error, "Could not save this destination", true);
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit destination" : "New destination"}</DialogTitle>
          <DialogDescription>Destinations group packages, hotels and suppliers by region.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField control={control} name="code" label="Code" required placeholder="e.g. KER" />
          <TextField control={control} name="name" label="Name" required />
          <SelectField control={control} name="scope" label="Scope" options={scopeOptions} required />
          <SelectField control={control} name="country_id" label="Country" options={countryOptions} placeholder="Select country" />
          <TextField control={control} name="region" label="Region" />
          <TextField control={control} name="best_season" label="Best season" placeholder="e.g. Oct – Mar" />
          <TextareaField control={control} name="description" label="Description" className="sm:col-span-2" />
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {isEdit ? "Save changes" : "Create destination"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Destinations() {
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [scope, setScope] = useState<DestinationScope | "">("");
  const [page, setPage] = useState(1);
  const [dialogTarget, setDialogTarget] = useState<Destination | null | "new">(null);
  const [archiveTarget, setArchiveTarget] = useState<DestinationListItem | null>(null);

  const filters: DestinationFilters = useMemo(
    () => ({ page, limit: 25, search: debouncedSearch || undefined, scope: scope || undefined }),
    [page, debouncedSearch, scope],
  );

  const listQuery = useQuery({ queryKey: qk.destinations.list(filters), queryFn: () => listDestinations(filters) });

  const archiveMutation = useMutation({
    mutationFn: (id: number) => archiveDestination(id),
    onSuccess: async () => {
      toast.success("Destination archived");
      await queryClient.invalidateQueries({ queryKey: qk.destinations.all });
      setArchiveTarget(null);
    },
    onError: (error) => {
      toast.fromError(error, "Could not archive this destination", true);
      setArchiveTarget(null);
    },
  });

  const canManage = can("edit_prices") || can("manage_operations");

  const columns: Column<DestinationListItem>[] = [
    {
      key: "name",
      header: "Destination",
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-xs text-muted-foreground">{row.code}{row.region ? ` · ${row.region}` : ""}</p>
        </div>
      ),
    },
    { key: "scope", header: "Scope", render: (row) => <StatusBadge status={row.scope} label={humanize(row.scope)} /> },
    { key: "country_name", header: "Country", hideOnMobile: true },
    { key: "package_count", header: "Packages", align: "right", hideOnMobile: true },
    { key: "hotel_count", header: "Hotels", align: "right", hideOnMobile: true },
    {
      key: "is_active",
      header: "Status",
      render: (row) => <StatusBadge status={row.is_active ? "active" : "inactive"} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); setDialogTarget(row); }} aria-label="Edit">
            <Pencil />
          </Button>
          {canManage && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => { e.stopPropagation(); setArchiveTarget(row); }}
              aria-label="Archive"
            >
              <Archive />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Destinations"
        description="Regions and countries packages, hotels and suppliers are organised under."
        actions={
          <Button onClick={() => setDialogTarget("new")}>
            <Plus /> Add destination
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name or code…" className="pl-8" />
          </div>
          <Select value={scope || "__all__"} onValueChange={(v) => { setScope(v === "__all__" ? "" : (v as DestinationScope)); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Scope" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All scopes</SelectItem>
              {DESTINATION_SCOPES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
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

      {dialogTarget !== null && (
        <DestinationDialog
          destination={dialogTarget === "new" ? null : dialogTarget}
          open={dialogTarget !== null}
          onOpenChange={(open) => { if (!open) setDialogTarget(null); }}
        />
      )}

      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}
        title="Archive this destination?"
        description={archiveTarget ? `"${archiveTarget.name}" will no longer appear in new package or booking pickers.` : undefined}
        confirmLabel="Archive"
        destructive
        onConfirm={async () => { if (archiveTarget) await archiveMutation.mutateAsync(archiveTarget.id); }}
      />
    </div>
  );
}

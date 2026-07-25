import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Loader2, Pencil, Plus, Search } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  archiveSupplier,
  createSupplier,
  listSuppliers,
  SUPPLIER_TYPES,
  updateSupplier,
  type Supplier,
  type SupplierFilters,
  type SupplierListItem,
  type SupplierType,
} from "@/lib/api/suppliers";
import { listDestinationOptions } from "@/lib/api/destinations";
import { humanize } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { applyApiErrors, NumberField, SelectField, TextareaField, TextField, type SelectOption } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { MoneyText } from "@/components/MoneyText";
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

const supplierSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  supplier_type: z.enum(SUPPLIER_TYPES),
  destination_id: z.string().optional(),
  contact_person: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  address: z.string().trim().max(400).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  gstin: z.string().trim().max(15).optional(),
  credit_days: z.number().min(0).max(365).optional(),
  credit_limit: z.number().min(0).optional(),
  bank_name: z.string().trim().max(120).optional(),
  bank_account: z.string().trim().max(40).optional(),
  bank_ifsc: z.string().trim().max(11).optional(),
  notes: z.string().trim().max(4000).optional(),
});
type SupplierFormValues = z.infer<typeof supplierSchema>;

const KNOWN_FIELDS = [
  "name", "supplier_type", "destination_id", "contact_person", "phone", "email", "address",
  "city", "state", "gstin", "credit_days", "credit_limit", "bank_name", "bank_account", "bank_ifsc", "notes",
] as const;

function SupplierDialog({ supplier, open, onOpenChange }: { supplier: Supplier | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const isEdit = supplier !== null;

  const { control, handleSubmit, reset, setError, formState: { isSubmitting } } = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: supplier
      ? {
          name: supplier.name,
          supplier_type: supplier.supplier_type,
          destination_id: supplier.destination_id ? String(supplier.destination_id) : undefined,
          contact_person: supplier.contact_person ?? undefined,
          phone: supplier.phone ?? undefined,
          email: supplier.email ?? undefined,
          address: supplier.address ?? undefined,
          city: supplier.city ?? undefined,
          state: supplier.state ?? undefined,
          gstin: supplier.gstin ?? undefined,
          credit_days: supplier.credit_days,
          credit_limit: Number(supplier.credit_limit) || undefined,
          bank_name: supplier.bank_name ?? undefined,
          bank_account: supplier.bank_account ?? undefined,
          bank_ifsc: supplier.bank_ifsc ?? undefined,
          notes: supplier.notes ?? undefined,
        }
      : { supplier_type: "hotel", credit_days: 0 },
  });

  const destinationsQuery = useQuery({ queryKey: qk.destinations.options, queryFn: listDestinationOptions, enabled: open });
  const destinationOptions: SelectOption[] = (destinationsQuery.data ?? []).map((d) => ({ value: String(d.id), label: d.name }));
  const typeOptions: SelectOption[] = SUPPLIER_TYPES.map((t) => ({ value: t, label: humanize(t) }));

  const onSubmit = handleSubmit(async (values) => {
    const input = {
      name: values.name,
      supplier_type: values.supplier_type,
      destination_id: values.destination_id ? Number(values.destination_id) : null,
      contact_person: values.contact_person || null,
      phone: values.phone || null,
      email: values.email || null,
      address: values.address || null,
      city: values.city || null,
      state: values.state || null,
      gstin: values.gstin || null,
      credit_days: values.credit_days,
      credit_limit: values.credit_limit,
      bank_name: values.bank_name || null,
      bank_account: values.bank_account || null,
      bank_ifsc: values.bank_ifsc || null,
      notes: values.notes || null,
    };

    try {
      if (isEdit) {
        await updateSupplier(supplier.id, input);
        toast.success("Supplier updated");
      } else {
        await createSupplier(input);
        toast.success("Supplier created");
      }
      await queryClient.invalidateQueries({ queryKey: qk.suppliers.all });
      onOpenChange(false);
    } catch (error) {
      if (!applyApiErrors(error, setError, KNOWN_FIELDS)) {
        toast.fromError(error, "Could not save this supplier", true);
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) reset(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit supplier" : "New supplier"}</DialogTitle>
          <DialogDescription>Hotels, transporters, DMCs and every other vendor the agency buys from.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField control={control} name="name" label="Name" required />
          <SelectField control={control} name="supplier_type" label="Type" options={typeOptions} required />
          <SelectField control={control} name="destination_id" label="Destination" options={destinationOptions} placeholder="Select destination" />
          <TextField control={control} name="contact_person" label="Contact person" />
          <TextField control={control} name="phone" label="Phone" />
          <TextField control={control} name="email" label="Email" type="email" />
          <TextField control={control} name="address" label="Address" className="sm:col-span-2" />
          <TextField control={control} name="city" label="City" />
          <TextField control={control} name="state" label="State" />
          <TextField control={control} name="gstin" label="GSTIN" />
          <NumberField control={control} name="credit_days" label="Credit days" min={0} max={365} />
          <NumberField control={control} name="credit_limit" label="Credit limit" min={0} />
          <TextField control={control} name="bank_name" label="Bank name" />
          <TextField control={control} name="bank_account" label="Bank account no" />
          <TextField control={control} name="bank_ifsc" label="IFSC" />
          <TextareaField control={control} name="notes" label="Notes" className="sm:col-span-2" />
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {isEdit ? "Save changes" : "Create supplier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Suppliers() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [supplierType, setSupplierType] = useState<SupplierType | "">("");
  const [page, setPage] = useState(1);
  const [dialogTarget, setDialogTarget] = useState<Supplier | null | "new">(null);
  const [archiveTarget, setArchiveTarget] = useState<SupplierListItem | null>(null);

  const filters: SupplierFilters = useMemo(
    () => ({ page, limit: 25, search: debouncedSearch || undefined, supplier_type: supplierType || undefined }),
    [page, debouncedSearch, supplierType],
  );

  const listQuery = useQuery({ queryKey: qk.suppliers.list(filters), queryFn: () => listSuppliers(filters) });

  const archiveMutation = useMutation({
    mutationFn: (id: number) => archiveSupplier(id),
    onSuccess: async () => {
      toast.success("Supplier archived");
      await queryClient.invalidateQueries({ queryKey: qk.suppliers.all });
      setArchiveTarget(null);
    },
    onError: (error) => {
      toast.fromError(error, "Could not archive this supplier", true);
      setArchiveTarget(null);
    },
  });

  const canManage = can("edit_prices") || can("manage_operations");

  const columns: Column<SupplierListItem>[] = [
    {
      key: "name",
      header: "Supplier",
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-xs text-muted-foreground">{row.code}{row.destination_name ? ` · ${row.destination_name}` : ""}</p>
        </div>
      ),
    },
    { key: "supplier_type", header: "Type", render: (row) => humanize(row.supplier_type) },
    { key: "contact_person", header: "Contact", render: (row) => row.contact_person ?? row.phone ?? "—", hideOnMobile: true },
    { key: "rating", header: "Rating", align: "right", render: (row) => (row.rating ? Number(row.rating).toFixed(1) : "—"), hideOnMobile: true },
    { key: "outstanding", header: "Outstanding", align: "right", render: (row) => <MoneyText value={row.outstanding} colored /> },
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
            <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); setArchiveTarget(row); }} aria-label="Archive">
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
        title="Suppliers"
        description="Hotels, transporters, DMCs and every vendor the agency contracts with."
        actions={<Button onClick={() => setDialogTarget("new")}><Plus /> Add supplier</Button>}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name or code…" className="pl-8" />
          </div>
          <Select value={supplierType || "__all__"} onValueChange={(v) => { setSupplierType(v === "__all__" ? "" : (v as SupplierType)); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All types</SelectItem>
              {SUPPLIER_TYPES.map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={listQuery.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={listQuery.isLoading}
        onRowClick={(row) => navigate(`/suppliers/${row.id}`)}
        pagination={listQuery.data?.pagination}
        onPageChange={setPage}
      />

      {dialogTarget !== null && (
        <SupplierDialog
          supplier={dialogTarget === "new" ? null : dialogTarget}
          open={dialogTarget !== null}
          onOpenChange={(open) => { if (!open) setDialogTarget(null); }}
        />
      )}

      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}
        title="Archive this supplier?"
        description={archiveTarget ? `"${archiveTarget.name}" will no longer appear in new booking pickers. Refused while any balance is outstanding.` : undefined}
        confirmLabel="Archive"
        destructive
        onConfirm={async () => { if (archiveTarget) await archiveMutation.mutateAsync(archiveTarget.id); }}
      />
    </div>
  );
}

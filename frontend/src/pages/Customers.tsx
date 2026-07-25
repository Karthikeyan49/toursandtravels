import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  CUSTOMER_TYPES,
  createCustomer,
  listCustomers,
  type CustomerFilters,
  type CustomerInput,
  type CustomerListItem,
  type CustomerType,
} from "@/lib/api/customers";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "@/hooks/use-toast";
import { humanize } from "@/lib/utils";
import { applyApiErrors, SelectField, SwitchField, TextField, type SelectOption } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import { MoneyText } from "@/components/MoneyText";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const customerSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(150),
  phone: z.string().trim().min(1, "Phone is required").max(20),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  alt_phone: z.string().optional(),
  whatsapp: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  gstin: z.string().optional(),
  customer_type: z.enum(CUSTOMER_TYPES).optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
  is_active: z.boolean().optional(),
});
type CustomerFormValues = z.infer<typeof customerSchema>;

const KNOWN_FIELDS = [
  "full_name", "phone", "email", "alt_phone", "whatsapp", "address", "city", "state",
  "pincode", "gstin", "customer_type", "source", "notes", "is_active",
] as const;

function AddCustomerDialog() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { control, handleSubmit, setError, reset, formState: { isSubmitting } } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: { customer_type: "individual", is_active: true },
  });

  const customerTypeOptions: SelectOption[] = CUSTOMER_TYPES.map((t) => ({ value: t, label: humanize(t) }));

  const onSubmit = handleSubmit(async (values) => {
    const input: CustomerInput = {
      full_name: values.full_name,
      phone: values.phone,
      email: values.email || null,
      alt_phone: values.alt_phone || null,
      whatsapp: values.whatsapp || null,
      address: values.address || null,
      city: values.city || null,
      state: values.state || null,
      pincode: values.pincode || null,
      gstin: values.gstin || null,
      customer_type: values.customer_type,
      source: values.source || null,
      notes: values.notes || null,
      is_active: values.is_active,
    };

    try {
      const customer = await createCustomer(input);
      toast.success("Customer added");
      await queryClient.invalidateQueries({ queryKey: qk.customers.all });
      reset();
      setOpen(false);
      navigate(`/customers/${customer.id}`);
    } catch (error) {
      if (!applyApiErrors(error, setError, KNOWN_FIELDS)) {
        toast.fromError(error, "Could not save this customer", true);
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <Button><Plus /> Add customer</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a customer</DialogTitle>
          <DialogDescription>Create a customer record for bookings and quotations.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField control={control} name="full_name" label="Full name" required />
          <TextField control={control} name="phone" label="Phone" required />
          <TextField control={control} name="email" label="Email" type="email" />
          <TextField control={control} name="alt_phone" label="Alternate phone" />
          <TextField control={control} name="whatsapp" label="WhatsApp" />
          <SelectField control={control} name="customer_type" label="Customer type" options={customerTypeOptions} />
          <TextField control={control} name="city" label="City" />
          <TextField control={control} name="state" label="State" />
          <TextField control={control} name="pincode" label="Pincode" />
          <TextField control={control} name="gstin" label="GSTIN" />
          <TextField control={control} name="address" label="Address" className="sm:col-span-2" />
          <TextField control={control} name="source" label="Source" className="sm:col-span-2" />
          <SwitchField control={control} name="is_active" label="Active" className="sm:col-span-2" />

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Save customer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Customers() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [customerType, setCustomerType] = useState<CustomerType | "">("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | undefined>(undefined);

  const filters: CustomerFilters = useMemo(
    () => ({
      page,
      limit: 25,
      search: debouncedSearch || undefined,
      customer_type: customerType || undefined,
      is_active: activeOnly || undefined,
      sort: sort?.key,
      dir: sort?.direction,
    }),
    [page, debouncedSearch, customerType, activeOnly, sort],
  );

  const listQuery = useQuery({ queryKey: qk.customers.list(filters), queryFn: () => listCustomers(filters) });

  const columns: Column<CustomerListItem>[] = [
    {
      key: "full_name",
      header: "Customer",
      render: (row) => (
        <div>
          <p className="font-medium">{row.full_name}</p>
          <p className="text-xs text-muted-foreground">{row.code} · {row.phone}</p>
        </div>
      ),
    },
    {
      key: "city",
      header: "Location",
      render: (row) => [row.city, row.state].filter(Boolean).join(", ") || "—",
      hideOnMobile: true,
    },
    {
      key: "customer_type",
      header: "Type",
      render: (row) => <Badge variant="secondary">{humanize(row.customer_type)}</Badge>,
      hideOnMobile: true,
    },
    {
      key: "booking_count",
      header: "Bookings",
      align: "right",
      render: (row) => row.booking_count,
    },
    {
      key: "lifetime_value",
      header: "Lifetime value",
      align: "right",
      render: (row) => <MoneyText value={row.lifetime_value} short />,
    },
    {
      key: "is_active",
      header: "Status",
      render: (row) => <Badge variant={row.is_active === 1 ? "outline" : "secondary"}>{row.is_active === 1 ? "Active" : "Inactive"}</Badge>,
      hideOnMobile: true,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Customers" description="Traveller and corporate accounts." actions={<AddCustomerDialog />} />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name, phone, code…" className="pl-8" />
          </div>

          <Select value={customerType || "__all__"} onValueChange={(v) => { setCustomerType(v === "__all__" ? "" : (v as CustomerType)); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All types</SelectItem>
              {CUSTOMER_TYPES.map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
            </SelectContent>
          </Select>

          <Button type="button" variant={activeOnly ? "default" : "outline"} size="sm" onClick={() => { setActiveOnly((v) => !v); setPage(1); }}>
            Active only
          </Button>

          {(search || customerType || !activeOnly) && (
            <Button type="button" variant="ghost" size="sm" onClick={() => { setSearch(""); setCustomerType(""); setActiveOnly(true); setPage(1); }}>
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={listQuery.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={listQuery.isLoading}
        onRowClick={(row) => navigate(`/customers/${row.id}`)}
        sort={sort}
        onSortChange={(s) => { setSort(s); setPage(1); }}
        pagination={listQuery.data?.pagination}
        onPageChange={setPage}
      />
    </div>
  );
}

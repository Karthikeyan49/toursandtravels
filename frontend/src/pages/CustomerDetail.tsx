import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Calendar, Loader2, Pencil, Wallet } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  CUSTOMER_TYPES,
  getCustomer,
  updateCustomer,
  type CustomerBookingRef,
  type CustomerUpdateInput,
} from "@/lib/api/customers";
import { formatDate } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { applyApiErrors, SelectField, SwitchField, TextField, type SelectOption } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { MoneyText } from "@/components/MoneyText";
import { EmptyState } from "@/components/EmptyState";
import { DataTable, type Column } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

const editSchema = z.object({
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
  notes: z.string().optional(),
  is_active: z.boolean().optional(),
});
type EditFormValues = z.infer<typeof editSchema>;

const KNOWN_FIELDS = [
  "full_name", "phone", "email", "alt_phone", "whatsapp", "address", "city", "state",
  "pincode", "gstin", "customer_type", "notes", "is_active",
] as const;

export default function CustomerDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const customerQuery = useQuery({ queryKey: qk.customers.detail(id), queryFn: () => getCustomer(id), enabled: Number.isFinite(id) });
  const customer = customerQuery.data;

  const editForm = useForm<EditFormValues>({ resolver: zodResolver(editSchema) });

  const openEdit = () => {
    if (!customer) return;
    editForm.reset({
      full_name: customer.full_name,
      phone: customer.phone,
      email: customer.email ?? "",
      alt_phone: customer.alt_phone ?? undefined,
      whatsapp: customer.whatsapp ?? undefined,
      address: customer.address ?? undefined,
      city: customer.city ?? undefined,
      state: customer.state ?? undefined,
      pincode: customer.pincode ?? undefined,
      gstin: customer.gstin ?? undefined,
      customer_type: customer.customer_type,
      notes: customer.notes ?? undefined,
      is_active: customer.is_active === 1,
    });
    setEditOpen(true);
  };

  const updateMutation = useMutation({
    mutationFn: (input: CustomerUpdateInput) => updateCustomer(id, input),
    onSuccess: () => {
      toast.success("Customer updated");
      queryClient.invalidateQueries({ queryKey: qk.customers.detail(id) });
      queryClient.invalidateQueries({ queryKey: qk.customers.all });
      setEditOpen(false);
    },
    onError: (error) => {
      if (!applyApiErrors(error, editForm.setError, KNOWN_FIELDS)) {
        toast.fromError(error, "Could not update this customer", true);
      }
    },
  });

  const bookingColumns: Column<CustomerBookingRef>[] = [
    { key: "booking_no", header: "Booking" },
    { key: "destination_name", header: "Destination", render: (row) => row.destination_name ?? row.package_name ?? "—" },
    { key: "travel_from", header: "Travel", render: (row) => `${formatDate(row.travel_from)} – ${formatDate(row.travel_to)}` },
    { key: "grand_total", header: "Amount", align: "right", render: (row) => <MoneyText value={row.grand_total} /> },
    { key: "outstanding", header: "Outstanding", align: "right", render: (row) => <MoneyText value={row.outstanding} colored /> },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ];

  const customerTypeOptions: SelectOption[] = CUSTOMER_TYPES.map((t) => ({ value: t, label: humanize(t) }));

  if (customerQuery.isLoading || !customer) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={customer.full_name}
        backTo="/customers"
        meta={<Badge variant={customer.is_active === 1 ? "outline" : "secondary"}>{customer.is_active === 1 ? "Active" : "Inactive"}</Badge>}
        description={`${customer.code} · ${customer.phone}`}
        actions={<Button variant="outline" onClick={openEdit}><Pencil /> Edit profile</Button>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Lifetime value" value={<MoneyText value={customer.stats.lifetime_value} short />} icon={Wallet} tone="positive" />
        <StatCard label="Total bookings" value={customer.stats.total_bookings} icon={Briefcase} />
        <StatCard label="Outstanding" value={<MoneyText value={customer.stats.outstanding} short />} icon={Wallet} tone={Number(customer.stats.outstanding) > 0 ? "warning" : "default"} />
        <StatCard label="Last travelled" value={customer.stats.last_travelled ? formatDate(customer.stats.last_travelled) : "—"} icon={Calendar} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-sm">Profile</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Phone" value={customer.phone} />
            {customer.alt_phone && <DetailRow label="Alt. phone" value={customer.alt_phone} />}
            {customer.whatsapp && <DetailRow label="WhatsApp" value={customer.whatsapp} />}
            {customer.email && <DetailRow label="Email" value={customer.email} />}
            <DetailRow label="Type" value={humanize(customer.customer_type)} />
            <DetailRow label="Location" value={[customer.city, customer.state].filter(Boolean).join(", ") || "—"} />
            {customer.address && <DetailRow label="Address" value={customer.address} />}
            {customer.gstin && <DetailRow label="GSTIN" value={customer.gstin} />}
            {customer.source && <DetailRow label="Source" value={customer.source} />}
            {customer.notes && (
              <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</p><p className="mt-1 whitespace-pre-wrap">{customer.notes}</p></div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-sm">Open leads</CardTitle></CardHeader>
          <CardContent>
            {customer.open_leads.length === 0 ? (
              <EmptyState compact title="No open enquiries" />
            ) : (
              <div className="space-y-1.5">
                {customer.open_leads.map((lead) => (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => navigate(`/leads/${lead.id}`)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent/50"
                  >
                    <span>{lead.lead_no}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {lead.travel_date ? formatDate(lead.travel_date) : "Flexible"}
                      <StatusBadge status={lead.status} size="sm" />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Booking history</CardTitle></CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={bookingColumns}
            rows={customer.bookings}
            rowKey={(row) => row.id}
            onRowClick={(row) => navigate(`/bookings/${row.id}`)}
            empty={<EmptyState compact title="No bookings yet" />}
            className="border-none"
          />
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit customer</DialogTitle>
            <DialogDescription>Update contact details and profile information.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={editForm.handleSubmit((values) =>
              updateMutation.mutate({
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
                notes: values.notes || null,
                is_active: values.is_active,
              }),
            )}
            noValidate
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            <TextField control={editForm.control} name="full_name" label="Full name" required />
            <TextField control={editForm.control} name="phone" label="Phone" required />
            <TextField control={editForm.control} name="email" label="Email" type="email" />
            <TextField control={editForm.control} name="alt_phone" label="Alternate phone" />
            <TextField control={editForm.control} name="whatsapp" label="WhatsApp" />
            <SelectField control={editForm.control} name="customer_type" label="Customer type" options={customerTypeOptions} />
            <TextField control={editForm.control} name="city" label="City" />
            <TextField control={editForm.control} name="state" label="State" />
            <TextField control={editForm.control} name="pincode" label="Pincode" />
            <TextField control={editForm.control} name="gstin" label="GSTIN" />
            <TextField control={editForm.control} name="address" label="Address" className="sm:col-span-2" />
            <SwitchField control={editForm.control} name="is_active" label="Active" className="sm:col-span-2" />

            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

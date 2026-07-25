import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, FileCheck2, FileClock, FileText, Plus, Search } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  QUOTATION_STATUSES,
  createQuotation,
  listQuotations,
  type QuotationFilters,
  type QuotationListItem,
  type QuotationStatus,
} from "@/lib/api/quotations";
import { listCustomers } from "@/lib/api/customers";
import { listUsers } from "@/lib/api/users";
import { formatDate } from "@/lib/format";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "@/hooks/use-toast";
import { applyApiErrors, DateField, NumberField, SelectField, TextField, type SelectOption } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { MoneyText } from "@/components/MoneyText";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
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

const STATUS_LABELS: Record<QuotationStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  revised: "Revised",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
};

const newQuoteSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  customer_id: z.string().min(1, "Select a customer"),
  adults: z.number().min(1, "At least 1 adult").max(200),
  travel_from: z.string().optional(),
  travel_to: z.string().optional(),
});
type NewQuoteFormValues = z.infer<typeof newQuoteSchema>;

function NewQuotationDialog() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { control, handleSubmit, setError, reset, formState: { isSubmitting } } = useForm<NewQuoteFormValues>({
    resolver: zodResolver(newQuoteSchema),
    defaultValues: { adults: 2 },
  });

  const customersQuery = useQuery({
    queryKey: qk.customers.list({ limit: 200 }),
    queryFn: () => listCustomers({ limit: 200 }),
    enabled: open,
  });
  const customerOptions: SelectOption[] = (customersQuery.data?.items ?? []).map((c) => ({
    value: String(c.id),
    label: `${c.full_name} · ${c.phone}`,
  }));

  const onSubmit = handleSubmit(async (values) => {
    try {
      const quote = await createQuotation({
        title: values.title,
        customer_id: Number(values.customer_id),
        adults: values.adults,
        travel_from: values.travel_from || null,
        travel_to: values.travel_to || null,
      });
      toast.success("Quotation created");
      await queryClient.invalidateQueries({ queryKey: qk.quotations.all });
      reset();
      setOpen(false);
      navigate(`/quotations/${quote.id}`);
    } catch (error) {
      if (!applyApiErrors(error, setError, ["title", "customer_id", "adults", "travel_from", "travel_to"])) {
        toast.fromError(error, "Could not create the quotation", true);
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <Button><Plus /> New quotation</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New quotation</DialogTitle>
          <DialogDescription>Start a draft — you'll build it out with the quotation builder next.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <TextField control={control} name="title" label="Title" required placeholder="e.g. Kerala honeymoon package" />
          <SelectField control={control} name="customer_id" label="Customer" required options={customerOptions} placeholder="Select customer" />
          <NumberField control={control} name="adults" label="Adults" required min={1} max={200} />
          <div className="grid grid-cols-2 gap-3">
            <DateField control={control} name="travel_from" label="Travel from" />
            <DateField control={control} name="travel_to" label="Travel to" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Quotations() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [status, setStatus] = useState<QuotationStatus | "">("");
  const [customerId, setCustomerId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | undefined>(undefined);

  const filters: QuotationFilters = useMemo(
    () => ({
      page,
      limit: 25,
      search: debouncedSearch || undefined,
      status: status || undefined,
      customer_id: customerId ? Number(customerId) : undefined,
      owner_id: ownerId ? Number(ownerId) : undefined,
      expiring: expiringOnly || undefined,
      sort: sort?.key,
      dir: sort?.direction,
    }),
    [page, debouncedSearch, status, customerId, ownerId, expiringOnly, sort],
  );

  const listQuery = useQuery({ queryKey: qk.quotations.list(filters), queryFn: () => listQuotations(filters) });
  const draftQuery = useQuery({ queryKey: qk.quotations.list({ status: "draft", limit: 1 }), queryFn: () => listQuotations({ status: "draft", limit: 1 }) });
  const pendingQuery = useQuery({
    queryKey: qk.quotations.list({ status: ["sent", "viewed"], limit: 1 }),
    queryFn: () => listQuotations({ status: ["sent", "viewed"], limit: 1 }),
  });
  const acceptedQuery = useQuery({ queryKey: qk.quotations.list({ status: "accepted", limit: 1 }), queryFn: () => listQuotations({ status: "accepted", limit: 1 }) });
  const expiringQuery = useQuery({ queryKey: qk.quotations.list({ expiring: true, limit: 1 }), queryFn: () => listQuotations({ expiring: true, limit: 1 }) });

  const customersQuery = useQuery({ queryKey: qk.customers.list({ limit: 200 }), queryFn: () => listCustomers({ limit: 200 }) });
  const usersQuery = useQuery({ queryKey: qk.users.list({ is_active: true, limit: 200 }), queryFn: () => listUsers({ is_active: true, limit: 200 }) });

  const columns: Column<QuotationListItem>[] = [
    {
      key: "quote_no",
      header: "Quotation",
      render: (row) => (
        <div>
          <p className="font-medium">{row.quote_no} <span className="text-xs text-muted-foreground">v{row.version}</span></p>
          <p className="text-xs text-muted-foreground">{row.title}</p>
        </div>
      ),
    },
    {
      key: "customer_name",
      header: "Customer",
      render: (row) => (
        <div>
          <p>{row.customer_name ?? "—"}</p>
          {row.customer_phone && <p className="text-xs text-muted-foreground">{row.customer_phone}</p>}
        </div>
      ),
    },
    {
      key: "destination_name",
      header: "Destination",
      render: (row) => row.destination_name ?? "—",
      hideOnMobile: true,
    },
    {
      key: "valid_until",
      header: "Valid until",
      render: (row) => (row.valid_until ? formatDate(row.valid_until) : "—"),
      hideOnMobile: true,
    },
    {
      key: "grand_total",
      header: "Amount",
      align: "right",
      render: (row) => <MoneyText value={row.grand_total} />,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row) => <StatusBadge status={row.status} label={STATUS_LABELS[row.status]} />,
    },
    {
      key: "owner_name",
      header: "Owner",
      render: (row) => row.owner_name ?? "—",
      hideOnMobile: true,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Quotations" description="Build, send and track priced proposals." actions={<NewQuotationDialog />} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Drafts" value={draftQuery.data?.pagination.total ?? 0} icon={FileText} loading={draftQuery.isLoading} />
        <StatCard label="Awaiting response" value={pendingQuery.data?.pagination.total ?? 0} icon={FileClock} tone="warning" loading={pendingQuery.isLoading} />
        <StatCard label="Accepted" value={acceptedQuery.data?.pagination.total ?? 0} icon={FileCheck2} tone="positive" loading={acceptedQuery.isLoading} />
        <StatCard label="Expiring soon" value={expiringQuery.data?.pagination.total ?? 0} icon={Clock3} tone="negative" loading={expiringQuery.isLoading} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search quote no, title, customer…" className="pl-8" />
          </div>

          <Select value={status || "__all__"} onValueChange={(v) => { setStatus(v === "__all__" ? "" : (v as QuotationStatus)); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              {QUOTATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={customerId || "__all__"} onValueChange={(v) => { setCustomerId(v === "__all__" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Customer" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All customers</SelectItem>
              {(customersQuery.data?.items ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.full_name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={ownerId || "__all__"} onValueChange={(v) => { setOwnerId(v === "__all__" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Owner" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Everyone</SelectItem>
              {(usersQuery.data?.items ?? []).map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.full_name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Button type="button" variant={expiringOnly ? "default" : "outline"} size="sm" onClick={() => { setExpiringOnly((v) => !v); setPage(1); }}>
            Expiring soon
          </Button>

          {(status || customerId || ownerId || expiringOnly || search) && (
            <Button type="button" variant="ghost" size="sm" onClick={() => { setSearch(""); setStatus(""); setCustomerId(""); setOwnerId(""); setExpiringOnly(false); setPage(1); }}>
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
        onRowClick={(row) => navigate(`/quotations/${row.id}`)}
        sort={sort}
        onSortChange={(s) => { setSort(s); setPage(1); }}
        pagination={listQuery.data?.pagination}
        onPageChange={setPage}
      />
    </div>
  );
}

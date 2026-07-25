import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  createLead,
  getPipeline,
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  listLeadSources,
  listLeads,
  type LeadFilters,
  type LeadInput,
  type LeadListItem,
  type LeadPriority,
  type LeadStatus,
} from "@/lib/api/leads";
import { listDestinationOptions } from "@/lib/api/destinations";
import { listPackageOptions } from "@/lib/api/packages";
import { listUsers } from "@/lib/api/users";
import { isApiError } from "@/lib/api/client";
import { formatDate, formatMoneyShort, formatPax } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "@/hooks/use-toast";
import { applyApiErrors, DateField, NumberField, SelectField, SwitchField, TextField, TextareaField, type SelectOption } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

const PRIORITY_TONE: Record<LeadPriority, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-status-in-progress-bg text-status-in-progress",
  high: "bg-status-pending-bg text-status-pending",
  hot: "bg-status-overdue-bg text-status-overdue",
};

const enquirySchema = z
  .object({
    contact_name: z.string().trim().min(1, "Contact name is required").max(150),
    phone: z.string().trim().min(1, "Phone number is required").max(20),
    email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
    city: z.string().trim().max(120).optional().or(z.literal("")),
    source_id: z.string().optional(),
    destination_id: z.string().optional(),
    package_id: z.string().optional(),
    travel_date: z.string().optional(),
    travel_date_flexible: z.boolean().optional(),
    nights: z.number().min(0).max(120).optional(),
    adults: z.number().min(1, "At least 1 adult").max(200).default(1),
    children: z.number().min(0).max(200).optional(),
    infants: z.number().min(0).max(100).optional(),
    budget_min: z.number().min(0).optional(),
    budget_max: z.number().min(0).optional(),
    requirement: z.string().trim().max(4000).optional(),
    priority: z.enum(LEAD_PRIORITIES).optional(),
  })
  .refine((v) => v.budget_min === undefined || v.budget_max === undefined || v.budget_max >= v.budget_min, {
    message: "Maximum budget cannot be below the minimum",
    path: ["budget_max"],
  });

type EnquiryFormValues = z.infer<typeof enquirySchema>;

const KNOWN_FIELDS = [
  "contact_name", "phone", "email", "city", "source_id", "destination_id", "package_id",
  "travel_date", "travel_date_flexible", "nights", "adults", "children", "infants",
  "budget_min", "budget_max", "requirement", "priority",
] as const;

function AddEnquiryDialog({ onCreated }: { onCreated: (lead: { id: number }) => void }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { control, handleSubmit, watch, reset, setError, formState: { isSubmitting } } = useForm<EnquiryFormValues>({
    resolver: zodResolver(enquirySchema),
    defaultValues: { adults: 1, travel_date_flexible: false },
  });

  const destinationId = watch("destination_id");

  const sourcesQuery = useQuery({ queryKey: ["lead-sources"], queryFn: listLeadSources, enabled: open });
  const destinationsQuery = useQuery({
    queryKey: qk.destinations.options,
    queryFn: listDestinationOptions,
    enabled: open,
  });
  const packagesQuery = useQuery({
    queryKey: qk.packages.options(destinationId ? Number(destinationId) : undefined),
    queryFn: () => listPackageOptions(destinationId ? Number(destinationId) : undefined),
    enabled: open && Boolean(destinationId),
  });

  const sourceOptions: SelectOption[] = (sourcesQuery.data ?? []).map((s) => ({ value: String(s.id), label: s.name }));
  const destinationOptions: SelectOption[] = (destinationsQuery.data ?? []).map((d) => ({ value: String(d.id), label: d.name }));
  const packageOptions: SelectOption[] = (packagesQuery.data ?? []).map((p) => ({ value: String(p.id), label: p.name }));
  const priorityOptions: SelectOption[] = LEAD_PRIORITIES.map((p) => ({ value: p, label: humanize(p) }));

  const onSubmit = handleSubmit(async (values) => {
    const input: LeadInput = {
      contact_name: values.contact_name,
      phone: values.phone,
      email: values.email || null,
      city: values.city || null,
      source_id: values.source_id ? Number(values.source_id) : null,
      destination_id: values.destination_id ? Number(values.destination_id) : null,
      package_id: values.package_id ? Number(values.package_id) : null,
      travel_date: values.travel_date || null,
      travel_date_flexible: values.travel_date_flexible,
      nights: values.nights ?? null,
      adults: values.adults,
      children: values.children ?? 0,
      infants: values.infants ?? 0,
      budget_min: values.budget_min ?? null,
      budget_max: values.budget_max ?? null,
      requirement: values.requirement || null,
      priority: values.priority,
    };

    try {
      const lead = await createLead(input);
      toast.success("Enquiry captured");
      await queryClient.invalidateQueries({ queryKey: qk.leads.all });
      reset();
      setOpen(false);
      onCreated(lead);
    } catch (error) {
      if (!applyApiErrors(error, setError, KNOWN_FIELDS)) {
        toast.fromError(error, "Could not save this enquiry", true);
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add enquiry
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Log a new enquiry</DialogTitle>
          <DialogDescription>Capture the traveller's contact details, travel dates and core requirement.</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField control={control} name="contact_name" label="Contact name" required />
          <TextField control={control} name="phone" label="Phone" required />
          <TextField control={control} name="email" label="Email" type="email" />
          <TextField control={control} name="city" label="City" />
          <SelectField control={control} name="source_id" label="Source" options={sourceOptions} placeholder="Select source" />
          <SelectField control={control} name="destination_id" label="Destination" options={destinationOptions} placeholder="Select destination" />
          <SelectField
            control={control}
            name="package_id"
            label="Package"
            options={packageOptions}
            placeholder={destinationId ? "Select package" : "Pick a destination first"}
            disabled={!destinationId}
          />
          <SelectField control={control} name="priority" label="Priority" options={priorityOptions} placeholder="Medium" />
          <DateField control={control} name="travel_date" label="Travel date" />
          <NumberField control={control} name="nights" label="Nights" min={0} max={120} />
          <NumberField control={control} name="adults" label="Adults" required min={1} max={200} />
          <NumberField control={control} name="children" label="Children" min={0} max={200} />
          <NumberField control={control} name="infants" label="Infants" min={0} max={100} />
          <NumberField control={control} name="budget_min" label="Budget from" min={0} />
          <NumberField control={control} name="budget_max" label="Budget to" min={0} />
          <SwitchField control={control} name="travel_date_flexible" label="Travel date is flexible" className="sm:col-span-2" />
          <TextareaField control={control} name="requirement" label="Requirement" className="sm:col-span-2" placeholder="What is the customer looking for?" />

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Save enquiry
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
  dropped: "Dropped",
};

export default function Leads() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [status, setStatus] = useState<LeadStatus | "">("");
  const [priority, setPriority] = useState<LeadPriority | "">("");
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [destinationId, setDestinationId] = useState<string>("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | undefined>(undefined);

  const filters: LeadFilters = useMemo(
    () => ({
      page,
      limit: 25,
      search: debouncedSearch || undefined,
      status: status || undefined,
      priority: priority || undefined,
      assigned_to: assignedTo ? Number(assignedTo) : undefined,
      destination_id: destinationId ? Number(destinationId) : undefined,
      overdue: overdueOnly || undefined,
      sort: sort?.key,
      dir: sort?.direction,
    }),
    [page, debouncedSearch, status, priority, assignedTo, destinationId, overdueOnly, sort],
  );

  const pipelineQuery = useQuery({
    queryKey: qk.leads.pipeline({ assigned_to: filters.assigned_to }),
    queryFn: () => getPipeline({ assigned_to: filters.assigned_to }),
  });

  const listQuery = useQuery({ queryKey: qk.leads.list(filters), queryFn: () => listLeads(filters) });

  const usersQuery = useQuery({
    queryKey: qk.users.list({ is_active: true, limit: 200 }),
    queryFn: () => listUsers({ is_active: true, limit: 200 }),
  });

  const destinationsQuery = useQuery({ queryKey: qk.destinations.options, queryFn: listDestinationOptions });

  const columns: Column<LeadListItem>[] = [
    {
      key: "lead_no",
      header: "Enquiry",
      render: (row) => (
        <div>
          <p className="font-medium">{row.lead_no}</p>
          <p className="text-xs text-muted-foreground">{row.contact_name} · {row.phone}</p>
        </div>
      ),
    },
    {
      key: "destination_name",
      header: "Destination",
      render: (row) => (
        <div>
          <p>{row.destination_name ?? "—"}</p>
          {row.package_name && <p className="text-xs text-muted-foreground">{row.package_name}</p>}
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: "travel_date",
      header: "Travel",
      render: (row) => (
        <div>
          <p>{row.travel_date ? formatDate(row.travel_date) : "Flexible"}</p>
          <p className="text-xs text-muted-foreground">{formatPax(row.adults, row.children, row.infants)}</p>
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: "budget_max",
      header: "Budget",
      align: "right",
      render: (row) =>
        row.budget_max ? <MoneyText value={row.budget_max} short /> : <span className="text-muted-foreground">—</span>,
      hideOnMobile: true,
    },
    {
      key: "priority",
      header: "Priority",
      render: (row) => (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_TONE[row.priority]}`}>
          {humanize(row.priority)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row) => <StatusBadge status={row.status} label={STATUS_LABELS[row.status]} />,
    },
    {
      key: "assigned_to_name",
      header: "Owner",
      render: (row) => row.assigned_to_name ?? <span className="text-muted-foreground">Unassigned</span>,
      hideOnMobile: true,
    },
    {
      key: "followup_count",
      header: "Follow-ups",
      align: "right",
      render: (row) => row.followup_count,
      hideOnMobile: true,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Enquiries"
        description="Log initial customer interest, travel dates and core requirements."
        actions={<AddEnquiryDialog onCreated={(lead) => navigate(`/leads/${lead.id}`)} />}
      />

      {/* Pipeline board */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {LEAD_STATUSES.map((s) => {
          const column = pipelineQuery.data?.board.find((b) => b.status === s);
          const isActive = status === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => { setStatus(isActive ? "" : s); setPage(1); }}
              className={`rounded-lg border p-3 text-left transition-colors ${isActive ? "border-primary bg-accent/50" : "hover:bg-accent/30"}`}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{STATUS_LABELS[s]}</p>
              <p className="mt-1 text-xl font-semibold tabular">{column?.lead_count ?? 0}</p>
              <p className="text-xs text-muted-foreground">
                <MoneyText value={column?.potential_value ?? 0} short muted />
              </p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search name, phone, lead no…"
              className="pl-8"
            />
          </div>

          <Select value={priority || "__all__"} onValueChange={(v) => { setPriority(v === "__all__" ? "" : (v as LeadPriority)); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All priorities</SelectItem>
              {LEAD_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{humanize(p)}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={destinationId || "__all__"} onValueChange={(v) => { setDestinationId(v === "__all__" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Destination" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All destinations</SelectItem>
              {(destinationsQuery.data ?? []).map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={assignedTo || "__all__"} onValueChange={(v) => { setAssignedTo(v === "__all__" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Owner" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Everyone</SelectItem>
              {(usersQuery.data?.items ?? []).map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.full_name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant={overdueOnly ? "default" : "outline"}
            size="sm"
            onClick={() => { setOverdueOnly((v) => !v); setPage(1); }}
          >
            Overdue only
          </Button>

          {(status || priority || destinationId || assignedTo || overdueOnly || search) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch(""); setStatus(""); setPriority(""); setAssignedTo(""); setDestinationId(""); setOverdueOnly(false); setPage(1);
              }}
            >
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
        onRowClick={(row) => navigate(`/leads/${row.id}`)}
        sort={sort}
        onSortChange={(s) => { setSort(s); setPage(1); }}
        pagination={listQuery.data?.pagination}
        onPageChange={setPage}
        rowClassName={(row) => (row.status === "new" && row.hours_since_contact !== null && row.hours_since_contact > 48 ? "bg-status-overdue-bg/40" : undefined)}
      />
    </div>
  );
}

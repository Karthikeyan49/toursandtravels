import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Loader2,
  MessageSquarePlus,
  Phone,
  UserPlus,
} from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  FOLLOWUP_CHANNELS,
  FOLLOWUP_DIRECTIONS,
  FOLLOWUP_OUTCOMES,
  LEAD_TRANSITIONS,
  changeLeadStatus,
  convertLeadToCustomer,
  getLead,
  logFollowup,
  type FollowupInput,
  type LeadStatus,
} from "@/lib/api/leads";
import { createQuotation } from "@/lib/api/quotations";
import { formatDate, formatDateTime, formatPax, relativeTime } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { applyApiErrors, DateField, NumberField, SelectField, TextField, TextareaField, type SelectOption } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { MoneyText } from "@/components/MoneyText";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
  dropped: "Dropped",
};

const followupSchema = z.object({
  channel: z.enum(FOLLOWUP_CHANNELS),
  direction: z.enum(FOLLOWUP_DIRECTIONS),
  outcome: z.enum(FOLLOWUP_OUTCOMES),
  note: z.string().trim().max(1000).optional(),
  next_action: z.string().trim().max(255).optional(),
  next_due_at: z.string().optional(),
});
type FollowupFormValues = z.infer<typeof followupSchema>;

const quoteSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  adults: z.number().min(1, "At least 1 adult").max(200),
  travel_from: z.string().optional(),
  travel_to: z.string().optional(),
});
type QuoteFormValues = z.infer<typeof quoteSchema>;

export default function LeadDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [closeStatus, setCloseStatus] = useState<LeadStatus | null>(null);
  const [closeReason, setCloseReason] = useState("");
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);

  const leadQuery = useQuery({ queryKey: qk.leads.detail(id), queryFn: () => getLead(id), enabled: Number.isFinite(id) });
  const lead = leadQuery.data;

  const invalidateLead = () => queryClient.invalidateQueries({ queryKey: qk.leads.detail(id) });

  const followupForm = useForm<FollowupFormValues>({
    resolver: zodResolver(followupSchema),
    defaultValues: { channel: "call", direction: "outbound", outcome: "connected" },
  });

  const followupMutation = useMutation({
    mutationFn: (input: FollowupInput) => logFollowup(id, input),
    onSuccess: async () => {
      toast.success("Follow-up logged");
      followupForm.reset({ channel: "call", direction: "outbound", outcome: "connected" });
      await invalidateLead();
      await queryClient.invalidateQueries({ queryKey: qk.leads.all });
    },
    onError: (error) => toast.fromError(error, "Could not log the follow-up", true),
  });

  const onLogFollowup = followupForm.handleSubmit((values) => {
    followupMutation.mutate({
      channel: values.channel,
      direction: values.direction,
      outcome: values.outcome,
      note: values.note || null,
      next_action: values.next_action || null,
      next_due_at: values.next_due_at || null,
    });
  });

  const statusMutation = useMutation({
    mutationFn: (input: { status: LeadStatus; reason?: string }) => changeLeadStatus(id, input),
    onSuccess: async () => {
      toast.success("Status updated");
      await invalidateLead();
      await queryClient.invalidateQueries({ queryKey: qk.leads.all });
    },
    onError: (error) => toast.fromError(error, "That status change was rejected", true),
  });

  const convertMutation = useMutation({
    mutationFn: () => convertLeadToCustomer(id),
    onSuccess: async (customer) => {
      toast.success("Customer record ready");
      await invalidateLead();
      navigate(`/customers/${customer.id}`);
    },
    onError: (error) => toast.fromError(error, "Could not convert this lead", true),
  });

  const quoteForm = useForm<QuoteFormValues>({
    resolver: zodResolver(quoteSchema),
    defaultValues: { adults: lead?.adults ?? 1 },
  });

  const quoteMutation = useMutation({
    mutationFn: (values: QuoteFormValues) =>
      createQuotation({
        lead_id: id,
        customer_id: lead?.customer_id ?? undefined,
        destination_id: lead?.destination_id ?? undefined,
        package_id: lead?.package_id ?? undefined,
        title: values.title,
        adults: values.adults,
        travel_from: values.travel_from || null,
        travel_to: values.travel_to || null,
      }),
    onSuccess: async (quote) => {
      toast.success("Quotation created");
      await invalidateLead();
      await queryClient.invalidateQueries({ queryKey: qk.quotations.all });
      setQuoteDialogOpen(false);
      navigate(`/quotations/${quote.id}`);
    },
    onError: (error) => {
      if (!applyApiErrors(error, quoteForm.setError, ["title", "adults", "travel_from", "travel_to"])) {
        toast.fromError(error, "Could not create the quotation", true);
      }
    },
  });

  const allowedTransitions = useMemo(() => (lead ? LEAD_TRANSITIONS[lead.status] : []), [lead]);

  const outcomeOptions: SelectOption[] = FOLLOWUP_OUTCOMES.map((o) => ({ value: o, label: humanize(o) }));
  const channelOptions: SelectOption[] = FOLLOWUP_CHANNELS.map((c) => ({ value: c, label: humanize(c) }));
  const directionOptions: SelectOption[] = FOLLOWUP_DIRECTIONS.map((d) => ({ value: d, label: humanize(d) }));

  if (leadQuery.isLoading || !lead) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={lead.lead_no}
        backTo="/leads"
        meta={<StatusBadge status={lead.status} label={STATUS_LABELS[lead.status]} />}
        description={`${lead.contact_name} · ${lead.phone}`}
        actions={
          <>
            {lead.customer_id ? (
              <Button variant="outline" onClick={() => navigate(`/customers/${lead.customer_id}`)}>
                <UserPlus /> View customer
              </Button>
            ) : (
              <Button variant="outline" onClick={() => convertMutation.mutate()} disabled={convertMutation.isPending}>
                {convertMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserPlus />}
                Convert to customer
              </Button>
            )}
            <Button onClick={() => setQuoteDialogOpen(true)} disabled={lead.status === "won"}>
              Create quotation
            </Button>
          </>
        }
      />

      {/* Status transitions */}
      {allowedTransitions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden /> Move to:
          </span>
          {allowedTransitions.map((next) => (
            <Button
              key={next}
              size="sm"
              variant="outline"
              disabled={statusMutation.isPending}
              onClick={() => {
                if (next === "lost" || next === "dropped") {
                  setCloseStatus(next);
                  setCloseReason("");
                } else {
                  statusMutation.mutate({ status: next });
                }
              }}
            >
              {STATUS_LABELS[next]}
            </Button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Enquiry details */}
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Enquiry details</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Contact" value={`${lead.contact_name} · ${lead.phone}`} />
            {lead.email && <DetailRow label="Email" value={lead.email} />}
            {lead.city && <DetailRow label="City" value={lead.city} />}
            <DetailRow label="Destination" value={lead.destination_name ?? "—"} />
            {lead.package_name && <DetailRow label="Package" value={lead.package_name} />}
            <DetailRow
              label="Travel date"
              value={lead.travel_date ? formatDate(lead.travel_date) : lead.travel_date_flexible ? "Flexible" : "—"}
            />
            <DetailRow label="Pax" value={formatPax(lead.adults, lead.children, lead.infants)} />
            <DetailRow
              label="Budget"
              value={
                lead.budget_min || lead.budget_max ? (
                  <>
                    <MoneyText value={lead.budget_min} short /> – <MoneyText value={lead.budget_max} short />
                  </>
                ) : (
                  "—"
                )
              }
            />
            <DetailRow label="Source" value={lead.source_name ?? "—"} />
            <DetailRow label="Owner" value={lead.assigned_to_name ?? "Unassigned"} />
            {lead.requirement && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Requirement</p>
                <p className="mt-1 whitespace-pre-wrap">{lead.requirement}</p>
              </div>
            )}

            {lead.quotations.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Quotations</p>
                  <div className="space-y-1">
                    {lead.quotations.map((q) => (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => navigate(`/quotations/${q.id}`)}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/50"
                      >
                        <span>{q.quote_no} · v{q.version}</span>
                        <span className="flex items-center gap-2">
                          <MoneyText value={q.grand_total} short />
                          <StatusBadge status={q.status} size="sm" />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Follow-up timeline */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Follow-up timeline</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <form onSubmit={onLogFollowup} noValidate className="grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-2">
              <SelectField control={followupForm.control} name="channel" label="Channel" options={channelOptions} />
              <SelectField control={followupForm.control} name="direction" label="Direction" options={directionOptions} />
              <SelectField control={followupForm.control} name="outcome" label="Outcome" options={outcomeOptions} className="sm:col-span-2" />
              <TextareaField control={followupForm.control} name="note" label="Note" className="sm:col-span-2" rows={2} />
              <TextField control={followupForm.control} name="next_action" label="Next action" placeholder="e.g. Send revised quote" />
              <DateField control={followupForm.control} name="next_due_at" label="Next follow-up due" />
              <div className="sm:col-span-2">
                <Button type="submit" size="sm" disabled={followupMutation.isPending}>
                  {followupMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MessageSquarePlus />}
                  Log follow-up
                </Button>
              </div>
            </form>

            {lead.followups.length === 0 ? (
              <EmptyState compact icon={Phone} title="No follow-ups yet" description="Log the first call or message above." />
            ) : (
              <ol className="space-y-4 border-l pl-4">
                {lead.followups.map((f) => (
                  <li key={f.id} className="relative">
                    <span className="absolute -left-[1.1rem] top-1 h-2 w-2 rounded-full bg-primary" aria-hidden />
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{humanize(f.channel)}</span>
                      <span className="text-muted-foreground">· {humanize(f.direction)} · {humanize(f.outcome)}</span>
                      <span className="text-xs text-muted-foreground">{relativeTime(f.done_at)}</span>
                    </div>
                    {f.note && <p className="mt-1 text-sm text-muted-foreground">{f.note}</p>}
                    {f.next_action && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Next: {f.next_action}{f.next_due_at ? ` · due ${formatDateTime(f.next_due_at)}` : ""}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">{f.actor_name ?? "System"} · {formatDateTime(f.created_at)}</p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Close as lost/dropped — requires a reason */}
      <ConfirmDialog
        open={closeStatus !== null}
        onOpenChange={(open) => { if (!open) setCloseStatus(null); }}
        title={closeStatus === "lost" ? "Mark this enquiry as lost" : "Drop this enquiry"}
        description="A reason is required so the team can see why this enquiry did not convert."
        confirmLabel={closeStatus === "lost" ? "Mark lost" : "Drop enquiry"}
        destructive
        confirmDisabled={closeReason.trim() === ""}
        onConfirm={async () => {
          if (!closeStatus) return;
          await statusMutation.mutateAsync({ status: closeStatus, reason: closeReason.trim() });
          setCloseStatus(null);
        }}
      >
        <textarea
          value={closeReason}
          onChange={(e) => setCloseReason(e.target.value)}
          placeholder="Reason…"
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </ConfirmDialog>

      {/* Create quotation */}
      <Dialog open={quoteDialogOpen} onOpenChange={setQuoteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a quotation</DialogTitle>
            <DialogDescription>Starts a draft quotation linked to this enquiry.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={quoteForm.handleSubmit((values) => quoteMutation.mutate(values))}
            noValidate
            className="space-y-4"
          >
            <TextField control={quoteForm.control} name="title" label="Title" required placeholder={lead.destination_name ? `${lead.destination_name} trip` : "Quotation title"} />
            <NumberField control={quoteForm.control} name="adults" label="Adults" required min={1} max={200} />
            <div className="grid grid-cols-2 gap-3">
              <DateField control={quoteForm.control} name="travel_from" label="Travel from" />
              <DateField control={quoteForm.control} name="travel_to" label="Travel to" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setQuoteDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={quoteMutation.isPending}>
                {quoteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

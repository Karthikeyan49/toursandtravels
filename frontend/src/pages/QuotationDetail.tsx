import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Loader2,
  Package,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  QUOTATION_ITEM_TYPES,
  QUOTATION_TRANSITIONS,
  QUOTE_TYPES,
  changeQuotationStatus,
  convertQuotation,
  getQuotation,
  priceQuotationFromPackage,
  reviseQuotation,
  saveQuotationItems,
  sendQuotation,
  updateQuotation,
  type QuotationItemInput,
  type QuotationStatus,
  type QuoteType,
} from "@/lib/api/quotations";
import {
  DIET_TYPES,
  ROOM_CATEGORIES,
  TRANSPORT_MODES,
  saveQuotationOptions,
  type QuotationOptionsInput,
} from "@/lib/api/quotationOptions";
import { HOTEL_CATEGORIES, HOTEL_CATEGORY_LABELS, type HotelCategory } from "@/lib/api/bookings";
import { formatDate, formatPax } from "@/lib/format";
import { humanize, toNumber } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  applyApiErrors,
  DateField,
  NumberField,
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
  type SelectOption,
} from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { MoneyText } from "@/components/MoneyText";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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

const INDEPENDENT_SUB_TYPES = QUOTE_TYPES.filter((t) => t !== "package");
const SUB_TYPE_LABELS: Record<QuoteType, string> = {
  package: "Full package",
  custom: "Custom / mixed",
  hotel_only: "Hotel only",
  transport_only: "Transport only",
  activity_only: "Activity only",
  visa_only: "Visa only",
};

// ---------------------------------------------------------------------------
// "Build the Quote" toggle panel
// ---------------------------------------------------------------------------

const builderSchema = z.object({
  transport_mode: z.enum(TRANSPORT_MODES),
  hotel_category: z.string().min(1, "Select a hotel category"),
  room_category: z.enum(ROOM_CATEGORIES),
  food_included: z.boolean(),
  diet_type: z.enum(DIET_TYPES),
  baggage_included: z.boolean(),
  baggage_notes: z.string().max(255).optional(),
  local_transport_included: z.boolean(),
  sightseeing_included: z.boolean(),
  insurance_included: z.boolean(),
});
type BuilderFormValues = z.infer<typeof builderSchema>;

// ---------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------

const itemRowSchema = z.object({
  item_type: z.enum(QUOTATION_ITEM_TYPES),
  description: z.string().trim().min(1, "Required"),
  day_no: z.number().optional(),
  service_date: z.string().optional(),
  quantity: z.number().min(0.01, "Must be > 0"),
  unit: z.string().optional(),
  unit_cost: z.number().optional(),
  unit_price: z.number().min(0, "Must be ≥ 0"),
  is_optional: z.boolean().optional(),
});
const itemsFormSchema = z.object({
  items: z.array(itemRowSchema),
  discount_amount: z.number().min(0).optional(),
});
type ItemsFormValues = z.infer<typeof itemsFormSchema>;

const ITEM_TYPE_OPTIONS: SelectOption[] = QUOTATION_ITEM_TYPES.map((t) => ({ value: t, label: humanize(t) }));

export default function QuotationDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [convertOpen, setConvertOpen] = useState(false);
  const [occupancy, setOccupancy] = useState<"single" | "double" | "triple">("double");

  const quoteQuery = useQuery({ queryKey: qk.quotations.detail(id), queryFn: () => getQuotation(id), enabled: Number.isFinite(id) });
  const quote = quoteQuery.data;

  const setQuote = (next: typeof quote) => {
    if (next) queryClient.setQueryData(qk.quotations.detail(id), next);
  };
  const invalidateLists = () => queryClient.invalidateQueries({ queryKey: qk.quotations.all });

  const canViewMargins = can("view_margins");
  const canEditPrices = can("edit_prices");
  const editable = quote ? quote.status === "draft" || quote.status === "revised" : false;

  // --- Package Type toggle ---
  const quoteTypeMutation = useMutation({
    mutationFn: (quote_type: QuoteType) => updateQuotation(id, { quote_type }),
    onSuccess: (next) => { setQuote(next); toast.success("Package type updated"); },
    onError: (error) => toast.fromError(error, "Could not update the package type", true),
  });

  // --- Build the Quote panel ---
  const builderForm = useForm<BuilderFormValues>({
    resolver: zodResolver(builderSchema),
    defaultValues: {
      transport_mode: "none",
      hotel_category: "3star",
      room_category: "normal",
      food_included: true,
      diet_type: "veg",
      baggage_included: false,
      baggage_notes: "",
      local_transport_included: false,
      sightseeing_included: false,
      insurance_included: false,
    },
  });

  useEffect(() => {
    if (!quote) return;
    builderForm.reset({
      transport_mode: quote.options?.transport_mode ?? "none",
      hotel_category: quote.hotel_category ?? "3star",
      room_category: quote.options?.room_category ?? "normal",
      food_included: quote.options ? quote.options.food_included === 1 : true,
      diet_type: quote.options?.diet_type ?? "veg",
      baggage_included: quote.options ? quote.options.baggage_included === 1 : false,
      baggage_notes: quote.options?.baggage_notes ?? "",
      local_transport_included: quote.options ? quote.options.local_transport_included === 1 : false,
      sightseeing_included: quote.options ? quote.options.sightseeing_included === 1 : false,
      insurance_included: quote.options ? quote.options.insurance_included === 1 : false,
    });
    // Only reset when a fresh quote loads, not on every builderForm identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id, quote?.options, quote?.hotel_category]);

  const foodIncluded = builderForm.watch("food_included");
  const baggageIncluded = builderForm.watch("baggage_included");

  const builderMutation = useMutation({
    mutationFn: async (values: BuilderFormValues) => {
      const optionsInput: QuotationOptionsInput = {
        transport_mode: values.transport_mode,
        room_category: values.room_category,
        food_included: values.food_included ? 1 : 0,
        diet_type: values.diet_type,
        baggage_included: values.baggage_included ? 1 : 0,
        baggage_notes: values.baggage_included ? values.baggage_notes || null : null,
        local_transport_included: values.local_transport_included ? 1 : 0,
        sightseeing_included: values.sightseeing_included ? 1 : 0,
        insurance_included: values.insurance_included ? 1 : 0,
      };
      const [options, updatedQuote] = await Promise.all([
        saveQuotationOptions(id, optionsInput),
        values.hotel_category !== quote?.hotel_category
          ? updateQuotation(id, { hotel_category: values.hotel_category as HotelCategory })
          : Promise.resolve(quote!),
      ]);
      return { options, updatedQuote };
    },
    onSuccess: ({ options, updatedQuote }) => {
      setQuote({ ...updatedQuote, options });
      toast.success("Quote build saved");
    },
    onError: (error) => toast.fromError(error, "Could not save the build", true),
  });

  // --- Line items ---
  const itemsForm = useForm<ItemsFormValues>({
    resolver: zodResolver(itemsFormSchema),
    defaultValues: { items: [], discount_amount: 0 },
  });
  const itemsFieldArray = useFieldArray({ control: itemsForm.control, name: "items" });

  useEffect(() => {
    if (!quote) return;
    itemsForm.reset({
      items: quote.items.map((item) => ({
        item_type: item.item_type,
        description: item.description,
        day_no: item.day_no ?? undefined,
        service_date: item.service_date ?? undefined,
        quantity: toNumber(item.quantity),
        unit: item.unit,
        unit_cost: item.unit_cost !== undefined ? toNumber(item.unit_cost) : undefined,
        unit_price: toNumber(item.unit_price),
        is_optional: item.is_optional === 1,
      })),
      discount_amount: toNumber(quote.discount_amount),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id, quote?.items]);

  const itemsMutation = useMutation({
    mutationFn: (values: ItemsFormValues) => {
      const items: QuotationItemInput[] = values.items.map((row) => ({
        item_type: row.item_type,
        description: row.description,
        day_no: row.day_no ?? null,
        service_date: row.service_date || null,
        quantity: row.quantity,
        unit: row.unit || "nos",
        unit_cost: row.unit_cost,
        unit_price: row.unit_price,
        is_optional: row.is_optional,
      }));
      return saveQuotationItems(id, { items, discount_amount: values.discount_amount });
    },
    onSuccess: (next) => { setQuote(next); invalidateLists(); toast.success("Quotation priced"); },
    onError: (error) => toast.fromError(error, "Could not save the line items", true),
  });

  const priceFromPackageMutation = useMutation({
    mutationFn: () => priceQuotationFromPackage(id, { occupancy }),
    onSuccess: (next) => { setQuote(next); toast.success("Priced from the package rate card"); },
    onError: (error) => toast.fromError(error, "Could not price from the package", true),
  });

  // --- Workflow actions ---
  const sendMutation = useMutation({
    mutationFn: () => sendQuotation(id),
    onSuccess: (next) => { setQuote(next); invalidateLists(); toast.success("Quotation sent"); },
    onError: (error) => toast.fromError(error, "Could not send the quotation", true),
  });

  const reviseMutation = useMutation({
    mutationFn: () => reviseQuotation(id),
    onSuccess: (next) => { invalidateLists(); toast.success("Revision created"); navigate(`/quotations/${next.id}`); },
    onError: (error) => toast.fromError(error, "Could not revise the quotation", true),
  });

  // No global onError here: this mutation is invoked both directly (Mark
  // accepted — needs its own error toast, passed per-call below) and inside
  // ConfirmDialog's onConfirm (Reject — ConfirmDialog surfaces the rejection,
  // including a 409 from an illegal transition, itself; a second global
  // onError would double-toast the same failure).
  const statusMutation = useMutation({
    mutationFn: (input: { status: QuotationStatus; reason?: string }) => changeQuotationStatus(id, input),
    onSuccess: (next) => { setQuote(next); invalidateLists(); toast.success(`Quotation marked ${next.status}`); },
  });

  // Invoked only via ConfirmDialog, which already surfaces any failure (and
  // keeps the dialog open so the user can retry) — no separate onError here.
  const convertMutation = useMutation({
    mutationFn: () => convertQuotation(id),
    onSuccess: (booking) => {
      invalidateLists();
      queryClient.invalidateQueries({ queryKey: qk.bookings.all });
      toast.success("Booking created");
      navigate(`/bookings/${booking.id}`);
    },
  });

  if (quoteQuery.isLoading || !quote) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const allowedTransitions = QUOTATION_TRANSITIONS[quote.status] ?? [];
  const isIndependent = quote.quote_type !== "package";
  const canConvert =
    !quote.converted_booking_id &&
    ["sent", "viewed", "accepted"].includes(quote.status);

  const hotelCategoryOptions: SelectOption[] = HOTEL_CATEGORIES.map((c) => ({ value: c, label: HOTEL_CATEGORY_LABELS[c] }));
  const roomCategoryOptions: SelectOption[] = ROOM_CATEGORIES.map((c) => ({ value: c, label: humanize(c) }));
  const dietOptions: SelectOption[] = DIET_TYPES.map((d) => ({
    value: d,
    label: d === "non_veg" ? "Non-Vegetarian" : d === "brahmin" ? "Brahmin Food" : d === "jain" ? "Jain Food" : "Vegetarian",
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${quote.quote_no} · v${quote.version}`}
        backTo="/quotations"
        meta={<StatusBadge status={quote.status} label={STATUS_LABELS[quote.status]} />}
        description={`${quote.customer_name ?? "No customer linked"} · ${formatPax(quote.adults, quote.children, quote.infants)} · Valid until ${quote.valid_until ? formatDate(quote.valid_until) : "—"}`}
        actions={
          <>
            {allowedTransitions.includes("sent") && (
              <Button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending}>
                {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send />}
                Send
              </Button>
            )}
            {allowedTransitions.includes("revised") && (
              <Button variant="outline" onClick={() => reviseMutation.mutate()} disabled={reviseMutation.isPending}>
                {reviseMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Revise
              </Button>
            )}
            {allowedTransitions.includes("accepted") && (
              <Button
                variant="outline"
                onClick={() =>
                  statusMutation.mutate(
                    { status: "accepted" },
                    { onError: (error) => toast.fromError(error, "That status change was rejected", true) },
                  )
                }
                disabled={statusMutation.isPending}
              >
                Mark accepted
              </Button>
            )}
            {allowedTransitions.includes("rejected") && (
              <Button variant="outline" onClick={() => { setRejectReason(""); setRejectOpen(true); }}>
                Reject
              </Button>
            )}
            {quote.converted_booking_id ? (
              <Button variant="secondary" asChild>
                <Link to={`/bookings/${quote.converted_booking_id}`}>View booking</Link>
              </Button>
            ) : canConvert ? (
              <Button onClick={() => setConvertOpen(true)}>Convert to booking</Button>
            ) : null}
          </>
        }
      />

      {/* Package Type toggle */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Package type</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border p-1">
              <Button
                type="button"
                size="sm"
                variant={quote.quote_type === "package" ? "default" : "ghost"}
                disabled={!editable || quoteTypeMutation.isPending}
                onClick={() => quoteTypeMutation.mutate("package")}
              >
                Full package
              </Button>
              <Button
                type="button"
                size="sm"
                variant={isIndependent ? "default" : "ghost"}
                disabled={!editable || quoteTypeMutation.isPending}
                onClick={() => quoteTypeMutation.mutate("custom")}
              >
                Independent / individual
              </Button>
            </div>

            {isIndependent && (
              <Select
                value={quote.quote_type}
                onValueChange={(v) => quoteTypeMutation.mutate(v as QuoteType)}
                disabled={!editable || quoteTypeMutation.isPending}
              >
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INDEPENDENT_SUB_TYPES.map((t) => <SelectItem key={t} value={t}>{SUB_TYPE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {!editable && (
              <p className="text-xs text-muted-foreground">
                Locked — a {quote.status} quotation cannot be edited; create a revision instead.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Build the Quote */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Build the quote</CardTitle></CardHeader>
        <CardContent>
          <form
            onSubmit={builderForm.handleSubmit((values) => builderMutation.mutate(values))}
            className="space-y-5"
          >
            <div>
              <Label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Transport mode</Label>
              <div className="inline-flex flex-wrap rounded-lg border p-1">
                {TRANSPORT_MODES.map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    size="sm"
                    variant={builderForm.watch("transport_mode") === mode ? "default" : "ghost"}
                    disabled={!editable}
                    onClick={() => builderForm.setValue("transport_mode", mode, { shouldDirty: true })}
                  >
                    {humanize(mode)}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectField
                control={builderForm.control}
                name="hotel_category"
                label="Hotel category"
                options={hotelCategoryOptions}
                disabled={!editable}
              />
              <SelectField
                control={builderForm.control}
                name="room_category"
                label="Room category"
                options={roomCategoryOptions}
                disabled={!editable}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SwitchField control={builderForm.control} name="food_included" label="Food included" disabled={!editable} />
              <SelectField
                control={builderForm.control}
                name="diet_type"
                label="Diet type"
                options={dietOptions}
                disabled={!editable || !foodIncluded}
              />
            </div>

            <Separator />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <SwitchField control={builderForm.control} name="baggage_included" label="Baggage" disabled={!editable} />
                {baggageIncluded && (
                  <TextField control={builderForm.control} name="baggage_notes" placeholder="e.g. 15kg check-in + 7kg cabin" disabled={!editable} />
                )}
              </div>
              <SwitchField control={builderForm.control} name="local_transport_included" label="Local transport (pickup / drop)" disabled={!editable} />
              <SwitchField control={builderForm.control} name="sightseeing_included" label="Sightseeing" disabled={!editable} />
              <SwitchField control={builderForm.control} name="insurance_included" label="Insurance" disabled={!editable} />
            </div>

            {editable && (
              <Button type="submit" disabled={builderMutation.isPending}>
                {builderMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save />}
                Save build
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Line items */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Line items</CardTitle>
          {editable && quote.package_id && (
            <div className="flex items-center gap-2">
              <Select value={occupancy} onValueChange={(v) => setOccupancy(v as typeof occupancy)}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single</SelectItem>
                  <SelectItem value="double">Double</SelectItem>
                  <SelectItem value="triple">Triple</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" onClick={() => priceFromPackageMutation.mutate()} disabled={priceFromPackageMutation.isPending}>
                {priceFromPackageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Package />}
                Price from package
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {itemsFieldArray.fields.length === 0 && !editable ? (
            <EmptyState compact title="No line items" />
          ) : (
            <div className="scroll-x rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">Type</th>
                    <th className="p-2 text-left">Description</th>
                    <th className="p-2 text-left">Day</th>
                    <th className="p-2 text-left">Date</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-left">Unit</th>
                    {canViewMargins && <th className="p-2 text-right">Cost</th>}
                    <th className="p-2 text-right">Price</th>
                    <th className="p-2 text-right">Total</th>
                    {editable && <th className="p-2" />}
                  </tr>
                </thead>
                <tbody>
                  {itemsFieldArray.fields.map((field, index) => {
                    const row = itemsForm.watch(`items.${index}`);
                    const lineTotal = toNumber(row?.quantity) * toNumber(row?.unit_price);
                    return (
                      <tr key={field.id} className="border-t">
                        <td className="p-2">
                          <SelectField control={itemsForm.control} name={`items.${index}.item_type`} options={ITEM_TYPE_OPTIONS} disabled={!editable} className="min-w-[7rem]" />
                        </td>
                        <td className="p-2 min-w-[10rem]">
                          <TextField control={itemsForm.control} name={`items.${index}.description`} disabled={!editable} />
                        </td>
                        <td className="p-2 w-16">
                          <NumberField control={itemsForm.control} name={`items.${index}.day_no`} disabled={!editable} min={1} />
                        </td>
                        <td className="p-2 w-36">
                          <DateField control={itemsForm.control} name={`items.${index}.service_date`} disabled={!editable} />
                        </td>
                        <td className="p-2 w-20">
                          <NumberField control={itemsForm.control} name={`items.${index}.quantity`} disabled={!editable} min={0} />
                        </td>
                        <td className="p-2 w-20">
                          <TextField control={itemsForm.control} name={`items.${index}.unit`} disabled={!editable} placeholder="nos" />
                        </td>
                        {canViewMargins && (
                          <td className="p-2 w-24">
                            <NumberField control={itemsForm.control} name={`items.${index}.unit_cost`} disabled={!editable} min={0} />
                          </td>
                        )}
                        <td className="p-2 w-24">
                          <NumberField control={itemsForm.control} name={`items.${index}.unit_price`} disabled={!editable} min={0} />
                        </td>
                        <td className="p-2 text-right tabular"><MoneyText value={lineTotal} /></td>
                        {editable && (
                          <td className="p-2">
                            <Button type="button" variant="ghost" size="icon-sm" onClick={() => itemsFieldArray.remove(index)} aria-label="Remove line">
                              <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {editable && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                itemsFieldArray.append({
                  item_type: "other",
                  description: "",
                  quantity: 1,
                  unit: "nos",
                  unit_price: 0,
                })
              }
            >
              <Plus /> Add line
            </Button>
          )}

          <Separator />

          <div className="ml-auto max-w-xs space-y-1.5 text-sm">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Subtotal</span><MoneyText value={quote.subtotal} /></div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Discount</span>
              {editable && canEditPrices ? (
                <NumberField control={itemsForm.control} name="discount_amount" className="w-28" min={0} />
              ) : (
                <MoneyText value={quote.discount_amount} />
              )}
            </div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Taxable amount</span><MoneyText value={quote.taxable_amount} /></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">GST ({toNumber(quote.gst_pct)}%)</span><MoneyText value={quote.gst_amount} /></div>
            {toNumber(quote.tcs_amount) > 0 && (
              <div className="flex items-center justify-between"><span className="text-muted-foreground">TCS</span><MoneyText value={quote.tcs_amount} /></div>
            )}
            <div className="flex items-center justify-between text-base font-semibold"><span>Grand total</span><MoneyText value={quote.grand_total} /></div>
            {canViewMargins && quote.cost_total !== undefined && (
              <>
                <div className="flex items-center justify-between text-muted-foreground"><span>Cost</span><MoneyText value={quote.cost_total} /></div>
                <div className="flex items-center justify-between font-medium"><span>Margin</span><MoneyText value={quote.margin_amount} colored /></div>
              </>
            )}
          </div>

          {editable && (
            <div className="flex justify-end">
              <Button onClick={itemsForm.handleSubmit((values) => itemsMutation.mutate(values))} disabled={itemsMutation.isPending}>
                {itemsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save />}
                Save & re-price
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reject */}
      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Reject this quotation"
        description="A reason is required so the team understands why the customer declined."
        confirmLabel="Reject"
        destructive
        confirmDisabled={rejectReason.trim() === ""}
        onConfirm={async () => {
          await statusMutation.mutateAsync({ status: "rejected", reason: rejectReason.trim() });
        }}
      >
        <textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Reason…"
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </ConfirmDialog>

      {/* Convert */}
      <ConfirmDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        title="Convert to booking"
        description="This opens a new draft booking pre-filled from this quotation. The quotation will be marked accepted."
        confirmLabel="Convert"
        icon={ArrowRightLeft}
        onConfirm={async () => {
          await convertMutation.mutateAsync();
        }}
      />
    </div>
  );
}

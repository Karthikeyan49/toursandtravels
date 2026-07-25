import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Loader2, Plus, Printer } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  getInvoice,
  recordInvoicePayment,
  voidInvoice,
  type InvoiceDetail as InvoiceDetailRecord,
  type InvoiceType,
} from "@/lib/api/invoices";
import { PAYMENT_MODES, requiresReference, type PaymentMode } from "@/lib/api/payments";
import type { CompanyProfile } from "@/lib/api/settings";
import type { PdfCompanyProfile } from "@/lib/pdf/companyProfile";
import { formatDate, formatDateTime } from "@/lib/format";
import { humanize, toNumber } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  applyApiErrors,
  DateField,
  NumberField,
  SelectField,
  TextField,
  TextareaField,
  type SelectOption,
} from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { MoneyText } from "@/components/MoneyText";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const TYPE_LABELS: Record<InvoiceType, string> = {
  tax_invoice: "GST Tax Invoice",
  cash_bill: "Cash Bill · Non-GST",
  proforma: "Proforma",
  credit_note: "Credit Note",
  debit_note: "Debit Note",
};

function InvoiceTypeBadge({ type }: { type: InvoiceType }) {
  if (type === "cash_bill") {
    return <Badge variant="status" className="bg-status-pending-bg text-status-pending">{TYPE_LABELS.cash_bill}</Badge>;
  }
  if (type === "tax_invoice") {
    return <Badge variant="status" className="bg-status-confirmed-bg text-status-confirmed">{TYPE_LABELS.tax_invoice}</Badge>;
  }
  return <Badge variant="outline">{TYPE_LABELS[type]}</Badge>;
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/** Maps the app's settings-backed CompanyProfile onto the PDF engine's plain input shape. */
function toPdfCompany(company: CompanyProfile): PdfCompanyProfile {
  return {
    name: company.name || company.legal_name || "Travel Desk",
    legalName: company.legal_name || undefined,
    address: company.address || undefined,
    city: company.city || undefined,
    state: company.state || undefined,
    pincode: company.pincode || undefined,
    phone: company.phone || undefined,
    email: company.email || undefined,
    website: company.website || undefined,
    gstin: company.gstin || undefined,
    pan: company.pan || undefined,
    // Only usable if the settings page already stores a data: URL — a remote
    // path cannot be embedded synchronously by the PDF engine.
    logoDataUrl: company.logo?.startsWith("data:") ? company.logo : undefined,
    primaryColorHex: company.primary_color || undefined,
    bank: company.bank
      ? {
          name: company.bank.name || undefined,
          accountName: company.bank.account_name || undefined,
          accountNo: company.bank.account_no || undefined,
          ifsc: company.bank.ifsc || undefined,
          upiId: company.bank.upi_id || undefined,
        }
      : undefined,
  };
}

const paymentSchema = z.object({
  amount: z.number().min(0.01, "Enter an amount"),
  mode: z.enum(PAYMENT_MODES),
  utr_no: z.string().optional(),
  bank_account: z.string().optional(),
  paid_on: z.string().optional(),
  remarks: z.string().optional(),
});
type PaymentFormValues = z.infer<typeof paymentSchema>;

export default function InvoiceDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [printing, setPrinting] = useState(false);

  const canRecordPayment = can("record_payment");
  const canVoid = can("void_document");

  const invoiceQuery = useQuery({
    queryKey: qk.invoices.detail(id),
    queryFn: () => getInvoice(id),
    enabled: Number.isFinite(id),
  });
  const invoice = invoiceQuery.data;

  const setInvoice = (next: InvoiceDetailRecord) => queryClient.setQueryData(qk.invoices.detail(id), next);
  const invalidateLists = () => queryClient.invalidateQueries({ queryKey: qk.invoices.all });

  const paymentForm = useForm<PaymentFormValues>({ resolver: zodResolver(paymentSchema), defaultValues: { mode: "cash" } });
  const paymentMode = paymentForm.watch("mode");

  const recordPaymentMutation = useMutation({
    mutationFn: (values: PaymentFormValues) =>
      recordInvoicePayment(id, {
        amount: values.amount,
        mode: values.mode,
        utr_no: values.utr_no || null,
        bank_account: values.bank_account || null,
        paid_on: values.paid_on || null,
        remarks: values.remarks || null,
      }),
    onSuccess: (result) => {
      setInvoice(result.invoice);
      invalidateLists();
      toast.success("Payment recorded");
      setPaymentOpen(false);
      paymentForm.reset({ mode: "cash" });
    },
    onError: (error) => {
      if (!applyApiErrors(error, paymentForm.setError, ["amount", "mode", "utr_no", "bank_account", "paid_on", "remarks"])) {
        toast.fromError(error, "Could not record the payment", true);
      }
    },
  });

  const voidMutation = useMutation({
    mutationFn: (reason: string) => voidInvoice(id, reason),
    onSuccess: (next) => {
      setInvoice(next);
      invalidateLists();
      toast.success("Invoice voided");
      setVoidReason("");
    },
  });

  const handleDownloadPdf = async () => {
    if (!invoice) return;
    setPrinting(true);
    try {
      const { downloadInvoicePdf } = await import("@/lib/pdf");
      await downloadInvoicePdf({
        invoiceNo: invoice.invoice_no,
        invoiceType: invoice.invoice_type,
        isGstApplicable: invoice.is_gst_applicable === 1,
        invoiceDate: invoice.invoice_date,
        dueDate: invoice.due_date ?? undefined,
        customer: {
          name: invoice.customer_name ?? "Customer",
          address: invoice.customer_address ?? undefined,
          city: invoice.customer_city ?? undefined,
          state: invoice.customer_state ?? undefined,
          pincode: invoice.customer_pincode ?? undefined,
          gstin: invoice.customer_gstin ?? undefined,
          phone: invoice.customer_phone ?? undefined,
        },
        placeOfSupply: invoice.place_of_supply ?? undefined,
        items: invoice.items.map((item) => ({
          description: item.description,
          sacCode: item.sac_code ?? undefined,
          quantity: toNumber(item.quantity),
          unit: item.unit,
          unitPrice: toNumber(item.unit_price),
          taxableValue: toNumber(item.taxable_value),
          gstPct: toNumber(item.gst_pct),
          gstAmount: toNumber(item.gst_amount),
          lineTotal: toNumber(item.line_total),
        })),
        subtotal: toNumber(invoice.subtotal),
        discountAmount: toNumber(invoice.discount_amount),
        taxableAmount: toNumber(invoice.taxable_amount),
        cgstAmount: toNumber(invoice.cgst_amount),
        sgstAmount: toNumber(invoice.sgst_amount),
        igstAmount: toNumber(invoice.igst_amount),
        tcsAmount: toNumber(invoice.tcs_amount),
        roundOff: toNumber(invoice.round_off),
        grandTotal: toNumber(invoice.grand_total),
        amountInWords: invoice.amount_in_words,
        notes: invoice.notes ?? undefined,
        terms: invoice.terms ?? undefined,
        company: toPdfCompany(invoice.company),
      });
    } catch (error) {
      toast.fromError(error, "Could not build the invoice PDF", true);
    } finally {
      setPrinting(false);
    }
  };

  const paymentModeOptions: SelectOption[] = PAYMENT_MODES.map((m) => ({ value: m, label: humanize(m) }));

  if (invoiceQuery.isLoading || !invoice) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const gstApplicable = invoice.is_gst_applicable === 1;
  const isVoided = invoice.status === "void" || invoice.status === "cancelled";
  const outstanding = toNumber(invoice.outstanding);
  const customerAddress = [invoice.customer_address, invoice.customer_city, invoice.customer_pincode]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-5">
      <PageHeader
        title={invoice.invoice_no}
        backTo="/invoices"
        meta={
          <>
            <InvoiceTypeBadge type={invoice.invoice_type} />
            <StatusBadge status={invoice.status} />
            <StatusBadge status={invoice.payment_status} size="sm" />
          </>
        }
        description={`${invoice.customer_name ?? "—"} · ${formatDate(invoice.invoice_date)}${invoice.due_date ? ` · Due ${formatDate(invoice.due_date)}` : ""}`}
        actions={
          <>
            <Button variant="outline" onClick={handleDownloadPdf} disabled={printing}>
              {printing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Printer />}
              Download PDF
            </Button>
            {canRecordPayment && !isVoided && (
              <Button onClick={() => setPaymentOpen(true)}>
                <Plus /> Record payment
              </Button>
            )}
            {canVoid && !isVoided && (
              <Button variant="destructive" onClick={() => { setVoidReason(""); setVoidOpen(true); }}>
                <Ban /> Void
              </Button>
            )}
          </>
        }
      />

      {isVoided && (
        <div className="rounded-lg border border-status-cancelled bg-status-cancelled-bg px-3 py-2 text-sm text-status-cancelled">
          This invoice was voided{invoice.voided_at ? ` on ${formatDateTime(invoice.voided_at)}` : ""}
          {invoice.void_reason ? ` — ${invoice.void_reason}` : "."}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Customer */}
          <Card>
            <CardHeader><CardTitle className="text-sm">Bill to</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div className="space-y-1">
                <p className="font-medium">{invoice.customer_name ?? "—"}</p>
                {customerAddress && <p className="text-muted-foreground">{customerAddress}</p>}
                {invoice.customer_phone && <p className="text-muted-foreground">{invoice.customer_phone}</p>}
                {invoice.customer_email && <p className="text-muted-foreground">{invoice.customer_email}</p>}
                {invoice.customer_gstin && <p className="text-muted-foreground">GSTIN: {invoice.customer_gstin}</p>}
              </div>
              <div className="space-y-1.5">
                {invoice.booking_id && invoice.booking_no && (
                  <DetailRow
                    label="Booking"
                    value={<Link to={`/bookings/${invoice.booking_id}`} className="underline-offset-2 hover:underline">{invoice.booking_no}</Link>}
                  />
                )}
                {invoice.destination_name && <DetailRow label="Destination" value={invoice.destination_name} />}
                {invoice.package_name && <DetailRow label="Package" value={invoice.package_name} />}
                {invoice.travel_from && (
                  <DetailRow label="Travel" value={`${formatDate(invoice.travel_from)} – ${formatDate(invoice.travel_to)}`} />
                )}
                {gstApplicable && invoice.place_of_supply && <DetailRow label="Place of supply" value={invoice.place_of_supply} />}
              </div>
            </CardContent>
          </Card>

          {/* Line items */}
          <Card>
            <CardHeader><CardTitle className="text-sm">Line items</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {invoice.items.length === 0 ? (
                <EmptyState compact title="No line items" />
              ) : (
                <div className="scroll-x rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="p-2 text-left">#</th>
                        <th className="p-2 text-left">Description</th>
                        {gstApplicable && <th className="p-2 text-left">SAC</th>}
                        <th className="p-2 text-right">Qty</th>
                        <th className="p-2 text-right">Rate</th>
                        <th className="p-2 text-right">Disc %</th>
                        {gstApplicable && <th className="p-2 text-right">Taxable</th>}
                        {gstApplicable && <th className="p-2 text-right">GST %</th>}
                        {gstApplicable && <th className="p-2 text-right">GST</th>}
                        <th className="p-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoice.items.map((item, index) => (
                        <tr key={item.id} className="border-t">
                          <td className="p-2 text-muted-foreground">{index + 1}</td>
                          <td className="p-2">{item.description}</td>
                          {gstApplicable && <td className="p-2 text-muted-foreground">{item.sac_code ?? "—"}</td>}
                          <td className="p-2 text-right tabular">{toNumber(item.quantity)} {item.unit}</td>
                          <td className="p-2 text-right"><MoneyText value={item.unit_price} /></td>
                          <td className="p-2 text-right tabular">{toNumber(item.discount_pct)}%</td>
                          {gstApplicable && <td className="p-2 text-right"><MoneyText value={item.taxable_value} /></td>}
                          {gstApplicable && <td className="p-2 text-right tabular">{toNumber(item.gst_pct)}%</td>}
                          {gstApplicable && <td className="p-2 text-right"><MoneyText value={item.gst_amount} /></td>}
                          <td className="p-2 text-right"><MoneyText value={item.line_total} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tax summary — the GST block is omitted entirely on a cash bill,
                  never rendered as zeroes: it is a statutory distinction. */}
              <div className="flex justify-end">
                <div className="w-full max-w-sm space-y-1.5 text-sm">
                  <DetailRow label="Subtotal" value={<MoneyText value={invoice.subtotal} />} />
                  {toNumber(invoice.discount_amount) > 0 && (
                    <DetailRow label="Discount" value={<MoneyText value={invoice.discount_amount} />} />
                  )}
                  {gstApplicable && (
                    <>
                      <DetailRow label="Taxable amount" value={<MoneyText value={invoice.taxable_amount} />} />
                      {toNumber(invoice.cgst_amount) > 0 && <DetailRow label="CGST" value={<MoneyText value={invoice.cgst_amount} />} />}
                      {toNumber(invoice.sgst_amount) > 0 && <DetailRow label="SGST" value={<MoneyText value={invoice.sgst_amount} />} />}
                      {toNumber(invoice.igst_amount) > 0 && <DetailRow label="IGST" value={<MoneyText value={invoice.igst_amount} />} />}
                      {toNumber(invoice.tcs_amount) > 0 && <DetailRow label="TCS" value={<MoneyText value={invoice.tcs_amount} />} />}
                    </>
                  )}
                  {toNumber(invoice.round_off) !== 0 && (
                    <DetailRow label="Round off" value={<MoneyText value={invoice.round_off} showSign />} />
                  )}
                  <Separator />
                  <div className="flex items-center justify-between text-base font-semibold">
                    <span>Grand total</span>
                    <MoneyText value={invoice.grand_total} struck={isVoided} />
                  </div>
                </div>
              </div>

              <p className="text-xs italic text-muted-foreground">Amount in words: {invoice.amount_in_words}</p>
            </CardContent>
          </Card>

          {(invoice.notes || invoice.terms) && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Notes &amp; terms</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {invoice.notes && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
                    <p className="mt-1 whitespace-pre-wrap">{invoice.notes}</p>
                  </div>
                )}
                {invoice.terms && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Terms</p>
                    <p className="mt-1 whitespace-pre-wrap">{invoice.terms}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Money</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <DetailRow label="Invoice date" value={formatDate(invoice.invoice_date)} />
              <DetailRow label="Due date" value={invoice.due_date ? formatDate(invoice.due_date) : "—"} />
              <Separator />
              <DetailRow label="Grand total" value={<MoneyText value={invoice.grand_total} />} />
              <DetailRow label="Paid" value={<MoneyText value={invoice.amount_paid} />} />
              <div className="flex items-center justify-between font-semibold">
                <span>Outstanding</span>
                <MoneyText value={invoice.outstanding} className={outstanding > 0 ? "text-status-overdue" : undefined} />
              </div>
              {invoice.last_payment_at && (
                <DetailRow label="Last payment" value={formatDateTime(invoice.last_payment_at)} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">Payments</CardTitle>
              {canRecordPayment && !isVoided && (
                <Button size="sm" variant="outline" onClick={() => setPaymentOpen(true)}><Plus /> Record</Button>
              )}
            </CardHeader>
            <CardContent>
              {invoice.payments.length === 0 ? (
                <EmptyState compact title="No payments received yet" />
              ) : (
                <div className="space-y-1.5">
                  {invoice.payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-accent/30">
                      <div>
                        <p className="font-medium">{payment.payment_no} · {humanize(payment.mode)}</p>
                        <p className="text-xs text-muted-foreground">
                          {payment.paid_on ? formatDate(payment.paid_on) : payment.due_on ? `Due ${formatDate(payment.due_on)}` : "—"}
                          {payment.utr_no ? ` · ${payment.utr_no}` : ""}
                          {payment.remarks ? ` · ${payment.remarks}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <MoneyText value={payment.amount} />
                        <StatusBadge status={payment.status} size="sm" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Record payment */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>Outstanding: <MoneyText value={invoice.outstanding} /></DialogDescription>
          </DialogHeader>
          <form onSubmit={paymentForm.handleSubmit((values) => recordPaymentMutation.mutate(values))} noValidate className="space-y-4">
            <NumberField control={paymentForm.control} name="amount" label="Amount" required min={0.01} />
            <SelectField control={paymentForm.control} name="mode" label="Mode" options={paymentModeOptions} />
            {requiresReference(paymentMode as PaymentMode) && (
              <>
                <TextField control={paymentForm.control} name="utr_no" label="Reference / UTR no." required />
                <TextField control={paymentForm.control} name="bank_account" label="Bank account" />
              </>
            )}
            <DateField control={paymentForm.control} name="paid_on" label="Paid on" />
            <TextareaField control={paymentForm.control} name="remarks" label="Remarks" rows={2} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={recordPaymentMutation.isPending}>
                {recordPaymentMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Record
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Void */}
      <ConfirmDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        title="Void this invoice"
        description="A voided invoice keeps its number and stays on record — it is never deleted. A reason is required."
        confirmLabel="Void invoice"
        destructive
        confirmDisabled={voidReason.trim() === ""}
        onConfirm={async () => {
          await voidMutation.mutateAsync(voidReason.trim());
        }}
      >
        <Textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} rows={3} placeholder="Reason for voiding…" />
      </ConfirmDialog>
    </div>
  );
}

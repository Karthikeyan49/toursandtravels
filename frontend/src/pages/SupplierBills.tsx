import { useMemo, useState, type ReactNode } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Plus, Search, Trash2, Wallet } from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  approveSupplierBill,
  createSupplierBill,
  getSupplierBill,
  listSupplierBills,
  paySupplierBill,
  SUPPLIER_BILL_PAYMENT_STATUSES,
  type SupplierBillFilters,
  type SupplierBillInput,
  type SupplierBillListItem,
  type SupplierBillPaymentStatus,
} from "@/lib/api/supplierBills";
import { listSupplierOptions } from "@/lib/api/suppliers";
import { listBookings } from "@/lib/api/bookings";
import type { Decimal } from "@/lib/api/common";
import { PAYMENT_MODES } from "@/lib/api/payments";
import { formatDate } from "@/lib/format";
import { humanize, toNumber } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "@/hooks/use-toast";
import {
  applyApiErrors,
  DateField,
  NumberField,
  SelectField,
  TextareaField,
  TextField,
  type SelectOption,
} from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { MoneyText } from "@/components/MoneyText";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** A booking reference the picker can round-trip without the full list row. */
interface BookingRef {
  id: number;
  label: string;
}

function BookingPicker({
  value,
  onSelect,
  label,
}: {
  value: BookingRef | null;
  onSelect: (booking: BookingRef | null) => void;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query);
  const searchQuery = useQuery({
    queryKey: qk.bookings.list({ search: debounced, limit: 8 }),
    queryFn: () => listBookings({ search: debounced, limit: 8 }),
    enabled: debounced.length >= 2,
  });

  return (
    <div className="space-y-1.5">
      {label && <label className="text-sm font-medium">{label}</label>}
      {value ? (
        <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
          <span className="truncate">{value.label}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onSelect(null)}>Change</Button>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search booking no, customer…" className="pl-8" />
          {query.length >= 2 && (searchQuery.data?.items.length ?? 0) > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
              {searchQuery.data?.items.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onSelect({ id: b.id, label: `${b.booking_no} · ${b.customer_name ?? b.lead_pax_name}` });
                    setQuery("");
                  }}
                >
                  <span>{b.booking_no} · {b.customer_name ?? b.lead_pax_name}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(b.travel_from)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const billItemSchema = z.object({
  description: z.string().trim().min(1, "Describe the line").max(400),
  unit_cost: z.number().min(0, "Cost cannot be negative"),
  quantity: z.number().min(0.01, "Quantity must be positive").optional(),
  tax_pct: z.number().min(0).max(100).optional(),
});

const billSchema = z.object({
  supplier_id: z.string().min(1, "Supplier is required"),
  bill_date: z.string().min(1, "Bill date is required"),
  supplier_ref_no: z.string().trim().max(60).optional(),
  due_date: z.string().optional(),
  tds_amount: z.number().min(0).optional(),
  notes: z.string().trim().max(4000).optional(),
  items: z.array(billItemSchema).min(1, "A bill needs at least one line"),
});
type BillFormValues = z.infer<typeof billSchema>;

const BILL_FIELDS = ["supplier_id", "bill_date", "supplier_ref_no", "due_date", "tds_amount", "notes", "items"] as const;

const EMPTY_LINE = { description: "", unit_cost: 0, quantity: 1, tax_pct: 0 };

function CreateBillDialog() {
  const [open, setOpen] = useState(false);
  const [booking, setBooking] = useState<BookingRef | null>(null);
  const queryClient = useQueryClient();

  const { control, handleSubmit, reset, setError, watch, formState: { isSubmitting } } = useForm<BillFormValues>({
    resolver: zodResolver(billSchema),
    defaultValues: { items: [EMPTY_LINE] },
  });
  const itemsFieldArray = useFieldArray({ control, name: "items" });

  const suppliersQuery = useQuery({
    queryKey: qk.suppliers.options(undefined),
    queryFn: () => listSupplierOptions(),
    enabled: open,
  });
  const supplierOptions: SelectOption[] = (suppliersQuery.data ?? []).map((s) => ({
    value: String(s.id),
    label: `${s.name} · ${humanize(s.supplier_type)}`,
  }));

  const lines = watch("items");
  const tdsAmount = toNumber(watch("tds_amount"));
  const totals = (lines ?? []).reduce(
    (acc, row) => {
      const net = toNumber(row?.quantity ?? 1) * toNumber(row?.unit_cost);
      const tax = (net * toNumber(row?.tax_pct)) / 100;
      return { subtotal: acc.subtotal + net, tax: acc.tax + tax };
    },
    { subtotal: 0, tax: 0 },
  );
  const grandTotal = totals.subtotal + totals.tax - tdsAmount;

  const close = () => {
    setOpen(false);
    reset({ items: [EMPTY_LINE] });
    setBooking(null);
  };

  const onSubmit = handleSubmit(async (values) => {
    const input: SupplierBillInput = {
      supplier_id: Number(values.supplier_id),
      bill_date: values.bill_date,
      items: values.items.map((row) => ({
        description: row.description,
        unit_cost: row.unit_cost,
        quantity: row.quantity,
        tax_pct: row.tax_pct,
      })),
      supplier_ref_no: values.supplier_ref_no || null,
      booking_id: booking?.id ?? null,
      due_date: values.due_date || null,
      tds_amount: values.tds_amount,
      notes: values.notes || null,
    };

    try {
      await createSupplierBill(input);
      toast.success("Supplier bill created", { description: "It starts as a draft — approve it before paying." });
      await queryClient.invalidateQueries({ queryKey: qk.supplierBills.all });
      close();
    } catch (error) {
      if (!applyApiErrors(error, setError, BILL_FIELDS)) {
        toast.fromError(error, "Could not create this bill", true);
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTrigger asChild>
        <Button><Plus /> New bill</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New supplier bill</DialogTitle>
          <DialogDescription>Payables against a supplier, optionally tied to a booking. Saved as a draft.</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField control={control} name="supplier_id" label="Supplier" options={supplierOptions} required placeholder="Select supplier" />
            <TextField control={control} name="supplier_ref_no" label="Supplier reference" placeholder="Their invoice no." />
            <DateField control={control} name="bill_date" label="Bill date" required />
            <DateField control={control} name="due_date" label="Due date" placeholder="Supplier credit days" />
            <div className="sm:col-span-2">
              <BookingPicker value={booking} onSelect={setBooking} label="Booking (optional)" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Line items</h3>
              <Button type="button" variant="outline" size="sm" onClick={() => itemsFieldArray.append(EMPTY_LINE)}>
                <Plus /> Add line
              </Button>
            </div>

            <div className="scroll-x rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">Description</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-right">Unit cost</th>
                    <th className="p-2 text-right">Tax %</th>
                    <th className="p-2 text-right">Line total</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {itemsFieldArray.fields.map((field, index) => {
                    const row = lines?.[index];
                    const net = toNumber(row?.quantity ?? 1) * toNumber(row?.unit_cost);
                    const lineTotal = net + (net * toNumber(row?.tax_pct)) / 100;
                    return (
                      <tr key={field.id} className="border-t align-top">
                        <td className="min-w-[14rem] p-2">
                          <TextField control={control} name={`items.${index}.description`} placeholder="e.g. 3 nights, deluxe room" />
                        </td>
                        <td className="w-20 p-2">
                          <NumberField control={control} name={`items.${index}.quantity`} min={0} />
                        </td>
                        <td className="w-28 p-2">
                          <NumberField control={control} name={`items.${index}.unit_cost`} min={0} />
                        </td>
                        <td className="w-20 p-2">
                          <NumberField control={control} name={`items.${index}.tax_pct`} min={0} max={100} />
                        </td>
                        <td className="p-2 text-right"><MoneyText value={lineTotal} /></td>
                        <td className="p-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={itemsFieldArray.fields.length === 1}
                            onClick={() => itemsFieldArray.remove(index)}
                            aria-label="Remove line"
                          >
                            <Trash2 className="text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-4">
              <NumberField control={control} name="tds_amount" label="TDS withheld" min={0} description="Deducted from the payable total." />
              <TextareaField control={control} name="notes" label="Notes" rows={3} />
            </div>

            <div className="space-y-1.5 rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <MoneyText value={totals.subtotal} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tax</span>
                <MoneyText value={totals.tax} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">TDS</span>
                <MoneyText value={-tdsAmount} />
              </div>
              <Separator className="my-1.5" />
              <div className="flex items-center justify-between font-medium">
                <span>Bill total</span>
                <MoneyText value={grandTotal} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Create bill
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

const paySchema = z.object({
  amount: z.number().min(0.01, "Enter the amount paid"),
  mode: z.enum(PAYMENT_MODES).optional(),
  utr_no: z.string().trim().max(60).optional(),
  bank_account: z.string().trim().max(80).optional(),
  paid_on: z.string().optional(),
  remarks: z.string().trim().max(400).optional(),
});
type PayFormValues = z.infer<typeof paySchema>;

const PAY_FIELDS = ["amount", "mode", "utr_no", "bank_account", "paid_on", "remarks"] as const;

function PayBillDialog({ bill, onOpenChange }: { bill: SupplierBillListItem; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const outstanding = toNumber(bill.outstanding);

  const { control, handleSubmit, setError, formState: { isSubmitting } } = useForm<PayFormValues>({
    resolver: zodResolver(paySchema),
    defaultValues: { amount: outstanding > 0 ? outstanding : undefined, mode: "bank_transfer" },
  });

  const modeOptions: SelectOption[] = PAYMENT_MODES.map((m) => ({ value: m, label: humanize(m) }));

  const onSubmit = handleSubmit(async (values) => {
    try {
      await paySupplierBill(bill.id, {
        amount: values.amount,
        mode: values.mode,
        utr_no: values.utr_no || null,
        bank_account: values.bank_account || null,
        paid_on: values.paid_on || null,
        remarks: values.remarks || null,
      });
      toast.success("Supplier payment recorded");
      await queryClient.invalidateQueries({ queryKey: qk.supplierBills.all });
      onOpenChange(false);
    } catch (error) {
      if (!applyApiErrors(error, setError, PAY_FIELDS)) {
        toast.fromError(error, "Could not record this payment", true);
      }
    }
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pay {bill.bill_no}</DialogTitle>
          <DialogDescription>
            {bill.supplier_name} · outstanding <MoneyText value={bill.outstanding} />
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField control={control} name="amount" label="Amount" required min={0} />
          <SelectField control={control} name="mode" label="Mode" options={modeOptions} />
          <TextField control={control} name="utr_no" label="UTR / cheque no." />
          <TextField control={control} name="bank_account" label="Bank account" />
          <DateField control={control} name="paid_on" label="Paid on" />
          <TextField control={control} name="remarks" label="Remarks" />
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function BillDetailSheet({
  billId,
  onOpenChange,
  onApprove,
  onPay,
}: {
  billId: number | null;
  onOpenChange: (open: boolean) => void;
  onApprove: (id: number) => void;
  onPay: (id: number) => void;
}) {
  const detailQuery = useQuery({
    queryKey: qk.supplierBills.detail(billId ?? 0),
    queryFn: () => getSupplierBill(billId as number),
    enabled: billId !== null,
  });
  const bill = detailQuery.data;

  return (
    <Sheet open={billId !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {bill ? bill.bill_no : "Supplier bill"}
            {bill && <StatusBadge status={bill.status} size="sm" />}
            {bill && <StatusBadge status={bill.payment_status} size="sm" />}
          </SheetTitle>
          <SheetDescription>Payable lines, approval state and the payment ledger.</SheetDescription>
        </SheetHeader>

        {!bill ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <Fact label="Supplier" value={bill.supplier_name} />
              <Fact label="GSTIN" value={bill.supplier_gstin ?? "—"} />
              <Fact label="Bill date" value={formatDate(bill.bill_date)} />
              <Fact label="Due date" value={formatDate(bill.due_date)} />
              <Fact label="Booking" value={bill.booking_no ?? "—"} />
              <Fact label="Supplier ref" value={bill.supplier_ref_no ?? "—"} />
            </div>

            {bill.notes && <p className="rounded-md bg-muted/50 p-3 text-sm">{bill.notes}</p>}

            <Separator />

            <div>
              <h3 className="mb-2 text-sm font-medium">Lines</h3>
              <div className="scroll-x rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="p-2 text-left">Description</th>
                      <th className="p-2 text-right">Qty</th>
                      <th className="p-2 text-right">Unit cost</th>
                      <th className="p-2 text-right">Tax %</th>
                      <th className="p-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bill.items.map((item) => (
                      <tr key={item.id} className="border-t">
                        <td className="p-2">{item.description}</td>
                        <td className="p-2 text-right tabular">{toNumber(item.quantity)}</td>
                        <td className="p-2 text-right"><MoneyText value={item.unit_cost} /></td>
                        <td className="p-2 text-right tabular">{toNumber(item.tax_pct)}</td>
                        <td className="p-2 text-right"><MoneyText value={item.line_total} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 space-y-1.5 rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <MoneyText value={bill.subtotal} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Tax</span>
                  <MoneyText value={bill.tax_amount} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">TDS</span>
                  <MoneyText value={bill.tds_amount} />
                </div>
                <Separator className="my-1.5" />
                <div className="flex items-center justify-between font-medium">
                  <span>Bill total</span>
                  <MoneyText value={bill.grand_total} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Paid</span>
                  <MoneyText value={bill.amount_paid} />
                </div>
                <div className="flex items-center justify-between font-medium">
                  <span>Outstanding</span>
                  <MoneyText value={bill.outstanding} className={toNumber(bill.outstanding) > 0 ? "text-status-overdue" : undefined} />
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="mb-2 text-sm font-medium">Payments</h3>
              {bill.payments.length === 0 ? (
                <EmptyState compact title="No payments yet" description="Approved bills can be paid from here." />
              ) : (
                <div className="space-y-1.5">
                  {bill.payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium">{payment.payment_no}</p>
                        <p className="text-xs text-muted-foreground">
                          {humanize(payment.mode)} · {formatDate(payment.paid_on)}
                          {payment.utr_no ? ` · ${payment.utr_no}` : ""}
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
            </div>

            <div className="flex flex-wrap gap-2">
              {bill.status === "draft" && (
                <Button onClick={() => onApprove(bill.id)}>
                  <CheckCircle2 /> Approve for payment
                </Button>
              )}
              {bill.status !== "draft" && bill.status !== "cancelled" && toNumber(bill.outstanding) > 0 && (
                <Button variant="outline" onClick={() => onPay(bill.id)}>
                  <Wallet /> Record payment
                </Button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SupplierBills() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [supplierId, setSupplierId] = useState("");
  const [booking, setBooking] = useState<BookingRef | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<SupplierBillPaymentStatus | "">("");
  const [dueOnly, setDueOnly] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | undefined>(undefined);

  const [detailId, setDetailId] = useState<number | null>(null);
  const [approveTarget, setApproveTarget] = useState<SupplierBillListItem | null>(null);
  const [payTarget, setPayTarget] = useState<SupplierBillListItem | null>(null);

  const filters: SupplierBillFilters = useMemo(
    () => ({
      page,
      limit: 25,
      search: debouncedSearch || undefined,
      supplier_id: supplierId ? Number(supplierId) : undefined,
      booking_id: booking?.id,
      payment_status: paymentStatus || undefined,
      due_only: dueOnly || undefined,
      from: from || undefined,
      to: to || undefined,
      sort: sort?.key,
      dir: sort?.direction,
    }),
    [page, debouncedSearch, supplierId, booking, paymentStatus, dueOnly, from, to, sort],
  );

  const listQuery = useQuery({ queryKey: qk.supplierBills.list(filters), queryFn: () => listSupplierBills(filters) });

  const dueQuery = useQuery({
    queryKey: qk.supplierBills.list({ due_only: true, limit: 1 }),
    queryFn: () => listSupplierBills({ due_only: true, limit: 1 }),
  });
  const overdueQuery = useQuery({
    queryKey: qk.supplierBills.list({ payment_status: "overdue", limit: 1 }),
    queryFn: () => listSupplierBills({ payment_status: "overdue", limit: 1 }),
  });
  const disputedQuery = useQuery({
    queryKey: qk.supplierBills.list({ payment_status: "disputed", limit: 1 }),
    queryFn: () => listSupplierBills({ payment_status: "disputed", limit: 1 }),
  });

  const suppliersQuery = useQuery({ queryKey: qk.suppliers.options(undefined), queryFn: () => listSupplierOptions() });

  const approveMutation = useMutation({
    mutationFn: (id: number) => approveSupplierBill(id),
    onSuccess: async (bill) => {
      toast.success("Bill approved for payment");
      await queryClient.invalidateQueries({ queryKey: qk.supplierBills.all });
      setApproveTarget(null);
      void bill;
    },
  });

  const rows = listQuery.data?.items ?? [];
  const detailRow = rows.find((row) => row.id === detailId) ?? null;

  const columns: Column<SupplierBillListItem>[] = [
    {
      key: "bill_no",
      header: "Bill",
      render: (row) => (
        <div>
          <p className="font-medium">{row.bill_no}</p>
          <p className="text-xs text-muted-foreground">
            {row.supplier_ref_no ? `Ref ${row.supplier_ref_no}` : "No supplier ref"}
          </p>
        </div>
      ),
    },
    {
      key: "supplier_name",
      header: "Supplier",
      render: (row) => (
        <div>
          <p>{row.supplier_name}</p>
          <p className="text-xs text-muted-foreground">{humanize(row.supplier_type)}</p>
        </div>
      ),
    },
    { key: "booking_no", header: "Booking", render: (row) => row.booking_no ?? "—", hideOnMobile: true },
    { key: "bill_date", header: "Bill date", sortable: true, render: (row) => formatDate(row.bill_date), hideOnMobile: true },
    {
      key: "due_date",
      header: "Due",
      sortable: true,
      render: (row) => (
        <div>
          <p>{formatDate(row.due_date)}</p>
          {row.days_overdue !== null && row.days_overdue > 0 && toNumber(row.outstanding) > 0 && (
            <p className="text-xs text-status-overdue">{row.days_overdue}d overdue</p>
          )}
        </div>
      ),
    },
    { key: "grand_total", header: "Total", align: "right", sortable: true, render: (row) => <MoneyText value={row.grand_total} /> },
    {
      key: "outstanding",
      header: "Outstanding",
      align: "right",
      render: (row) => (
        <MoneyText value={row.outstanding} className={toNumber(row.outstanding) > 0 ? "text-status-overdue" : undefined} />
      ),
    },
    {
      key: "payment_status",
      header: "Payment",
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={row.payment_status} size="sm" />
          <StatusBadge status={row.status} size="sm" />
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {row.status === "draft" && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => { e.stopPropagation(); setApproveTarget(row); }}
              aria-label="Approve"
            >
              <CheckCircle2 />
            </Button>
          )}
          {row.status !== "draft" && row.status !== "cancelled" && toNumber(row.outstanding) > 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => { e.stopPropagation(); setPayTarget(row); }}
              aria-label="Record payment"
            >
              <Wallet />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const hasFilters =
    search !== "" || supplierId !== "" || booking !== null || paymentStatus !== "" || dueOnly || from !== "" || to !== "";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Supplier bills"
        description="Payables raised by hotels, transporters and DMCs. Approve before paying — a bill is never deleted."
        actions={<CreateBillDialog />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Bills with a balance" value={dueQuery.data?.pagination.total ?? 0} icon={FileText} tone="info" loading={dueQuery.isLoading} />
        <StatCard label="Overdue" value={overdueQuery.data?.pagination.total ?? 0} icon={AlertTriangle} tone="negative" loading={overdueQuery.isLoading} />
        <StatCard label="Disputed" value={disputedQuery.data?.pagination.total ?? 0} icon={Wallet} tone="warning" loading={disputedQuery.isLoading} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search bill no, supplier ref…" className="pl-8" />
          </div>

          <Select value={supplierId || "__all__"} onValueChange={(v) => { setSupplierId(v === "__all__" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Supplier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All suppliers</SelectItem>
              {(suppliersQuery.data ?? []).map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={paymentStatus || "__all__"} onValueChange={(v) => { setPaymentStatus(v === "__all__" ? "" : (v as SupplierBillPaymentStatus)); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Payment" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Any payment status</SelectItem>
              {SUPPLIER_BILL_PAYMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="min-w-[220px]">
            <BookingPicker value={booking} onSelect={(b) => { setBooking(b); setPage(1); }} />
          </div>

          <div className="flex items-center gap-1.5">
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-36" aria-label="Billed from" />
            <span className="text-muted-foreground">–</span>
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-36" aria-label="Billed to" />
          </div>

          <Button type="button" variant={dueOnly ? "default" : "outline"} size="sm" onClick={() => { setDueOnly((v) => !v); setPage(1); }}>
            Unpaid only
          </Button>

          {hasFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch(""); setSupplierId(""); setBooking(null); setPaymentStatus("");
                setDueOnly(false); setFrom(""); setTo(""); setPage(1);
              }}
            >
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={listQuery.isLoading}
        empty={<EmptyState title="No supplier bills" description="Bills raised against suppliers will appear here." />}
        onRowClick={(row) => setDetailId(row.id)}
        sort={sort}
        onSortChange={(s) => { setSort(s); setPage(1); }}
        pagination={listQuery.data?.pagination}
        onPageChange={setPage}
      />

      <BillDetailSheet
        billId={detailId}
        onOpenChange={(open) => { if (!open) setDetailId(null); }}
        onApprove={(id) => {
          const row = rows.find((r) => r.id === id);
          if (row) setApproveTarget(row);
        }}
        onPay={(id) => {
          const row = rows.find((r) => r.id === id);
          if (row) setPayTarget(row);
        }}
      />

      <ConfirmDialog
        open={approveTarget !== null}
        onOpenChange={(open) => { if (!open) setApproveTarget(null); }}
        title="Approve this bill for payment?"
        description={
          approveTarget
            ? `${approveTarget.bill_no} · ${approveTarget.supplier_name}. Approval freezes the bill against the booking's margin.`
            : undefined
        }
        confirmLabel="Approve"
        icon={CheckCircle2}
        onConfirm={() => approveMutation.mutateAsync(approveTarget!.id).then(() => undefined)}
      />

      {payTarget !== null && (
        <PayBillDialog bill={payTarget} onOpenChange={(open) => { if (!open) setPayTarget(null); }} />
      )}

      {detailRow !== null && null}
    </div>
  );
}

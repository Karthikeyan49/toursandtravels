import { useMemo, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CheckCircle2,
  CircleDollarSign,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Send,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  approveExpense,
  createExpense,
  EXPENSE_EDITABLE_STATUSES,
  EXPENSE_MODES,
  EXPENSE_STATUSES,
  getExpense,
  getExpenseSummary,
  listExpenseCategories,
  listExpenses,
  markExpensePaid,
  rejectExpense,
  submitExpense,
  updateExpense,
  voidExpense,
  type Expense,
  type ExpenseFilters,
  type ExpenseInput,
  type ExpenseListItem,
  type ExpenseMode,
  type ExpenseStatus,
} from "@/lib/api/expenses";
import { listSupplierOptions } from "@/lib/api/suppliers";
import { listBookings } from "@/lib/api/bookings";
import { listUsers } from "@/lib/api/users";
import { formatDate, formatDateTime, formatFileSize, formatMoneyShort } from "@/lib/format";
import { humanize, toNumber, truncate } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "@/hooks/use-toast";
import {
  applyApiErrors,
  CheckboxField,
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
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Everything the edit form needs to prefill — both the list row and the detail satisfy it. */
type EditableExpense = Expense & { booking_no: string | null };

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
// Create / edit
// ---------------------------------------------------------------------------

const expenseSchema = z.object({
  expense_date: z.string().min(1, "Date is required"),
  category: z.string().trim().min(1, "Category is required").max(60),
  subcategory: z.string().trim().max(60).optional(),
  description: z.string().trim().min(1, "Description is required").max(400),
  amount: z.number().min(0, "Amount is required"),
  tax_amount: z.number().min(0).optional(),
  mode: z.enum(EXPENSE_MODES).optional(),
  supplier_id: z.string().optional(),
  paid_by: z.string().optional(),
  is_reimbursable: z.boolean().optional(),
  status: z.enum(["draft", "submitted"]).optional(),
});
type ExpenseFormValues = z.infer<typeof expenseSchema>;

// `booking_id` is a picker outside the form, so it is left off deliberately —
// applyApiErrors routes anything it does not recognise to the form root.
const EXPENSE_FIELDS = [
  "expense_date", "category", "subcategory", "description", "amount", "tax_amount",
  "mode", "supplier_id", "paid_by", "is_reimbursable", "status",
] as const;

function ExpenseDialog({ expense, onOpenChange }: { expense: EditableExpense | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const isEdit = expense !== null;

  const [booking, setBooking] = useState<BookingRef | null>(
    expense?.booking_id ? { id: expense.booking_id, label: expense.booking_no ?? `Booking #${expense.booking_id}` } : null,
  );

  const { control, handleSubmit, setError, setValue, watch, formState: { errors, isSubmitting } } = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: expense
      ? {
          expense_date: expense.expense_date,
          category: expense.category,
          subcategory: expense.subcategory ?? undefined,
          description: expense.description,
          amount: toNumber(expense.amount),
          tax_amount: toNumber(expense.tax_amount),
          mode: expense.mode,
          supplier_id: expense.supplier_id ? String(expense.supplier_id) : undefined,
          paid_by: expense.paid_by ? String(expense.paid_by) : undefined,
          is_reimbursable: expense.is_reimbursable === 1,
        }
      : { amount: 0, tax_amount: 0, mode: "cash", is_reimbursable: false, status: "draft" },
  });

  const categoriesQuery = useQuery({ queryKey: qk.expenses.categories, queryFn: listExpenseCategories });
  const suppliersQuery = useQuery({ queryKey: qk.suppliers.options(undefined), queryFn: () => listSupplierOptions() });
  const usersQuery = useQuery({
    queryKey: qk.users.list({ is_active: true, limit: 200 }),
    queryFn: () => listUsers({ is_active: true, limit: 200 }),
  });

  const supplierOptions: SelectOption[] = (suppliersQuery.data ?? []).map((s) => ({
    value: String(s.id),
    label: `${s.name} · ${humanize(s.supplier_type)}`,
  }));
  const userOptions: SelectOption[] = (usersQuery.data?.items ?? []).map((u) => ({ value: String(u.id), label: u.full_name }));
  const modeOptions: SelectOption[] = EXPENSE_MODES.map((m) => ({ value: m, label: humanize(m) }));

  const amount = toNumber(watch("amount"));
  const tax = toNumber(watch("tax_amount"));

  const onSubmit = handleSubmit(async (values) => {
    const input: ExpenseInput = {
      expense_date: values.expense_date,
      category: values.category,
      description: values.description,
      amount: values.amount,
      subcategory: values.subcategory || null,
      booking_id: booking?.id ?? null,
      supplier_id: values.supplier_id ? Number(values.supplier_id) : null,
      tax_amount: values.tax_amount,
      mode: values.mode,
      paid_by: values.paid_by ? Number(values.paid_by) : null,
      is_reimbursable: values.is_reimbursable,
    };

    try {
      if (isEdit) {
        await updateExpense(expense.id, input);
        toast.success("Expense updated");
      } else {
        await createExpense({ ...input, status: values.status });
        toast.success("Expense recorded");
      }
      await queryClient.invalidateQueries({ queryKey: qk.expenses.all });
      onOpenChange(false);
    } catch (error) {
      if (!applyApiErrors(error, setError, EXPENSE_FIELDS)) {
        toast.fromError(error, "Could not save this expense", true);
      }
    }
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${expense.expense_no}` : "Record an expense"}</DialogTitle>
          <DialogDescription>
            Overheads, or a direct cost attached to a booking. The total is always amount plus tax.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DateField control={control} name="expense_date" label="Expense date" required toDate={new Date()} />
          <SelectField control={control} name="mode" label="Mode" options={modeOptions} />

          <div className="space-y-1.5 sm:col-span-2">
            <TextField
              control={control}
              name="category"
              label="Category"
              required
              placeholder="e.g. office, marketing, fuel"
              description="Pick one already in use, or type a new one."
            />
            {(categoriesQuery.data ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(categoriesQuery.data ?? []).slice(0, 10).map((c) => (
                  <button
                    key={c.category}
                    type="button"
                    className="rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-accent"
                    onClick={() => setValue("category", c.category, { shouldValidate: true, shouldDirty: true })}
                  >
                    {c.category}
                  </button>
                ))}
              </div>
            )}
          </div>

          <TextField control={control} name="subcategory" label="Subcategory" />
          <SelectField control={control} name="supplier_id" label="Supplier" options={supplierOptions} placeholder="Not supplier-linked" />

          <TextareaField control={control} name="description" label="Description" required rows={2} className="sm:col-span-2" />

          <NumberField control={control} name="amount" label="Amount" required min={0} />
          <NumberField control={control} name="tax_amount" label="Tax" min={0} />

          <div className="sm:col-span-2">
            <BookingPicker value={booking} onSelect={setBooking} label="Booking (optional)" />
          </div>

          <SelectField control={control} name="paid_by" label="Paid by" options={userOptions} placeholder="You" />
          {!isEdit && (
            <SelectField
              control={control}
              name="status"
              label="Save as"
              options={[{ value: "draft", label: "Draft" }, { value: "submitted", label: "Submitted for approval" }]}
            />
          )}

          <CheckboxField
            control={control}
            name="is_reimbursable"
            label="Reimbursable to the person who paid"
            className="sm:col-span-2"
          />

          <div className="flex items-center justify-between rounded-lg border p-3 text-sm sm:col-span-2">
            <span className="text-muted-foreground">Total</span>
            <MoneyText value={amount + tax} className="font-medium" />
          </div>

          {errors.root?.serverError?.message && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive sm:col-span-2">
              {errors.root.serverError.message}
            </p>
          )}

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {isEdit ? "Save changes" : "Record expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

interface ExpenseActionHandlers {
  onEdit: (expense: EditableExpense) => void;
  onSubmit: (expense: EditableExpense) => void;
  onApprove: (expense: EditableExpense) => void;
  onReject: (expense: EditableExpense) => void;
  onMarkPaid: (expense: EditableExpense) => void;
  onVoid: (expense: EditableExpense) => void;
}

interface ExpenseAction {
  key: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
  destructive?: boolean;
}

/** Only the transitions the API will accept from this row's current status. */
function legalActions(expense: EditableExpense, handlers: ExpenseActionHandlers): ExpenseAction[] {
  const actions: ExpenseAction[] = [];

  if (EXPENSE_EDITABLE_STATUSES.includes(expense.status)) {
    actions.push({ key: "edit", label: "Edit", icon: Pencil, run: () => handlers.onEdit(expense) });
  }
  if (expense.status === "draft") {
    actions.push({ key: "submit", label: "Submit", icon: Send, run: () => handlers.onSubmit(expense) });
  }
  if (expense.status === "submitted") {
    actions.push({ key: "approve", label: "Approve", icon: CheckCircle2, run: () => handlers.onApprove(expense) });
    actions.push({ key: "reject", label: "Reject", icon: XCircle, run: () => handlers.onReject(expense), destructive: true });
  }
  if (expense.status === "approved") {
    actions.push({ key: "paid", label: "Mark paid", icon: Wallet, run: () => handlers.onMarkPaid(expense) });
  }
  if (expense.status !== "void") {
    actions.push({ key: "void", label: "Void", icon: Ban, run: () => handlers.onVoid(expense), destructive: true });
  }

  return actions;
}

function ExpenseActions({
  expense,
  handlers,
  labelled = false,
}: {
  expense: EditableExpense;
  handlers: ExpenseActionHandlers;
  labelled?: boolean;
}) {
  const actions = legalActions(expense, handlers);
  if (actions.length === 0) return null;

  return (
    <div className={labelled ? "flex flex-wrap gap-2" : "flex justify-end gap-1"}>
      {actions.map((action) => {
        const Icon = action.icon;
        return labelled ? (
          <Button key={action.key} variant={action.destructive ? "outline" : "default"} size="sm" onClick={action.run}>
            <Icon className={action.destructive ? "text-destructive" : undefined} />
            {action.label}
          </Button>
        ) : (
          <Button
            key={action.key}
            variant="ghost"
            size="icon-sm"
            onClick={(e) => { e.stopPropagation(); action.run(); }}
            aria-label={action.label}
            title={action.label}
          >
            <Icon className={action.destructive ? "text-destructive" : undefined} />
          </Button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function ExpenseDetailSheet({
  expenseId,
  onOpenChange,
  handlers,
}: {
  expenseId: number | null;
  onOpenChange: (open: boolean) => void;
  handlers: ExpenseActionHandlers;
}) {
  const detailQuery = useQuery({
    queryKey: qk.expenses.detail(expenseId ?? 0),
    queryFn: () => getExpense(expenseId as number),
    enabled: expenseId !== null,
  });
  const expense = detailQuery.data;

  return (
    <Sheet open={expenseId !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {expense ? expense.expense_no : "Expense"}
            {expense && <StatusBadge status={expense.status} size="sm" />}
          </SheetTitle>
          <SheetDescription>The document, its attachments and any disbursement against it.</SheetDescription>
        </SheetHeader>

        {!expense ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-6">
            <p className="text-sm">{expense.description}</p>

            <div className="grid grid-cols-2 gap-3">
              <Fact label="Date" value={formatDate(expense.expense_date)} />
              <Fact label="Category" value={`${expense.category}${expense.subcategory ? ` · ${expense.subcategory}` : ""}`} />
              <Fact label="Mode" value={humanize(expense.mode)} />
              <Fact label="Paid by" value={expense.paid_by_name ?? "—"} />
              <Fact label="Booking" value={expense.booking_no ?? "—"} />
              <Fact label="Supplier" value={expense.supplier_name ?? "—"} />
              <Fact label="Recorded by" value={expense.created_by_name ?? "—"} />
              <Fact label="Approved by" value={expense.approved_by_name ?? "—"} />
              <Fact
                label="Reimbursable"
                value={expense.is_reimbursable === 1 ? (expense.reimbursed_at ? `Yes · reimbursed ${formatDate(expense.reimbursed_at)}` : "Yes") : "No"}
              />
            </div>

            {expense.rejection_reason && (
              <p className="rounded-md bg-status-cancelled-bg p-3 text-sm text-status-cancelled">
                Rejected — {expense.rejection_reason}
              </p>
            )}
            {expense.void_reason && (
              <p className="rounded-md bg-status-cancelled-bg p-3 text-sm text-status-cancelled">
                Voided by {expense.voided_by_name ?? "—"} — {expense.void_reason}
              </p>
            )}

            <div className="space-y-1.5 rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Amount</span>
                <MoneyText value={expense.amount} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tax</span>
                <MoneyText value={expense.tax_amount} />
              </div>
              <Separator className="my-1.5" />
              <div className="flex items-center justify-between font-medium">
                <span>Total</span>
                <MoneyText value={expense.total_amount} struck={expense.status === "void"} />
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium">Attachments</h3>
              {expense.attachments.length === 0 ? (
                <EmptyState compact title="No attachments" description="Bills and receipts uploaded against this expense appear here." />
              ) : (
                <div className="space-y-1.5">
                  {expense.attachments.map((file) => (
                    <div key={file.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <div className="flex min-w-0 items-center gap-2">
                        <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate">{file.original_name}</span>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatFileSize(file.size_bytes)} · {formatDateTime(file.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium">Payments</h3>
              {expense.payments.length === 0 ? (
                <EmptyState compact title="Not disbursed yet" description="An approved expense can be marked paid." />
              ) : (
                <div className="space-y-1.5">
                  {expense.payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium">{payment.payment_no}</p>
                        <p className="text-xs text-muted-foreground">
                          {humanize(payment.mode)} · {formatDate(payment.paid_on)}
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

            <ExpenseActions expense={expense} handlers={handlers} labelled />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Expenses() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<ExpenseStatus | "">("");
  const [mode, setMode] = useState<ExpenseMode | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reimbursableOnly, setReimbursableOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | undefined>(undefined);

  const [detailId, setDetailId] = useState<number | null>(null);
  const [dialogTarget, setDialogTarget] = useState<EditableExpense | "new" | null>(null);
  const [rejectTarget, setRejectTarget] = useState<EditableExpense | null>(null);
  const [voidTarget, setVoidTarget] = useState<EditableExpense | null>(null);
  const [paidTarget, setPaidTarget] = useState<EditableExpense | null>(null);
  const [reason, setReason] = useState("");
  const [paidOn, setPaidOn] = useState("");

  /** Shared by the list and the summary strip, so the header always describes the rows below. */
  const baseFilters: ExpenseFilters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      category: category || undefined,
      status: status || undefined,
      mode: mode || undefined,
      from: from || undefined,
      to: to || undefined,
      reimbursable_only: reimbursableOnly || undefined,
    }),
    [debouncedSearch, category, status, mode, from, to, reimbursableOnly],
  );

  const filters: ExpenseFilters = useMemo(
    () => ({ ...baseFilters, page, limit: 25, sort: sort?.key, dir: sort?.direction }),
    [baseFilters, page, sort],
  );

  const listQuery = useQuery({ queryKey: qk.expenses.list(filters), queryFn: () => listExpenses(filters) });
  const summaryQuery = useQuery({ queryKey: qk.expenses.summary(baseFilters), queryFn: () => getExpenseSummary(baseFilters) });
  const categoriesQuery = useQuery({ queryKey: qk.expenses.categories, queryFn: listExpenseCategories });

  // qk.expenses.all is the resource root, so this also refreshes the open
  // detail, the summary strip and the category picker.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.expenses.all });

  const submitMutation = useMutation({
    mutationFn: (id: number) => submitExpense(id),
    onSuccess: async () => { toast.success("Sent for approval"); await invalidate(); },
    onError: (error) => toast.fromError(error, "Could not submit this expense", true),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => approveExpense(id),
    onSuccess: async () => { toast.success("Expense approved"); await invalidate(); },
    onError: (error) => toast.fromError(error, "Could not approve this expense", true),
  });

  // The three below run inside ConfirmDialog, which reports failures itself.
  const rejectMutation = useMutation({
    mutationFn: (input: { id: number; reason: string }) => rejectExpense(input.id, input.reason),
    onSuccess: async () => {
      toast.success("Expense rejected");
      await invalidate();
      setRejectTarget(null);
      setReason("");
    },
  });

  const voidMutation = useMutation({
    mutationFn: (input: { id: number; reason: string }) => voidExpense(input.id, input.reason),
    onSuccess: async () => {
      toast.success("Expense voided");
      await invalidate();
      setVoidTarget(null);
      setReason("");
    },
  });

  const paidMutation = useMutation({
    mutationFn: (input: { id: number; paidOn?: string }) => markExpensePaid(input.id, input.paidOn),
    onSuccess: async () => {
      toast.success("Expense marked paid");
      await invalidate();
      setPaidTarget(null);
      setPaidOn("");
    },
  });

  const handlers: ExpenseActionHandlers = {
    onEdit: (expense) => setDialogTarget(expense),
    onSubmit: (expense) => submitMutation.mutate(expense.id),
    onApprove: (expense) => approveMutation.mutate(expense.id),
    onReject: (expense) => { setRejectTarget(expense); setReason(""); },
    onMarkPaid: (expense) => { setPaidTarget(expense); setPaidOn(""); },
    onVoid: (expense) => { setVoidTarget(expense); setReason(""); },
  };

  const totals = summaryQuery.data?.totals;
  const byCategory = (summaryQuery.data?.by_category ?? []).slice(0, 6);
  const largestCategory = byCategory.reduce((max, row) => Math.max(max, toNumber(row.total_amount)), 0);

  const columns: Column<ExpenseListItem>[] = [
    {
      key: "expense_no",
      header: "Expense",
      render: (row) => (
        <div>
          <p className="font-medium">{row.expense_no}</p>
          <p className="text-xs text-muted-foreground">
            {row.category}{row.subcategory ? ` · ${row.subcategory}` : ""}
          </p>
        </div>
      ),
    },
    { key: "expense_date", header: "Date", sortable: true, render: (row) => formatDate(row.expense_date), hideOnMobile: true },
    {
      key: "description",
      header: "Description",
      render: (row) => (
        <div>
          <p>{truncate(row.description, 60)}</p>
          {(row.booking_no || row.supplier_name) && (
            <p className="text-xs text-muted-foreground">
              {[row.booking_no, row.supplier_name].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "total_amount",
      header: "Total",
      align: "right",
      sortable: true,
      render: (row) => (
        <div>
          <MoneyText value={row.total_amount} struck={row.status === "void"} />
          {toNumber(row.tax_amount) > 0 && (
            <p className="text-xs text-muted-foreground">
              incl. tax <MoneyText value={row.tax_amount} compactZeros />
            </p>
          )}
        </div>
      ),
    },
    { key: "mode", header: "Mode", render: (row) => humanize(row.mode), hideOnMobile: true },
    { key: "status", header: "Status", sortable: true, render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "flags",
      header: "",
      hideOnMobile: true,
      render: (row) => (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {row.is_reimbursable === 1 && <span className="rounded-full bg-muted px-2 py-0.5">Reimbursable</span>}
          {row.attachment_count > 0 && (
            <span className="inline-flex items-center gap-1" title={`${row.attachment_count} attachment(s)`}>
              <Paperclip className="h-3 w-3" aria-hidden />
              {row.attachment_count}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => <ExpenseActions expense={row} handlers={handlers} />,
    },
  ];

  const hasFilters =
    search !== "" || category !== "" || status !== "" || mode !== "" || from !== "" || to !== "" || reimbursableOnly;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expenses"
        description="Overheads and booking-attached direct costs. Nothing is deleted — a wrong expense is voided."
        actions={<Button onClick={() => setDialogTarget("new")}><Plus /> Record expense</Button>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total spend"
          value={<MoneyText value={totals?.total_amount ?? 0} short />}
          icon={CircleDollarSign}
          hint={`${totals?.expense_count ?? 0} expense(s)`}
          loading={summaryQuery.isLoading}
        />
        <StatCard
          label="Net of tax"
          value={<MoneyText value={totals?.net_amount ?? 0} short />}
          icon={Wallet}
          tone="info"
          hint={`Tax ${formatMoneyShort(totals?.tax_amount ?? 0)}`}
          loading={summaryQuery.isLoading}
        />
        <StatCard
          label="Overheads"
          value={<MoneyText value={totals?.overhead_amount ?? 0} short />}
          icon={CircleDollarSign}
          tone="warning"
          loading={summaryQuery.isLoading}
        />
        <StatCard
          label="Booking-attached"
          value={<MoneyText value={totals?.direct_amount ?? 0} short />}
          icon={CircleDollarSign}
          tone="positive"
          loading={summaryQuery.isLoading}
        />
      </div>

      {byCategory.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <h2 className="text-sm font-medium">Top categories</h2>
            {byCategory.map((row) => (
              <button
                key={row.category}
                type="button"
                className="flex w-full items-center gap-3 rounded-md px-1 py-1 text-left text-sm transition-colors hover:bg-accent"
                onClick={() => { setCategory(row.category); setPage(1); }}
              >
                <span className="w-32 shrink-0 truncate">{row.category}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${largestCategory > 0 ? (toNumber(row.total_amount) / largestCategory) * 100 : 0}%` }}
                  />
                </span>
                <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular">{row.expense_count}</span>
                <MoneyText value={row.total_amount} short className="w-24 shrink-0 text-right" />
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search expense no, description…" className="pl-8" />
          </div>

          <Select value={category || "__all__"} onValueChange={(v) => { setCategory(v === "__all__" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All categories</SelectItem>
              {(categoriesQuery.data ?? []).map((c) => <SelectItem key={c.category} value={c.category}>{c.category}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={status || "__all__"} onValueChange={(v) => { setStatus(v === "__all__" ? "" : (v as ExpenseStatus)); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              {EXPENSE_STATUSES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={mode || "__all__"} onValueChange={(v) => { setMode(v === "__all__" ? "" : (v as ExpenseMode)); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Mode" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Any mode</SelectItem>
              {EXPENSE_MODES.map((m) => <SelectItem key={m} value={m}>{humanize(m)}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1.5">
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-36" aria-label="Spent from" />
            <span className="text-muted-foreground">–</span>
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-36" aria-label="Spent to" />
          </div>

          <Button
            type="button"
            variant={reimbursableOnly ? "default" : "outline"}
            size="sm"
            onClick={() => { setReimbursableOnly((v) => !v); setPage(1); }}
          >
            Reimbursable only
          </Button>

          {hasFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch(""); setCategory(""); setStatus(""); setMode("");
                setFrom(""); setTo(""); setReimbursableOnly(false); setPage(1);
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
        empty={<EmptyState title="No expenses" description="Nothing matches the current filters." />}
        onRowClick={(row) => setDetailId(row.id)}
        sort={sort}
        onSortChange={(s) => { setSort(s); setPage(1); }}
        pagination={listQuery.data?.pagination}
        onPageChange={setPage}
        rowClassName={(row) => (row.status === "void" ? "opacity-60" : undefined)}
      />

      <ExpenseDetailSheet
        expenseId={detailId}
        onOpenChange={(open) => { if (!open) setDetailId(null); }}
        handlers={handlers}
      />

      {dialogTarget !== null && (
        <ExpenseDialog
          expense={dialogTarget === "new" ? null : dialogTarget}
          onOpenChange={(open) => { if (!open) setDialogTarget(null); }}
        />
      )}

      <ConfirmDialog
        open={rejectTarget !== null}
        onOpenChange={(open) => { if (!open) { setRejectTarget(null); setReason(""); } }}
        title="Reject this expense?"
        description={rejectTarget ? `${rejectTarget.expense_no} — the reason is shown to whoever raised it.` : undefined}
        confirmLabel="Reject"
        destructive
        icon={XCircle}
        confirmDisabled={reason.trim() === ""}
        onConfirm={() => rejectMutation.mutateAsync({ id: rejectTarget!.id, reason: reason.trim() }).then(() => undefined)}
      >
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason…" />
      </ConfirmDialog>

      <ConfirmDialog
        open={voidTarget !== null}
        onOpenChange={(open) => { if (!open) { setVoidTarget(null); setReason(""); } }}
        title="Void this expense?"
        description={voidTarget ? `${voidTarget.expense_no} stays in the ledger, marked void with your reason.` : undefined}
        confirmLabel="Void expense"
        destructive
        icon={Ban}
        confirmDisabled={reason.trim() === ""}
        onConfirm={() => voidMutation.mutateAsync({ id: voidTarget!.id, reason: reason.trim() }).then(() => undefined)}
      >
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason…" />
      </ConfirmDialog>

      <ConfirmDialog
        open={paidTarget !== null}
        onOpenChange={(open) => { if (!open) { setPaidTarget(null); setPaidOn(""); } }}
        title="Mark this expense as paid?"
        description={paidTarget ? `${paidTarget.expense_no} — leave the date blank to use today.` : undefined}
        confirmLabel="Mark paid"
        icon={Wallet}
        onConfirm={() => paidMutation.mutateAsync({ id: paidTarget!.id, paidOn: paidOn || undefined }).then(() => undefined)}
      >
        <Input
          type="date"
          value={paidOn}
          onChange={(e) => setPaidOn(e.target.value)}
          max={new Date().toISOString().slice(0, 10)}
          aria-label="Paid on"
        />
      </ConfirmDialog>
    </div>
  );
}

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Loader2,
  Package,
  Plus,
  Printer,
  Save,
  Trash2,
} from "lucide-react";
import { qk } from "@/lib/api/queries";
import {
  BOOKING_TRANSITIONS,
  GENDERS,
  HOTEL_CATEGORIES,
  HOTEL_CATEGORY_LABELS,
  MEAL_PREFERENCES,
  PAX_TITLES,
  PAX_TYPES,
  SERVICE_TYPES,
  VISA_STATUSES,
  cancelBooking,
  changeBookingStatus,
  confirmBooking,
  getBooking,
  getBookingHistory,
  getBookingMargin,
  priceBookingFromPackage,
  saveBookingPax,
  saveBookingServices,
  updateBooking,
  type BookingPaxInput,
  type BookingServiceInput,
  type BookingStatus,
  type PaxWarning,
} from "@/lib/api/bookings";
import {
  DIET_TYPES,
  ROOM_CATEGORIES,
  TRANSPORT_MODES,
} from "@/lib/api/quotationOptions";
import { saveBookingOptions, type BookingOptionsInput } from "@/lib/api/bookingOptions";
import {
  TRAVEL_LEG_CONFIRMATION_STATUSES,
  TRAVEL_LEG_DIRECTIONS,
  TRAVEL_LEG_MODES,
  confirmTravelLeg,
  listTravelLegs,
  replaceTravelLegs,
  type TravelLegInput,
} from "@/lib/api/travelLegs";
import {
  getBookingLedger,
  markPaymentPaid,
  recordBookingPayment,
  requiresReference,
  scheduleInstalments,
  PAYMENT_MODES,
  type PaymentMode,
} from "@/lib/api/payments";
import { getSettings, type CompanyProfile } from "@/lib/api/settings";
import type { PdfCompanyProfile } from "@/lib/pdf/companyProfile";
import { formatDate, formatDateTime, formatMoney, formatPax, toISODate } from "@/lib/format";
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
import { EmptyState } from "@/components/EmptyState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUS_LABELS: Record<BookingStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  vouchered: "Vouchered",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No show",
};

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/** Mirrors BookingController::documentWarnings for a first-paint banner, before any save. */
function computeClientWarnings(
  pax: readonly { pax_no: number; first_name: string; last_name: string | null; passport_expiry: string | null; visa_status: string }[],
  travelTo: string,
  minValidityDays = 180,
): PaxWarning[] {
  const warnings: PaxWarning[] = [];
  const travelEnd = new Date(travelTo).getTime();
  for (const p of pax) {
    const name = `${p.first_name} ${p.last_name ?? ""}`.trim();
    if (p.passport_expiry) {
      const daysAfter = Math.floor((new Date(p.passport_expiry).getTime() - travelEnd) / 86_400_000);
      if (daysAfter < 0) {
        warnings.push({ pax_no: p.pax_no, severity: "critical", message: `${name} — passport expires before the return date` });
      } else if (daysAfter < minValidityDays) {
        warnings.push({ pax_no: p.pax_no, severity: "warning", message: `${name} — passport valid for only ${daysAfter} days after travel` });
      }
    }
    if (p.visa_status === "rejected") {
      warnings.push({ pax_no: p.pax_no, severity: "critical", message: `${name} — visa rejected` });
    } else if (p.visa_status === "pending" || p.visa_status === "applied") {
      warnings.push({ pax_no: p.pax_no, severity: "info", message: `${name} — visa still ${p.visa_status}` });
    }
  }
  return warnings;
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

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const serviceRowSchema = z.object({
  service_type: z.enum(SERVICE_TYPES),
  description: z.string().trim().min(1, "Required"),
  day_no: z.number().optional(),
  service_date: z.string().optional(),
  quantity: z.number().min(0.01),
  unit: z.string().optional(),
  nights: z.number().optional(),
  pax_count: z.number().optional(),
  unit_cost: z.number().optional(),
  unit_price: z.number().min(0),
  tax_pct: z.number().optional(),
  notes: z.string().optional(),
});
const servicesFormSchema = z.object({ services: z.array(serviceRowSchema), discount_amount: z.number().min(0).optional() });
type ServicesFormValues = z.infer<typeof servicesFormSchema>;

// ---------------------------------------------------------------------------
// Passengers
// ---------------------------------------------------------------------------

const paxRowSchema = z.object({
  title: z.enum(PAX_TITLES),
  first_name: z.string().trim().min(1, "Required"),
  last_name: z.string().optional(),
  pax_type: z.enum(PAX_TYPES),
  gender: z.enum(GENDERS).optional(),
  date_of_birth: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  passport_no: z.string().optional(),
  passport_issue: z.string().optional(),
  passport_expiry: z.string().optional(),
  passport_country: z.string().optional(),
  visa_no: z.string().optional(),
  visa_status: z.enum(VISA_STATUSES),
  visa_expiry: z.string().optional(),
  meal_preference: z.enum(MEAL_PREFERENCES),
  medical_notes: z.string().optional(),
  is_lead_pax: z.boolean().optional(),
  insurance_no: z.string().optional(),
});
const paxFormSchema = z.object({ pax: z.array(paxRowSchema) });
type PaxFormValues = z.infer<typeof paxFormSchema>;

// ---------------------------------------------------------------------------
// Options builder
// ---------------------------------------------------------------------------

const optionsSchema = z.object({
  transport_mode: z.enum(TRANSPORT_MODES),
  hotel_category: z.string().min(1),
  room_category: z.enum(ROOM_CATEGORIES),
  food_included: z.boolean(),
  diet_type: z.enum(DIET_TYPES),
  baggage_included: z.boolean(),
  baggage_notes: z.string().optional(),
  local_transport_included: z.boolean(),
  sightseeing_included: z.boolean(),
  insurance_included: z.boolean(),
});
type OptionsFormValues = z.infer<typeof optionsSchema>;

// ---------------------------------------------------------------------------
// Travel legs
// ---------------------------------------------------------------------------

const legRowSchema = z.object({
  id: z.number().optional(),
  mode: z.enum(TRAVEL_LEG_MODES),
  direction: z.enum(TRAVEL_LEG_DIRECTIONS),
  carrier_name: z.string().optional(),
  vehicle_number: z.string().optional(),
  pnr: z.string().optional(),
  seat_class: z.string().optional(),
  from_location: z.string().trim().min(1, "Required"),
  to_location: z.string().trim().min(1, "Required"),
  departure_date: z.string().trim().min(1, "Required"),
  departure_time: z.string().optional(),
  arrival_date: z.string().optional(),
  arrival_time: z.string().optional(),
  baggage_allowance: z.string().optional(),
  confirmation_status: z.enum(TRAVEL_LEG_CONFIRMATION_STATUSES),
  notes: z.string().optional(),
});
const legsFormSchema = z.object({ legs: z.array(legRowSchema) });
type LegsFormValues = z.infer<typeof legsFormSchema>;

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

const paymentSchema = z.object({
  amount: z.number().min(0.01, "Enter an amount"),
  mode: z.enum(PAYMENT_MODES),
  utr_no: z.string().optional(),
  paid_on: z.string().optional(),
  remarks: z.string().optional(),
});
type PaymentFormValues = z.infer<typeof paymentSchema>;

const instalmentsSchema = z.object({
  instalments: z.array(z.object({ amount: z.number().min(0.01), due_on: z.string().optional(), label: z.string().optional() })),
});
type InstalmentsFormValues = z.infer<typeof instalmentsSchema>;

export default function BookingDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [tab, setTab] = useState("overview");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [instalmentsOpen, setInstalmentsOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [paxWarnings, setPaxWarnings] = useState<PaxWarning[] | null>(null);

  const canViewCosts = can("view_costs");
  const canViewMargins = can("view_margins");
  const canEditPrices = can("edit_prices");
  const canRecordPayment = can("record_payment");

  const bookingQuery = useQuery({ queryKey: qk.bookings.detail(id), queryFn: () => getBooking(id), enabled: Number.isFinite(id) });
  const booking = bookingQuery.data;

  const setBooking = (next: typeof booking) => { if (next) queryClient.setQueryData(qk.bookings.detail(id), next); };
  const invalidateLists = () => queryClient.invalidateQueries({ queryKey: qk.bookings.all });

  const marginQuery = useQuery({
    queryKey: qk.bookings.margin(id),
    queryFn: () => getBookingMargin(id),
    enabled: Number.isFinite(id) && canViewMargins && booking?.margin === undefined,
  });
  const margin = booking?.margin ?? marginQuery.data;

  const ledgerQuery = useQuery({ queryKey: ["bookings", id, "ledger"], queryFn: () => getBookingLedger(id), enabled: Number.isFinite(id) && tab === "payments" });
  const historyQuery = useQuery({ queryKey: qk.bookings.history(id), queryFn: () => getBookingHistory(id), enabled: Number.isFinite(id) && tab === "history" });
  const travelLegsQuery = useQuery({
    queryKey: qk.travelLegs.list(id),
    queryFn: () => listTravelLegs(id),
    enabled: Number.isFinite(id) && booking?.travel_legs === undefined,
  });
  const travelLegs = booking?.travel_legs ?? travelLegsQuery.data ?? [];

  useEffect(() => {
    if (booking) setPaxWarnings(computeClientWarnings(booking.pax, booking.travel_to));
  }, [booking]);

  // --- Status actions ---
  const confirmMutation = useMutation({
    mutationFn: () => confirmBooking(id),
    onSuccess: (next) => { setBooking(next); invalidateLists(); toast.success("Booking confirmed"); },
    onError: (error) => toast.fromError(error, "Could not confirm this booking", true),
  });

  const statusMutation = useMutation({
    mutationFn: (status: BookingStatus) => changeBookingStatus(id, status),
  });

  const cancelMutation = useMutation({
    mutationFn: (reason: string) => cancelBooking(id, reason),
    onSuccess: (result) => {
      setBooking(result.booking);
      invalidateLists();
      toast.success("Booking cancelled", {
        description: `Charge ${formatMoney(result.policy.charge)} · Refund due ${formatMoney(result.refund_due)}`,
      });
    },
  });

  // --- Services ---
  const servicesForm = useForm<ServicesFormValues>({ resolver: zodResolver(servicesFormSchema), defaultValues: { services: [], discount_amount: 0 } });
  const servicesFieldArray = useFieldArray({ control: servicesForm.control, name: "services" });
  const servicesEditable = booking ? !["completed", "cancelled"].includes(booking.status) : false;

  useEffect(() => {
    if (!booking) return;
    servicesForm.reset({
      services: booking.services.map((s) => ({
        service_type: s.service_type,
        description: s.description,
        day_no: s.day_no ?? undefined,
        service_date: s.service_date ?? undefined,
        quantity: toNumber(s.quantity),
        unit: s.unit,
        nights: s.nights || undefined,
        pax_count: s.pax_count || undefined,
        unit_cost: s.unit_cost !== undefined ? toNumber(s.unit_cost) : undefined,
        unit_price: toNumber(s.unit_price),
        tax_pct: toNumber(s.tax_pct) || undefined,
        notes: s.notes ?? undefined,
      })),
      discount_amount: toNumber(booking.discount_amount),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.id, booking?.services]);

  const saveServicesMutation = useMutation({
    mutationFn: (values: ServicesFormValues) => {
      const services: BookingServiceInput[] = values.services.map((row) => ({
        service_type: row.service_type,
        description: row.description,
        day_no: row.day_no ?? null,
        service_date: row.service_date || null,
        quantity: row.quantity,
        unit: row.unit || "nos",
        nights: row.nights,
        pax_count: row.pax_count,
        unit_cost: row.unit_cost,
        unit_price: row.unit_price,
        tax_pct: row.tax_pct,
        notes: row.notes || null,
      }));
      return saveBookingServices(id, { services, discount_amount: values.discount_amount });
    },
    onSuccess: (next) => { setBooking(next); invalidateLists(); toast.success("Services saved"); },
    onError: (error) => toast.fromError(error, "Could not save services", true),
  });

  const [occupancy, setOccupancy] = useState<"single" | "double" | "triple">("double");
  const priceFromPackageMutation = useMutation({
    mutationFn: () => priceBookingFromPackage(id, { occupancy }),
    onSuccess: (next) => { setBooking(next); toast.success("Priced from the package rate card"); },
    onError: (error) => toast.fromError(error, "Could not price from the package", true),
  });

  // --- Passengers ---
  const paxForm = useForm<PaxFormValues>({ resolver: zodResolver(paxFormSchema), defaultValues: { pax: [] } });
  const paxFieldArray = useFieldArray({ control: paxForm.control, name: "pax" });

  useEffect(() => {
    if (!booking) return;
    paxForm.reset({
      pax: booking.pax.map((p) => ({
        title: p.title,
        first_name: p.first_name,
        last_name: p.last_name ?? undefined,
        pax_type: p.pax_type,
        gender: p.gender ?? undefined,
        date_of_birth: p.date_of_birth ?? undefined,
        phone: p.phone ?? undefined,
        email: p.email ?? undefined,
        passport_no: p.passport_no ?? undefined,
        passport_issue: p.passport_issue ?? undefined,
        passport_expiry: p.passport_expiry ?? undefined,
        passport_country: p.passport_country ?? undefined,
        visa_no: p.visa_no ?? undefined,
        visa_status: p.visa_status,
        visa_expiry: p.visa_expiry ?? undefined,
        meal_preference: p.meal_preference,
        medical_notes: p.medical_notes ?? undefined,
        is_lead_pax: p.is_lead_pax === 1,
        insurance_no: p.insurance_no ?? undefined,
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.id, booking?.pax]);

  const savePaxMutation = useMutation({
    mutationFn: (values: PaxFormValues) => {
      const pax: BookingPaxInput[] = values.pax.map((row) => ({ ...row }));
      return saveBookingPax(id, pax);
    },
    onSuccess: (result) => {
      queryClient.setQueryData(qk.bookings.detail(id), (prev: typeof booking) => (prev ? { ...prev, pax: result.pax } : prev));
      setPaxWarnings(result.warnings);
      toast.success("Passenger manifest saved");
    },
    onError: (error) => toast.fromError(error, "Could not save the manifest", true),
  });

  // --- Options ---
  const optionsForm = useForm<OptionsFormValues>({
    resolver: zodResolver(optionsSchema),
    defaultValues: {
      transport_mode: "none", hotel_category: "3star", room_category: "normal", food_included: true,
      diet_type: "veg", baggage_included: false, baggage_notes: "", local_transport_included: false,
      sightseeing_included: false, insurance_included: false,
    },
  });

  useEffect(() => {
    if (!booking) return;
    optionsForm.reset({
      transport_mode: booking.options?.transport_mode ?? "none",
      hotel_category: booking.hotel_category ?? "3star",
      room_category: booking.options?.room_category ?? "normal",
      food_included: booking.options ? booking.options.food_included === 1 : true,
      diet_type: booking.options?.diet_type ?? "veg",
      baggage_included: booking.options ? booking.options.baggage_included === 1 : false,
      baggage_notes: booking.options?.baggage_notes ?? "",
      local_transport_included: booking.options ? booking.options.local_transport_included === 1 : false,
      sightseeing_included: booking.options ? booking.options.sightseeing_included === 1 : false,
      insurance_included: booking.options ? booking.options.insurance_included === 1 : false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.id, booking?.options, booking?.hotel_category]);

  const optionsMutation = useMutation({
    mutationFn: async (values: OptionsFormValues) => {
      const input: BookingOptionsInput = {
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
      const [options, updated] = await Promise.all([
        saveBookingOptions(id, input),
        values.hotel_category !== booking?.hotel_category
          ? updateBooking(id, { hotel_category: values.hotel_category as (typeof HOTEL_CATEGORIES)[number] })
          : Promise.resolve(booking!),
      ]);
      return { options, updated };
    },
    onSuccess: ({ options, updated }) => { setBooking({ ...updated, options }); toast.success("Options saved"); },
    onError: (error) => toast.fromError(error, "Could not save the options", true),
  });

  const foodIncluded = optionsForm.watch("food_included");
  const baggageIncluded = optionsForm.watch("baggage_included");

  // --- Travel legs ---
  const legsForm = useForm<LegsFormValues>({ resolver: zodResolver(legsFormSchema), defaultValues: { legs: [] } });
  const legsFieldArray = useFieldArray({ control: legsForm.control, name: "legs" });

  useEffect(() => {
    legsForm.reset({
      legs: travelLegs.map((leg) => ({
        id: leg.id,
        mode: leg.mode,
        direction: leg.direction,
        carrier_name: leg.carrier_name ?? undefined,
        vehicle_number: leg.vehicle_number ?? undefined,
        pnr: leg.pnr ?? undefined,
        seat_class: leg.seat_class ?? undefined,
        from_location: leg.from_location,
        to_location: leg.to_location,
        departure_date: leg.departure_date,
        departure_time: leg.departure_time ?? undefined,
        arrival_date: leg.arrival_date ?? undefined,
        arrival_time: leg.arrival_time ?? undefined,
        baggage_allowance: leg.baggage_allowance ?? undefined,
        confirmation_status: leg.confirmation_status,
        notes: leg.notes ?? undefined,
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.id, travelLegs.length]);

  const saveLegsMutation = useMutation({
    mutationFn: (values: LegsFormValues) => {
      const legs: TravelLegInput[] = values.legs.map((row, index) => ({
        leg_no: index + 1,
        mode: row.mode,
        direction: row.direction,
        carrier_name: row.carrier_name || null,
        vehicle_number: row.vehicle_number || null,
        pnr: row.pnr || null,
        seat_class: row.seat_class || null,
        from_location: row.from_location,
        to_location: row.to_location,
        departure_date: row.departure_date,
        departure_time: row.departure_time || null,
        arrival_date: row.arrival_date || null,
        arrival_time: row.arrival_time || null,
        baggage_allowance: row.baggage_allowance || null,
        confirmation_status: row.confirmation_status,
        notes: row.notes || null,
      }));
      return replaceTravelLegs(id, legs);
    },
    onSuccess: (next) => {
      queryClient.setQueryData(qk.bookings.detail(id), (prev: typeof booking) => (prev ? { ...prev, travel_legs: next } : prev));
      queryClient.setQueryData(qk.travelLegs.list(id), next);
      toast.success("Travel logistics saved");
    },
    onError: (error) => toast.fromError(error, "Could not save the travel legs", true),
  });

  const confirmLegMutation = useMutation({
    mutationFn: (input: { legId: number; pnr?: string }) => confirmTravelLeg(id, input.legId, input.pnr),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qk.travelLegs.list(id) }); queryClient.invalidateQueries({ queryKey: qk.bookings.detail(id) }); toast.success("Leg confirmed"); },
    onError: (error) => toast.fromError(error, "Could not confirm this leg", true),
  });

  // --- Payments ---
  const paymentForm = useForm<PaymentFormValues>({ resolver: zodResolver(paymentSchema), defaultValues: { mode: "cash" } });
  const paymentMode = paymentForm.watch("mode");

  const recordPaymentMutation = useMutation({
    mutationFn: (values: PaymentFormValues) =>
      recordBookingPayment(id, {
        amount: values.amount,
        mode: values.mode,
        utr_no: values.utr_no || null,
        paid_on: values.paid_on || null,
        remarks: values.remarks || null,
      }),
    onSuccess: (result) => {
      setBooking(result.booking);
      invalidateLists();
      queryClient.invalidateQueries({ queryKey: ["bookings", id, "ledger"] });
      toast.success("Payment recorded");
      setPaymentOpen(false);
      paymentForm.reset({ mode: "cash" });
    },
    onError: (error) => {
      if (!applyApiErrors(error, paymentForm.setError, ["amount", "mode", "utr_no", "paid_on", "remarks"])) {
        toast.fromError(error, "Could not record the payment", true);
      }
    },
  });

  const instalmentsForm = useForm<InstalmentsFormValues>({ resolver: zodResolver(instalmentsSchema), defaultValues: { instalments: [{ amount: 0 }] } });
  const instalmentsFieldArray = useFieldArray({ control: instalmentsForm.control, name: "instalments" });

  const scheduleMutation = useMutation({
    mutationFn: (values: InstalmentsFormValues) =>
      scheduleInstalments(id, values.instalments.map((i) => ({ amount: i.amount, due_on: i.due_on || null, label: i.label || null }))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings", id, "ledger"] });
      toast.success("Instalment plan saved");
      setInstalmentsOpen(false);
    },
    onError: (error) => toast.fromError(error, "Could not schedule instalments", true),
  });

  const markPaidMutation = useMutation({
    mutationFn: (paymentId: number) => markPaymentPaid(paymentId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["bookings", id, "ledger"] }); toast.success("Payment marked paid"); },
    onError: (error) => toast.fromError(error, "Could not mark this payment paid", true),
  });

  // --- Print itinerary ---
  const handlePrintItinerary = async () => {
    if (!booking) return;
    setPrinting(true);
    try {
      const [{ downloadItineraryPdf }, settings] = await Promise.all([
        import("@/lib/pdf/itinerary"),
        queryClient.fetchQuery({ queryKey: qk.settings.map, queryFn: getSettings }),
      ]);
      const driver = booking.trip_assignments[0];
      await downloadItineraryPdf({
        booking: {
          bookingNo: booking.booking_no,
          leadPaxName: booking.lead_pax_name ?? booking.customer_name ?? "Guest",
          contactPhone: booking.contact_phone ?? undefined,
          travelFrom: booking.travel_from,
          travelTo: booking.travel_to,
          nights: booking.nights,
          adults: booking.adults,
          children: booking.children,
          infants: booking.infants,
          destinationName: booking.destination_name ?? undefined,
          packageName: booking.package_name ?? undefined,
        },
        days: [],
        travelLegs: travelLegs.map((leg) => ({
          legNo: leg.leg_no,
          mode: leg.mode,
          direction: leg.direction,
          carrierName: leg.carrier_name ?? undefined,
          vehicleNumber: leg.vehicle_number ?? undefined,
          pnr: leg.pnr ?? undefined,
          seatClass: leg.seat_class ?? undefined,
          fromLocation: leg.from_location,
          toLocation: leg.to_location,
          departureDate: leg.departure_date,
          departureTime: leg.departure_time ?? undefined,
          arrivalDate: leg.arrival_date ?? undefined,
          arrivalTime: leg.arrival_time ?? undefined,
          baggageAllowance: leg.baggage_allowance ?? undefined,
        })),
        drivers: driver
          ? [{
              fromDate: driver.from_date,
              toDate: driver.to_date,
              driverName: driver.driver_name ?? undefined,
              driverPhone: driver.driver_phone ?? undefined,
              vehicleType: driver.vehicle_type_name ?? undefined,
              registrationNo: driver.registration_no ?? undefined,
              pickupPoint: driver.pickup_point ?? undefined,
            }]
          : [],
        options: booking.options
          ? {
              transportMode: booking.options.transport_mode,
              roomCategory: booking.options.room_category,
              foodIncluded: booking.options.food_included === 1,
              dietType: booking.options.diet_type,
              baggageIncluded: booking.options.baggage_included === 1,
              baggageNotes: booking.options.baggage_notes ?? undefined,
              localTransportIncluded: booking.options.local_transport_included === 1,
              sightseeingIncluded: booking.options.sightseeing_included === 1,
              insuranceIncluded: booking.options.insurance_included === 1,
            }
          : undefined,
        emergencyContact: { name: booking.emergency_contact ?? undefined, phone: booking.emergency_phone ?? undefined },
        company: toPdfCompany(settings.company),
      });
    } catch (error) {
      toast.fromError(error, "Could not build the itinerary PDF", true);
    } finally {
      setPrinting(false);
    }
  };

  const serviceTypeOptions: SelectOption[] = SERVICE_TYPES.map((t) => ({ value: t, label: humanize(t) }));
  const hotelCategoryOptions: SelectOption[] = HOTEL_CATEGORIES.map((c) => ({ value: c, label: HOTEL_CATEGORY_LABELS[c] }));
  const roomCategoryOptions: SelectOption[] = ROOM_CATEGORIES.map((c) => ({ value: c, label: humanize(c) }));
  const dietOptions: SelectOption[] = DIET_TYPES.map((d) => ({
    value: d, label: d === "non_veg" ? "Non-Vegetarian" : d === "brahmin" ? "Brahmin Food" : d === "jain" ? "Jain Food" : "Vegetarian",
  }));
  const paymentModeOptions: SelectOption[] = PAYMENT_MODES.map((m) => ({ value: m, label: humanize(m) }));

  if (bookingQuery.isLoading || !booking) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const allowedTransitions = (BOOKING_TRANSITIONS[booking.status] ?? []).filter((s) => s !== "cancelled");
  const canCancel = !["cancelled", "completed"].includes(booking.status);
  const criticalWarnings = (paxWarnings ?? []).filter((w) => w.severity === "critical").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title={booking.booking_no}
        backTo="/bookings"
        meta={<StatusBadge status={booking.status} label={STATUS_LABELS[booking.status]} />}
        description={`${booking.customer_name ?? "—"} · ${booking.destination_name ?? "—"} · ${formatDate(booking.travel_from)} – ${formatDate(booking.travel_to)}`}
        actions={
          <>
            <Button variant="outline" onClick={handlePrintItinerary} disabled={printing}>
              {printing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Printer />}
              Print itinerary
            </Button>
            {BOOKING_TRANSITIONS[booking.status]?.includes("confirmed") && (
              <Button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
                {confirmMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 />}
                Confirm
              </Button>
            )}
            {allowedTransitions.map((next) => (
              <Button
                key={next}
                variant="outline"
                disabled={statusMutation.isPending}
                onClick={() =>
                  statusMutation.mutate(next, {
                    onSuccess: (updated) => { setBooking(updated); invalidateLists(); toast.success(`Booking marked ${next}`); },
                    onError: (error) => toast.fromError(error, "That status change was rejected", true),
                  })
                }
              >
                {STATUS_LABELS[next]}
              </Button>
            ))}
            {canCancel && (
              <Button variant="destructive" onClick={() => { setCancelReason(""); setCancelOpen(true); }}>
                <Ban /> Cancel
              </Button>
            )}
          </>
        }
      />

      {criticalWarnings > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-status-overdue bg-status-overdue-bg px-3 py-2 text-sm text-status-overdue">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {criticalWarnings} passenger document issue(s) need attention — see the Passengers tab.
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="passengers">
            Passengers{criticalWarnings > 0 && <Badge variant="destructive" className="ml-1.5 px-1.5 py-0">{criticalWarnings}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="options">Options</TabsTrigger>
          <TabsTrigger value="logistics">Travel Logistics</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="vouchers">Vouchers</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-sm">Trip details</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <DetailRow label="Customer" value={`${booking.customer_name ?? "—"} · ${booking.customer_phone ?? ""}`} />
                <DetailRow label="Destination" value={booking.destination_name ?? "—"} />
                {booking.package_name && <DetailRow label="Package" value={booking.package_name} />}
                <DetailRow label="Travel dates" value={`${formatDate(booking.travel_from)} – ${formatDate(booking.travel_to)} (${booking.nights}N)`} />
                <DetailRow label="Pax" value={formatPax(booking.adults, booking.children, booking.infants)} />
                <DetailRow label="Lead passenger" value={booking.lead_pax_name ?? "—"} />
                <DetailRow label="Emergency contact" value={booking.emergency_contact ? `${booking.emergency_contact} · ${booking.emergency_phone ?? ""}` : "—"} />
                <DetailRow label="Owner" value={booking.owner_name ?? "—"} />
                <DetailRow label="Ops owner" value={booking.ops_owner_name ?? "—"} />
                {booking.quote_no && <DetailRow label="From quotation" value={booking.quote_no} />}
                {booking.special_requests && (
                  <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Special requests</p><p className="mt-1 whitespace-pre-wrap">{booking.special_requests}</p></div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">Money</CardTitle></CardHeader>
                <CardContent className="space-y-1.5 text-sm">
                  <DetailRow label="Subtotal" value={<MoneyText value={booking.subtotal} />} />
                  <DetailRow label="Discount" value={<MoneyText value={booking.discount_amount} />} />
                  <DetailRow label="GST" value={<MoneyText value={booking.gst_amount} />} />
                  <div className="flex items-center justify-between text-base font-semibold"><span>Grand total</span><MoneyText value={booking.grand_total} /></div>
                  <DetailRow label="Paid" value={<MoneyText value={booking.amount_paid} />} />
                  <DetailRow label="Outstanding" value={<MoneyText value={booking.outstanding} colored />} />
                </CardContent>
              </Card>

              {canViewMargins && margin && (
                <Card>
                  <CardHeader><CardTitle className="text-sm">Margin</CardTitle></CardHeader>
                  <CardContent className="space-y-1.5 text-sm">
                    <DetailRow label="Revenue" value={<MoneyText value={margin.revenue} />} />
                    <DetailRow label="Cost" value={<MoneyText value={margin.actual_cost} />} />
                    <div className="flex items-center justify-between font-semibold"><span>Margin</span><MoneyText value={margin.margin} colored /></div>
                    <DetailRow label="Margin %" value={`${margin.margin_pct.toFixed(1)}%`} />
                    {margin.is_estimated && <p className="text-xs text-muted-foreground">Estimated — nothing billed by a supplier yet.</p>}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Services */}
        <TabsContent value="services" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">Service lines</CardTitle>
              {servicesEditable && booking.package_id && (
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
              {servicesFieldArray.fields.length === 0 && !servicesEditable ? (
                <EmptyState compact title="No services" />
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
                        {canViewCosts && <th className="p-2 text-right">Cost</th>}
                        <th className="p-2 text-right">Price</th>
                        <th className="p-2 text-right">Total</th>
                        {servicesEditable && <th className="p-2" />}
                      </tr>
                    </thead>
                    <tbody>
                      {servicesFieldArray.fields.map((field, index) => {
                        const row = servicesForm.watch(`services.${index}`);
                        const total = toNumber(row?.quantity) * toNumber(row?.unit_price);
                        return (
                          <tr key={field.id} className="border-t">
                            <td className="p-2"><SelectField control={servicesForm.control} name={`services.${index}.service_type`} options={serviceTypeOptions} disabled={!servicesEditable} className="min-w-[7rem]" /></td>
                            <td className="p-2 min-w-[10rem]"><TextField control={servicesForm.control} name={`services.${index}.description`} disabled={!servicesEditable} /></td>
                            <td className="p-2 w-16"><NumberField control={servicesForm.control} name={`services.${index}.day_no`} disabled={!servicesEditable} min={1} /></td>
                            <td className="p-2 w-36"><DateField control={servicesForm.control} name={`services.${index}.service_date`} disabled={!servicesEditable} /></td>
                            <td className="p-2 w-20"><NumberField control={servicesForm.control} name={`services.${index}.quantity`} disabled={!servicesEditable} min={0} /></td>
                            {canViewCosts && <td className="p-2 w-24"><NumberField control={servicesForm.control} name={`services.${index}.unit_cost`} disabled={!servicesEditable} min={0} /></td>}
                            <td className="p-2 w-24"><NumberField control={servicesForm.control} name={`services.${index}.unit_price`} disabled={!servicesEditable} min={0} /></td>
                            <td className="p-2 text-right tabular"><MoneyText value={total} /></td>
                            {servicesEditable && <td className="p-2"><Button type="button" variant="ghost" size="icon-sm" onClick={() => servicesFieldArray.remove(index)} aria-label="Remove line"><Trash2 className="h-4 w-4 text-destructive" aria-hidden /></Button></td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {servicesEditable && (
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => servicesFieldArray.append({ service_type: "other", description: "", quantity: 1, unit: "nos", unit_price: 0 })}>
                    <Plus /> Add line
                  </Button>
                  <Button size="sm" onClick={servicesForm.handleSubmit((values) => saveServicesMutation.mutate(values))} disabled={saveServicesMutation.isPending}>
                    {saveServicesMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save />}
                    Save & re-price
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Passengers */}
        <TabsContent value="passengers" className="space-y-4">
          {(paxWarnings ?? []).length > 0 && (
            <div className="space-y-1.5">
              {(paxWarnings ?? []).map((w, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                    w.severity === "critical" ? "bg-status-overdue-bg text-status-overdue" : w.severity === "warning" ? "bg-status-pending-bg text-status-pending" : "bg-muted text-muted-foreground"
                  }`}
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {w.message}
                </div>
              ))}
            </div>
          )}

          <Card>
            <CardHeader><CardTitle className="text-sm">Passenger manifest</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                {paxFieldArray.fields.map((field, index) => (
                  <div key={field.id} className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-medium">Passenger {index + 1}</p>
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => paxFieldArray.remove(index)} aria-label="Remove passenger"><Trash2 className="h-4 w-4 text-destructive" aria-hidden /></Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <SelectField control={paxForm.control} name={`pax.${index}.title`} label="Title" options={PAX_TITLES.map((t) => ({ value: t, label: t }))} />
                      <TextField control={paxForm.control} name={`pax.${index}.first_name`} label="First name" required className="sm:col-span-2" />
                      <TextField control={paxForm.control} name={`pax.${index}.last_name`} label="Last name" />
                      <SelectField control={paxForm.control} name={`pax.${index}.pax_type`} label="Type" options={PAX_TYPES.map((t) => ({ value: t, label: humanize(t) }))} />
                      <SelectField control={paxForm.control} name={`pax.${index}.gender`} label="Gender" options={GENDERS.map((g) => ({ value: g, label: humanize(g) }))} />
                      <DateField control={paxForm.control} name={`pax.${index}.date_of_birth`} label="Date of birth" />
                      <TextField control={paxForm.control} name={`pax.${index}.phone`} label="Phone" />
                      <TextField control={paxForm.control} name={`pax.${index}.email`} label="Email" type="email" />
                      <TextField control={paxForm.control} name={`pax.${index}.passport_no`} label="Passport no" />
                      <DateField control={paxForm.control} name={`pax.${index}.passport_issue`} label="Passport issue" />
                      <DateField control={paxForm.control} name={`pax.${index}.passport_expiry`} label="Passport expiry" />
                      <TextField control={paxForm.control} name={`pax.${index}.passport_country`} label="Passport country" />
                      <TextField control={paxForm.control} name={`pax.${index}.visa_no`} label="Visa no" />
                      <SelectField control={paxForm.control} name={`pax.${index}.visa_status`} label="Visa status" options={VISA_STATUSES.map((v) => ({ value: v, label: humanize(v) }))} />
                      <DateField control={paxForm.control} name={`pax.${index}.visa_expiry`} label="Visa expiry" />
                      <SelectField control={paxForm.control} name={`pax.${index}.meal_preference`} label="Meal preference" options={MEAL_PREFERENCES.map((m) => ({ value: m, label: humanize(m) }))} />
                      <TextField control={paxForm.control} name={`pax.${index}.insurance_no`} label="Insurance no" />
                      <SwitchField control={paxForm.control} name={`pax.${index}.is_lead_pax`} label="Lead passenger" className="sm:col-span-2" />
                      <TextareaField control={paxForm.control} name={`pax.${index}.medical_notes`} label="Medical notes" className="sm:col-span-4" rows={2} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => paxFieldArray.append({ title: "Mr", first_name: "", pax_type: "adult", visa_status: "not_required", meal_preference: "none" })}
                >
                  <Plus /> Add passenger
                </Button>
                <Button size="sm" onClick={paxForm.handleSubmit((values) => savePaxMutation.mutate(values))} disabled={savePaxMutation.isPending}>
                  {savePaxMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save />}
                  Save manifest
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Options */}
        <TabsContent value="options" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Trip inclusions (carried over from the quotation)</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={optionsForm.handleSubmit((values) => optionsMutation.mutate(values))} className="space-y-5">
                <div>
                  <Label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Transport mode</Label>
                  <div className="inline-flex flex-wrap rounded-lg border p-1">
                    {TRANSPORT_MODES.map((mode) => (
                      <Button key={mode} type="button" size="sm" variant={optionsForm.watch("transport_mode") === mode ? "default" : "ghost"} onClick={() => optionsForm.setValue("transport_mode", mode, { shouldDirty: true })}>
                        {humanize(mode)}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <SelectField control={optionsForm.control} name="hotel_category" label="Hotel category" options={hotelCategoryOptions} />
                  <SelectField control={optionsForm.control} name="room_category" label="Room category" options={roomCategoryOptions} />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <SwitchField control={optionsForm.control} name="food_included" label="Food included" />
                  <SelectField control={optionsForm.control} name="diet_type" label="Diet type" options={dietOptions} disabled={!foodIncluded} />
                </div>

                <Separator />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-3">
                    <SwitchField control={optionsForm.control} name="baggage_included" label="Baggage" />
                    {baggageIncluded && <TextField control={optionsForm.control} name="baggage_notes" placeholder="e.g. 15kg check-in + 7kg cabin" />}
                  </div>
                  <SwitchField control={optionsForm.control} name="local_transport_included" label="Local transport (pickup / drop)" />
                  <SwitchField control={optionsForm.control} name="sightseeing_included" label="Sightseeing" />
                  <SwitchField control={optionsForm.control} name="insurance_included" label="Insurance" />
                </div>

                <Button type="submit" disabled={optionsMutation.isPending}>
                  {optionsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save />}
                  Save options
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Travel logistics */}
        <TabsContent value="logistics" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Travel legs — actual flight / train / bus details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {legsFieldArray.fields.map((field, index) => {
                  const legId = legsForm.watch(`legs.${index}.id`);
                  const status = legsForm.watch(`legs.${index}.confirmation_status`);
                  return (
                    <div key={field.id} className="rounded-lg border p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-medium">Leg {index + 1}</p>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={status} size="sm" />
                          {legId && status !== "confirmed" && (
                            <Button type="button" size="sm" variant="outline" onClick={() => confirmLegMutation.mutate({ legId, pnr: legsForm.getValues(`legs.${index}.pnr`) })} disabled={confirmLegMutation.isPending}>
                              Confirm
                            </Button>
                          )}
                          <Button type="button" variant="ghost" size="icon-sm" onClick={() => legsFieldArray.remove(index)} aria-label="Remove leg"><Trash2 className="h-4 w-4 text-destructive" aria-hidden /></Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <SelectField control={legsForm.control} name={`legs.${index}.mode`} label="Mode" options={TRAVEL_LEG_MODES.map((m) => ({ value: m, label: humanize(m) }))} />
                        <SelectField control={legsForm.control} name={`legs.${index}.direction`} label="Direction" options={TRAVEL_LEG_DIRECTIONS.map((d) => ({ value: d, label: humanize(d) }))} />
                        <TextField control={legsForm.control} name={`legs.${index}.carrier_name`} label="Carrier" placeholder="IndiGo / SR / KSRTC" />
                        <TextField control={legsForm.control} name={`legs.${index}.vehicle_number`} label="Flight / train / bus no." />
                        <TextField control={legsForm.control} name={`legs.${index}.pnr`} label="PNR" />
                        <TextField control={legsForm.control} name={`legs.${index}.seat_class`} label="Class" placeholder="Economy / 3AC" />
                        <TextField control={legsForm.control} name={`legs.${index}.from_location`} label="From" required />
                        <TextField control={legsForm.control} name={`legs.${index}.to_location`} label="To" required />
                        <DateField control={legsForm.control} name={`legs.${index}.departure_date`} label="Departure date" />
                        <TextField control={legsForm.control} name={`legs.${index}.departure_time`} label="Departure time" placeholder="14:30" />
                        <DateField control={legsForm.control} name={`legs.${index}.arrival_date`} label="Arrival date" />
                        <TextField control={legsForm.control} name={`legs.${index}.arrival_time`} label="Arrival time" placeholder="18:45" />
                        <TextField control={legsForm.control} name={`legs.${index}.baggage_allowance`} label="Baggage allowance" placeholder="15kg + 7kg cabin" className="sm:col-span-2" />
                        <SelectField control={legsForm.control} name={`legs.${index}.confirmation_status`} label="Confirmation" options={TRAVEL_LEG_CONFIRMATION_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    legsFieldArray.append({
                      mode: "flight", direction: "onward", from_location: "", to_location: "",
                      departure_date: toISODate(new Date()) ?? "", confirmation_status: "pending",
                    })
                  }
                >
                  <Plus /> Add leg
                </Button>
                <Button size="sm" onClick={legsForm.handleSubmit((values) => saveLegsMutation.mutate(values))} disabled={saveLegsMutation.isPending}>
                  {saveLegsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save />}
                  Save travel legs
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payments */}
        <TabsContent value="payments" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">Payment ledger</CardTitle>
              {canRecordPayment && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setInstalmentsOpen(true)}>Schedule instalments</Button>
                  <Button size="sm" onClick={() => setPaymentOpen(true)}><Plus /> Record payment</Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {ledgerQuery.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : ledgerQuery.data ? (
                <>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <DetailRow label="Total" value={<MoneyText value={ledgerQuery.data.grand_total} />} />
                    <DetailRow label="Received" value={<MoneyText value={ledgerQuery.data.received} />} />
                    <DetailRow label="Scheduled" value={<MoneyText value={ledgerQuery.data.scheduled} />} />
                    <DetailRow label="Outstanding" value={<MoneyText value={ledgerQuery.data.outstanding} colored />} />
                  </div>
                  <Separator />
                  {ledgerQuery.data.payments.length === 0 ? (
                    <EmptyState compact title="No payments recorded yet" />
                  ) : (
                    <div className="space-y-1.5">
                      {ledgerQuery.data.payments.map((payment) => (
                        <div key={payment.id} className="flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-accent/30">
                          <div>
                            <p className="font-medium">{payment.payment_no} · {humanize(payment.mode)}</p>
                            <p className="text-xs text-muted-foreground">
                              {payment.paid_on ? formatDate(payment.paid_on) : payment.due_on ? `Due ${formatDate(payment.due_on)}` : "—"}
                              {payment.remarks ? ` · ${payment.remarks}` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <MoneyText value={payment.amount} />
                            <StatusBadge status={payment.status} size="sm" />
                            {payment.status === "scheduled" && canRecordPayment && (
                              <Button size="sm" variant="outline" onClick={() => markPaidMutation.mutate(payment.id)} disabled={markPaidMutation.isPending}>
                                Mark paid
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </CardContent>
          </Card>

          {booking.invoices.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Invoices</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {booking.invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm">
                    <span>{inv.invoice_no} · {formatDate(inv.invoice_date)}</span>
                    <span className="flex items-center gap-2"><MoneyText value={inv.grand_total} /><StatusBadge status={inv.payment_status} size="sm" /></span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Vouchers */}
        <TabsContent value="vouchers">
          <Card>
            <CardHeader><CardTitle className="text-sm">Vouchers</CardTitle></CardHeader>
            <CardContent>
              {booking.vouchers.length === 0 ? (
                <EmptyState compact title="No vouchers issued yet" />
              ) : (
                <div className="space-y-1.5">
                  {booking.vouchers.map((v) => (
                    <div key={v.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm">
                      <span>{v.voucher_no} · {humanize(v.voucher_type)}</span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {v.issued_at ? formatDate(v.issued_at) : "Not issued"}
                        <StatusBadge status={v.status} size="sm" />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Operations */}
        <TabsContent value="operations">
          <Card>
            <CardHeader><CardTitle className="text-sm">Trip assignment</CardTitle></CardHeader>
            <CardContent>
              {booking.trip_assignments.length === 0 ? (
                <EmptyState compact title="No vehicle or driver assigned yet" />
              ) : (
                <div className="space-y-3">
                  {booking.trip_assignments.map((t) => (
                    <div key={t.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{t.driver_name ?? "Driver TBD"} {t.driver_phone && `· ${t.driver_phone}`}</p>
                        <StatusBadge status={t.status} size="sm" />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t.vehicle_type_name ?? "—"} {t.registration_no && `· ${t.registration_no}`} · {formatDate(t.from_date)} – {formatDate(t.to_date)}
                      </p>
                      {(t.pickup_point || t.drop_point) && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t.pickup_point && `Pickup: ${t.pickup_point} ${t.pickup_time ?? ""}`} {t.drop_point && `· Drop: ${t.drop_point}`}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* History */}
        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Status timeline</CardTitle></CardHeader>
            <CardContent>
              {historyQuery.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : !historyQuery.data || historyQuery.data.transitions.length === 0 ? (
                <EmptyState compact title="No transitions recorded" />
              ) : (
                <ol className="space-y-3 border-l pl-4">
                  {historyQuery.data.transitions.map((t) => (
                    <li key={t.id} className="relative text-sm">
                      <span className="absolute -left-[1.1rem] top-1 h-2 w-2 rounded-full bg-primary" aria-hidden />
                      <p><span className="font-medium">{t.from_status ?? "—"}</span> → <span className="font-medium">{t.to_status}</span></p>
                      {t.note && <p className="text-muted-foreground">{t.note}</p>}
                      <p className="text-xs text-muted-foreground">{t.actor_name ?? "System"} · {formatDateTime(t.created_at)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Audit log</CardTitle></CardHeader>
            <CardContent>
              {historyQuery.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : !historyQuery.data || historyQuery.data.audit.length === 0 ? (
                <EmptyState compact title="Nothing logged" />
              ) : (
                <div className="space-y-2 text-sm">
                  {historyQuery.data.audit.map((a) => (
                    <div key={a.id} className="border-t pt-2 first:border-t-0 first:pt-0">
                      <p><span className="font-medium">{humanize(a.action)}</span> {a.note && `· ${a.note}`}</p>
                      <p className="text-xs text-muted-foreground">{a.actor_name ?? "System"} · {formatDateTime(a.created_at)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Cancel dialog */}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this booking"
        description="The cancellation charge is computed from the destination's cancellation policy based on how many days remain before departure."
        confirmLabel="Cancel booking"
        destructive
        confirmDisabled={cancelReason.trim() === ""}
        onConfirm={async () => {
          await cancelMutation.mutateAsync(cancelReason.trim());
        }}
      >
        <textarea
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder="Reason for cancellation…"
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </ConfirmDialog>

      {/* Record payment */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>Outstanding: <MoneyText value={booking.outstanding} /></DialogDescription>
          </DialogHeader>
          <form onSubmit={paymentForm.handleSubmit((values) => recordPaymentMutation.mutate(values))} noValidate className="space-y-4">
            <NumberField control={paymentForm.control} name="amount" label="Amount" required min={0.01} />
            <SelectField control={paymentForm.control} name="mode" label="Mode" options={paymentModeOptions} />
            {requiresReference(paymentMode as PaymentMode) && (
              <TextField control={paymentForm.control} name="utr_no" label="Reference / UTR no." required />
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

      {/* Schedule instalments */}
      <Dialog open={instalmentsOpen} onOpenChange={setInstalmentsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule instalments</DialogTitle>
            <DialogDescription>Replaces any existing scheduled (unpaid) instalments.</DialogDescription>
          </DialogHeader>
          <form onSubmit={instalmentsForm.handleSubmit((values) => scheduleMutation.mutate(values))} noValidate className="space-y-3">
            {instalmentsFieldArray.fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <NumberField control={instalmentsForm.control} name={`instalments.${index}.amount`} label="Amount" required min={0.01} />
                <DateField control={instalmentsForm.control} name={`instalments.${index}.due_on`} label="Due on" />
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => instalmentsFieldArray.remove(index)} aria-label="Remove instalment">
                  <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => instalmentsFieldArray.append({ amount: 0 })}>
              <Plus /> Add instalment
            </Button>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInstalmentsOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={scheduleMutation.isPending}>
                {scheduleMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Save plan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Central React Query key factory. Every page imports its keys from here
 * rather than inlining array literals, so a mutation in one file can always
 * invalidate the exact list a page in another file is watching.
 *
 * Convention: `qk.<resource>.list(filters)` for a filtered list,
 * `qk.<resource>.detail(id)` for a single record, `qk.<resource>.all` as the
 * broad key used to invalidate every list variant after a write.
 */

// Loosely typed on purpose: every module's filter object is different and
// this factory does not need to know their shapes, only serialise them into
// a stable cache key.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Filters = Record<string, any> | undefined;

function list(resource: string, filters: Filters) {
  return [resource, "list", filters ?? {}] as const;
}

function detail(resource: string, id: number | string) {
  return [resource, "detail", id] as const;
}

function all(resource: string) {
  return [resource] as const;
}

function make(resource: string) {
  return {
    all: all(resource),
    list: (filters?: Filters) => list(resource, filters),
    detail: (id: number | string) => detail(resource, id),
  };
}

export const qk = {
  auth: { me: ["auth", "me"] as const },
  dashboard: {
    overview: ["dashboard", "overview"] as const,
    salesFunnel: ["dashboard", "sales-funnel"] as const,
    myWork: ["dashboard", "my-work"] as const,
  },

  leads: { ...make("leads"), pipeline: (filters?: Filters) => ["leads", "pipeline", filters ?? {}] as const },
  quotations: { ...make("quotations") },
  quotationOptions: { detail: (quotationId: number) => ["quotation-options", quotationId] as const },
  bookings: { ...make("bookings"), margin: (id: number) => ["bookings", id, "margin"] as const, history: (id: number) => ["bookings", id, "history"] as const },
  bookingOptions: { detail: (bookingId: number) => ["booking-options", bookingId] as const },
  travelLegs: { list: (bookingId: number) => ["travel-legs", bookingId] as const },
  customers: { ...make("customers") },

  packages: { ...make("packages"), options: (destinationId?: number) => ["packages", "options", destinationId] as const },
  departures: { ...make("departures") },
  destinations: { ...make("destinations"), options: ["destinations", "options"] as const },
  activities: { ...make("activities") },
  suppliers: { ...make("suppliers"), options: (type?: string) => ["suppliers", "options", type] as const },
  hotels: { ...make("hotels"), options: (destinationId?: number) => ["hotels", "options", destinationId] as const },
  fleet: {
    vehicles: (filters?: Filters) => ["fleet", "vehicles", filters ?? {}] as const,
    drivers: (filters?: Filters) => ["fleet", "drivers", filters ?? {}] as const,
    vehicleTypes: ["fleet", "vehicle-types"] as const,
  },

  ops: {
    board: (date: string, filters?: Filters) => ["ops", "board", date, filters ?? {}] as const,
    calendar: (from: string, to: string) => ["ops", "calendar", from, to] as const,
    departuresChecklist: (days: number) => ["ops", "departures-checklist", days] as const,
    incidents: (filters?: Filters) => ["ops", "incidents", filters ?? {}] as const,
  },
  tripAssignments: { ...make("trip-assignments") },
  vouchers: { ...make("vouchers"), forBooking: (bookingId: number) => ["vouchers", "booking", bookingId] as const },

  invoices: { ...make("invoices") },
  payments: { daybook: (from: string, to: string, mode?: string) => ["payments", "daybook", from, to, mode] as const },
  supplierBills: { ...make("supplier-bills") },
  expenses: { ...make("expenses"), summary: (filters?: Filters) => ["expenses", "summary", filters ?? {}] as const, categories: ["expenses", "categories"] as const },
  finance: {
    payables: ["finance", "payables"] as const,
    receivables: ["finance", "receivables"] as const,
    gstSummary: (from: string, to: string) => ["finance", "gst-summary", from, to] as const,
    profitAndLoss: (from: string, to: string) => ["finance", "pl", from, to] as const,
  },

  reports: {
    sales: (filters?: Filters) => ["reports", "sales", filters ?? {}] as const,
    margin: (filters?: Filters) => ["reports", "margin", filters ?? {}] as const,
    supplierPerformance: (filters?: Filters) => ["reports", "supplier-performance", filters ?? {}] as const,
    paxManifest: (departureId: number) => ["reports", "pax-manifest", departureId] as const,
    outstanding: ["reports", "outstanding"] as const,
    leadSourceRoi: (filters?: Filters) => ["reports", "lead-source-roi", filters ?? {}] as const,
  },

  notifications: {
    inbox: (unreadOnly: boolean, page: number) => ["notifications", "inbox", unreadOnly, page] as const,
    unreadCount: ["notifications", "unread-count"] as const,
  },

  users: { ...make("users") },
  settings: { map: ["settings", "map"] as const, numbering: ["settings", "numbering"] as const },
  auditLog: { list: (filters?: Filters) => ["audit-log", "list", filters ?? {}] as const },
};

# Requirements

Format follows [`docs/REFERENCE_STACK_ANALYSIS.md`](docs/REFERENCE_STACK_ANALYSIS.md#requirements-doc-format-adopted):
raw requirement → `R<n>` analysis (tables/files/endpoint, or NOT YET IMPLEMENTED) → `T<n>` checklist citing its
R-ids → dated progress log → blocked/needs-input. A Module Map states the wires that must exist, with the rule
**never ship an isolated feature.**

---

## §0 Working protocol

**Repo facts.** This is a **from-scratch build**, not a fork. It shares engineering patterns with a different,
unrelated client's inventory/manufacturing ERP (`api-EcoSudar/clone/inventory`) via a one-time, read-only
analysis — see [`docs/REFERENCE_STACK_ANALYSIS.md`](docs/REFERENCE_STACK_ANALYSIS.md) — but no code, data, or
business logic was copied across. That repository must never be read from or written to during this project's
work.

**Stack.** Zero-dependency PHP 8.1+ (no Composer, no `vendor/`) over MariaDB/MySQL, deployed by copying files onto
shared hosting. React 18 + Vite 5 + TypeScript (`strict: true`) SPA. Full detail in [ARCHITECTURE.md](ARCHITECTURE.md).

**How to run.**
```bash
cp .env.example .env                                    # then set JWT_SECRET, DB_*
php api/install.php --email=owner@example.com            # runs all migrations, creates the owner account
./scripts/dev.sh                                          # PHP :8000 + Vite :8080
```
Backend-only tests: `php api/tests/run_all.php`. Frontend: `cd frontend && npm test / npm run typecheck / npm run lint`.

**Non-negotiable rules** (enforced in code, not just convention):

1. **Never touch `api-EcoSudar/**`.** A different client's repository. Read-only analysis of it is already
   complete and frozen in `docs/REFERENCE_STACK_ANALYSIS.md`.
2. **Never trust a client-sent price.** Every sell price that resolves to a catalogued item (package slab, hotel
   rate, activity rate) is resolved server-side by `api/services/Pricing.php`. A price arriving in a request body
   for one of those items is ignored; only free-text/manual lines (gated to `owner`/`manager`) accept a
   client-supplied amount.
3. **Financial documents are voided, not deleted.** `invoices`, `payments`, `supplier_bills`, `expenses` all carry
   `voided_by` / `voided_at` / `void_reason` and are never `DELETE`d. Masters (`destinations`, `suppliers`, …)
   soft-delete via `is_deleted`.
4. **A booking's GST-vs-cash-bill choice must never mix on one document.** `Invoice::fromBooking()` produces a
   `tax_invoice` with CGST/SGST/IGST computed and `is_gst_applicable = 1`; `Invoice::cashBill()` produces a
   `cash_bill` with every tax column forced to `0.00` and `is_gst_applicable = 0`, drawing its number from a
   distinct `CASH-…` sequence so it can never collide with, or be confused for, a tax invoice number. A single
   invoice row is one or the other, never both, and nothing upgrades one type into the other in place — a
   mistake is voided and reissued as the correct type.

---

## §1 Business context

Quoting the client's call-recording summary directly:

> "The system is envisioned as an internal CRM and Booking Management tool to handle customer inquiries, dynamic
> quote generation, conversion tracking, and comprehensive itinerary creation."

> "Internal Portal Use: strictly an internal administrative tool for the agency's staff; no customer-facing
> login portal required."

This is **one tours & travel agency's own back-office system** — an internal CRM plus booking/ops/finance tool
used by the agency's staff, never by the travelling customer. There is no login screen, quote-viewer, or payment
page intended for the traveller; every screen in `frontend/src/lib/navigation.ts` is behind `ProtectedRoute` and
every backend route is guarded to `staff` (or, for the unrelated B2B sub-agent extension already present in the
schema, `agent`) — nothing is guarded `customer`.

**Roles** (`AuthMiddleware::ROLES`, `api/middleware/AuthMiddleware.php`): `owner`, `manager`, `sales`,
`operations`, `accounts`, `visa`. The bootstrap account created by `php api/install.php` is implicitly `owner`.
Route guards use these exact names — see [SECURITY.md](SECURITY.md) for the full matrix.

---

## §1a Module map

Wires that **exist today** (verified against `api/index.php` and the corresponding model, current session):

```
Lead ── (§2 CRM) ──► Quotation (+ quotation_options toggle set)
                          │  QuotationController::convert()
                          ▼
                      Booking (+ booking_options copied from quotation_options,
                      │        + booking_travel_legs entered by ops)
                      │
                      ├──► Invoice (tax_invoice via Invoice::fromBooking()
                      │              OR cash_bill via Invoice::cashBill() — never both)
                      │        │
                      │        ▼
                      │    Payment (polymorphic ledger, ref_type='invoice'|'booking')
                      │
                      ├──► Supplier Bill ──► Payment (ref_type='supplier_bill') ──► Payable ageing
                      │
                      ├──► Trip Assignment (driver + vehicle) ──► Trip Sheet
                      │
                      └──► Voucher (hotel/transport/activity/tour)
```

The printable itinerary handout PDF — the document that would render `booking_travel_legs` +
`trip_assignments` + `booking_options` into a single guest-facing sheet — is **not yet built** (see R11/T11
below); the data it would read is fully wired.

Rule: **never ship an isolated feature.** A toggle, a leg, or a bill type that has a table and a model but no
route, or a route but no page, is tracked as unfinished below rather than described as done.

---

## §2 Requirement analysis

Each block cites the exact table/column and the endpoint that satisfies it, as verified by reading
`api/index.php`, the relevant controller and model, and `frontend/src/` directly in the current session.

### R1 — CRM funnel (enquiry → quote → conversion Yes/No; dashboard metrics)
*Client §2.* Tables: `leads` (`004_crm.sql`, `status` ENUM `new,contacted,quoted,negotiating,won,lost,dropped`),
`quotations` (`status` ENUM `draft,sent,viewed,revised,accepted,rejected,expired`). Endpoints:
`GET /leads`, `GET /leads/pipeline`, `POST /leads/{id}/status`, `GET /dashboard/sales-funnel`,
`GET /dashboard/overview` (`DashboardController::salesFunnel/overview`). **IMPLEMENTED** — backend complete;
no frontend page exists yet (`frontend/src/pages/` is empty — see §3).

### R2 — Full Package vs Independent/Individual
*Client §3A.* `quotations.quote_type` ENUM `package,custom,hotel_only,transport_only,activity_only,visa_only`
(`009_client_vocab_patch.sql`), mirroring the pre-existing `bookings.booking_type`. Wired into
`QuotationController::store()` (validated, in `Quotation::FILLABLE`) and copied onto the booking at conversion:
`QuotationController::convert()` sets `booking_type = $quote['quote_type'] ?? …`. **IMPLEMENTED.** No frontend
page yet.

### R3 — Transport mode: Flight / Train / Bus / Mixed
*Client §3B.* `quotation_options.transport_mode` / `booking_options.transport_mode` ENUM
`flight,train,bus,mixed,none` (`010_quotation_builder.sql`). Model: `QuotationOption`/`BookingOption`
(`api/models/QuotationOption.php`, `BookingOption.php`). Endpoints: `PUT /quotations/{id}/options`
(`QuotationController::saveOptions`), `PUT /bookings/{id}/options` (`BookingController::saveOptions`).
**IMPLEMENTED** at the API level as of this session — schema, model and route all present and reachable
(`api/index.php` requires both model files and registers both routes). No frontend page yet.

### R4 — Hotel category (incl. 2-Star) + room type picklist
*Client §3C.* `hotels.category` and `package_prices.hotel_category` widened to include `'2star'`
(`009_client_vocab_patch.sql`) alongside the pre-existing `budget,3star,4star,5star,…`. This part is
**IMPLEMENTED and live**: `MasterController::storeHotel/updateHotel` and `PackageController::storePrice` already
read/write `category`/`hotel_category`, and `Pricing::quotePackage()`/`resolvePackagePrice()` already filter by
it — the enum widening alone makes 2-Star hotels and price slabs usable today.

The room-type picklist (Normal/AC/Non-AC/Deluxe/Super Deluxe/Executive/Suite) is a different story:
`hotel_room_types.room_category` ENUM was added in the same migration, and `quotation_options.room_category` /
`booking_options.room_category` exist and are wired through `saveOptions()` on both quotations and bookings
(so the *toggle* half of R4 is implemented, same as R3). But `MasterController::storeRoomType()`
(`api/controllers/MasterController.php:397`) still only accepts `name`, `max_adults`, `max_children`,
`extra_beds` — **`room_category` is not in its `Request::only()` list, so a hotel's own room types can never be
tagged with the picklist value; the column is permanently stuck at its default `'normal'`.** This is a specific,
one-field gap, not a missing feature — see T4.

### R5 — Food/dietary: Included/Excluded status; Veg/Non-Veg/Brahmin/Jain
*Client §3D.* Two places carry this, and they are in two different states:

- `quotation_options.food_included` / `diet_type` ENUM `veg,non_veg,brahmin,jain` and the matching
  `booking_options` columns (`010_quotation_builder.sql`) — **IMPLEMENTED**, wired through `saveOptions()` on
  both quotations and bookings, validated against `in:veg,non_veg,brahmin,jain` in both controllers.
- `booking_pax.meal_preference` ENUM was separately widened to include `'brahmin'`
  (`009_client_vocab_patch.sql`: `none,veg,non_veg,brahmin,jain,vegan,halal`) for the **per-passenger** meal
  preference on the manifest. This is **NOT reachable**: `BookingController::savePax()`
  (`api/controllers/BookingController.php:455`) still validates each passenger's `meal_preference` against the
  old, narrower in-code list `['none','veg','non_veg','jain','vegan','halal']` — **`'brahmin' is missing from
  this allowlist**, so any passenger meal preference sent as `brahmin` is silently coerced to `'none'` before
  the INSERT, even though the database column would happily accept it. One-line fix; flagged as a bug, not a
  missing feature — see T5.

### R6 — Add-on toggles: baggage, local transport, sightseeing, insurance
*Client §3E.* `quotation_options`/`booking_options` columns `baggage_included`, `baggage_notes`,
`local_transport_included`, `sightseeing_included`, `insurance_included` (`010_quotation_builder.sql`).
**IMPLEMENTED** — same `saveOptions()` endpoints as R3/R5, all four toggles plus the baggage free-text note are
in both controllers' validation and both models' `FIELDS` allowlist. No frontend page yet.

### R7 — Auto-population: accepted quote → booking form
*Client §4.* Two layers:
- **Core commercial fields** (customer, agency, package, departure, destination, dates, pax counts, hotel
  category, the whole money block, and the service lines from `quotation_items`) — pre-existing, in
  `QuotationController::convert()`. **IMPLEMENTED.**
- **The toggle set** — the specific thing migration `010`'s own comment promises ("copied wholesale on
  conversion"): `QuotationOption::copyToBooking($id, $bid)` is called inside `QuotationController::convert()`
  (`api/controllers/QuotationController.php:439`), which reads the quote's `quotation_options` row and upserts
  it onto `booking_options` for the new booking. **IMPLEMENTED** as of this session.

### R8 — Travel logistics: actual flight/train/bus numbers, PNR, timings, baggage rules
*Client §4.* `booking_travel_legs` (`011_travel_legs.sql`): `mode`, `carrier_name`, `vehicle_number`, `pnr`,
`seat_class`, `from_location`/`to_location`, `departure_date`/`time`, `arrival_date`/`time`,
`baggage_allowance`, `confirmation_status`. Model `TravelLeg` (`api/models/TravelLeg.php`) with
`forBooking()`, `replaceForBooking()`, `add()`, `updateOne()`, `remove()`, `markConfirmed()` and its own
shape validation (`from_location`/`to_location`/`departure_date` required; arrival can't precede departure).
Endpoints: `GET/PUT/POST /bookings/{id}/travel-legs`, `PUT/DELETE /bookings/{id}/travel-legs/{legId}`,
`POST /bookings/{id}/travel-legs/{legId}/confirm` (all in `BookingController`, guarded
`staff:owner,manager,operations`). **IMPLEMENTED** as of this session — this is the single largest gap-closing
item in the whole pass, and it is now fully wired end to end. No frontend page yet.

### R9 — Driver assignment: local driver name/contact for pickup, drop-off, sightseeing
*Client §4.* Pre-existing scaffolding, unrelated to migrations 009–011: `trip_assignments.driver_id` →
`drivers.full_name`/`phone` (`002_masters.sql`, `007_operations.sql`). `Booking::detail()` already joins
`trip_assignments` with the driver's name and phone. Endpoints: `POST /bookings/{id}/trip-assignments`,
`PUT /trip-assignments/{id}` (`OpsController`). **IMPLEMENTED** — migration `011`'s own comment states this
correctly: "already exist via `trip_assignments` + `drivers`; nothing further needed there," and that holds up
under inspection.

### R10 — Internal-only, no customer-facing login portal
*Client §5.* `users.user_type` ENUM includes `customer` and `agent` values for forward compatibility (a future
B2B sub-agent portal, already partially wired via `AuthMiddleware::agencyScope()`), but **no route in
`api/index.php` is guarded `'customer'`**, and `frontend/src/pages/` contains no customer-facing view of any
kind — the entire frontend is staff sidebar + `ProtectedRoute`. **IMPLEMENTED** (satisfied by absence): the
system does not expose a customer login or self-service surface today.

### R11 — Printable itinerary / handout PDF
*Client §5.* **NOT YET IMPLEMENTED.** No controller method, PDF-generation service, or frontend PDF template
exists anywhere in the repo for compiling `booking_travel_legs` + `booking_options` + `trip_assignments` (driver
name/phone) + booking dates into a single printable/PDF handout. The frontend has `jspdf`/`jspdf-autotable` as
declared dependencies (`frontend/package.json`) but no file under `frontend/src/` calls them for this purpose,
and `frontend/src/pages/` is empty so there is no page to hang a "Print Itinerary" button off yet. The data this
document would read (R8, R9, R6) is now fully wired, which is what makes this the natural next step — see T11.

### R12 — GST tax invoice vs Non-GST cash bill
*Client §5.* `invoices.invoice_type` ENUM widened to include `'cash_bill'`, plus a new
`is_gst_applicable TINYINT(1)` column and a `CASH-…` document-number sequence
(`009_client_vocab_patch.sql`). Model: `Invoice::fromBooking()` (unchanged, tax invoice — CGST/SGST/IGST split
via `Money::splitGst()`) and the new sibling `Invoice::cashBill()` (`api/models/Invoice.php:213`) — every tax
column forced to `0.00`, `is_gst_applicable = 0`, number drawn from the `CASH` sequence, and its own
"already exists" guard scoped to `invoice_type = 'cash_bill'` so a booking can hold one of each type
independently. Controller: `FinanceController::raiseInvoice()` (`POST /bookings/{id}/invoice`, tax invoice only)
and the new sibling `FinanceController::raiseCashBill()` (`POST /bookings/{id}/cash-bill`), both guarded
`staff:owner,manager,accounts`. **IMPLEMENTED** as of this session — this is the `Invoice::fromBooking()` vs
`Invoice::cashBill()` split described in [ARCHITECTURE.md](ARCHITECTURE.md). No frontend page yet, so staff
cannot choose GST-vs-cash from the UI (see T12).

---

## §3 Pending work checklist

Backend items are cited against the live route table (`api/index.php`, 173 routes as of this session) and the
directory `frontend/src/pages/`, which was confirmed **empty** by directory listing (`ls frontend/src/pages/`
returns nothing) — every page below is genuinely absent, not just unlinked.

- [x] **T1** CRM funnel: leads, statuses, follow-ups, pipeline, dashboard sales-funnel metric (R1)
- [x] **T2** Full-package vs Independent quote type, carried to the booking on conversion (R2)
- [x] **T3** Transport-mode toggle on quotation and booking, `saveOptions()` wired end to end (R3)
- [ ] **T4** `MasterController::storeRoomType()` accept and persist `room_category` so a hotel's own room types
      can actually be tagged Normal/AC/Non-AC/Deluxe/Super Deluxe/Executive/Suite (R4) — currently the column
      exists but is permanently `'normal'`
- [ ] **T5** Fix `BookingController::savePax()`'s in-code `meal_preference` allowlist to include `'brahmin'`
      (R5) — one-line change, currently silently downgrades to `'none'`
- [x] **T6** Food-included + diet-type toggle at the quotation/booking-option level (R5, options half)
- [x] **T7** Baggage / local-transport / sightseeing / insurance toggles, quotation + booking (R6)
- [x] **T8** Toggle set copied from quotation to booking on conversion (R7)
- [x] **T9** Actual flight/train/bus number, PNR, timings, baggage-rule capture (`booking_travel_legs`
      CRUD + confirm) (R8)
- [x] **T10** Driver + vehicle assignment surfaced on the booking detail (R9)
- [ ] **T11** Printable itinerary handout PDF — service/endpoint to render travel legs + options + driver
      assignment into a single PDF, plus a "Print Itinerary" action on the booking-detail page (R11)
- [x] **T12** Non-GST cash bill: schema, model (`Invoice::cashBill()`), controller
      (`FinanceController::raiseCashBill()`), route (`POST /bookings/{id}/cash-bill`) (R12)
- [ ] **T13** Frontend: **every page the client's workflow needs is still unbuilt.** Checked directly —
      `frontend/src/pages/` has zero files, while `App.tsx` already imports ~30 page modules by path (they do
      not exist, so `npm run dev`/`npm run build` currently fail on unresolved imports). Specifically missing:
      - [ ] Enquiry (lead) list + detail with follow-up log
      - [ ] Quotation builder with the toggle UI (package type, transport mode, hotel category, room category,
            food/diet, baggage/local-transport/sightseeing/insurance switches)
      - [ ] Booking detail with a travel-legs tab (flight/train/bus number, PNR, timings) and an options tab
      - [ ] "Print Itinerary" / itinerary PDF button on booking detail (blocked on T11)
      - [ ] Invoice page with an explicit GST-tax-invoice-vs-cash-bill choice at raise time
      - [ ] All other pages listed in `frontend/src/App.tsx` (Dashboard, Packages, Suppliers, Ops Board,
            Vouchers, Finance, Reports, Settings, …) — none exist yet
- [ ] **T14** Frontend API client wiring for the new concepts: `frontend/src/lib/api/quotations.ts` and
      `bookings.ts` already carry the `QuotationOptions`/`BookingOptions`/`TravelLeg` TypeScript types and
      `options?`/`travel_legs?` fields on their response interfaces (confirmed by direct read, current
      session), but there is no `payments.ts`/`invoices` support for choosing `cash_bill` vs `tax_invoice` yet,
      and — per T13 — no page consumes any of it.
- [ ] **T15** Frontend test suite: `vitest.config.ts` and `src/test/setup.ts` are wired but only a placeholder
      `smoke.test.ts` exists; no real component or integration tests yet.

---

## §4 Progress log

- **Initial build (this project's inception):** 8 migrations (`001`–`008`), 15 models, 14 controllers, 164
  routes. Backend feature-complete for a generic tours & travel ERP shape (CRM → Quotation → Booking →
  Operations → Invoicing → P&L) modelled on general industry practice, not yet checked against the client's
  actual call-recording requirements.
- **Client-requirements gap-closing pass (current session, 2026-07-25):** three schema patches written and
  applied — `009_client_vocab_patch.sql` (2-Star hotel category, Bus transport mode, Brahmin food, GST/cash-bill
  invoice split, `quote_type`, `room_category`), `010_quotation_builder.sql` (`quotation_options` /
  `booking_options` toggle tables), `011_travel_legs.sql` (`booking_travel_legs`). Over the course of this same
  session the backend was extended **live, by a concurrently-running agent**, from those schema patches through
  to fully wired models (`QuotationOption`, `BookingOption`, `TravelLeg`, `Invoice::cashBill()`), controllers
  (`saveOptions()` on both `QuotationController` and `BookingController`, the travel-legs CRUD set on
  `BookingController`, `FinanceController::raiseCashBill()`), and route registrations — observed going from 164
  routes / 15 models at the start of this documentation pass to **173 routes / 18 models** by the end of it.
  Two small, precise gaps were caught by direct code inspection and are recorded above rather than glossed over
  (T4, T5). This document was written against that final snapshot; **given the pace of concurrent activity, a
  fresh `rg` against `api/index.php` and `frontend/src/pages/` is the authoritative source of truth**, more so
  than usual for a living requirements doc.
- **Frontend:** infrastructure only — API client, auth context, layout shell, shared components, navigation,
  13 typed API modules. Zero pages. This has not changed during the backend gap-closing pass.

---

## §5 Blocked / needs client input

- **"Brahmin food" — confirmed as a dietary tag, not a special meal-prep workflow.** It sits in the same
  `diet_type`/`meal_preference` enum as `veg`/`non_veg`/`jain` throughout the schema (`quotation_options`,
  `booking_options`, `booking_pax`) — a label the kitchen/caterer is told, not a separate approval or
  preparation pipeline with its own states. If the client actually needs Brahmin meals routed through a
  different supplier, sourced from a different kitchen, or costed differently from standard veg, that is a
  new requirement, not a bigger enum — please confirm before building anything beyond the tag.
- **Cash-bill disclaimer text — needs client input.** `Invoice::cashBill()` produces a document with
  `is_gst_applicable = 0` and every tax column zeroed, but carries no printed disclaimer (e.g. "This is not a
  tax invoice; no GST has been charged" / "Input tax credit is not available against this document"). Indian
  practice varies by agency on whether such a line is printed, and in what wording. Needs a client decision
  before the (not-yet-built) invoice PDF template is finalised.
- **Room-type vocabulary — open question on whether the 7 named categories are closed or extensible.**
  `room_category` is an ENUM (`normal,ac,non_ac,deluxe,super_deluxe,executive,suite,other`) with an `'other'`
  escape hatch, matching the 7 terms the client named plus one catch-all. If the agency's actual hotel
  contracts use additional named categories (e.g. "Premium", "Club", "Villa") often enough that `'other'` free
  text becomes unworkable, the enum should be widened — confirm with the client which vocabulary their supplier
  contracts actually use before assuming these 7 are exhaustive.
- **Local transport / sightseeing / insurance toggles — informational only, or do they need their own cost
  line?** Today `local_transport_included`, `sightseeing_included`, `insurance_included` on
  `quotation_options`/`booking_options` are booleans with no associated amount — they say *whether* something
  is included, not *what it costs*. The actual costed line, if any, has to be entered separately as a
  `booking_services`/`quotation_items` row of the matching `service_type`. If the client expects toggling
  "Insurance: Included" to auto-generate a costed line (the way `Pricing::quotePackage()` already auto-generates
  package price-slab lines), that is unbuilt and needs a decision on the default cost source (a flat per-pax
  rate? a supplier rate card, the way hotels and activities already have one?) before it can be designed.

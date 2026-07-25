# Tours & Travels ERP — Build Status Report

_Last verified: 2026-07-26, by direct file/DB/route inspection (not agent self-report)._

This file exists so a remote/scheduled job can pick up exactly where the build left off. Read the "Not Completed" section first — that's the actionable list.

---

## ✅ Completed (verified)

### Backend (100%)
- PHP 8.1+/8.3, no-Composer architecture, PDO prepared statements, `Database` insert/update allowlists.
- **11 migrations** in `api/migrations/`, all applied — including the client-vocab patch (2-star hotels, bus/train service types, brahmin diet, cash-bill invoice type) and the new `quotation_options` / `booking_options` / `booking_travel_legs` tables.
- **173 routes** registered in `api/index.php`, guard-checked via `AuthMiddleware`.
- All controllers/models for the client's new requirements are in and working:
  - `QuotationOption`, `BookingOption`, `TravelLeg` models
  - Quotation/Booking `saveOptions()`, travel-leg CRUD (`travelLegs/addTravelLeg/updateTravelLeg/removeTravelLeg/confirmTravelLeg`)
  - `Invoice::cashBill()` + `FinanceController::raiseCashBill()` (Non-GST cash bill path, separate `CASH` number sequence)
  - `DashboardController::salesFunnel()` returns the client's 4 named funnel metrics (`total_inquiries`, `total_quotes_dispatched`, `pending_response`, `conversions`)
- Two real bugs found and fixed:
  - `BookingController::savePax()` — `meal_preference` validation was missing `'brahmin'`
  - `MasterController::storeRoomType()` — didn't accept/save `room_category`
- `php -l` clean across the tree; `php api/tests/run_all.php` — **110/110 passing** (30 authorization + 80 money/business-rule checks).

### PDF engine (100%)
`frontend/src/lib/pdf/` — `fonts.ts, companyProfile.ts, saveFilename.ts, theme.ts, itinerary.ts, invoice.ts, voucher.ts, index.ts`. Fully self-contained (no dependency on app types still being built by other agents). `tsc` clean within this directory.

### Docs (100%)
`REQUIREMENTS.md`, `ARCHITECTURE.md`, `SECURITY.md`, `docs/API.md`, `docs/DATA_MODEL.md`, `docs/OPERATIONS_GUIDE.md`, `docs/REFERENCE_STACK_ANALYSIS.md` — all written and cross-checked against live code.

### Frontend — API modules (30/30 present)
All files in `frontend/src/lib/api/` exist, including `quotationOptions.ts`, `bookingOptions.ts`, `travelLegs.ts`, `finance.ts`, `invoices.ts`, `expenses.ts`, `payments.ts`, `supplierBills.ts`, `users.ts`, `reports.ts`, `settings.ts`, `queries.ts` (shared React Query key factory).

### Frontend — Sales/CRM & Catalog/Ops pages (23/37 present)
`Login, Dashboard, Leads, LeadDetail, Quotations, QuotationDetail, Bookings, BookingDetail, Customers, CustomerDetail, Packages, PackageDetail, Departures, Destinations, Activities, Suppliers, SupplierDetail, Hotels, Fleet, OpsBoard, TripAssignments, Vouchers, Incidents, NotFound` — all built, all routed in `App.tsx`.

### Visual design decision (recorded, not yet actioned — see below)
User wants tours-travel-erp's frontend to visually match this inventory repo's actual design (colors, sidebar, layout), not just share the shadcn/ui architecture with an independent teal theme. This is a **design correction still pending**, tracked below.

---

## ❌ Not Completed — action items for the next run

### 1. Fix `frontend/src/lib/api/settings.ts` — blocks the entire build
**Confirmed still broken** (checked 2026-07-26). Line 78:
```ts
/** Arbitrary company_*/bank_*/default_*/seq_* keys, or the small named allowlist. */
```
The literal text `company_*/` inside the comment closes the JSDoc block early (`*/`), so everything after it (`bank_*/default_*/seq_* keys...`) becomes invalid top-level syntax, followed by more stray `*/` tokens. **This breaks `tsc` for the whole project.** Fix: rewrite the comment to not contain a literal `*/` sequence, e.g.:
```ts
/** Arbitrary company_, bank_, default_, seq_ prefixed keys, or the small named allowlist. */
```

### 2. Build the 14 missing Finance/Admin/Reports pages
Already imported and routed in `App.tsx` (lines 45–58, 136–204) — the app **cannot type-check or build** until these exist:

| # | Page | Notes |
|---|------|-------|
| 1 | `Invoices.tsx` | List + filters, GST vs Cash Bill badge |
| 2 | `InvoiceDetail.tsx` | Must wire up `downloadInvoicePdf` (dynamic import from `lib/pdf`) |
| 3 | `Payments.tsx` | Polymorphic payment ledger UI |
| 4 | `SupplierBills.tsx` | |
| 5 | `Expenses.tsx` | |
| 6 | `Receivables.tsx` | |
| 7 | `Payables.tsx` | |
| 8 | `ProfitLoss.tsx` | |
| 9 | `Reports.tsx` | |
| 10 | `Users.tsx` | Admin — user/role management |
| 11 | `CompanySettings.tsx` | Company profile/letterhead/GSTIN — feeds PDF header |
| 12 | `NumberingSettings.tsx` | Reads `NumberSequence::summary()` |
| 13 | `AuditLog.tsx` | |

All should follow the same conventions as the 23 completed pages: `DataTable`, `PageHeader`, `FormField`, `StatusBadge`, `MoneyText`, TanStack Query via the `qk.*` key factory in `lib/api/queries.ts`, react-hook-form + zod.

### 3. Apply the same-visual-design correction
Once pages are complete, port this inventory repo's actual CSS variable values (`frontend/src/index.css`, light + dark) and mirror `AppSidebar.tsx` / `DashboardLayout.tsx` / `TopNavbar.tsx` structure from:
`/home/karthikeyan/vscode/api-EcoSudar/clone/inventory/frontend/src/`
into tours-travel-erp, replacing its independently-invented teal theme. Do **not** just swap colors — check component structure too (tours-travel-erp's `AppSidebar.tsx` is a from-scratch reimplementation, not the same component).

### 4. Full verification pass (not yet run)
- `npm install` in `frontend/`
- `npx tsc --noEmit` across the whole frontend (will fail until items 1 & 2 above are done)
- Dev-server smoke test: log in, walk Sales→Quotation→Booking→Invoice→Payment happy path, confirm PDF downloads work
- Re-run `php api/tests/run_all.php` as a final backend sanity check (should still be 110/110 — nothing here should have touched it)

### 5. Not yet started
- No git repo has been initialized for tours-travel-erp yet (`git status` returns "not a git repository").

---

## Suggested next-run order
1. Fix `settings.ts` (1-line fix, unblocks everything).
2. Build the 13 missing pages, batched by domain (Finance: 1–8, Admin: 10–13, Reports: 9) — can be parallelized across agents same as before, but give each a disjoint file list to avoid collisions (lesson from the previous run).
3. Apply the visual-design port (item 3).
4. Run full verification pass (item 4).
5. Consider `git init` + first commit once the build is green.

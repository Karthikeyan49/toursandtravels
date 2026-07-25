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

### 2. Build the 13 missing Finance/Admin/Reports pages
Already imported and routed in `App.tsx` (lines 45–58, 136–207) — the app **cannot type-check or build** until these exist. All API contracts below are copied from the already-built, already-correct `lib/api/*.ts` modules — do not re-derive shapes, just consume them. Every page follows the same conventions as the 23 completed pages: `DataTable`, `PageHeader`, `FormField`, `StatusBadge`, `MoneyText`, TanStack Query via the `qk.*` key factory in `lib/api/queries.ts`, react-hook-form + zod for forms. Route guards (`<Guarded permission="...">`) are already wired in `App.tsx` — do not re-implement gating inside the page.

#### Finance batch (routes `/invoices`, `/invoices/:id`, `/payments`, `/supplier-bills`, `/expenses`, `/receivables`, `/payables`, `/profit-loss`)

**1. `Invoices.tsx`** — route `/invoices`, no permission guard (all staff can view).
- Data: `listInvoices(filters)` from `lib/api/invoices.ts` → paginated `InvoiceListItem[]`. Filters available server-side: `status`, `payment_status`, `customer_id`, `booking_id`, `from`/`to`, `overdue`, `search`, `sort`/`dir`. **`invoice_type` is NOT a server filter** — fetch normally, then filter the returned page client-side if the user picks a type tab (GST / Cash Bill / All).
- Table columns: invoice_no, customer_name, booking_no, invoice_type (badge: tax_invoice vs cash_bill — cash bill must visually read as "Non-GST"), invoice_date, grand_total (`MoneyText`), outstanding, payment_status (`StatusBadge`), days_overdue.
- Row click → `/invoices/:id`.
- No create-from-scratch action here — invoices are raised from a booking (see BookingDetail, already built) via `raiseInvoice()`/`raiseCashBill()`.

**2. `InvoiceDetail.tsx`** — route `/invoices/:id`.
- Data: `getInvoice(id)` → `InvoiceDetail` (includes `items[]`, `payments[]`, `company: CompanyProfile`, `amount_in_words`).
- Sections: header (invoice_no, type, status, dates), customer block, line items table (`InvoiceItem[]`: description, sac_code, quantity, unit_price, discount_pct, taxable_value, gst_pct, gst_amount, line_total), tax summary (cgst/sgst/igst/tcs/round_off/grand_total — **hide the entire GST block when `is_gst_applicable` is falsy**, i.e. for a cash bill), amount_in_words, payments list (reuse whatever payment-row rendering `BookingDetail.tsx` already uses for its ledger), notes/terms.
- Actions: "Download PDF" → dynamic `import("@/lib/pdf")` then call the invoice PDF builder with this record (mirror exactly how `BookingDetail.tsx` already dynamic-imports for the itinerary PDF — same pattern, do not invent a new one). "Record Payment" → dialog calling `recordInvoicePayment(id, input)` (fields: amount, mode, utr_no, bank_account, paid_on, remarks — gate the reference fields with `requiresReference()` if reusing the payments module's mode list, but note invoices uses its own untyped `mode?: string`). "Void" → `voidInvoice(id, reason)`, reason required, confirm dialog.
- Invalidate `qk.invoices.detail(id)` and `qk.invoices.list()` after payment/void.

**3. `Payments.tsx`** — route `/payments`. This is the **daybook**, not a per-booking ledger (that already exists inside `BookingDetail.tsx` via `getBookingLedger`).
- Data: `getDaybook({ from, to, mode })` from `lib/api/payments.ts` → `Daybook` with `entries: DaybookEntry[]` and `summary` (total_in, total_out, net, by_mode breakdown).
- UI: date-range filter + mode filter, a totals strip (total in / total out / net, and a small by-mode breakdown chip row), then a table of `DaybookEntry` (payment_no, ref_type + ref_no as a linkable label — link to the booking/invoice/bill it settles if you can resolve the route from `ref_type`, direction as in/out badge, amount, mode, paid_on, remarks, recorded_by).
- Row action: if `status === 'scheduled'` show nothing here (daybook is paid entries) — this is a read/export screen, not where instalments get scheduled (that's inside Booking/Invoice detail).
- "Export CSV" is out of scope unless you also wire a `reports.ts`-style export for this endpoint — skip it, this endpoint has no CSV mode; don't add one speculatively.

**4. `SupplierBills.tsx`** — route `/supplier-bills`, guard `permission="view_costs"` (already applied in `App.tsx`, don't duplicate).
- Data: `listSupplierBills(filters)` → `SupplierBillListItem[]`. Filters: supplier_id, booking_id, payment_status, due_only, from/to, search, sort/dir.
- Table: bill_no, supplier_name, supplier_type, booking_no, bill_date, due_date, grand_total, outstanding, payment_status, days_overdue.
- Create dialog/drawer: `createSupplierBill(input)` — `SupplierBillInput` requires `supplier_id`, `bill_date`, `items: SupplierBillItemInput[]` (description, unit_cost, quantity, tax_pct, optional booking_service_id); optional supplier_ref_no, booking_id, due_date, tds_amount, notes. Bill starts as `draft`.
- Row actions: `approveSupplierBill(id)` (only valid from `draft`), then `paySupplierBill(id, input)` once approved. No delete — void is not exposed on this module (there's no `voidSupplierBill` export), so don't add a void button that calls a non-existent endpoint.
- Detail can be a drawer/dialog using `getSupplierBill(id)` rather than a separate route (no `/supplier-bills/:id` is registered in `App.tsx` — keep it in-page).

**5. `Expenses.tsx`** — route `/expenses`, guard `permission="view_costs"`.
- Data: `listExpenses(filters)` → `ExpenseListItem[]`; also `getExpenseSummary(filters)` for a totals/by-category header strip, and `listExpenseCategories()` to populate the category picker (returns usage-ranked categories, not a fixed enum).
- Table: expense_no, expense_date, category/subcategory, description, booking_no (if attached), supplier_name (if attached), amount, tax_amount, total_amount (`MoneyText`), mode, status (`StatusBadge`), is_reimbursable flag, attachment_count.
- Create: `createExpense(input)` — `ExpenseInput` requires expense_date, category, description, amount; optional subcategory, booking_id, supplier_id, tax_amount, mode, paid_by, is_reimbursable, status (draft|submitted only).
- Edit: `updateExpense(id, input)` — only while status is in `EXPENSE_EDITABLE_STATUSES` (draft/submitted/rejected); disable the edit action otherwise.
- Row actions by status: `submitExpense`, `approveExpense`, `rejectExpense(id, reason)`, `markExpensePaid(id, paidOn?)`, `voidExpense(id, reason)`.
- Detail can be a drawer using `getExpenseDetail`-equivalent (`getExpense(id)` → `ExpenseDetail`, includes `attachments[]` and `payments[]`) — no separate route registered, keep in-page like SupplierBills.

**6. `Receivables.tsx`** — route `/receivables`, no guard.
- Data: `getReceivables()` from `lib/api/finance.ts` → `{ customers: ReceivableRow[], totals }`. No filters, no pagination — it's a full roll-up, render as-is.
- Table: customer_name, phone, booking_count, outstanding, next_departure, due_within_7_days — sort client-side (e.g. by outstanding desc) since the API returns the full set unsorted-by-param.
- Totals strip at top: `totals.outstanding`, `totals.due_within_7_days`.
- Row click → `/customers/:id` (CustomerDetail already exists).

**7. `Payables.tsx`** — route `/payables`, guard `permission="view_costs"`.
- Data: `getPayables()` → `{ suppliers: PayableRow[], totals }`. Same shape as Receivables: no filters/pagination, full roll-up.
- Table: supplier_name, supplier_type, bill_count, outstanding, ageing buckets (not_due, days_1_30, days_31_60, days_60_plus) as separate columns — this is the one screen that should render an ageing-bucket table, matching the shape the API already computed.
- Totals strip mirroring the bucket columns.
- Row click → `/suppliers/:id` (SupplierDetail already exists).

**8. `ProfitLoss.tsx`** — route `/profit-loss`, guard `permission="view_margins"`.
- Data: `getProfitAndLoss({ from, to })` from `lib/api/finance.ts` → `ProfitAndLoss`.
- Layout: a from/to period picker, then a stacked P&L statement — Revenue → COGS breakdown (supplier_bills, direct_expenses, agent_commission, total) → Gross Profit (+ gross_margin_pct) → Overheads (`overheads: ProfitAndLossOverheadLine[]`, list each category/amount) → overhead_total → Net Profit (+ net_margin_pct) → revenue_per_pax as a footer stat alongside booking_count/pax.
- This is a read-only statement screen — no mutations, no table/DataTable needed, just a formatted financial statement layout (use `MoneyText` throughout).

#### Reports (route `/reports`)

**9. `Reports.tsx`** — route `/reports`, no guard (all staff can view reports; individual figures inside may still be sensitive but the API doesn't gate the endpoint).
- This is a **hub with 6 sub-reports** from `lib/api/reports.ts`, likely tabs or a left-nav within the page (no separate routes are registered for individual reports — everything lives under `/reports`):
  1. **Sales** — `getSalesReport({ from, to, group_by, date_basis, destination_id, package_id, owner_id })`. `group_by` is one of `SALES_GROUP_BY` (period/travel_month/destination/package/staff/source/agency/booking_type) — expose as a dropdown. Table of `SalesReportRow` + `totals`.
  2. **Margin** — `getMarginReport({ from, to, loss_making, destination_id, package_id, owner_id })`. Table of `MarginReportRow`, highlight rows where `is_estimated` is true (cost not finalized) and where `margin < 0`. `loss_making` toggle filters to losses only.
  3. **Supplier performance** — `getSupplierPerformanceReport({ from, to, supplier_type, destination_id })`. Table of `SupplierPerformanceRow` — surface `on_time_pct` and `incident_rate_pct` prominently, these are the two headline KPIs per the requirements doc.
  4. **Pax manifest** — `getPaxManifest(departureId)` — **needs a departure picker first** (reuse whatever departure-select component `Departures.tsx`/`PackageDetail.tsx` already has) since it's the one report keyed by a single ID, not a date range. Renders `PaxManifest.pax[]` as a passenger roster with document_ok flagging (passport/visa expiry issues).
  5. **Outstanding** — `getOutstandingReport({ customer_id, owner_id, overdue_only })`. Two tables: `rows: OutstandingBookingRow[]` bucketed by `bucket` (departed/due_now/due_30/later — render as tabs or colored sections) and `invoices: OutstandingInvoiceRow[]`.
  6. **Lead source ROI** — `getLeadSourceRoiReport({ from, to })`. Table of `LeadSourceRoiRow`, note `roi_pct`/`cost_per_acquisition` can be `null` (spend not attributed) — render as "—" not "0%".
- Every sub-report needs an **Export CSV** button wired to `exportReportCsv(slug, params)` — it returns a `Blob`; trigger a download via an object URL (same params as the on-screen query, plus the function already appends `format=csv`). Do not build a second CSV renderer client-side — the export is a real server endpoint.

#### Admin/Settings batch (routes `/settings/users`, `/settings/company`, `/settings/numbering`, `/settings/audit`)

**10. `Users.tsx`** — route `/settings/users`, guard `permission="manage_users"`.
- Data: `listUsers(filters)` → `StaffUser[]`. Filters: user_type, staff_role, is_active, search.
- Table: full_name, email, phone, user_type, staff_role, is_active (toggle-styled badge), last_login_at.
- Create: `createUser(input)` → returns `UserCredentialResult` with `temporary_password` — **display this exactly once in a dismissible dialog, do not store it in any client state beyond that dialog's lifetime, do not log it.**
- Edit: `updateUser(id, input)` (full_name, email, phone, staff_role, agency_id, is_active).
- Row actions: `deactivateUser(id)` / `activateUser(id)`; `resetUserPassword(id, password?)` — same one-time-display rule as create.
- `staff_role` options come from `StaffRole` in `lib/constants` — read that file for the actual enum values before building the picker (don't guess role names).

**11. `CompanySettings.tsx`** — route `/settings/company`, guard `permission="manage_settings"`.
- Data: `getSettings()` → `SettingsResponse` (use `.company: CompanyProfile` for this form; `.settings`/`.map` also available if this page doubles as the general settings screen — check whether `NumberingSettings.tsx` is meant to be the only other settings screen, in which case this page owns everything else: company profile + bank + any remaining `map` keys not covered by numbering).
- Form fields: name, legal_name, address, city, state, pincode, phone, email, website, gstin, pan, logo (file/path — check `FileStore` service for the upload convention already used elsewhere, e.g. avatar_path on users), primary_color, iata_number, and the nested `bank: CompanyBank` (name, account_name, account_no, ifsc, upi_id).
- Save: `updateSettings(input)` — **the key space is closed server-side**; only keys that already exist can change (`ignored: string[]` comes back for anything else) — surface `ignored` to the user as a warning if non-empty rather than silently dropping it.
- This form directly feeds the PDF letterhead (`companyProfile.ts` in the PDF engine) — get the field list exactly right, no placeholder/mock fields.

**12. `NumberingSettings.tsx`** — route `/settings/numbering`, guard `permission="manage_settings"`.
- Data: `getNumberingSettings()` → `NumberingSeries[]` (doc_type, prefix, policy, padding, next — one row per entry in `NumberSequence::DOCUMENTS`, 15 doc types: LEAD/QTN/BKG/INV/CASH/PAY/VCH/SB/EXP/COM/PKG/CUS/SUP/AGY/TRP).
- This is **read-only in the current API contract** — `settings.ts` only exports `getNumberingSettings`, there is no `updateNumberingSettings`/similar. Build this as a display table (doc_type, prefix, policy badge, padding, next-preview) unless a write endpoint gets added; do not invent a PUT call the backend doesn't have. If editable prefixes/padding are actually required by the client doc, that's a **backend gap**, not a frontend one — flag it back rather than faking a save button.

**13. `AuditLog.tsx`** — route `/settings/audit`, guard `permission="manage_settings"`.
- Data: `listAuditLog(filters)` → paginated `AuditLogEntry[]`. Filters: entity_type, entity_id, user_id, action, from/to, search.
- Table: created_at, actor_name (+ actor_role badge), action, entity_type + entity_id (linkable if you can map entity_type to a route, e.g. "booking" → `/bookings/:id` — optional nicety, skip if the mapping isn't 1:1 obvious), a short diff summary.
- Row expand/detail: use `parseAuditValue(old_value)` / `parseAuditValue(new_value)` (already exported by the module — do not re-implement JSON parsing) to render a before/after key-value diff. Both can be `null` for very old rows — guard for that, don't assume shape.

All 13 pages: wrap list queries with the existing `DataTable` pagination props (see any completed page, e.g. `Bookings.tsx`, for the exact prop contract), use `qk.<resource>.*` from `queries.ts` for all query keys, and invalidate the right keys after every mutation (check `queries.ts` for the exact key-factory shape per resource before wiring `onSuccess`).

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

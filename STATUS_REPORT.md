# Tours & Travels ERP — Build Status Report

_Last verified: 2026-07-25, by running the stack — MariaDB 10.11 + PHP 8.4 built-in server + Vite dev server — and driving it with a real browser. Not by agent self-report._

This file exists so a remote/scheduled job can pick up exactly where the build left off. Read the "Not Completed" section first — that's the actionable list.

**The frontend build is green and the happy path works end to end.** What remains is one blocked task (needs a file that isn't in this repo) and two backend gaps found during verification — one of which is a money bug that makes a shipped screen report the wrong number.

---

## ✅ Completed (verified)

### Backend
- PHP 8.1+/8.3 (tested on 8.4), no-Composer architecture, PDO prepared statements, `Database` insert/update allowlists.
- **11 migrations** in `api/migrations/`, all applied against a live MariaDB 10.11 — `php api/install.php` completes and reports **59 tables checked, 0 missing**.
- **173 routes** registered in `api/index.php`, guard-checked via `AuthMiddleware`.
- All controllers/models for the client's requirements are in and working (quotation/booking options, travel legs, cash bill, sales funnel).
- `php api/tests/run_all.php` — **2/2 suites pass** (30 authorization checks across all 173 routes + the money/business-rule suite).

### Frontend — complete
- **All 37 pages exist and are routed.** The 13 that were missing (Invoices, InvoiceDetail, Payments, SupplierBills, Expenses, Receivables, Payables, ProfitLoss, Reports, Users, CompanySettings, NumberingSettings, AuditLog) are built.
- `npm run typecheck` — **zero errors across the whole project**.
- `npm run lint` — **0 errors** (12 pre-existing `react-refresh` / `consistent-type-imports` warnings, unchanged baseline).
- `npm run build` — **succeeds**, 9s, code-split per route.
- `npm test` — **13/13 passing**.

### PDF engine
`frontend/src/lib/pdf/` — verified live, not just type-checked: clicking "Download PDF" on `/invoices/1` in a real browser produces `Invoice_INV-2026-27-0001.pdf`, 12 010 bytes, valid `%PDF-` header.

### Verification actually performed this run
- **API happy path**, driven with real HTTP calls: login → create destination → customer → lead → quotation → price items → send → accept → convert to booking → confirm → raise invoice → record ₹10 000 receipt. Every step returned 2xx. GST maths checks out: ₹38 000 taxable → CGST ₹950 + SGST ₹950 → grand total ₹39 900 → outstanding ₹29 900 after the receipt, `payment_status: partially_paid`.
- **Every endpoint the 13 new pages read** returns 200: invoices, daybook, supplier-bills, expenses (+ summary + categories), receivables, payables, `/finance/pl`, all six reports, users, settings, numbering, audit-log, dashboard overview and sales funnel.
- **All 13 new pages driven in headless Chromium** against that live backend, logged in through the real login form. Every page renders with **no console errors, no pageerrors, no error boundaries**; all six Reports tabs open clean.

### Docs
`REQUIREMENTS.md`, `ARCHITECTURE.md`, `SECURITY.md`, `docs/*` — written and cross-checked against live code.

---

## ❌ Not Completed — action items for the next run

### 1. `bookings.amount_paid` ignores invoice receipts — Receivables reports the wrong number

**This is a live money bug, found by running the happy path.** Reproduced end to end:

| Screen | Shows |
|---|---|
| `GET /invoices/1` | outstanding **₹29 900** ✅ (₹39 900 − ₹10 000 receipt) |
| `GET /finance/receivables` | outstanding **₹39 900** ❌ |
| `GET /bookings/1/payments` | received **₹0**, outstanding **₹39 900** ❌ |

Cause: `FinanceController::recordInvoicePayment()` writes the payment with `ref_type = 'invoice'` and then calls only `Invoice::refreshPaymentStatus()`. `Booking::refreshPaymentStatus()` (`api/models/Booking.php:308`) sums **only** `ref_type = 'booking'` rows, so `bookings.amount_paid` never moves. Everything keyed on `b.grand_total - b.amount_paid` is then overstated:

- `/finance/receivables` → the **Receivables** page
- `/reports/outstanding` → the **Outstanding** report tab
- `Booking::outstanding` → the outstanding column on Bookings and BookingDetail
- the booking's `payment_status`, which stays `unpaid` even after its invoice is paid in full

`InvoiceDetail`'s "Record Payment" button — built to spec — is exactly the path that triggers this, so the more the invoice screen is used, the more overstated receivables become.

**Not fixed here deliberately.** The fix changes money roll-up semantics (probably: have `Booking::refreshPaymentStatus` also sum payments against invoices belonging to that booking, and call it from `recordInvoicePayment`), and if any deployment already records both a booking-level advance *and* an invoice receipt for the same money, a naive roll-up would double-count. That's an owner decision, not one to make unattended. The money suite in `api/tests/` should grow a case for it either way.

### 2. Numbering prefixes are writable in the model but reachable from no endpoint
`seq_` is in `WRITABLE_SETTING_PREFIXES`, so the settings model will accept a prefix change, but no route exposes it — `settings.ts` exports only `getNumberingSettings`. `NumberingSettings.tsx` is therefore built read-only, which matches the current contract honestly. If the client needs editable prefixes/padding, that's a **backend endpoint to add**, then a small frontend change — not a frontend gap.

### 3. Visual-design port — **blocked, source not in this repo**
The recorded decision was to port CSS variables and mirror `AppSidebar.tsx` / `DashboardLayout.tsx` / `TopNavbar.tsx` from:
`/home/karthikeyan/vscode/api-EcoSudar/clone/inventory/frontend/src/`

That is a path on the original author's workstation. It does not exist in this repository or in any checkout available to a remote/scheduled run, and the inventory project is not a git source here. **Nothing was invented in its place** — the existing teal theme is untouched, because guessing at "the inventory repo's design" would produce a third design rather than the intended match.

To unblock, one of: add the inventory repo as a second source for the session, commit the relevant files (`index.css` plus the three layout components) into this repo, or paste the CSS variable block into an issue.

### 4. Deployment smoke test on real shared hosting
Everything above was verified against PHP's built-in server and the Vite dev server. `deploy.sh` and the `api/.htaccess` rewrite/hardening rules have **not** been exercised against a real Apache + mod_rewrite host, and those rules are what route `/api/*` in production.

---

## Fixed during this run

- **`settings.ts` unterminated JSDoc** — the literal `company_*/` inside a doc comment closed the block early and broke `tsc` for the entire project. (Was item 1.)
- **`001_core.sql` used the reserved word `row_number` unquoted** — install failed outright on MySQL 8.0+ and MariaDB 10.2+ with a syntax error at `import_job_rows`. Now backticked. This means the previous report's "11 migrations, all applied" could not have been true against any modern MySQL/MariaDB.
- **`PackageDetail extends Package` was structurally impossible** — `Package::detail()` overwrites the numeric `days` column with the itinerary rows, so the interface now narrows `Omit<Package, "days">`.
- **`Packages.tsx` scope filter was unreachable** — the state and the `PackageFilters` wiring existed but no control ever set it.
- **`Vouchers.tsx` cancel handler** returned `Promise<VoucherDetail>` where `ConfirmDialog#onConfirm` expects `void | Promise<void>`.
- **`qk.reports.outstanding`** was the one key in `qk.reports` that was a fixed array while its endpoint takes filters — one filter's rows could be served for another. Now a factory like its five siblings.
- 14 further dead imports/locals across 11 files that `noUnusedLocals` rejected.

## Known-inert, worth knowing

- `FinanceController::supplierBills` ignores `sort`/`dir` and always orders by due date. `SupplierBills.tsx` wires the sort state through as specified, so sortable headers there are inert until the backend honours it.
- There is no shared `DepartureSelect` component. The Reports pax-manifest picker mirrors the `Departures.tsx` pattern; it is the natural first caller if one is ever extracted.
- `Hotels.tsx` imported `archiveHotel` but never wired an archive action. The unused import was removed; the archive feature itself was never built.

---

## Suggested next-run order
1. Decide and implement the invoice→booking payment roll-up (item 1), with a money-suite test.
2. Unblock the design port by making the inventory source reachable (item 3).
3. Add the numbering write endpoint if the client needs editable prefixes (item 2).
4. Exercise `deploy.sh` against a real Apache host (item 4).

## Running it locally
```bash
mariadb -e "CREATE DATABASE tours_erp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
cp .env.example .env            # then set DB_USER / DB_PASS
ADMIN_PASSWORD='...' php api/install.php --email=you@example.com --name="Owner"
./scripts/dev.sh                # API on :8000, SPA on :8080
```
Note: MariaDB's `root` uses `unix_socket` auth, so `DB_USER=root` with an empty password fails over TCP — create a dedicated user and grant it `tours_erp.*`.

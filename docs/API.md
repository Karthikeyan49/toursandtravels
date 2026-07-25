# API Reference

Generated directly from `api/index.php` (173 routes, current session). Base path in production is whatever
`deploy.sh` mounts the bridge at; in development the SPA calls `/api/*` and `vite.config.ts` proxies to
`http://localhost:8000` with the prefix stripped, so paths below are written without the `/api` prefix — exactly
as `Request::path()` sees them server-side.

For the authorization model itself (what each guard string means, the role matrix, rate limits), see
[SECURITY.md](../SECURITY.md). For request/response field shapes of each resource, see
[DATA_MODEL.md](DATA_MODEL.md).

---

## Envelope

Every response, success or failure, is exactly this shape (`api/core/Response.php`):

```json
{ "success": true, "data": { }, "message": "optional", "pagination": { "optional": "list endpoints only" } }
```

```json
{ "success": false, "message": "human-readable", "errors": { "field": ["optional, 422 only"] } }
```

### Pagination object

Present on every list endpoint (`Response::paginated()`):

```json
{ "page": 1, "limit": 50, "total": 213, "total_pages": 5 }
```

`page`/`limit` are read from `?page=&limit=`, defaulting to 1/50, hard-capped at 200 (`Request::pagination()`)
so a client cannot request the whole table in one call.

### Error shapes by status

| Status | Meaning | Body shape |
|---|---|---|
| 400 | Malformed request (e.g. `changeStatus` called with `status=cancelled`, which has its own endpoint) | `{success:false, message}` |
| 401 | No/invalid/expired bearer token, or a rejected *existing* session (frontend then clears the session and fires `tt:auth-expired`) | `{success:false, message:"Authentication required"}` |
| 403 | Authenticated, but role/user_type does not satisfy the guard | `{success:false, message:"Your role does not permit this action"}` |
| 404 | Route not registered for this method, or entity not found (`NotFoundException`) | `{success:false, message}` |
| 405 | Path matches a different HTTP method | `{success:false, message:"Method not allowed"}`, `Allow:` header set |
| 409 | Business-rule violation (`BusinessRuleException`) — e.g. "no price slab configured," "invoice already exists" | `{success:false, message}` |
| 415 | POST/PUT/PATCH with an unsupported or missing `Content-Type` on a body-bearing request | `{success:false, message}` |
| 422 | Field validation failure (`ValidationException`) | `{success:false, message, errors:{field:[msg]}}` |
| 423 | Account locked after repeated failed logins | `{success:false, message}` |
| 429 | Rate limit exceeded | `{success:false, message}`, `Retry-After`, `X-RateLimit-*` headers |
| 500 | Uncaught exception — message is generic in production, the real message only outside it | `{success:false, message:"Internal server error"}` |
| 503 | Database connection failed | `{success:false, message:"Database connection failed"}` |

### Auth flow

1. `POST /auth/login` `{identifier, password}` → `{user, token, refresh_token, expires_at (epoch ms), must_change_password}`.
2. Every subsequent call: `Authorization: Bearer <token>`, plus `X-Client-Type: web|mobile` (governs token TTL).
3. `POST /auth/refresh` `{refresh_token}` → new pair; the presented refresh token is revoked in the same
   statement it is validated, so a stolen copy is single-use.
4. `POST /auth/logout` denylists the access token's `jti` (until its natural expiry) and revokes the refresh
   token immediately.
5. Access tokens: 1 day (web) / 30 days (mobile). Refresh tokens: 7 days (web) / 180 days (mobile).

### Rate limits

DB-backed, per IP (`api/config/app.php` → `security.rate_limits`):

| Bucket | Limit | Applies to |
|---|---|---|
| `login` | 5 / 15 min | `POST /auth/login` |
| `reset` | 5 / 60 min | `POST /auth/forgot-password`, `POST /auth/reset-password` |
| `general` | 300 / 60 s | everything else |

A limiter failure (e.g. the `rate_limits` table is locked) fails **open** — logged, not blocking — so a
rate-limiter outage never takes down the whole API.

---

## Authentication — `AuthController`

| Method | Path | Guard | Purpose |
|---|---|---|---|
| POST | `/auth/login` | public | Sign in, returns session |
| POST | `/auth/refresh` | public | Rotate refresh token for a new pair |
| POST | `/auth/forgot-password` | public | Always returns the same message whether or not the account exists |
| POST | `/auth/reset-password` | public | Consume a 15-minute reset token |
| GET | `/auth/me` | any authed | Current user + `permissions` capability flags |
| POST | `/auth/logout` | any authed | Revoke access + refresh token |
| POST | `/auth/change-password` | any authed | Requires current password |

## Notifications — `NotificationController`

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/notifications` | any authed | `?unread=1` filter |
| GET | `/notifications/unread-count` | any authed | Badge count |
| POST | `/notifications/read-all` | any authed | Mark all read |
| POST | `/notifications/{id}/read` | any authed | Mark one read |

## Dashboard — `DashboardController`

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/dashboard/overview` | staff | Headline KPIs |
| GET | `/dashboard/sales-funnel` | staff | Inquiries → quotes → pending → conversions (client §2 requirement) |
| GET | `/dashboard/my-work` | staff | What the signed-in user has open today |

## Masters — `MasterController`

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/countries` | staff | Reference list |
| GET | `/destinations` | staff | List |
| GET | `/destinations/options` | staff | Dropdown lookup |
| POST | `/destinations` | staff | Create |
| PUT | `/destinations/{id}` | staff | Update |
| DELETE | `/destinations/{id}` | staff:owner,manager | Soft-delete |
| GET | `/cities` | staff | List |
| POST | `/cities` | staff | Create |
| GET | `/suppliers` | staff | List |
| GET | `/suppliers/options` | staff | Dropdown lookup |
| GET | `/suppliers/{id}` | staff | Detail |
| POST | `/suppliers` | staff | Create |
| PUT | `/suppliers/{id}` | staff | Update |
| DELETE | `/suppliers/{id}` | staff:owner,manager | Soft-delete |
| GET | `/hotels` | staff | List |
| GET | `/hotels/options` | staff | Dropdown lookup |
| GET | `/hotels/{id}` | staff | Detail |
| POST | `/hotels` | staff | Create — `category` includes `2star` (client §3C) |
| PUT | `/hotels/{id}` | staff | Update |
| DELETE | `/hotels/{id}` | staff:owner,manager | Soft-delete |
| POST | `/hotels/{id}/room-types` | staff | Add a room type — **does not yet accept `room_category`**, see REQUIREMENTS.md T4 |
| POST | `/hotels/{id}/rates` | staff:owner,manager | Contracted buying rate (pricing data) |
| GET | `/activities` | staff | List |
| POST | `/activities` | staff | Create |
| GET | `/customers` | staff | List |
| GET | `/customers/{id}` | staff | Detail |
| POST | `/customers` | staff | Create |
| PUT | `/customers/{id}` | staff | Update |
| GET | `/vehicles` | staff | List |
| GET | `/vehicle-types` | staff | List |
| GET | `/drivers` | staff | List — name/phone used on trip assignments (client §4 driver requirement) |

## Packages — `PackageController`

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/packages` | staff | List |
| GET | `/packages/options` | staff | Dropdown lookup |
| GET | `/packages/{id}` | staff | Detail incl. itinerary + price slabs |
| POST | `/packages` | staff:owner,manager,sales | Create |
| PUT | `/packages/{id}` | staff:owner,manager,sales | Update |
| PUT | `/packages/{id}/itinerary` | staff:owner,manager,sales | Replace day-by-day itinerary |
| POST | `/packages/{id}/prices` | staff:owner,manager | Add a price slab (pax band × occupancy × hotel category × season) |
| DELETE | `/packages/{id}/prices/{priceId}` | staff:owner,manager | Deactivate a slab (never hard-deleted) |
| POST | `/packages/{id}/departures` | staff:owner,manager,sales | Add a fixed-departure batch |
| POST | `/packages/{id}/publish` | staff:owner,manager | draft → active |
| POST | `/packages/{id}/archive` | staff:owner,manager | → archived |
| GET | `/departures` | staff | Cross-package departure board |

## Leads (Enquiries) — `LeadController`

Implements client spec §2 (CRM & Lead Management).

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/leads` | staff | List, filterable by status/source/assignee |
| GET | `/leads/pipeline` | staff | Funnel view: new → contacted → quoted → negotiating → won/lost |
| GET | `/leads/sources` | staff | Reference list (Walk-in, WhatsApp, Referral, …) |
| GET | `/leads/{id}` | staff | Detail + follow-up log |
| POST | `/leads` | staff:owner,manager,sales | Capture an enquiry |
| PUT | `/leads/{id}` | staff:owner,manager,sales | Update |
| POST | `/leads/{id}/status` | staff:owner,manager,sales | Guarded status transition |
| POST | `/leads/{id}/followups` | staff:owner,manager,sales | Log a call/WhatsApp/email touch |
| POST | `/leads/{id}/convert-customer` | staff:owner,manager,sales | Promote enquirer to a `customers` row |

## Quotations — `QuotationController`

Implements client spec §3 (Dynamic Quotation Builder).

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/quotations` | staff | List |
| GET | `/quotations/{id}` | staff | Detail incl. `items`, `days`, `options`, `revisions` |
| POST | `/quotations` | staff:owner,manager,sales | Create — accepts `quote_type` (Full Package vs Independent, client §3A) |
| PUT | `/quotations/{id}` | staff:owner,manager,sales | Update (draft/revised only) |
| PUT | `/quotations/{id}/items` | staff:owner,manager,sales | Replace priced lines, server recomputes totals |
| PUT | `/quotations/{id}/options` | staff:owner,manager,sales | **The toggle builder** — transport mode, room category, food/diet, baggage/local-transport/sightseeing/insurance (client §3B–E) — see [new endpoints](#new-endpoints-from-migrations-009011) |
| POST | `/quotations/{id}/price-from-package` | staff:owner,manager,sales | Server-side price resolution from the package rate card |
| POST | `/quotations/{id}/send` | staff:owner,manager,sales | draft → sent |
| POST | `/quotations/{id}/status` | staff:owner,manager,sales | Guarded transition (viewed/accepted/rejected/expired) |
| POST | `/quotations/{id}/revise` | staff:owner,manager,sales | New version, copies items/days/options forward |
| POST | `/quotations/{id}/convert` | staff:owner,manager,sales | Accept → open a booking; copies commercial fields, service lines, **and the options toggle set** |

## Bookings — `BookingController`

Implements client spec §4 (Post-Conversion & Booking Management).

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/bookings` | staff | List |
| GET | `/bookings/{id}` | staff | Detail incl. `pax`, `services`, `rooms`, `payments`, `invoices`, `vouchers`, `trip_assignments`, `options`, `travel_legs`, `margin` |
| GET | `/bookings/{id}/history` | staff | Status-transition + audit history |
| POST | `/bookings` | staff:owner,manager,sales | Create (auto-populates from a quotation if `quotation_id` given) |
| PUT | `/bookings/{id}` | staff:owner,manager,sales | Update |
| PUT | `/bookings/{id}/services` | staff:owner,manager,sales | Replace costed service lines |
| POST | `/bookings/{id}/services/from-package` | staff:owner,manager,sales | Price service lines from the package catalogue |
| PUT | `/bookings/{id}/options` | staff:owner,manager,sales | Edit the toggle set post-conversion (own audited action, distinct from the copy at conversion) |
| POST | `/bookings/{id}/confirm` | staff:owner,manager,sales | draft → confirmed; consumes fixed-departure seat inventory atomically; generates ops day sheets |
| PUT | `/bookings/{id}/pax` | staff | Replace the passenger manifest; returns passport/visa expiry warnings |
| POST | `/bookings/{id}/status` | staff:owner,manager,operations | Guarded transition (not for cancellation) |
| POST | `/bookings/{id}/cancel` | staff:owner,manager | Cancellation charge computed server-side from the policy slab; releases seats and supplier holds |
| GET | `/bookings/{id}/margin` | staff:owner,manager,accounts,operations | Revenue vs actual/estimated cost |
| GET | `/bookings/{id}/travel-legs` | staff:owner,manager,operations | List actual flight/train/bus legs (client §4 logistics) |
| PUT | `/bookings/{id}/travel-legs` | staff:owner,manager,operations | Replace the whole leg list |
| POST | `/bookings/{id}/travel-legs` | staff:owner,manager,operations | Append one leg |
| PUT | `/bookings/{id}/travel-legs/{legId}` | staff:owner,manager,operations | Update one leg |
| DELETE | `/bookings/{id}/travel-legs/{legId}` | staff:owner,manager,operations | Remove one leg |
| POST | `/bookings/{id}/travel-legs/{legId}/confirm` | staff:owner,manager,operations | Mark confirmed once the PNR is issued |

## Finance: Payments — `FinanceController`

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/payments/daybook` | staff:owner,manager,accounts | All money in/out for a date range, grouped by mode |
| POST | `/payments/{id}/mark-paid` | staff:owner,manager,accounts | Settle a scheduled instalment |
| POST | `/payments/{id}/void` | staff:owner,manager,accounts | Void (never deleted) |
| GET | `/bookings/{id}/payments` | staff:owner,manager,accounts | Ledger for one booking |
| POST | `/bookings/{id}/payments` | staff:owner,manager,accounts | Record a payment — balance re-checked under `SELECT…FOR UPDATE` |
| POST | `/bookings/{id}/payment-plan` | staff:owner,manager,accounts | Schedule an instalment plan |

## Finance: Invoices — `FinanceController`

Implements client spec §5 (Billing/Invoicing — GST and Non-GST).

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/invoices` | staff:owner,manager,accounts | List |
| GET | `/invoices/{id}` | staff:owner,manager,accounts | Detail, `amount_in_words` |
| POST | `/bookings/{id}/invoice` | staff:owner,manager,accounts | Raise a **tax invoice** (`Invoice::fromBooking()`) — CGST/SGST/IGST computed |
| POST | `/bookings/{id}/cash-bill` | staff:owner,manager,accounts | Raise a **Non-GST cash bill** (`Invoice::cashBill()`) — see [new endpoints](#new-endpoints-from-migrations-009011) |
| POST | `/invoices/{id}/payments` | staff:owner,manager,accounts | Record a receipt |
| POST | `/invoices/{id}/void` | staff:owner,manager,accounts | Void (blocked while `amount_paid > 0`) |

## Finance: Payables — `FinanceController`

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/supplier-bills` | staff:owner,manager,accounts | List |
| GET | `/supplier-bills/{id}` | staff:owner,manager,accounts | Detail |
| POST | `/supplier-bills` | staff:owner,manager,accounts | Create |
| POST | `/supplier-bills/{id}/approve` | staff:owner,manager,accounts | draft → approved |
| POST | `/supplier-bills/{id}/payments` | staff:owner,manager,accounts | Pay — balance re-checked under lock |

## Finance: Statements — `FinanceController`

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/finance/payables` | staff:owner,manager,accounts | Ageing by supplier |
| GET | `/finance/receivables` | staff:owner,manager,accounts | Ageing by customer |
| GET | `/finance/gst-summary` | staff:owner,manager,accounts | Period GST totals (GSTR-1 input) |
| GET | `/finance/pl` | staff:owner,manager,accounts | Revenue, COGS, overheads, margin |

## Expenses — `ExpenseController`

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/expenses` | staff:owner,manager,accounts | List |
| GET | `/expenses/summary` | staff:owner,manager,accounts | Totals by category |
| GET | `/expenses/categories` | staff:owner,manager,accounts | Reference list |
| GET | `/expenses/{id}` | staff:owner,manager,accounts | Detail |
| POST | `/expenses` | staff:owner,manager,accounts | Create (draft) |
| PUT | `/expenses/{id}` | staff:owner,manager,accounts | Update |
| POST | `/expenses/{id}/submit` | staff:owner,manager,accounts | draft → submitted |
| POST | `/expenses/{id}/approve` | staff:owner,manager,accounts | → approved |
| POST | `/expenses/{id}/reject` | staff:owner,manager,accounts | → rejected, reason required |
| POST | `/expenses/{id}/mark-paid` | staff:owner,manager,accounts | → paid |
| POST | `/expenses/{id}/void` | staff:owner,manager,accounts | Void |

## Vouchers — `VoucherController`

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/vouchers` | staff:owner,manager,operations | List |
| GET | `/vouchers/{id}` | staff:owner,manager,operations | Detail |
| GET | `/bookings/{id}/vouchers` | staff:owner,manager,operations | For one booking |
| POST | `/bookings/{id}/vouchers` | staff:owner,manager,operations | Issue one (hotel/transport/activity/tour) |
| POST | `/bookings/{id}/vouchers/issue-all` | staff:owner,manager,operations | Issue every outstanding voucher |
| POST | `/vouchers/{id}/cancel` | staff:owner,manager,operations | Cancel |
| POST | `/vouchers/{id}/send` | staff:owner,manager,operations | Record guest receipt |

## Operations — `OpsController`

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/ops/board` | staff:owner,manager,operations | Ops board — bookings on the road |
| GET | `/ops/calendar` | staff:owner,manager,operations | Calendar view, `?from=&to=` |
| GET | `/ops/departures-checklist` | staff:owner,manager,operations | Pre-departure readiness gates |
| GET | `/ops/incidents` | staff:owner,manager,operations | Open/investigating incidents |
| POST | `/ops/daysheets/{id}/checklist` | staff:owner,manager,operations | Toggle one checklist item |
| POST | `/ops/daysheets/{id}/issue` | staff:owner,manager,operations | Flag a critical issue |
| GET | `/trip-assignments` | staff:owner,manager,operations | List |
| GET | `/trip-assignments/{id}` | staff:owner,manager,operations | Detail |
| POST | `/bookings/{id}/trip-assignments` | staff:owner,manager,operations | **Assign driver + vehicle** (client §4 driver requirement) |
| PUT | `/trip-assignments/{id}` | staff:owner,manager,operations | Update |
| POST | `/trip-assignments/{id}/status` | staff:owner,manager,operations | Transition |
| POST | `/trip-assignments/{id}/trip-sheet` | staff:owner,manager,operations | Driver/tour-manager end-of-day sheet |
| POST | `/trip-sheets/{id}/approve` | staff:owner,manager,operations | Approve |
| POST | `/trip-sheets/{id}/reject` | staff:owner,manager,operations | Reject, reason required |
| POST | `/booking-services/{id}/confirm` | staff:owner,manager,operations | Supplier-side confirmation |
| POST | `/bookings/{id}/incidents` | staff:owner,manager,operations | Log an on-trip incident |
| POST | `/incidents/{id}/resolve` | staff:owner,manager,operations | Resolve |
| GET | `/attachments` | staff | List (passports, visas, vouchers, bills — polymorphic) |
| POST | `/attachments` | staff | Upload — see [SECURITY.md](../SECURITY.md) for validation |
| GET | `/attachments/{id}` | staff | Stream (private, no-store) |
| DELETE | `/attachments/{id}` | staff:owner,manager,operations | Delete |

## Reports — `ReportController`

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/reports/sales` | staff:owner,manager,accounts,operations | Grouped by date/destination/package |
| GET | `/reports/margin` | staff:owner,manager,accounts,operations | Per-booking profitability |
| GET | `/reports/supplier-performance` | staff:owner,manager,accounts,operations | Rating + on-time |
| GET | `/reports/outstanding` | staff:owner,manager,accounts | Receivables snapshot |
| GET | `/reports/pax-manifest` | staff:owner,manager,operations | Per-departure passenger list |
| GET | `/reports/lead-source-roi` | staff:owner,manager,sales | ROI by lead source |

All accept `?format=csv|json` (`Exporter::maybeExport()`) as a streamed download instead of the JSON envelope;
CSV cells are formula-injection-neutralised (see [SECURITY.md](../SECURITY.md)).

## Administration — `AdminController`

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/users` | staff:owner | List |
| GET | `/users/{id}` | staff:owner | Detail |
| POST | `/users` | staff:owner | Create |
| PUT | `/users/{id}` | staff:owner | Update — cannot self-escalate role |
| POST | `/users/{id}/deactivate` | staff:owner | Deactivate |
| POST | `/users/{id}/activate` | staff:owner | Reactivate |
| POST | `/users/{id}/reset-password` | staff:owner | Force reset |
| GET | `/settings` | staff:owner | Company profile, defaults, sequences |
| PUT | `/settings` | staff:owner | Update (closed key space — no arbitrary keys) |
| GET | `/settings/numbering` | staff:owner | Document sequence preview |
| GET | `/audit-log` | staff:owner | Full audit trail |

---

## New endpoints from migrations 009–011

These map directly to client spec §§3–5 and were added, wired end-to-end, over the course of the current
session (schema → model → controller → route). All confirmed present and reachable in the live route table as
of this writing.

### Quotation options (the toggle builder — client §3)

| Method | Path | Guard | Body |
|---|---|---|---|
| PUT | `/quotations/{id}/options` | staff:owner,manager,sales | `{transport_mode, room_category, food_included, diet_type, baggage_included, baggage_notes, local_transport_included, sightseeing_included, insurance_included}` — all optional, upserted as a set |

`transport_mode`: `flight\|train\|bus\|mixed\|none`. `room_category`:
`normal\|ac\|non_ac\|deluxe\|super_deluxe\|executive\|suite\|other`. `diet_type`: `veg\|non_veg\|brahmin\|jain`.
Only reachable while the quotation is `draft`/`revised` (`Quotation::EDITABLE_STATUSES`).

### Booking options (carried forward automatically at conversion, editable after)

| Method | Path | Guard | Body |
|---|---|---|---|
| PUT | `/bookings/{id}/options` | staff:owner,manager,sales | Same shape as above |

Not reachable once the booking is `completed`/`cancelled`. Populated automatically on
`POST /quotations/{id}/convert` via `QuotationOption::copyToBooking()` — no client call needed to seed it.

### Travel legs (actual flight/train/bus number, PNR, timings — client §4)

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/bookings/{id}/travel-legs` | staff:owner,manager,operations | List, ordered by `sort_order` |
| PUT | `/bookings/{id}/travel-legs` | staff:owner,manager,operations | `{legs:[…]}` — replace the whole itinerary, renumbered from 1 |
| POST | `/bookings/{id}/travel-legs` | staff:owner,manager,operations | Append one leg after the existing set |
| PUT | `/bookings/{id}/travel-legs/{legId}` | staff:owner,manager,operations | Update one field set |
| DELETE | `/bookings/{id}/travel-legs/{legId}` | staff:owner,manager,operations | Remove |
| POST | `/bookings/{id}/travel-legs/{legId}/confirm` | staff:owner,manager,operations | `{pnr}` — marks `confirmation_status = confirmed` |

Leg body: `{mode, direction, carrier_name, vehicle_number, pnr, seat_class, from_location, to_location, departure_date, departure_time, arrival_date, arrival_time, baggage_allowance, confirmation_status, notes}`.
`mode`: `flight\|train\|bus\|car\|other`. `direction`: `onward\|return\|internal`. `from_location`,
`to_location` and `departure_date` are mandatory per leg; arrival cannot precede departure.

### Cash bill (Non-GST invoice — client §5)

| Method | Path | Guard | Purpose |
|---|---|---|---|
| POST | `/bookings/{id}/cash-bill` | staff:owner,manager,accounts | Raise a Non-GST bill, sibling of `POST /bookings/{id}/invoice` |

Body: `{invoice_date, due_days, notes, terms}` — no `invoice_type` field (it is always `cash_bill` by
construction) and no tax inputs at all: `Invoice::cashBill()` zeroes every GST column server-side and sets
`is_gst_applicable = 0`. Draws its number from the independent `CASH-…` sequence
(`seq_CASH_prefix` in `settings`), so it can never collide with, or be mistaken for, a tax invoice number. A
booking may hold at most one non-voided tax invoice **and** at most one non-voided cash bill simultaneously —
the two uniqueness guards are scoped to their own `invoice_type` independently.

**Known gap:** neither the frontend nor `docs/OPERATIONS_GUIDE.md`'s workflow yet has a page that lets staff
choose between these two endpoints at the point of raising a bill — see REQUIREMENTS.md §3 T13.

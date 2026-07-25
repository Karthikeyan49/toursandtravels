# Security

Posture, role matrix, and a go-live checklist. For the reasoning behind these choices, see
[ARCHITECTURE.md](ARCHITECTURE.md); for the endpoint-by-endpoint guard list, [docs/API.md](docs/API.md).

---

## Authentication and token handling

- **Hand-rolled HS256 JWT** (`api/helpers/JWT.php`) — no library, because the backend has no Composer/vendor
  directory by design. Only HS256 is ever accepted for verification; the `alg` header inside the token itself
  is never consulted to choose the algorithm, which closes the classic "`alg: none`" / algorithm-confusion
  attack where a forged token claims a weaker or absent signature scheme and the verifier trusts it. Signature
  comparison uses `hash_equals()` (constant-time), not `===`.
- **The database row is authoritative for authorization, not the token's claims.** `AuthMiddleware::authenticate()`
  decodes the JWT to get a user ID, then re-reads `user_type`/`staff_role`/`is_active` from `users` on every
  request. A token minted before a role change (or a deactivation) never carries the old privilege forward —
  the very next request after an admin edits a user's role sees the new one.
- **Access-token revocation:** `revoked_tokens` denylists a token's `jti` until its natural expiry — logout is
  immediate, not "wait out the TTL." **Refresh-token rotation:** the presented refresh token is revoked in the
  same statement that validates it (`api/controllers/AuthController.php::refresh()`), so a stolen refresh token
  is single-use — replaying it after the legitimate client has already rotated fails outright.
- **Token lifetimes** are client-type dependent (`X-Client-Type: web|mobile` header): 1 day access / 7 day
  refresh on web, 30 day access / 180 day refresh on mobile — a browser on a shared office PC is asked to
  re-authenticate far more often than a phone in a driver's pocket.
- **Login response timing** does not distinguish "no such account" from "wrong password": a non-existent
  identifier still runs a dummy `password_verify()` against a static bcrypt hash before returning the same
  generic "Invalid credentials" message, so a timing side-channel can't be used to enumerate valid accounts.
- **Account lockout:** `failed_logins`/`locked_until` on `users` — repeated bad attempts lock the account
  temporarily (`api/config/app.php`: `max_failed_logins`, `lockout_minutes`), independent of the IP-based rate
  limiter below.
- **Password reset tokens** live 15 minutes (`security.reset_token_ttl`), not the 30-day mistake a naive
  implementation might reach for, and `forgot-password` always returns the same message whether or not the
  account exists.

## The guard model and role matrix

Every route in `api/index.php` declares a 4th-argument guard — see
[ARCHITECTURE.md §3](ARCHITECTURE.md#3-the-route-guard-grammar) for the grammar itself. The role list
(`AuthMiddleware::ROLES`): `owner`, `manager`, `sales`, `operations`, `accounts`, `visa`.

| Area | Guard | Rationale |
|---|---|---|
| `/auth/login`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password` | public | The only four public routes in the system — asserted as an exact set by `authorization_test.php`, not just "at least these" |
| `/auth/me`, `/auth/logout`, `/auth/change-password`, `/notifications/*` | any authenticated user | No business data, just session/inbox |
| Reads, masters CRUD, package/quotation/booking creation | `staff` or `staff:owner,manager,sales` | Default surface for day-to-day selling |
| Pricing changes, cancellation, publishing | `staff:owner,manager` | Anything that moves a price or commits capacity |
| **All of Finance** — payments, invoices, cash bills, supplier bills, payables/receivables, GST summary, P&L, expenses | `staff:owner,manager,accounts` | No exception, anywhere — asserted by `authorization_test.php` as a structural invariant: every route whose path starts with `/finance/`, `/invoices`, `/supplier-bills`, `/payments/`, or `/expenses` must carry exactly this guard, however it came to be registered |
| Operations, vouchers, travel legs, trip assignments | `staff:owner,manager,operations` | Ground-level execution, not sales or accounts |
| Cost-bearing reports (`/reports/sales`, `/reports/margin`, `/reports/supplier-performance`) | `staff:owner,manager,accounts,operations` | Expose buying prices/margin — never `sales` alone |
| **All of Administration** — users, settings, numbering, audit log | `staff:owner` | Owner-only, no exception — this specifically blocks a `manager` or any other admin from self-escalating their own role, since only `owner` can touch `/users/{id}` |

This is enforced, not just documented: `api/tests/authorization_test.php` requires `index.php` with
`ROUTER_TEST_MODE` defined (no database, no dispatch) and asserts the guard map as data — every route in the
finance/admin namespaces carries exactly the expected guard, no route is missing a guard entirely, no guard
names a role outside the canonical list, and no literal path is shadowed by an earlier `{id}` pattern that
would silently swallow it. Run it with `php api/tests/run_all.php`.

**Row-level scope for B2B agents:** a `user_type = 'agent'` user is additionally scoped to their own
`agency_id` via `AuthMiddleware::agencyScope()`, appended to the `WHERE` clause of every booking/quotation/
invoice list and enforced again on `show()` (`BookingController::assertAgencyAccess()` raises a 404 — not a
403 — for another agency's booking, so its existence isn't even confirmed to an agent who isn't entitled to
see it).

## Rate limits

DB-backed (`rate_limits` table, epoch-int timestamps for cheap integer comparison), per source IP:

| Bucket | Limit | Applies to |
|---|---|---|
| `login` | 5 / 15 min | `POST /auth/login` |
| `reset` | 5 / 60 min | `POST /auth/forgot-password`, `POST /auth/reset-password` |
| `general` | 300 / 60 s | everything else |

The limiter **fails open**: if the `rate_limits` table write itself errors (locked table, disk full), the
exception is logged and the request proceeds — a rate-limiter outage must never become an outage of the whole
API. `X-RateLimit-Limit`/`X-RateLimit-Remaining`/`Retry-After` headers are set on every response so a client
can back off proactively rather than by trial and error.

## SQL-injection defence

Every query goes through `Database::query()`, which is a `PDO::prepare()` + `execute($params)` with
`ATTR_EMULATE_PREPARES => false` — real server-side prepared statements, not client-side emulation, which
matters because emulated prepares on some MySQL builds re-open a path for multi-statement injection that real
prepares close. **There is no method anywhere in `Database` that accepts an interpolated `WHERE` fragment built
from request data.** The one place identifiers (not values) must be dynamic — `ORDER BY` column, filter
column — goes through `Model::assertSortable()`, which checks the requested column against an explicit
`SORTABLE` allowlist declared on each model and silently falls back to a safe default otherwise; a column name
can never be bound as a parameter, so allowlisting is the only correct defence for that specific case.

## Mass-assignment defence

`Database::insert()`/`update()` take an explicit `$allowed` column list and `array_intersect_key()` the
incoming data against it before the query is even built — a key not on the list is dropped silently, not
rejected loudly, which matters because a rejection would tell an attacker which extra field they tried exists.
Every model declares its own `FILLABLE` constant; `Model::create()` always merges in `created_by` from the
authenticated session, never from the request body. On the request-parsing side, `Request::only($keys)` is "the
only way controllers should read a payload" per its own docblock — a controller that wants `title` and
`status` literally cannot see any other field the client sent, so there is no `$_POST`-style blanket read
anywhere for an attacker to smuggle `is_active` or `amount_paid` through.

## Price-tampering defence

See [ARCHITECTURE.md §4](ARCHITECTURE.md#4-server-side-price-resolution) for the full reasoning.
`api/services/Pricing.php` resolves every price for a catalogued item (package slab, hotel rate, activity
rate) server-side; a request body's price for one of those items is structurally never read. The one
exception — a free-text/manual line — is gated to `owner`/`manager` at the point a client-supplied price or
discount is accepted (`QuotationController`/`BookingController` compare the incoming discount against the
existing one and require `canEditPrices()` before allowing a change), so the exception is scoped to the roles
who are supposed to be able to price manually, not open to whoever can reach the endpoint at all.

## Concurrency guard on payments

`Payment::postBookingPayment()`/`postSupplierPayment()` take a `SELECT … FOR UPDATE` row lock on the
booking/bill **inside the transaction**, then re-read the sum of prior payments and re-check the overpayment
guard against that locked snapshot, before inserting the new payment row. Without the lock, two concurrent
requests reading the same "balance remaining" figure could both pass the "amount ≤ balance" check and both
commit, leaving the document overpaid with no error anywhere. Booking confirmation against fixed-departure
seat inventory uses the equivalent pattern for a different hazard (oversell instead of overpayment): the seat
`UPDATE`'s own `WHERE (seats_total - seats_booked - seats_held) >= ?` clause is the guard, so the check and the
write are the same atomic statement and no separate lock is needed.

## Upload validation

`api/services/FileStore.php` defends against four things, in order: (1) uploading an executable file and
requesting it back — closed by a per-category **extension allowlist plus a hard denylist** (`.php`, `.phtml`,
`.phar`, `.exe`, `.sh`, `.py`, `.js`, and critically `.svg`/`.html` — anything a browser could render as active
content) and a stored filename of `bin2hex(random_bytes(16))`, so the client never controls the path at all;
(2) an SVG or HTML file rendered inline as stored XSS — no renderable type is ever on an allowlist, and
downloads are served `X-Content-Type-Options: nosniff` with a strict `Content-Security-Policy: default-src
'none'; sandbox`; (3) a claimed Content-Type that doesn't match the actual bytes — the MIME is read from
`finfo` on the uploaded temp file, never from the client-supplied `$_FILES[...]['type']`, and an image category
additionally gets a second opinion from `getimagesize()`; (4) path traversal reading a file back —
`FileStore::resolveLocalPath()` rejects any `..`, a leading `/`, or a null byte, then `realpath()`-resolves and
confirms the result is still inside the uploads root (which also defeats a symlink escape, since `realpath()`
has already resolved every symlink by the time the containment check runs). A `.htaccess` is written into the
uploads root on first use that disables PHP execution and denies dangerous extensions outright, as defence in
depth on top of the extension/MIME checks.

## CSV/export formula-injection neutralisation

`api/services/Exporter::csvSafe()` prefixes any cell (including headers) that begins with `=`, `+`, `-`, `@`,
a tab, or a carriage return with a leading apostrophe before writing it to a CSV. Without this, a customer name
or supplier note that happens to start with one of those characters — accidental or deliberately crafted — is
interpreted as a spreadsheet formula the moment an accountant opens the exported report in Excel, LibreOffice,
or Google Sheets, potentially executing an external command via a legacy formula function. The apostrophe
forces the cell to plain text and is not itself displayed by the spreadsheet application.

## Audit logging

Every create/update/delete/void/login/permission-denial writes a row to `audit_log`
(`entity_type`+`entity_id`, `old_value`/`new_value` as JSON, actor, IP). Password-shaped fields
(`password`, `password_hash`, `token`, `refresh_token`, `token_hash`, `jwt_secret`, `otp_code`) are redacted to
`***` before the JSON is even encoded, so a leaked audit-log export can never itself become a credential leak.
Audit writes are wrapped so a failure (locked table, full disk) is logged and swallowed — an audit-write outage
must never block or fail the underlying business action it was trying to record. **Permission denials are
audited too** (`Audit::denied()`), which is the signal most worth having: a pattern of 403s against
`/finance/*` from one account is the first thing that should show up when someone is probing for access they
shouldn't have.

## Secret handling

`JWT_SECRET` is read from `.env` (never committed; `.env.example` documents every variable with no real
values) via a hand-written parser that deliberately does **not** populate `getenv()`/`$_ENV`, so a leaked
`phpinfo()` page cannot dump it. The API refuses to boot rather than sign tokens with a weak key: `api/index.php`
checks the secret is present, ≥32 characters, and not the literal string `change-me`, before any route can be
reached — a missing or placeholder secret returns `500 Server misconfiguration` for every request, including
in production, rather than quietly signing forgeable tokens. `ADMIN_PASSWORD` for the bootstrap owner account
is read via `getenv()` specifically (the one exception, deliberately), so it can be passed as a real shell
environment variable and never has to land in a file on disk; omitted entirely, the installer generates and
prints a 16-character password once and sets `must_change_pw`.

## The localStorage-JWT tradeoff

The frontend stores the session (access token, refresh token, user, expiry) in `localStorage`
(`frontend/src/lib/api/client.ts`), which is a known, accepted tradeoff rather than an oversight: `localStorage`
is readable by any script running on the page, so a successful XSS anywhere in the SPA is a session-theft
vector in a way an `HttpOnly` cookie would not be. This is mitigated, not eliminated:

- **Strict CSP** (`api/index.php`: `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` on API
  responses; the SPA build should carry an equivalent `script-src 'self'` policy) makes injecting and running
  attacker-controlled script materially harder in the first place.
- **No `dangerouslySetInnerHTML`** anywhere the SPA renders user- or supplier-supplied text.
- **Short access-token TTL** (1 day web) bounds how long a stolen token is useful even if theft succeeds; the
  refresh token is what's long-lived, and it is single-use-then-rotated (see Authentication, above), so a
  stolen refresh token is detectable the moment the legitimate client's next refresh call fails.
- A 401 against an **existing** session (not a failed login) fires `tt:auth-expired` and clears the stored
  session immediately — a revoked or expired token is not silently retried or cached.

**Before going live, revisit this specific tradeoff** if the deployment ever needs to defend against a
persistent XSS risk higher than "a well-reviewed internal SPA with no third-party script inclusion" — at that
point an `HttpOnly` cookie + CSRF-token pair is the standard upgrade, and it is a frontend-only change (the
backend's JWT issuance and validation do not need to change shape).

---

## Before going live — checklist

- [ ] Generate a fresh `JWT_SECRET` for production (`php -r 'echo bin2hex(random_bytes(32));'`) — never reuse
      the development secret.
- [ ] Confirm `APP_ENV=production` (or anything other than the literal string `development`) — this alone
      disables verbose error messages, rejects `localhost` as a CORS origin, and sets `display_errors` off.
- [ ] Set `CORS_ORIGIN` to the exact production SPA origin(s), comma-separated, with scheme and port — never
      `*`, never a substring or wildcard-subdomain match.
- [ ] Create the database with an explicit collation:
      `CREATE DATABASE … CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;` — the MariaDB 11.x server default
      will silently differ and break joins in production only, the worst possible place to discover it.
- [ ] Run `php api/install.php` against production **once**, capture the printed bootstrap owner password out
      of the terminal (it is never written to disk or logged), and change it immediately after first login.
- [ ] Confirm `.env` is `chmod 600` and lives **above** the web root (see `deploy.sh`'s bundle layout) — never
      inside `public_html/`.
- [ ] Run `php api/tests/run_all.php` and confirm both suites pass, especially `authorization_test.php` — it is
      the test that catches a newly-added route silently defaulting to an over-broad guard.
- [ ] Confirm the uploads directory (`api/config/app.php` → `uploads.root`) is writable by the web server user
      but is **not** itself inside `public_html/` or otherwise directly web-servable — attachments are meant to
      be read only through `GET /attachments/{id}`, which enforces auth + the private/no-store headers.
- [ ] Review the CORS/CSP headers actually reaching the browser in production (a misconfigured reverse proxy or
      CDN can silently strip or override them) — don't just trust that `api/index.php` sets them.
- [ ] Decide whether the `localStorage`-JWT tradeoff above is acceptable for this deployment's threat model, or
      whether to invest in the `HttpOnly` cookie upgrade before real customer data reaches the system.
- [ ] Fix the two known gaps that affect data correctness before staff start relying on them in production: the
      `meal_preference` allowlist missing `brahmin` in `BookingController::savePax()`, and `room_category` not
      being settable via `POST /hotels/{id}/room-types` — both are one-line changes, tracked as T4/T5 in
      [REQUIREMENTS.md](REQUIREMENTS.md).

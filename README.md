# Tours & Travel ERP

An operations and accounting system for a tours & travel operator. It carries a
trip through its whole commercial life:

```
Enquiry → Quotation → Booking → Operations → Invoicing → P&L
```

A walk-in or a WhatsApp message becomes a lead. The lead is followed up and
quoted from a priced package. An accepted quotation becomes a booking with a
passenger manifest and an advance. Confirming the booking generates the
operations day sheets, transport is assigned, vouchers are issued to the guest
and to the supplier. The trip runs, the trip sheet is settled, the invoice is
raised, the supplier bills are entered, and the margin on that booking is
visible without anyone opening a spreadsheet.

---

## Current state

The backend is complete and tested: **56 tables**, **164 routes**, **2/2 test
suites passing**.

The frontend has its full infrastructure — API client, auth context, layout,
shared components, navigation, 10 typed API modules — but **`frontend/src/pages/`
is still empty**, so `npm run dev` and `npm run build` currently fail on
unresolved imports from `App.tsx`. The API is fully usable in the meantime with
`curl` or any HTTP client. See [REQUIREMENTS.md §3](REQUIREMENTS.md) for the
honest, itemised state of every capability.

---

## Modules

| Module | What it covers |
|---|---|
| **CRM** | Enquiries, lead pipeline, follow-up log, lead-source ROI, conversion to customer |
| **Quotations** | Versioned quotes, revision chains, itinerary snapshot, server-side pricing, accept → booking |
| **Bookings** | Passenger manifest, service lines, rooming, confirmation, seat consumption, cancellation with policy slabs |
| **Packages** | Itineraries, day items, price slabs by pax band × occupancy × hotel category × season, fixed departures |
| **Masters** | Destinations, cities, suppliers, hotels + room types + contracted rates, activities, vehicles, drivers, customers |
| **Operations** | Ops board and day sheets, departures checklist, trip assignments, trip sheets, incidents, attachments |
| **Vouchers** | Hotel/transport/activity vouchers per booking service, issue-all, cancel, mark sent |
| **Finance** | Polymorphic payment ledger, invoices, supplier bills, payables/receivables ageing, GST summary, P&L |
| **Expenses** | Overheads and booking-attached direct costs with a submit → approve → pay workflow |
| **Reports** | Sales, margin, supplier performance, outstanding, pax manifest, lead-source ROI — each exportable as CSV/JSON |
| **Admin** | Users and roles, company settings, document numbering, audit log |

---

## Tech stack

**Backend** — zero dependencies. No Composer, no `vendor/`, no autoloader, so it
deploys onto cheap shared hosting by copying files.

| | |
|---|---|
| PHP | 8.1+ (uses `match`, enums-free, first-class `??=`, `throw` expressions) |
| Database | MariaDB 10.4+ / MySQL 8+, InnoDB, `utf8mb4_unicode_ci` |
| Auth | Hand-rolled HS256 JWT + rotating refresh tokens |
| Architecture | Front controller → Router → Middleware → Controller → Model → PDO |

**Frontend**

| | |
|---|---|
| React | 18.3 |
| Build | Vite 5.4 with `@vitejs/plugin-react-swc` |
| Language | TypeScript 5.8, `strict: true` |
| Routing | react-router-dom 6.28 |
| Server state | @tanstack/react-query 5.62 — the only GET cache |
| Forms | react-hook-form 7.54 + zod 3.23 via `@hookform/resolvers` |
| UI | shadcn/ui over Radix primitives, Tailwind 3.4, lucide-react icons |
| Charts / export | recharts 2.13, jspdf 2.5 + jspdf-autotable, xlsx 0.18 |
| Tests | vitest 2.1 + @testing-library/react 16, jsdom |

---

## Quick start

### Prerequisites

- PHP **8.1+** with `pdo_mysql`, `mbstring`, `json`, `fileinfo`
- MariaDB **10.4+** or MySQL **8+**
- Node **18+** and npm

Check:

```bash
php -v && php -m | grep -E 'pdo_mysql|mbstring|fileinfo'
node --version
mysql --version
```

### 1. Get the code

```bash
git clone <repository-url> tours-travel-erp
cd tours-travel-erp
```

### 2. Configure

```bash
cp .env.example .env
```

Generate a signing secret and paste it into `.env` as `JWT_SECRET`:

```bash
php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'
```

The API **refuses to boot** with a secret that is missing, shorter than 32
characters, or still the literal `change-me` — it returns
`500 Server misconfiguration` rather than signing tokens with a weak key.

Then set `DB_NAME`, `DB_USER` and `DB_PASS`.

### 3. Create the database

The collation must be explicit. The MariaDB 11.x server default
(`utf8mb4_uca1400_ai_ci`) breaks every JOIN against the application's tables
with errno 1267, *Illegal mix of collations*.

```bash
mysql -u root -p -e "CREATE DATABASE tours_erp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### 4. Install

```bash
php api/install.php --email=owner@example.com --name="Your Name"
```

This runs all eight migrations in numeric order, creates the bootstrap **owner**
account, and prints a per-table verification summary. It is idempotent — every
migration is `CREATE TABLE IF NOT EXISTS` / `INSERT IGNORE`, and the owner is
skipped when any user already exists.

A 16-character temporary password is generated and **printed once**, with
`must_change_pw` set on the account. To supply your own instead — keeping it out
of your shell history is on you:

```bash
ADMIN_PASSWORD='your-password' php api/install.php --email=owner@example.com
```

No password hash is ever committed: `008_seed.sql` seeds settings, lead sources,
countries and cancellation slabs, but deliberately creates no user rows.

### 5. Run

Both servers at once:

```bash
./scripts/dev.sh
```

Or separately:

```bash
php -S localhost:8000 -t api          # API   → http://localhost:8000
cd frontend && npm install && npm run dev   # SPA → http://localhost:8080
```

Open **http://localhost:8080**. The SPA calls `/api/*`, which `vite.config.ts`
proxies to `http://localhost:8000` with the prefix stripped — the same relative
base production uses, so nothing about the API path differs between the two.

> While `frontend/src/pages/` is empty the Vite server will fail to resolve the
> page imports in `App.tsx`. Use `./scripts/dev.sh --api-only` and drive the API
> directly until the pages land.

### 6. Sign in

Sign in at `/login` with the email you passed to the installer and the temporary
password it printed.

Under the hood:

1. `POST /api/auth/login` with `{identifier, password}` — `identifier` is either
   the email or the phone number.
2. The response carries `user`, `token` (access JWT), `refresh_token`,
   `expires_at` (epoch **milliseconds**) and `must_change_password`.
3. The SPA stores the session in `localStorage` and sends
   `Authorization: Bearer <token>` on every call.
4. On expiry, `POST /api/auth/refresh` exchanges the refresh token for a new
   pair — the presented refresh token is burned in the same statement, so a
   stolen copy is single-use.
5. `POST /api/auth/logout` denylists the access token's `jti` and revokes the
   refresh token immediately.

Access tokens live 1 day on web and 30 days on mobile (`X-Client-Type: mobile`);
refresh tokens 7 and 180 days respectively.

The bootstrap account is an **owner** and sees everything. Create the rest under
*Settings → Users* with the narrowest role that does the job — see
[SECURITY.md](SECURITY.md) for the full role matrix.

---

## Running tests

**Backend** — no database, no configuration, no network:

```bash
php api/tests/run_all.php
```

Each suite runs in its own PHP process and the runner exits non-zero if any
fails, so it can gate a deploy. Two suites today:

- `money_test.php` — epsilon comparisons, line totals, GST intra/inter-state
  splitting, Indian-format amount in words.
- `authorization_test.php` — asserts the **route guard map itself** by requiring
  `index.php` with `ROUTER_TEST_MODE` defined. It checks all 164 routes: that
  every route declares a guard, that every guard names a known user type and
  roles that exist in `AuthMiddleware::ROLES`, that no `{id}` route shadows a
  literal sibling, and that the finance and cost-bearing report routes are
  restricted to the roles they are supposed to be. The failure it exists to
  catch is someone adding a route and forgetting the 4th argument, which
  silently defaults to `'staff'` and hands every staff user the finance module.

**Frontend**

```bash
cd frontend
npm test            # vitest run
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
```

There are no frontend test files yet — the vitest harness (`vitest.config.ts`,
`src/test/setup.ts`) is wired but nothing imports it. See REQUIREMENTS.md §3.

---

## Repository layout

```
tours-travel-erp/
├── api/                        Backend — no Composer, no vendor/
│   ├── index.php               Front controller + the 164-route table
│   ├── install.php             Migration runner + bootstrap owner (CLI only)
│   ├── config/app.php          .env parser and the config array
│   ├── core/                   Config, Database, Model, Controller, Router,
│   │                             Request, Response
│   ├── helpers/                JWT (HS256), Money (epsilon), Validator
│   ├── middleware/             AuthMiddleware (the guard), RateLimitMiddleware
│   ├── models/                 15 table-backed models, static methods, PDO only
│   ├── controllers/            14 thin controllers
│   ├── services/               Audit, Exporter, FileStore, Notifier,
│   │                             NumberSequence, OpsDaysheet, Pricing
│   ├── migrations/             001_core … 008_seed — the schema source of truth
│   ├── tests/                  run_all.php + the two suites
│   ├── cron/                   (empty — scheduled jobs not yet written)
│   └── uploads/                Attachment store, never web-served
│
├── frontend/
│   ├── src/
│   │   ├── lib/api/            client.ts (the only fetch wrapper) + one typed
│   │   │                         module per resource
│   │   ├── lib/navigation.ts   Single source of truth for the sidebar
│   │   ├── components/         Shared components + shadcn/ui primitives
│   │   ├── contexts/           AuthContext
│   │   ├── pages/              (empty — not yet written)
│   │   └── App.tsx             Route table
│   ├── vite.config.ts          Dev proxy /api → :8000, manual chunks
│   └── vitest.config.ts
│
├── database/
│   └── build-schema.sh         Concatenates the migrations into schema.sql
│
├── scripts/dev.sh              Runs PHP :8000 + Vite :8080 together
├── deploy.sh                   Assembles a shared-hosting bundle (uploads nothing)
│
├── README.md                   This file
├── ARCHITECTURE.md             Design decisions and why
├── REQUIREMENTS.md             Requirements, module map, backlog, progress log
├── SECURITY.md                 Posture, role matrix, go-live checklist
├── .env.example                Every variable the code reads
└── docs/
    ├── API.md                  Complete endpoint reference
    ├── DATA_MODEL.md           All 56 tables + ER diagram
    ├── OPERATIONS_GUIDE.md     End-user walkthrough
    └── REFERENCE_STACK_ANALYSIS.md   Patterns this project inherited
```

---

## Deployment

```bash
DEPLOY_DOMAIN=erp.example.com ./deploy.sh
```

Builds the SPA, assembles `deploy/erp.example.com/` with the PHP **above** the
web root, generates a `.env` with a fresh JWT secret (only if one is not already
there), writes both `.htaccess` files, and produces `UPLOAD_MAP.txt` with the
post-upload sanity checks.

It **uploads nothing**. The transfer is a separate, deliberate step.

Details in [docs/OPERATIONS_GUIDE.md](docs/OPERATIONS_GUIDE.md) and
[SECURITY.md](SECURITY.md).

---

## Where to read next

| Question | File |
|---|---|
| Why is it built this way? | [ARCHITECTURE.md](ARCHITECTURE.md) |
| What is done and what is not? | [REQUIREMENTS.md](REQUIREMENTS.md) |
| What endpoints exist? | [docs/API.md](docs/API.md) |
| What is in the database? | [docs/DATA_MODEL.md](docs/DATA_MODEL.md) |
| How does a travel agent use it? | [docs/OPERATIONS_GUIDE.md](docs/OPERATIONS_GUIDE.md) |
| Is it safe to put on the internet? | [SECURITY.md](SECURITY.md) |

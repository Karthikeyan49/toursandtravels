# Reference Stack Analysis

Extracted from a **different client's** inventory/manufacturing ERP by three parallel read-only
analysis agents. That repo was never modified. This document records only the *transferable
engineering patterns*; no business logic, data, or domain concept from that client is carried over.

Source repo analysed: `api-EcoSudar/clone/inventory` (read-only)
Analysis date: 2026-07-25
Agents: (1) backend/PHP, (2) frontend/React, (3) database + deploy + cross-cutting

---

## Agent 1 — Backend (PHP REST API)

**Shape:** zero-dependency PHP 8.1+ MVC-ish REST API. No Composer, no vendor/, no autoloader —
built for cheap shared hosting (Apache + MariaDB). 209 files, 427 routes, 81 tables.

### Front-controller pipeline (strict order — `api/index.php`)

| Stage | What |
|---|---|
| 1 | `define('ROOT_PATH')`, require `config/app.php` + `core/Response.php` **first** (every later fatal path needs Response) |
| 2 | `error_reporting` toggled by `APP_ENV` |
| 3 | `set_exception_handler` → JSON error; message leaked only in `development` |
| 4 | CORS from an `.env` allowlist, `Vary: Origin`, 24h preflight cache |
| 5 | `OPTIONS` → 204 + exit **before any DB work** |
| 6 | JWT-secret guard: missing / <32 chars / placeholder → 500 `Server misconfiguration` |
| 7 | 415 gate on POST/PUT/PATCH with a non-JSON/form/multipart content type |
| 8 | ~130 explicit `require_once` in dependency order |
| 9 | Route table |
| 10 | Rate limiting |
| 11 | `$router->dispatch()` |

### Route guard grammar (the single best idea in the codebase)

```php
$router->get('/packages',              [PackageController::class, 'index'], 'admin');
$router->post('/bookings/{id}/cancel', [BookingController::class, 'cancel'], 'admin:owner,manager');
$router->post('/leads',                [LeadController::class, 'store'],    true);   // any authed user
$router->post('/auth/login',           [AuthController::class, 'login'],    false);  // public
```

4th arg: `false` public · `true` authenticated · `'admin'` any admin · `'admin:a,b'` role-scoped.
Authorization is therefore *declarative and greppable* — and testable as a map (see phase-8 tests).

### Layers

- `core/Database.php` — static PDO facade, `ATTR_EMULATE_PREPARES => false`, `ERRMODE_EXCEPTION`,
  `MYSQL_ATTR_INIT_COMMAND = "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci, time_zone='+05:30'"`.
- `core/Response.php` — `success() / error() / paginated()`, envelope `{success, data, message?, pagination?}`.
- `core/Request.php` — `only([...])`, `query()`, `param()`, `bearerToken()`.
- `core/Router.php` — `{id}` placeholders, verb map, 404/405.
- `middleware/` — Auth (JWT), Admin (staff_role), RateLimit (DB-backed, probabilistic cleanup).
- `helpers/` — `JWT.php` (hand-rolled HS256, `hash_equals` compare), `Money.php` (EPSILON 0.005).
- `services/` — `NumberSequence.php`, `FileStore.php`, `ApprovalWorkflow.php`, `ImportEngine.php`.

### Conventions worth copying verbatim

- Controllers: thin. Parse → validate → model call → `Response::success`. Every write audited.
- Models: static methods, all PDO prepared, explicit column allowlists on insert/update.
- Migrations: `NNN_name.sql`, always idempotent (`CREATE TABLE IF NOT EXISTS` + an
  `information_schema` guard idiom for `ALTER`), plus one-shot `run_NNN.php` runners for hosts
  where `PREPARE/EXECUTE` trips PDO's unbuffered-query error.

---

## Agent 2 — Frontend (React SPA)

**Stack:** React 18.3 · Vite 5 (`@vitejs/plugin-react-swc`) · TS 5.8 (`strict: false`) ·
react-router-dom 6.30 · @tanstack/react-query 5.83 · shadcn/ui over ~28 Radix packages ·
tailwind 3.4 · sonner (toasts) · recharts · jspdf + jspdf-autotable · xlsx · date-fns · lucide.

### Patterns adopted here

- **`src/lib/api/client.ts` is the only fetch wrapper.** Bearer token read from `localStorage` on
  every call; 60s in-memory GET cache with in-flight dedupe; **any non-GET clears the whole cache**;
  a 401 dispatches a `window` event that AuthContext listens for.
- **Types live beside their API module**, not in a `src/types/` folder. `src/lib/api/bookings.ts`
  exports `interface Booking` + `BookingInput` + the functions.
- **`src/lib/navigation.ts` is the single source of truth** for sidebar, module launcher, and the
  persisted "active module" — a data array, not JSX.
- Auth gate is a *component* (`<ProtectedRoutes/>`), not a route wrapper.

### Patterns deliberately **rejected** (agent flagged them as debt)

| Their approach | Ours |
|---|---|
| `useState` + manual validation in every form; `react-hook-form`+`zod` installed but unused | react-hook-form + zodResolver, wired through `ui/form.tsx`, from day one |
| `DataTable` copy-pasted inline in two pages | one shared `components/DataTable.tsx` |
| `tsconfig` `strict:false`, `noImplicitAny:false` | `strict: true` |
| Dark-mode tokens defined but no ThemeProvider mounted; pages hardcode `bg-amber-50` | ThemeProvider mounted, semantic tokens only |
| React Query on only 6 of 36 pages | React Query everywhere; the bespoke GET cache is kept only as a backstop |
| 427 routes inline in one 70KB `index.php` | routes split into `api/routes/*.php` by module |

---

## Agent 3 — Database, deployment, cross-cutting

### Schema conventions adopted

- MariaDB / InnoDB, **`DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` written explicitly on
  every table.** (Their prod incident: server default `utf8mb4_uca1400_ai_ci` broke every JOIN with
  errno 1267 "Illegal mix of collations".)
- **Uniform PK: `id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY`.** Their repo has two eras
  (`<entity>_id INT` vs `id BIGINT UNSIGNED`) and their own spec file warns "never assume `id`".
  We fix this at the start.
- Money is **always `DECIMAL(15,2)`**, never FLOAT. Rates `DECIMAL(6,3)`. Comparisons via a
  `Money` helper with `EPSILON = 0.005`.
- Audit columns on every table: `created_at`, `updated_at ON UPDATE CURRENT_TIMESTAMP`, `created_by`.
- Index naming: `uq_<table>_<col>`, `idx_<table>_<col>`, FK `fk_<table>_<col>`.

### Cross-cutting patterns transplanted (agent 3's top picks)

1. **Polymorphic `attachments`** (`entity_type` + `entity_id` + `category`) — one table serves every
   module. Perfect fit here for passports, visas, vouchers, supplier invoices.
2. **Polymorphic `payment_installments`** (`ref_type`, `ref_id`, `seq`, `label`, `amount`, `mode`,
   `utr_no`, `paid_on`). Outstanding is **never stored**, always `total − Σ(payments)`. Agent 3
   called this "the single most transplantable table" — and a tour booking is exactly an
   advance + installments + balance.
3. **Dual delete semantics:** masters soft-delete (`is_deleted`); money documents are **voided**
   (`voided_by`/`voided_at`/`void_reason`), never deleted.
4. **Atomic document numbering** — `document_sequences(doc_type, period, next_value)` with
   `INSERT … VALUES (…, LAST_INSERT_ID(2)) ON DUPLICATE KEY UPDATE next_value = LAST_INSERT_ID(next_value+1)`.
   One statement, no transaction, no `SELECT FOR UPDATE`.
5. **Settings-as-table** — anything an operator might change without a deploy.
6. **Audit permission denials**, and wrap audit writes in try/catch so logging can never break a request.
7. **Per-row import framework** (`import_jobs` + `import_job_rows`) instead of all-or-nothing.
8. **Export formula-injection neutralisation** — prefix `= + - @ TAB CR` cells with `'`.

### Deployment shape adopted

PHP backend lives **above the web root**; `public_html/api/index.php` is a 5-line bridge:

```
site/
├── .env                (chmod 600, above web root)
├── .htaccess           denies ^(backend|database)
├── backend/            rsync of api/
└── public_html/        ← web root: built SPA + .htaccess + api/index.php bridge
```

### Security posture adopted from their 8 hardening phases

- Every business route defaults to `'admin'`; money mutations to `'admin:owner,accountant'`;
  user/settings CRUD to `'admin:owner'` (blocks an admin self-escalating their own role).
- DB-backed rate limiting: 300/60s general, 5/15min login, 3/60min register.
- Server-side price resolution — never trust a client-sent price (their phase-4 fix closed a real
  price-tampering hole in order creation). Applies directly to package/booking pricing here.
- Balance re-validated **inside** the transaction under `SELECT … FOR UPDATE` before posting a
  payment, so two concurrent payments can't both pass an overpayment guard.
- File uploads: extension **and** MIME allowlist per category, a dangerous-extension denylist,
  random `bin2hex(random_bytes(16))` stored filenames, `realpath`-confined reads.
- Known weak point we inherit knowingly: JWT in `localStorage`. Mitigated by strict CSP
  (`script-src 'self'`), no `dangerouslySetInnerHTML`, and short access-token TTL.

### Requirements-doc format adopted

Their `REQUIREMENTS_SET*.md` doubles as agent working memory and is genuinely good:
raw requirement → **`R<n>` analysis block** (tables, files, acceptance) → **`T<n>` checklist item
citing its R-ids** → dated **progress log** → **blocked/needs-input**. Plus a **Module Map**
section listing `A → B` wires that must exist, with the rule *"never ship an isolated feature."*
Reused as-is in [`REQUIREMENTS.md`](../REQUIREMENTS.md).

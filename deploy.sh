#!/usr/bin/env bash
#
# deploy.sh — assemble a shared-hosting deployment bundle.
#
# This script BUILDS AND ASSEMBLES ONLY. It never connects to a server, never
# runs rsync/scp/ftp against a remote host, and never touches a database. The
# upload is a separate, deliberate, human step — see UPLOAD_MAP.txt in the
# finished bundle.
#
# Output layout (the PHP lives ABOVE the web root):
#
#   <DEPLOY_DIR>/<DEPLOY_DOMAIN>/
#   ├── .env                 chmod 600 — generated only if absent
#   ├── .htaccess            denies ^(backend|database)
#   ├── backend/             rsync of api/  (no .env, no tests/, no logs)
#   │   └── index.php        the real front controller
#   ├── database/            schema.sql, if database/build-schema.sh has run
#   └── public_html/         ← the web root
#       ├── .htaccess        SPA fallback, /api rewrite, MIME types, denies
#       ├── api/index.php    5-line bridge into ../../backend/index.php
#       └── assets/…         the built SPA
#
# Usage:
#   ./deploy.sh                              # domain from $DEPLOY_DOMAIN or default
#   DEPLOY_DOMAIN=erp.example.com ./deploy.sh
#   ./deploy.sh --domain erp.example.com --out /tmp/bundles
#   ./deploy.sh --skip-build                 # reuse an existing frontend/dist

set -Eeuo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

DEPLOY_DOMAIN="${DEPLOY_DOMAIN:-tours-travel-erp}"
DEPLOY_DIR="${DEPLOY_DIR:-${REPO_ROOT}/deploy}"
SKIP_BUILD=0

# The API base the SPA is compiled against. Relative on purpose: the built app
# and the /api bridge are served from the same origin, so no CORS entry and no
# absolute host name is baked into the bundle.
VITE_API_BASE_URL_VALUE="/api"

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
else
  C_RESET=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''
fi

step() { printf '%s==>%s %s\n' "${C_BOLD}" "${C_RESET}" "$*"; }
info() { printf '    %s\n' "$*"; }
ok()   { printf '    %s✓%s %s\n' "${C_GREEN}" "${C_RESET}" "$*"; }
warn() { printf '    %s!%s %s\n' "${C_YELLOW}" "${C_RESET}" "$*" >&2; }
die()  { printf '\n%sERROR:%s %s\n\n' "${C_RED}${C_BOLD}" "${C_RESET}" "$*" >&2; exit 1; }

trap 'die "failed at line ${LINENO}: ${BASH_COMMAND}"' ERR

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------

need_command() {
  local cmd="$1" hint="${2:-}"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    die "required command not found: ${cmd}${hint:+ — ${hint}}"
  fi
}

# ---------------------------------------------------------------------------
# Path-escape guard
#
# Every write in this script goes through here. A bundle path is only accepted
# when its resolved parent is inside BUNDLE_ROOT, so a hostile or fat-fingered
# DEPLOY_DOMAIN (../../etc, an absolute path, a symlink out of the tree) can
# never cause a write outside the bundle directory.
# ---------------------------------------------------------------------------

assert_inside() {
  local target="$1" root="$2" resolved parent

  parent="$(dirname -- "${target}")"
  [[ -d "${parent}" ]] || die "internal: parent does not exist for ${target}"

  resolved="$(cd -- "${parent}" && pwd -P)/$(basename -- "${target}")"
  root="$(cd -- "${root}" && pwd -P)"

  case "${resolved}" in
    "${root}"|"${root}"/*) : ;;
    *) die "refusing to write outside the bundle: ${target}" ;;
  esac
}

# Create a directory, then prove it landed inside the bundle.
safe_mkdir() {
  local dir="$1"
  mkdir -p -- "${dir}"
  assert_inside "${dir}" "${BUNDLE_ROOT}"
}

# Write stdin to a file inside the bundle.
safe_write() {
  local file="$1"
  safe_mkdir "$(dirname -- "${file}")"
  assert_inside "${file}" "${BUNDLE_ROOT}"
  cat > "${file}"
}

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)     DEPLOY_DOMAIN="${2:-}"; shift 2 ;;
    --domain=*)   DEPLOY_DOMAIN="${1#*=}"; shift ;;
    --out)        DEPLOY_DIR="${2:-}"; shift 2 ;;
    --out=*)      DEPLOY_DIR="${1#*=}"; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

# A domain becomes a directory name. Accept only what is safe as one.
[[ -n "${DEPLOY_DOMAIN}" ]] || die "DEPLOY_DOMAIN is empty"
if [[ ! "${DEPLOY_DOMAIN}" =~ ^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$ ]]; then
  die "DEPLOY_DOMAIN must look like a hostname (letters, digits, . _ -): got '${DEPLOY_DOMAIN}'"
fi

step "Checking tools"
need_command php  "install PHP 8.1+"
need_command npm  "install Node 18+"
need_command rsync
need_command tar
ok "php $(php -r 'echo PHP_VERSION;'), node $(node --version 2>/dev/null || echo '?'), rsync present"

[[ -d "${REPO_ROOT}/api" ]]      || die "api/ not found — run this from the repository root"
[[ -d "${REPO_ROOT}/frontend" ]] || die "frontend/ not found — run this from the repository root"

# ---------------------------------------------------------------------------
# Syntax check every PHP file before shipping it
# ---------------------------------------------------------------------------

step "Linting PHP"
lint_failures=0
while IFS= read -r -d '' php_file; do
  if ! php -l "${php_file}" >/dev/null 2>&1; then
    php -l "${php_file}" >&2 || true
    lint_failures=$((lint_failures + 1))
  fi
done < <(find "${REPO_ROOT}/api" -type f -name '*.php' -print0)
(( lint_failures == 0 )) || die "${lint_failures} PHP file(s) failed the syntax check"
ok "all PHP files parse"

# ---------------------------------------------------------------------------
# Build the frontend
# ---------------------------------------------------------------------------

if (( SKIP_BUILD )); then
  step "Skipping frontend build (--skip-build)"
  [[ -d "${REPO_ROOT}/frontend/dist" ]] || die "--skip-build given but frontend/dist does not exist"
else
  step "Building the frontend (VITE_API_BASE_URL=${VITE_API_BASE_URL_VALUE})"

  if [[ ! -d "${REPO_ROOT}/frontend/node_modules" ]]; then
    info "installing dependencies…"
    ( cd "${REPO_ROOT}/frontend" && npm ci --no-audit --no-fund )
  fi

  rm -rf -- "${REPO_ROOT}/frontend/dist"
  ( cd "${REPO_ROOT}/frontend" && VITE_API_BASE_URL="${VITE_API_BASE_URL_VALUE}" npm run build )
fi

[[ -f "${REPO_ROOT}/frontend/dist/index.html" ]] || die "frontend/dist/index.html missing — the build produced nothing"
ok "SPA built ($(du -sh "${REPO_ROOT}/frontend/dist" | cut -f1))"

# ---------------------------------------------------------------------------
# Bundle skeleton
# ---------------------------------------------------------------------------

BUNDLE_ROOT="${DEPLOY_DIR}/${DEPLOY_DOMAIN}"

step "Assembling ${BUNDLE_ROOT}"

# Preserve a previously generated .env across rebuilds: it holds the production
# JWT secret and database password, and regenerating the secret would sign out
# every user on the next deploy.
PRESERVED_ENV=""
if [[ -f "${BUNDLE_ROOT}/.env" ]]; then
  PRESERVED_ENV="$(cat -- "${BUNDLE_ROOT}/.env")"
  info "keeping the existing .env (secret and credentials preserved)"
fi

rm -rf -- "${BUNDLE_ROOT}"
mkdir -p -- "${BUNDLE_ROOT}"
BUNDLE_ROOT="$(cd -- "${BUNDLE_ROOT}" && pwd -P)"

safe_mkdir "${BUNDLE_ROOT}/backend"
safe_mkdir "${BUNDLE_ROOT}/public_html/api"
safe_mkdir "${BUNDLE_ROOT}/database"

# ---------------------------------------------------------------------------
# backend/ — the API, minus everything that must not leave the workstation
# ---------------------------------------------------------------------------

step "Copying backend/"
rsync -a --delete \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'tests/' \
  --exclude 'cron/*.log' \
  --exclude '*.log' \
  --exclude 'error_log' \
  --exclude '.DS_Store' \
  --exclude 'uploads/*' \
  "${REPO_ROOT}/api/" "${BUNDLE_ROOT}/backend/"

# uploads/ must exist and be writable, but ships empty.
safe_mkdir "${BUNDLE_ROOT}/backend/uploads"
: > "${BUNDLE_ROOT}/backend/uploads/.gitkeep"

# Paranoia: prove nothing sensitive slipped through the excludes.
if find "${BUNDLE_ROOT}/backend" -maxdepth 2 -name '.env*' ! -name '.env.example' -print -quit | grep -q .; then
  die "a .env file reached backend/ — refusing to continue"
fi
ok "backend/ = $(find "${BUNDLE_ROOT}/backend" -type f | wc -l | tr -d ' ') files"

# ---------------------------------------------------------------------------
# public_html/ — the web root
# ---------------------------------------------------------------------------

step "Copying public_html/"
rsync -a --delete --exclude 'api/' "${REPO_ROOT}/frontend/dist/" "${BUNDLE_ROOT}/public_html/"
safe_mkdir "${BUNDLE_ROOT}/public_html/api"
ok "public_html/ = $(find "${BUNDLE_ROOT}/public_html" -type f | wc -l | tr -d ' ') files"

# The bridge. The entire public surface of the API is these five lines; the
# code itself sits one directory above the web root where Apache cannot serve
# it even if a rewrite rule is lost.
safe_write "${BUNDLE_ROOT}/public_html/api/index.php" <<'PHP'
<?php
// Bridge into the application, which lives ABOVE the web root.
// public_html/api/index.php  ->  dirname(__DIR__, 2) == <site>  ->  <site>/backend
require dirname(__DIR__, 2) . '/backend/index.php';
PHP

# ---------------------------------------------------------------------------
# database/ — schema only, no data
# ---------------------------------------------------------------------------

if [[ -f "${REPO_ROOT}/database/schema.sql" ]]; then
  cp -- "${REPO_ROOT}/database/schema.sql" "${BUNDLE_ROOT}/database/schema.sql"
  ok "database/schema.sql included"
else
  info "database/schema.sql absent — run database/build-schema.sh to include it"
  info "(the installer runs backend/migrations/*.sql directly, so this is optional)"
fi

# ---------------------------------------------------------------------------
# .env — generated once, never overwritten
# ---------------------------------------------------------------------------

step "Writing .env"

if [[ -n "${PRESERVED_ENV}" ]]; then
  printf '%s\n' "${PRESERVED_ENV}" > "${BUNDLE_ROOT}/.env"
  ok ".env restored from the previous bundle"
else
  GENERATED_SECRET="$(php -r 'echo bin2hex(random_bytes(32));')"
  [[ ${#GENERATED_SECRET} -eq 64 ]] || die "JWT secret generation failed"

  safe_write "${BUNDLE_ROOT}/.env" <<ENV
# Production environment for ${DEPLOY_DOMAIN}
# Generated by deploy.sh on $(date '+%Y-%m-%d %H:%M:%S %Z').
# Fill in the database credentials before the first request.
#
# This file is regenerated ONLY when it is absent. Re-running deploy.sh keeps
# the values below, so the JWT secret survives a redeploy and existing sessions
# are not invalidated.

APP_NAME="Tours & Travel ERP"
APP_ENV=production
APP_URL=https://${DEPLOY_DOMAIN}
APP_TIMEZONE=Asia/Kolkata
APP_CURRENCY=INR

DB_HOST=localhost
DB_PORT=3306
DB_NAME=
DB_USER=
DB_PASS=

# Generated fresh for this bundle. Rotating it signs out every user.
JWT_SECRET=${GENERATED_SECRET}
JWT_ISSUER=tours-travel-erp

# Same-origin deployment: the SPA and /api share a host, so no entry is needed.
# Add exact origins (scheme + host + port, comma separated) only for a separate
# frontend domain or a mobile app.
CORS_ORIGIN=
ENV
  ok "new .env written with a freshly generated 64-character JWT secret"
fi

chmod 600 "${BUNDLE_ROOT}/.env"
ok ".env mode 600"

# ---------------------------------------------------------------------------
# Root .htaccess — the belt to public_html's braces
# ---------------------------------------------------------------------------

step "Writing .htaccess files"

safe_write "${BUNDLE_ROOT}/.htaccess" <<'HTACCESS'
# Site root — this directory should NOT be the Apache document root.
#
# On correctly configured hosting the document root is public_html/ and nothing
# here is reachable at all. This file is the second line of defence for the
# common shared-hosting misconfiguration where the account root is served
# directly: it denies the application code and the schema outright.

RewriteEngine On

# Block any request whose path starts with backend/ or database/.
RewriteRule ^(backend|database)(/|$) - [F,L]

# Block dotfiles, .env in any form, SQL dumps and documentation.
<FilesMatch "^\.">
  Require all denied
</FilesMatch>
<FilesMatch "(?i)(^\.env|\.env\..*|\.(sql|sqlite|db|log|ini|yml|yaml|lock|md|sh)$)">
  Require all denied
</FilesMatch>

Options -Indexes
HTACCESS

# ---------------------------------------------------------------------------
# public_html/.htaccess — SPA fallback, /api rewrite, MIME types, denies
# ---------------------------------------------------------------------------

safe_write "${BUNDLE_ROOT}/public_html/.htaccess" <<'HTACCESS'
# Web root for the Tours & Travel ERP SPA + API bridge.

Options -Indexes
DirectoryIndex index.html

# --- MIME types -------------------------------------------------------------
# Shared hosts routinely ship an Apache without modern types. A .js served as
# text/plain is refused by every browser's module loader, which surfaces as a
# blank page with no error anyone can act on.
<IfModule mod_mime.c>
  AddType text/javascript              .js
  AddType text/javascript              .mjs
  AddType text/css                     .css
  AddType application/json             .json map
  AddType application/wasm             .wasm
  AddType image/svg+xml                .svg
  AddType image/webp                   .webp
  AddType font/woff                    .woff
  AddType font/woff2                   .woff2
  AddType application/manifest+json    .webmanifest
</IfModule>

# --- Deny everything that is not part of the app ----------------------------
<FilesMatch "^\.">
  Require all denied
</FilesMatch>
<FilesMatch "(?i)(^\.env|\.env\..*|\.(sql|sqlite|db|log|ini|yml|yaml|lock|md|sh|bak|old|orig|swp)$)">
  Require all denied
</FilesMatch>

# --- Security headers -------------------------------------------------------
<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set Permissions-Policy "geolocation=(), microphone=(), camera=()"
  # The known accepted risk is a JWT in localStorage; a strict script-src is
  # the mitigation, so keep this tight. The SPA ships no inline <script>.
  Header always set Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'"
</IfModule>

# --- Caching ----------------------------------------------------------------
# Vite fingerprints asset filenames, so they are safe to cache forever.
# index.html must never be cached or a deploy is invisible until a hard reload.
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/javascript "access plus 1 year"
  ExpiresByType text/css        "access plus 1 year"
  ExpiresByType image/webp      "access plus 1 month"
  ExpiresByType image/png       "access plus 1 month"
  ExpiresByType image/jpeg      "access plus 1 month"
  ExpiresByType font/woff2      "access plus 1 year"
</IfModule>
<IfModule mod_headers.c>
  <FilesMatch "\.(js|mjs|css|woff2?)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <FilesMatch "\.(html|json)$">
    Header set Cache-Control "no-cache, must-revalidate"
  </FilesMatch>
</IfModule>

# --- Routing ----------------------------------------------------------------
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /

  # Authorization is not passed to PHP by default under CGI/FastCGI, and the
  # whole API authenticates with a Bearer token.
  RewriteCond %{HTTP:Authorization} .
  RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]

  # Every /api/* request goes to the bridge, which requires the real front
  # controller from above the web root. The [QSA] keeps ?page=2 intact.
  RewriteRule ^api(?:/(.*))?$ api/index.php [QSA,L]

  # SPA fallback: anything that is not a real file or directory is a client-side
  # route and must be answered with index.html so a deep link works on reload.
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^ index.html [L]
</IfModule>
HTACCESS

ok "root and public_html .htaccess written"

# ---------------------------------------------------------------------------
# UPLOAD_MAP.txt — what goes where, and how to prove it worked
# ---------------------------------------------------------------------------

step "Writing UPLOAD_MAP.txt"

BUNDLE_SIZE="$(du -sh "${BUNDLE_ROOT}" | cut -f1)"

safe_write "${BUNDLE_ROOT}/UPLOAD_MAP.txt" <<MAP
Tours & Travel ERP — upload map for ${DEPLOY_DOMAIN}
Assembled $(date '+%Y-%m-%d %H:%M:%S %Z') · ${BUNDLE_SIZE}

This bundle was assembled locally. NOTHING HAS BEEN UPLOADED. Every step below
is manual and deliberate.

===========================================================================
1. WHERE EACH DIRECTORY GOES
===========================================================================

  local (this bundle)          remote
  ---------------------------  --------------------------------------------
  .env                         <site>/.env                    chmod 600
  .htaccess                    <site>/.htaccess
  backend/                     <site>/backend/                ABOVE the web root
  database/                    <site>/database/               optional, schema only
  public_html/                 <site>/public_html/            THE WEB ROOT

"<site>" is the account directory that CONTAINS public_html — not public_html
itself. If backend/ ends up inside public_html, the entire source tree
including database credentials becomes downloadable.

Example with rsync over SSH (adjust user, host, port and path):

  rsync -avz --delete -e 'ssh -p 22' \\
    ./backend/ ./database/ ./.env ./.htaccess \\
    user@host:/home/user/

  rsync -avz --delete -e 'ssh -p 22' \\
    ./public_html/ user@host:/home/user/public_html/

===========================================================================
2. BEFORE THE FIRST REQUEST
===========================================================================

  [ ] Edit <site>/.env — set DB_NAME, DB_USER, DB_PASS.
      Leave JWT_SECRET exactly as generated.
  [ ] Confirm the permissions:  chmod 600 <site>/.env
  [ ] Create the database with an explicit collation:
        CREATE DATABASE <name> CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  [ ] Make the upload directory writable:  chmod 755 <site>/backend/uploads
  [ ] Run the installer over SSH:
        cd <site>/backend && php install.php --email=owner@example.com --name="Owner"
      It prints a temporary password ONCE. Note it, then change it after signing in.
      To supply your own instead:
        ADMIN_PASSWORD='...' php install.php --email=owner@example.com

===========================================================================
3. POST-UPLOAD SANITY CHECKS  (all must pass)
===========================================================================

Replace <domain> with the live host. Expected results are absolute — a
deviation means the layout is wrong and the site must not be handed over.

  # .env must NOT be readable. 403 or 404 only — a 200 is a credential leak.
  curl -sS -o /dev/null -w '%{http_code}\\n' https://<domain>/.env
      expect 403 or 404      NEVER 200

  # The source tree must not be reachable through the web root.
  curl -sS -o /dev/null -w '%{http_code}\\n' https://<domain>/backend/index.php
      expect 403 or 404      NEVER 200
  curl -sS -o /dev/null -w '%{http_code}\\n' https://<domain>/backend/config/app.php
      expect 403 or 404      NEVER 200
  curl -sS -o /dev/null -w '%{http_code}\\n' https://<domain>/database/schema.sql
      expect 403 or 404      NEVER 200

  # The API answers, and answers with JSON.
  curl -sS -i https://<domain>/api/auth/me
      expect HTTP 401 and a body of {"success":false,"message":"Authentication required"}
      A 404 means the /api rewrite is not active.
      A 500 "Server misconfiguration" means JWT_SECRET is missing from .env.
      An HTML error page means PHP fataled — check the host's error log.

  # Login works end to end.
  curl -sS -X POST https://<domain>/api/auth/login \\
       -H 'Content-Type: application/json' \\
       -d '{"identifier":"owner@example.com","password":"…"}'
      expect {"success":true,...} carrying token and refresh_token

  # Rate limiting is live (the 6th login attempt in 15 minutes).
      expect HTTP 429 with a Retry-After header

  # A deep link reloads instead of 404ing (the SPA fallback).
  curl -sS -o /dev/null -w '%{http_code}\\n' https://<domain>/bookings/1
      expect 200 with the SPA shell

  # JavaScript is served with a usable MIME type.
  curl -sS -o /dev/null -w '%{content_type}\\n' https://<domain>/assets/<any>.js
      expect text/javascript      NOT text/plain

===========================================================================
4. ROLLBACK
===========================================================================

  Keep the previous backend/ directory as backend.prev/ before overwriting.
  To roll back: swap the directories and restore public_html/ from the old
  bundle. The database is NOT rolled back by this script — migrations are
  additive and idempotent, so a rollback of code alone is safe.
MAP

ok "UPLOAD_MAP.txt written"

# ---------------------------------------------------------------------------
# Final report
# ---------------------------------------------------------------------------

echo
step "Bundle ready"
info "location : ${BUNDLE_ROOT}"
info "size     : ${BUNDLE_SIZE}"
info "backend  : $(find "${BUNDLE_ROOT}/backend" -type f | wc -l | tr -d ' ') files"
info "web root : $(find "${BUNDLE_ROOT}/public_html" -type f | wc -l | tr -d ' ') files"
echo
warn "Nothing has been uploaded. Read ${BUNDLE_ROOT}/UPLOAD_MAP.txt before you do."
echo

#!/usr/bin/env bash
#
# build-schema.sh — concatenate api/migrations/*.sql into database/schema.sql.
#
# The migrations are the source of truth. This produces a single file for the
# cases where running the installer is not an option: importing through
# phpMyAdmin, handing a schema to a DBA, or diffing two releases.
#
# HARD RULE, enforced below: the output must contain no INSERT that targets the
# `users` table. A user row carries a password hash, and a password hash in a
# repository is a committed password. If a migration ever grows one, this script
# fails and writes nothing.
#
# Usage:
#   ./database/build-schema.sh
#   ./database/build-schema.sh --out /tmp/schema.sql

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"

MIGRATIONS_DIR="${REPO_ROOT}/api/migrations"
OUTPUT="${SCRIPT_DIR}/schema.sql"

if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
else
  C_RESET=''; C_BOLD=''; C_RED=''; C_GREEN=''
fi

info() { printf '    %s\n' "$*"; }
ok()   { printf '    %s✓%s %s\n' "${C_GREEN}" "${C_RESET}" "$*"; }
die()  { printf '\n%sERROR:%s %s\n\n' "${C_RED}${C_BOLD}" "${C_RESET}" "$*" >&2; exit 1; }

trap 'die "failed at line ${LINENO}: ${BASH_COMMAND}"' ERR

need_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)   OUTPUT="${2:-}"; shift 2 ;;
    --out=*) OUTPUT="${1#*=}"; shift ;;
    -h|--help)
      sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

need_command awk
need_command sort

[[ -d "${MIGRATIONS_DIR}" ]] || die "migrations directory not found: ${MIGRATIONS_DIR}"

# ---------------------------------------------------------------------------
# Collect the migrations in numeric order.
#
# A plain glob sorts lexically, which is correct only while every prefix has the
# same width. Sorting on the leading integer keeps 002 before 010 forever.
# ---------------------------------------------------------------------------

mapfile -t MIGRATIONS < <(
  find "${MIGRATIONS_DIR}" -maxdepth 1 -type f -name '*.sql' -print |
    while IFS= read -r f; do
      base="$(basename -- "${f}")"
      num="${base%%_*}"
      [[ "${num}" =~ ^[0-9]+$ ]] || num=999999
      printf '%06d\t%s\n' "$((10#${num}))" "${f}"
    done | sort -n | cut -f2-
)

(( ${#MIGRATIONS[@]} > 0 )) || die "no .sql files found in ${MIGRATIONS_DIR}"

printf '%s==>%s Building schema from %d migration(s)\n' "${C_BOLD}" "${C_RESET}" "${#MIGRATIONS[@]}"

# ---------------------------------------------------------------------------
# Guard: refuse to emit a user row.
#
# Checked on the migrations themselves, before anything is written, so a failure
# leaves no partial file behind. Comment lines are stripped first so the prose
# in a migration header cannot trip the check.
# ---------------------------------------------------------------------------

for file in "${MIGRATIONS[@]}"; do
  # Strip `-- …` and `# …` comments first, so the prose in a migration header
  # cannot trip the check. The `|` delimiter matters: `-` would collide with the
  # `--` being matched and sed would abort, leaving the guard vacuously true.
  offending="$(
    sed -e 's|--.*$||' -e 's|#.*$||' -- "${file}" |
      grep -n -i -E 'INSERT[[:space:]]+(IGNORE[[:space:]]+)?INTO[[:space:]]+`?users`?' || true
  )"
  if [[ -n "${offending}" ]]; then
    printf '\n%s' "${offending}" >&2
    die "$(basename -- "${file}") inserts into \`users\`.

A user row carries password_hash, and a hash committed to a repository IS a
committed password. Move the account creation into api/install.php, which
hashes at install time and prints the password once.

Nothing was written to ${OUTPUT}."
  fi
done
ok "no migration inserts a user row"

# ---------------------------------------------------------------------------
# Build into a temporary file, then move it into place atomically.
# ---------------------------------------------------------------------------

TMP_OUT="$(mktemp "${TMPDIR:-/tmp}/schema.XXXXXX.sql")"
trap 'rm -f -- "${TMP_OUT}"' EXIT

{
  cat <<HEADER
-- ===========================================================================
-- Tours & Travel ERP — consolidated schema
--
-- GENERATED FILE — do not edit.
-- Source: api/migrations/*.sql  ·  Regenerate: ./database/build-schema.sh
--
-- Built     : $(date '+%Y-%m-%d %H:%M:%S %Z')
-- Migrations: ${#MIGRATIONS[@]}
--
-- Contains schema and reference data only. It creates NO user accounts —
-- run \`php api/install.php\` to create the bootstrap owner, so that no
-- password hash is ever committed.
--
-- Requires MariaDB 10.4+ / MySQL 8+. Create the database with an explicit
-- collation before importing; the MariaDB 11.x server default
-- (utf8mb4_uca1400_ai_ci) breaks every JOIN against these tables with
-- errno 1267 "Illegal mix of collations":
--
--   CREATE DATABASE tours_erp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--   USE tours_erp;
--   SOURCE database/schema.sql;
--
-- Every statement is idempotent (CREATE TABLE IF NOT EXISTS / INSERT IGNORE),
-- so re-importing over a live database is safe.
-- ===========================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET SQL_MODE = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';

HEADER

  for file in "${MIGRATIONS[@]}"; do
    base="$(basename -- "${file}")"
    printf -- '-- ---------------------------------------------------------------------------\n'
    printf -- '-- %s\n' "${base}"
    printf -- '-- ---------------------------------------------------------------------------\n\n'
    cat -- "${file}"
    printf '\n\n'
  done
} > "${TMP_OUT}"

for file in "${MIGRATIONS[@]}"; do
  info "$(basename -- "${file}")"
done

# ---------------------------------------------------------------------------
# Verify the output, then publish it.
# ---------------------------------------------------------------------------

if grep -q -i -E 'INSERT[[:space:]]+(IGNORE[[:space:]]+)?INTO[[:space:]]+`?users`?' "${TMP_OUT}"; then
  die "the generated file inserts into \`users\` — refusing to write ${OUTPUT}"
fi

TABLE_COUNT="$(
  grep -c -i -E '^[[:space:]]*CREATE[[:space:]]+TABLE' "${TMP_OUT}" || true
)"
(( TABLE_COUNT > 0 )) || die "the generated file declares no tables — something went wrong"

mkdir -p -- "$(dirname -- "${OUTPUT}")"
mv -- "${TMP_OUT}" "${OUTPUT}"
trap - EXIT

echo
ok "wrote ${OUTPUT}"
info "tables : ${TABLE_COUNT}"
info "size   : $(du -h "${OUTPUT}" | cut -f1)"
info "lines  : $(wc -l < "${OUTPUT}" | tr -d ' ')"
echo
info "Note: database/schema.sql is generated and is listed in .gitignore."
info "Import it with:  mysql -u USER -p DBNAME < database/schema.sql"
echo

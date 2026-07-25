#!/usr/bin/env bash
#
# dev.sh — run the whole stack locally.
#
#   PHP built-in server   http://localhost:8000   serving api/
#   Vite dev server       http://localhost:8080   serving the SPA
#
# Open http://localhost:8080. The SPA calls /api/*, which vite.config.ts proxies
# to http://localhost:8000 with the /api prefix stripped — the same relative base
# the production bundle uses, so nothing about the API path differs between
# development and production.
#
# Ctrl-C stops both servers: the trap kills the whole process group, so no
# orphaned PHP server is left holding port 8000.
#
# Usage:
#   ./scripts/dev.sh
#   API_PORT=9000 WEB_PORT=5173 ./scripts/dev.sh
#   ./scripts/dev.sh --api-only
#   ./scripts/dev.sh --web-only

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"

API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-8080}"
RUN_API=1
RUN_WEB=1

if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'
else
  C_RESET=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_CYAN=''
fi

info() { printf '    %s\n' "$*"; }
ok()   { printf '    %s✓%s %s\n' "${C_GREEN}" "${C_RESET}" "$*"; }
warn() { printf '    %s!%s %s\n' "${C_YELLOW}" "${C_RESET}" "$*" >&2; }
die()  { printf '\n%sERROR:%s %s\n\n' "${C_RED}${C_BOLD}" "${C_RESET}" "$*" >&2; exit 1; }

need_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1${2:+ — $2}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-only) RUN_WEB=0; shift ;;
    --web-only) RUN_API=0; shift ;;
    --api-port)   API_PORT="${2:-}"; shift 2 ;;
    --api-port=*) API_PORT="${1#*=}"; shift ;;
    --web-port)   WEB_PORT="${2:-}"; shift 2 ;;
    --web-port=*) WEB_PORT="${1#*=}"; shift ;;
    -h|--help)
      sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

# ---------------------------------------------------------------------------
# Shutdown
#
# Both children are killed on any exit path — clean, Ctrl-C, or an error under
# `set -e`. Each gets a TERM first and a KILL only if it is still alive, so the
# PHP server gets a chance to close its sockets.
# ---------------------------------------------------------------------------

PIDS=()

shutdown() {
  trap - EXIT INT TERM

  local pid
  for pid in "${PIDS[@]:-}"; do
    [[ -n "${pid}" ]] || continue
    kill -TERM "${pid}" 2>/dev/null || true
  done

  # Give them a moment, then insist.
  local waited=0
  while (( waited < 20 )); do
    local alive=0
    for pid in "${PIDS[@]:-}"; do
      [[ -n "${pid}" ]] || continue
      kill -0 "${pid}" 2>/dev/null && alive=1
    done
    (( alive )) || break
    sleep 0.1
    waited=$((waited + 1))
  done

  for pid in "${PIDS[@]:-}"; do
    [[ -n "${pid}" ]] || continue
    kill -KILL "${pid}" 2>/dev/null || true
  done

  printf '\n    stopped\n'
}

trap shutdown EXIT INT TERM

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${port}" -sTCP:LISTEN -t >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :${port}" 2>/dev/null | grep -q LISTEN
  else
    return 1   # cannot tell; let the server report the conflict itself
  fi
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

printf '%s==>%s Tours & Travel ERP — development stack\n' "${C_BOLD}" "${C_RESET}"

if (( RUN_API )); then
  need_command php "install PHP 8.1+"
  [[ -f "${REPO_ROOT}/api/index.php" ]] || die "api/index.php not found"
  port_in_use "${API_PORT}" && die "port ${API_PORT} is already in use (set API_PORT to change it)"
fi

if (( RUN_WEB )); then
  need_command npm "install Node 18+"
  [[ -f "${REPO_ROOT}/frontend/package.json" ]] || die "frontend/package.json not found"
  port_in_use "${WEB_PORT}" && die "port ${WEB_PORT} is already in use (set WEB_PORT to change it)"
  if [[ ! -d "${REPO_ROOT}/frontend/node_modules" ]]; then
    info "installing frontend dependencies (first run)…"
    ( cd "${REPO_ROOT}/frontend" && npm install --no-audit --no-fund )
  fi
fi

if [[ ! -f "${REPO_ROOT}/.env" ]]; then
  warn "no .env at the repository root — the API will fail with 'Server misconfiguration'."
  warn "run:  cp .env.example .env  then set DB_* and generate JWT_SECRET with"
  warn "      php -r 'echo bin2hex(random_bytes(32));'"
fi

# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------

if (( RUN_API )); then
  # -t api makes api/index.php the document root, so paths arrive as /auth/login
  # without an /api prefix. Request::path() strips a leading /api anyway, which
  # is what lets the same route table serve the production bridge.
  php -S "localhost:${API_PORT}" -t "${REPO_ROOT}/api" &
  PIDS+=("$!")
  ok "API  http://localhost:${API_PORT}  (serving api/)"
fi

if (( RUN_WEB )); then
  ( cd "${REPO_ROOT}/frontend" && npm run dev -- --port "${WEB_PORT}" --strictPort ) &
  PIDS+=("$!")
  ok "SPA  http://localhost:${WEB_PORT}  (proxies /api → :${API_PORT})"
fi

echo
printf '    %sOpen http://localhost:%s%s\n' "${C_CYAN}" "${WEB_PORT}" "${C_RESET}"
info "Ctrl-C stops both."
echo

# Wait on the children. `wait -n` returns as soon as EITHER exits, so if the PHP
# server dies the whole script tears down instead of leaving a half-running
# stack that looks healthy.
wait -n "${PIDS[@]}"
warn "a server exited — shutting the other one down"

#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
VENV_DIR="$ROOT_DIR/.venv"

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js is required. Install Node.js 20 or newer and retry."
command -v npm >/dev/null 2>&1 || fail "npm is required. Install Node.js 20 or newer and retry."

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
(( node_major >= 20 )) || fail "Node.js 20 or newer is required (found $(node --version))."

PYTHON_BIN=""
for candidate in python3.13 python3.12 python3.11 python3.14 python3; do
  if command -v "$candidate" >/dev/null 2>&1; then
    version="$("$candidate" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
    major="${version%%.*}"
    minor="${version#*.}"
    if (( major > 3 || (major == 3 && minor >= 11) )); then
      PYTHON_BIN="$(command -v "$candidate")"
      break
    fi
  fi
done
[[ -n "$PYTHON_BIN" ]] || fail "Python 3.11 or newer is required. Install Python 3.11, 3.12, or 3.13 and retry."
python_version="$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR" || fail "Could not create the Python environment. Ensure Python venv support is installed."
fi

requirements_hash="$(shasum -a 256 "$BACKEND_DIR/requirements.txt" | awk '{print $1}')"
installed_hash=""
if [[ -f "$BACKEND_DIR/.requirements-sha256" ]]; then
  installed_hash="$(<"$BACKEND_DIR/.requirements-sha256")"
fi
if [[ "$requirements_hash" != "$installed_hash" ]] || [[ ! -x "$VENV_DIR/bin/uvicorn" ]]; then
  printf 'Installing backend dependencies (Python %s; first run or requirements changed)…\n' "$python_version"
  "$VENV_DIR/bin/python" -m pip install -r "$BACKEND_DIR/requirements.txt"
  printf '%s' "$requirements_hash" > "$BACKEND_DIR/.requirements-sha256"
fi

command -v npm >/dev/null 2>&1 || fail "npm is unavailable."
frontend_hash="$({ cat "$FRONTEND_DIR/package.json"; if [[ -f "$FRONTEND_DIR/package-lock.json" ]]; then cat "$FRONTEND_DIR/package-lock.json"; fi; } | shasum -a 256 | awk '{print $1}')"
installed_frontend_hash=""
if [[ -f "$FRONTEND_DIR/.dependencies-sha256" ]]; then
  installed_frontend_hash="$(<"$FRONTEND_DIR/.dependencies-sha256")"
fi
if [[ ! -x "$FRONTEND_DIR/node_modules/.bin/vite" ]] || [[ "$frontend_hash" != "$installed_frontend_hash" ]]; then
  printf 'Installing frontend dependencies (first run or package files changed)…\n'
  (cd "$FRONTEND_DIR" && npm install)
  frontend_hash="$({ cat "$FRONTEND_DIR/package.json"; cat "$FRONTEND_DIR/package-lock.json"; } | shasum -a 256 | awk '{print $1}')"
  printf '%s' "$frontend_hash" > "$FRONTEND_DIR/.dependencies-sha256"
fi

backend_pid=""
frontend_pid=""
shutdown() {
  trap - INT TERM EXIT
  if [[ -n "$frontend_pid" ]]; then kill "$frontend_pid" 2>/dev/null || true; fi
  if [[ -n "$backend_pid" ]]; then kill "$backend_pid" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}
trap shutdown INT TERM EXIT

printf '\nDental AI Workstation\n'
printf '  Frontend: http://localhost:5173\n'
printf '  Backend:  http://localhost:8000/api/health\n'
if [[ ! -f "$BACKEND_DIR/models/best.pt" ]]; then
  printf '  Model:    unavailable — add your trained weights at backend/models/best.pt\n'
fi
printf 'Press Ctrl+C to stop both services.\n\n'

(cd "$ROOT_DIR" && exec "$VENV_DIR/bin/python" -m uvicorn main:app --app-dir "$BACKEND_DIR" --host 0.0.0.0 --port 8000) &
backend_pid=$!
(cd "$FRONTEND_DIR" && exec npm run dev) &
frontend_pid=$!

while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$frontend_pid" 2>/dev/null; do
  sleep 1
done
status=0
if ! kill -0 "$backend_pid" 2>/dev/null; then
  wait "$backend_pid" || status=$?
  kill "$frontend_pid" 2>/dev/null || true
elif ! kill -0 "$frontend_pid" 2>/dev/null; then
  wait "$frontend_pid" || status=$?
  kill "$backend_pid" 2>/dev/null || true
fi
wait 2>/dev/null || true
if (( status != 0 )); then
  printf 'A workstation service exited with status %s.\n' "$status" >&2
fi
exit "$status"

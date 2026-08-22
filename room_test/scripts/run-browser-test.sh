#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PORT="${WEBXR_TEST_PORT:-18765}"
OUT="${TMPDIR:-/tmp}/webxr-calibration-browser-test.html"
ERR="${TMPDIR:-/tmp}/webxr-calibration-browser-test.err"
LOG="${TMPDIR:-/tmp}/webxr-calibration-http.log"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" >"$LOG" 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
sleep 0.5

# Keep this optional: many CI/container Chromium builds cannot start their UI
# process because DBus/sandbox/zygote services are intentionally absent. The
# deterministic Node DOM tests cover the same overlay/control logic in `npm test`.
if ! timeout 20s chromium --headless --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --disable-background-networking --no-first-run --virtual-time-budget=1500 --dump-dom \
  "http://127.0.0.1:${PORT}/test/browser/browser-harness.html" >"$OUT" 2>"$ERR"; then
  echo "BROWSER-HARNESS-UNAVAILABLE: Chromium did not complete in this environment." >&2
  tail -n 20 "$ERR" >&2 || true
  exit 2
fi
if grep -q 'data-result="PASS"' "$OUT"; then
  echo "PASS browser-harness: Chromium ES modules + DOM overlay + controls + localStorage"
else
  echo "FAIL browser-harness"
  cat "$OUT"
  exit 1
fi

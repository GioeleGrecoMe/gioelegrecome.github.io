#!/bin/sh
set -eu
PORT=${PORT:-18762}
python3 -m http.server "$PORT" --bind 127.0.0.1 > /tmp/roomscan_http.log 2>&1 &
PID=$!
cleanup() { kill "$PID" >/dev/null 2>&1 || true; wait "$PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
n=0
while ! curl -fsS "http://127.0.0.1:$PORT/build_info.json" >/dev/null 2>&1; do
  n=$((n+1))
  [ "$n" -lt 30 ] || { cat /tmp/roomscan_http.log; exit 1; }
  sleep 0.1
done
for f in \
  index.html \
  room_scanner_v12.html \
  processing.html \
  build_info.json \
  manifest.webmanifest \
  css/app_v20_2_0.css \
  js/app_v20_2_0.js \
  js/xr_capture_v20_2_0.js \
  js/db_v20_2_0.js \
  js/raw_export_v20_2_0.js \
  js/processing_ui_v20_2_0.js \
  workers/map_worker_v20_2_0.js \
  workers/processing_worker_v20_2_0.js \
  workers/audio_worklet_v20_2_0.js \
  workers/acoustic_worker_v20_2_0.js \
  sw_v20_2_0.js \
  assets/icon.svg
  do
    curl -fsS "http://127.0.0.1:$PORT/$f" >/dev/null
  done
curl -fsSI "http://127.0.0.1:$PORT/js/does-not-exist.js" | grep -q '404' || exit 1
printf '%s\n' 'PASS http_smoke_v20_2_0'

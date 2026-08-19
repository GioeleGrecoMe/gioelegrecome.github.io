#!/bin/sh
set -eu
cd "$(dirname "$0")"
clang --target=wasm32 -O3 -fno-builtin -nostdlib slam_core.c -o slam_core.wasm \
  -Wl,--no-entry -Wl,--export-memory \
  -Wl,--initial-memory=8388608 -Wl,--max-memory=33554432 -Wl,--strip-all
printf 'Built %s\n' "$(pwd)/slam_core.wasm"

#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
INPUT="$ROOT/test/online-data/tum_freiburg1_xyz_rgb_preview.png"
OUTPUT="$ROOT/test/online-data/tum_freiburg1_xyz_debug_replay.mp4"

# A short deterministic replay lets the debug suite exercise the installed video
# decoder using a frame from a real public RGB-D sequence without bundling the
# much larger original AVI.
ffmpeg -hide_banner -loglevel error -y \
  -loop 1 -framerate 30 -i "$INPUT" \
  -t 2 -vf "scale=640:480,format=yuv420p" \
  -c:v libx264 -preset veryfast -crf 23 -movflags +faststart "$OUTPUT"

# Decode the complete replay to /dev/null. A corrupt/unsupported output causes a
# non-zero exit code and therefore fails the debug command.
ffmpeg -hide_banner -loglevel error -i "$OUTPUT" -f null -
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,r_frame_rate -show_entries format=duration \
  -of default=noprint_wrappers=1 "$OUTPUT"

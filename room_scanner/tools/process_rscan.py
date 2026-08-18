#!/usr/bin/env python3
"""Inspect and convert a Room Scanner RSCAN-ZIP-1 bundle.

The script deliberately depends only on the Python standard library. It can be
used immediately on another computer to recover metric surfels, trajectory,
audio and diagnostics even when the phone cannot run the in-browser processor.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import statistics
import struct
import sys
import wave
import zipfile
from collections import defaultdict
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Validate and unpack Room Scanner RAW data")
    p.add_argument("bundle", type=Path, help="*.rscan.zip file exported by the webpage")
    p.add_argument("--out", type=Path, default=Path("roomscan_processed"), help="output directory")
    p.add_argument("--voxel", type=float, default=0.075, help="metric decimation voxel in metres")
    p.add_argument("--extract-images", action="store_true", help="copy JPEG keyframes to output")
    return p.parse_args()


def load_ndjson(zf: zipfile.ZipFile, name: str) -> list[dict]:
    try:
        text = zf.read(name).decode("utf-8")
    except KeyError:
        return []
    out = []
    for line_no, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON in {name}:{line_no}: {exc}") from exc
    return out


def identity() -> list[float]:
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def yaw_translation(yaw: float, t: tuple[float, float, float]) -> list[float]:
    c, s = math.cos(yaw), math.sin(yaw)
    return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, t[0], t[1], t[2], 1]


def transform_point(m: list[float], p: tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z = p
    return (
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    )


def transform_direction(m: list[float], n: tuple[float, float, float]) -> tuple[float, float, float]:
    x = m[0] * n[0] + m[4] * n[1] + m[8] * n[2]
    y = m[1] * n[0] + m[5] * n[1] + m[9] * n[2]
    z = m[2] * n[0] + m[6] * n[1] + m[10] * n[2]
    length = math.sqrt(x * x + y * y + z * z) or 1.0
    return x / length, y / length, z / length


def estimate_registration(session: dict, mark_records: list[dict]) -> dict:
    segment_ids = [s["id"] for s in session.get("segments", []) if s.get("id")]
    points = [r.get("value", r) for r in mark_records]
    if not segment_ids:
        segment_ids = list(dict.fromkeys(p.get("segmentId") for p in points if p.get("segmentId")))
    reference = segment_ids[0] if segment_ids else "segment-0"
    groups: dict[str, dict[str, dict]] = defaultdict(dict)
    for p in points:
        if p.get("logicalId") and p.get("segmentId") and p.get("position"):
            old = groups[p["logicalId"]].get(p["segmentId"])
            if old is None or p.get("quality", 0) > old.get("quality", 0):
                groups[p["logicalId"]][p["segmentId"]] = p
    transforms = {reference: {"registered": True, "matrix": identity(), "matches": 0, "residualM": 0.0}}
    for sid in segment_ids:
        if sid == reference:
            continue
        pairs = []
        for logical, per_segment in groups.items():
            if reference in per_segment and sid in per_segment:
                pairs.append((logical, per_segment[reference]["position"], per_segment[sid]["position"]))
        transforms[sid] = fit_yaw_translation(reference, sid, pairs)
    return {"referenceSegmentId": reference, "transforms": transforms,
            "unregistered": [s for s in segment_ids if not transforms.get(s, {}).get("registered")]}


def fit_yaw_translation(reference: str, moving: str, pairs: list[tuple]) -> dict:
    if not pairs:
        return {"registered": False, "matrix": None, "matches": 0, "residualM": None}
    rx = statistics.fmean(p[1][0] for p in pairs)
    ry = statistics.fmean(p[1][1] for p in pairs)
    rz = statistics.fmean(p[1][2] for p in pairs)
    mx = statistics.fmean(p[2][0] for p in pairs)
    mz = statistics.fmean(p[2][2] for p in pairs)
    a = b = 0.0
    for _, ref, mov in pairs:
        qx, qz = mov[0] - mx, mov[2] - mz
        px, pz = ref[0] - rx, ref[2] - rz
        a += qx * px + qz * pz
        b += qx * pz - qz * px
    yaw = math.atan2(b, a) if len(pairs) >= 2 else 0.0
    c, s = math.cos(yaw), math.sin(yaw)
    tx, tz = rx - (c * mx - s * mz), rz - (s * mx + c * mz)
    ty = statistics.median(p[1][1] - p[2][1] for p in pairs)
    matrix = yaw_translation(yaw, (tx, ty, tz))
    residuals = []
    for _, ref, mov in pairs:
        mapped = transform_point(matrix, tuple(mov))
        residuals.append(math.dist(mapped, tuple(ref)))
    residual = statistics.median(residuals)
    registered = (len(pairs) >= 2 and residual < 0.22) or (len(pairs) == 1 and residual < 0.08)
    return {"registered": registered, "matrix": matrix if registered else None,
            "matches": len(pairs), "residualM": residual, "yawRad": yaw,
            "translation": [tx, ty, tz], "referenceSegmentId": reference, "segmentId": moving}


def decode_rspt(data: bytes, origin: list[float]):
    if len(data) < 20 or struct.unpack_from("<I", data, 0)[0] != 0x52535054:
        raise ValueError("invalid RSPT point batch")
    version, stride = struct.unpack_from("<HH", data, 4)
    count = struct.unpack_from("<I", data, 8)[0]
    if version != 1 or stride < 14 or 20 + count * stride > len(data):
        raise ValueError(f"unsupported/corrupt RSPT version={version} stride={stride} count={count}")
    for i in range(count):
        off = 20 + i * stride
        dx, dy, dz = struct.unpack_from("<hhh", data, off)
        nx, ny, nz = struct.unpack_from("<bbb", data, off + 6)
        r, g, b, conf = struct.unpack_from("<BBBB", data, off + 9)
        yield ((origin[0] + dx / 1000, origin[1] + dy / 1000, origin[2] + dz / 1000),
               (nx / 127, ny / 127, nz / 127), (r, g, b), conf / 255)


def voxel_fuse(points, voxel: float):
    cells = {}
    for position, normal, rgb, conf in points:
        key = tuple(math.floor(v / voxel) for v in position)
        cell = cells.get(key)
        weight = max(0.08, conf)
        if cell is None:
            cell = [0.0, [0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0], 0]
            cells[key] = cell
        cell[0] += weight
        cell[4] += 1
        for j in range(3):
            cell[1][j] += position[j] * weight
            cell[2][j] += normal[j] * weight
            cell[3][j] += rgb[j] * weight
    for cell in cells.values():
        w = cell[0]
        p = tuple(v / w for v in cell[1])
        n = tuple(v / w for v in cell[2])
        nl = math.sqrt(sum(v * v for v in n)) or 1.0
        n = tuple(v / nl for v in n)
        rgb = tuple(max(0, min(255, round(v / w))) for v in cell[3])
        yield p, n, rgb, cell[4]


def write_ply(path: Path, points) -> int:
    points = list(points)
    with path.open("w", encoding="ascii", newline="\n") as f:
        f.write("ply\nformat ascii 1.0\n")
        f.write(f"element vertex {len(points)}\n")
        for prop in ("float x", "float y", "float z", "float nx", "float ny", "float nz",
                     "uchar red", "uchar green", "uchar blue", "uint support"):
            f.write(f"property {prop}\n")
        f.write("end_header\n")
        for p, n, rgb, support in points:
            f.write(f"{p[0]:.6f} {p[1]:.6f} {p[2]:.6f} {n[0]:.6f} {n[1]:.6f} {n[2]:.6f} "
                    f"{rgb[0]} {rgb[1]} {rgb[2]} {support}\n")
    return len(points)


def main() -> int:
    args = parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.bundle) as zf:
        bad = zf.testzip()
        if bad:
            raise ValueError(f"CRC failure in {bad}")
        manifest = json.loads(zf.read("manifest.json"))
        if manifest.get("format") != "RSCAN-ZIP-1":
            raise ValueError(f"Unsupported format: {manifest.get('format')}")
        session = manifest["session"]
        mark_records = load_ndjson(zf, "records/markpoint.ndjson")
        pose_records = load_ndjson(zf, "records/pose-chunk.ndjson")
        events = load_ndjson(zf, "diagnostics/events.ndjson")
        registration = estimate_registration(session, mark_records)
        entry_by_leaf = {Path(e["key"]).name: e for e in manifest.get("entries", [])}
        raw_points = []
        skipped_batches = 0
        for name in sorted(n for n in zf.namelist() if n.startswith("depth/") and n.endswith(".rspt")):
            meta = entry_by_leaf.get(Path(name).name, {}).get("meta", {})
            sid = meta.get("segmentId") or registration["referenceSegmentId"]
            reg = registration["transforms"].get(sid, {})
            if sid != registration["referenceSegmentId"] and not reg.get("registered"):
                skipped_batches += 1
                continue
            matrix = reg.get("matrix") or identity()
            for p, n, rgb, conf in decode_rspt(zf.read(name), meta.get("origin", [0, 0, 0])):
                raw_points.append((transform_point(matrix, p), transform_direction(matrix, n), rgb, conf))
        point_count = write_ply(args.out / "metric_surfels.ply", voxel_fuse(raw_points, args.voxel))

        with (args.out / "trajectory.csv").open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["segment_id", "time_epoch_ms", "time_xr_ms", "x_m", "y_m", "z_m", "registered"])
            for rec in pose_records:
                for pose in rec.get("value", {}).get("poses", []):
                    sid = pose.get("segmentId") or registration["referenceSegmentId"]
                    reg = registration["transforms"].get(sid, {})
                    registered = sid == registration["referenceSegmentId"] or reg.get("registered", False)
                    if not registered:
                        continue
                    p = transform_point(reg.get("matrix") or identity(), tuple(pose["position"]))
                    writer.writerow([sid, pose.get("timeEpoch"), pose.get("timeXR"), *p, int(registered)])

        audio_entries = sorted((e for e in manifest.get("entries", []) if e.get("kind") == "audio-pcm"),
                               key=lambda e: e.get("meta", {}).get("sequence", 0))
        if audio_entries:
            sample_rate = int(audio_entries[0].get("meta", {}).get("sampleRate", 48000))
            with wave.open(str(args.out / "microphone_continuous.wav"), "wb") as wav:
                wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(sample_rate)
                for entry in audio_entries:
                    leaf = Path(entry["key"]).name
                    wav.writeframes(zf.read(f"audio/{leaf}"))

        if args.extract_images:
            image_dir = args.out / "frames"
            image_dir.mkdir(exist_ok=True)
            for name in (n for n in zf.namelist() if n.startswith("frames/") and n.endswith(".jpg")):
                (image_dir / Path(name).name).write_bytes(zf.read(name))

        summary = {
            "format": manifest["format"], "sessionId": manifest["sessionId"],
            "build": manifest.get("build"), "zipEntries": len(zf.namelist()),
            "metricSurfelCount": point_count, "rawPointCount": len(raw_points),
            "skippedUnregisteredDepthBatches": skipped_batches,
            "registration": registration, "diagnosticEvents": len(events),
            "lastEvents": events[-30:], "session": session,
        }
        (args.out / "diagnostics_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        (args.out / "registration.json").write_text(json.dumps(registration, indent=2), encoding="utf-8")
    print(json.dumps({"status": "ok", "output": str(args.out), "surfels": point_count,
                      "unregistered": registration["unregistered"]}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # A clear single-line failure is useful in support logs.
        print(f"ERROR: {exc}", file=sys.stderr)
        raise

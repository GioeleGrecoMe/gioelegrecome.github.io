# RSCAN RAW Archive Format - V20.2.0

The exported file is a standard ZIP archive using stored entries. Compression is intentionally disabled so JPEG, PCM and compact depth blobs can be streamed into the archive without a second large compression buffer.

## Top-level layout

```text
manifest.json
diagnostics/events.ndjson
records/<kind>/<record-id>.json
blobs/frames/<frame-id>.jpg
blobs/depth/<depth-id>.rspt
blobs/audio/<chunk-id>.pcm16
models/<model-id>.json
```

The exact set of directories is data-dependent. Every binary entry has a corresponding JSON record containing timestamps, segment ID, coordinate-frame information and source relationships.

## Manifest

The manifest includes:

- format and application versions;
- session ID and creation/update timestamps;
- completion/recovery state;
- list of segments and their metric-frame status;
- device/browser capability summary;
- audio settings actually obtained;
- counts and byte sizes by record type;
- diagnostics summary;
- model references when present.

## RSPT v1

Each metric depth entry begins with a fixed header identifying `RSPT` and version 1, followed by the camera/world reference origin and packed points.

Each point uses 14 bytes:

```text
int16 x_mm
int16 y_mm
int16 z_mm
int8  normal_x
int8  normal_y
int8  normal_z
uint8 red
uint8 green
uint8 blue
uint8 confidence/source flags
uint8 reserved
```

Coordinates are offsets from the origin stored in the associated JSON record. The record also links the XR frame, camera pose, depth source and any RGB frame captured nearby.

## PCM16

Audio chunks are little-endian signed 16-bit mono PCM. Metadata records contain:

- actual sample rate;
- absolute stream frame range;
- AudioContext and performance timing observations;
- microphone constraint settings/capabilities;
- chirp windows referencing relevant frame ranges.

Do not infer propagation distance from an absolute PCM index. RIR processing detects the direct path and uses reflection delay relative to that arrival.

## Stability and compatibility

Readers must ignore unknown record fields and preserve unknown entries when repackaging. A processing failure must not mutate the archive. Coordinate transforms must not introduce a segment scale unless a future format explicitly changes the metric authority contract.

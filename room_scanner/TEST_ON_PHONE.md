# Phone Validation Protocol - V20.2.0

Use a recent Chrome Android build with ARCore support, HTTPS and at least several hundred megabytes of free storage. Disable Bluetooth audio for the first acoustic tests.

## A. First-load and persistence

1. Clear the site's old storage once.
2. Open `room_scanner_v12.html` and verify the visible build is `V20.2.0`.
3. Grant camera/motion/microphone permissions.
4. Start capture and walk for 20 seconds.
5. Force-close Chrome without using the exit button.
6. Reopen the site.

Expected: the session is listed as recoverable; already committed poses/depth/photos/audio can be exported. Only the final small in-flight batches may be missing.

## B. Critical XR exit test

1. Start a capture with RGB, depth and audio enabled.
2. Wait until several keyframes and chirps have been recorded.
3. Press **Save and leave XR** while moving slowly.
4. Do not press any processing action.

Expected:

- XR closes once;
- the webpage remains open in the same document;
- no Deep model or FFT starts;
- memory use should fall rather than spike;
- the review screen shows record counts;
- `Export RAW` and `Export diagnostics` work immediately.

Repeat ten times, including one exit during an RGB save and one during an acoustic window. Record any renderer crash from `chrome://crashes` and attach the exported diagnostics from the next launch.

## C. Walk-only geometry

1. Scan one room without marking walls.
2. Include floor, ceiling, four walls, a doorway, a table and a cabinet.
3. Approach boundaries and observe projected cells.
4. Leave at least one inaccessible cell red and exit normally.

Expected: cells are attached to observed/predicted surfaces, object cells are finer than wall cells, floor and ceiling receive targets, and red cells do not prevent saving.

## D. Adaptive object coverage

1. Walk around a freestanding chair or table from at least three positions.
2. Observe the object residual acquire its own cells.
3. Follow red/yellow prompts quickly, not with pixel-perfect aiming.

Expected: repeated same-position images do not falsely create strong parallax; the object becomes greener as distinct viewpoints and useful RGB/depth accumulate.

## E. Markpoints and restart

1. Place or choose a distinctive colored/textured item that will not move.
2. Attempt a mark on a blank white wall; verify rejection or low quality.
3. Save a mark on the distinctive item and confirm it from another view.
4. Leave XR, resume as a new segment, and observe the same mark plus a second mark.
5. Run processing.

Expected: the new segment is fused only when correspondence is sufficient. Scale remains unchanged. An insufficiently constrained segment is reported as separate.

## F. Multi-room scan

Walk through two or more connected rooms in one segment where possible. Include a narrow corridor and return to the first room. Do not manually outline rooms.

Expected: trajectory remains metric; the processor extracts floor/ceiling/wall candidates and preserves doorway connectivity. Inspect the model for duplicated or thick walls and retain RAW for regression comparison.

## G. RAW transfer

1. Export `.rscan.zip` immediately after XR exit.
2. Transfer it to a desktop.
3. Run:

```bash
python3 tools/process_rscan.py session.rscan.zip --output processed_session --extract-images
```

Expected: archive validation succeeds and the output contains at least a diagnostic report, trajectory CSV, PLY when depth exists, WAV when PCM exists, and extracted images when requested.

## H. Acoustic capture

1. Use the phone speaker/microphone mode in a quiet room.
2. Walk naturally for at least one minute.
3. Confirm many short chirps are distributed over the route.
4. Repeat with the phone held at different orientations.

Expected: raw PCM remains chunked; each chirp has pose/timing metadata; processing reports quality weights rather than selecting only a few poses. Treat inferred surface coefficients as effective in-situ estimates, not certified material data.

## I. Memory and thermal test

Perform a 10-minute capture with RGB, depth and chirps. Export RAW before starting processing. Then process with Deep disabled and enabled separately.

Record:

- device and Android/Chrome/ARCore versions;
- storage consumed;
- maximum resident memory if available;
- temperature/throttling warnings;
- capture and processing durations;
- diagnostics JSON;
- renderer crash IDs.

import {
  distance3,
  estimateRigidTransform3D,
  matrixToArray,
  mat4TransformEuclideanPoint,
  poseOrientation,
  posePosition,
  projectReferencePointToView,
  quaternionAngularDistanceRad,
  translationFromMatrix,
} from "./mat4.js";

const SCHEMA_VERSION = 5;
const DEFAULT_PROFILE = "default";

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function deepCloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function rms(values) {
  if (!values.length) return null;
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
}

function asArrayIfIterable(value) {
  if (value == null) return null;
  try {
    return Array.from(value);
  } catch {
    return null;
  }
}

function pinPositionsFromSample(sample) {
  const out = {};
  for (const pin of sample?.visiblePins ?? []) {
    if (Array.isArray(pin.position) && pin.position.length >= 3) {
      out[pin.pinId] = pin.position.slice(0, 3).map(Number);
    }
  }
  return out;
}

function pairwiseGeometryFromPositions(positionObject) {
  const entries = Object.entries(positionObject ?? {});
  const geometry = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      geometry.push({
        a: entries[i][0],
        b: entries[j][0],
        distanceM: distance3(entries[i][1], entries[j][1]),
      });
    }
  }
  return geometry;
}

/**
 * WebXRCalibrationManager
 * -----------------------
 * Manages calibration pins as real XRAnchor objects, determines whether pins
 * are actually tracked + visible from each calibration pose, and persists a
 * calibration profile across XR sessions.
 *
 * Critical design rules:
 *   1. A copied reticle matrix can never satisfy calibration coverage.
 *   2. Anchor poses are queried only in updateFrame(), i.e. from the active
 *      XRFrame supplied by the current XR animation callback.
 *   3. A saved calibration is not considered reusable in a new XR session until
 *      restored anchors determine and validate the rigid alignment from the
 *      saved XR reference frame to the current XR reference frame.
 */
export class WebXRCalibrationManager extends EventTarget {
  constructor(options = {}) {
    super();

    this.storageKey = options.storageKey ?? "webxr-calibration-profiles-v5";
    this.legacyStorageKeys = options.legacyStorageKeys ?? ["webxr-calibration-profiles-v4", "webxr-calibration-profiles-v3"];
    this.storage = options.storage ?? globalThis.localStorage ?? null;
    this.minPinsPerPose = options.minPinsPerPose ?? 3;
    this.minCalibrationPoses = options.minCalibrationPoses ?? 3;
    this.minPoseTranslationM = options.minPoseTranslationM ?? 0.12;
    this.minPoseRotationDeg = options.minPoseRotationDeg ?? 10;
    this.visibilityMargin = options.visibilityMargin ?? 0.02;
    this.anchorGeometryRmseThresholdM = options.anchorGeometryRmseThresholdM ?? 0.025;
    this.anchorGeometryMaxErrorThresholdM = options.anchorGeometryMaxErrorThresholdM ?? 0.04;
    this.sessionAlignmentRmseThresholdM = options.sessionAlignmentRmseThresholdM ?? 0.025;
    this.sessionAlignmentMaxErrorThresholdM = options.sessionAlignmentMaxErrorThresholdM ?? 0.04;
    // With >=4 pins, leave-one-out prediction catches a single bad anchor that
    // an all-point least-squares fit could partially absorb as rotation/translation.
    this.sessionAlignmentCrossValidationThresholdM =
      options.sessionAlignmentCrossValidationThresholdM ?? 0.04;
    this.minAlignmentTriangleArea2 = options.minAlignmentTriangleArea2 ?? 1e-5;

    // Existing project solver hooks. The manager supplies correct XR
    // observations but deliberately does not assume the project's calibration
    // parameterization.
    this.solveCalibration = options.solveCalibration ?? null;
    this.validateCalibration = options.validateCalibration ?? null;

    // Optional callback for projects whose calibration contains world/reference-
    // space transforms. It can map the saved calibration into the current XR
    // session using sessionAlignment.matrix. Intrinsics-only calibrations usually
    // do not need rebasing and can ignore this hook.
    this.rebaseCalibration = options.rebaseCalibration ?? null;

    this.profileName = DEFAULT_PROFILE;
    this.calibration = null;
    this.calibrationQuality = null;
    this.pins = new Map();
    // calibrationPoses contains observations captured in the CURRENT XR reference
    // space only. Poses loaded from a profile are kept separately so a later
    // refinement can never accidentally mix coordinates from two XR sessions.
    this.calibrationPoses = [];
    this.savedCalibrationPoses = [];
    this.historicalCalibrationPoses = [];
    this.verificationHistory = [];
    this.referencePinPositions = {};
    this.referencePinGeometry = [];
    this.referenceSnapshotPoseId = null;

    // Runtime-only XRAnchor references cannot be JSON serialized. They are
    // reconstructed each session from persistent handles when supported.
    this.runtimeAnchors = new Map();
    this.framePinState = new Map();
    this.lastFrameSummary = null;
    this.lastViewerPose = null;
    this.sessionAlignment = null;
    this.loadedFromProfile = false;
    // True when the calibration payload is expressed in a reference frame that
    // is no longer the active one (profile load or XRReferenceSpace reset).
    this.requiresReferenceAlignment = false;
    this.referenceSpaceResetCount = 0;
    this._observedReferenceSpace = null;
    this._referenceSpaceResetHandler = (event) => this._handleReferenceSpaceReset(event);
    this.state = "empty";
  }

  _emit(type, detail) {
    // CustomEvent exists in modern browsers and Node >=19. The fallback keeps
    // tests/debug harnesses usable in older JS hosts without changing browser
    // behaviour.
    if (typeof CustomEvent === "function") {
      this.dispatchEvent(new CustomEvent(type, { detail }));
      return;
    }
    const event = new Event(type);
    Object.defineProperty(event, "detail", { value: detail, enumerable: true });
    this.dispatchEvent(event);
  }

  _setState(state, extra = {}) {
    this.state = state;
    this._emit("statechange", { state, ...extra });
  }

  _observeReferenceSpace(referenceSpace) {
    if (!referenceSpace || referenceSpace === this._observedReferenceSpace) return;
    if (this._observedReferenceSpace?.removeEventListener) {
      this._observedReferenceSpace.removeEventListener("reset", this._referenceSpaceResetHandler);
    }
    this._observedReferenceSpace = referenceSpace;
    referenceSpace.addEventListener?.("reset", this._referenceSpaceResetHandler);
  }

  _handleReferenceSpaceReset(event) {
    this.referenceSpaceResetCount += 1;
    this.sessionAlignment = null;
    this.framePinState.clear();
    this.lastFrameSummary = null;
    this.lastViewerPose = null;

    // Coordinates captured before a reset and after a reset are not directly
    // comparable. Never feed both sets to the numerical solver. The calibrated
    // result and canonical anchor snapshot are retained so >=3 live anchors can
    // recover the old-reference -> new-reference alignment on a later frame.
    this.calibrationPoses = [];
    if (this.calibration) {
      this.requiresReferenceAlignment = true;
      this._setState("reference-space-reset-needs-verification", {
        resetCount: this.referenceSpaceResetCount,
        resetTransform: matrixToArray(event?.transform?.matrix),
      });
    } else {
      this._setState("collecting", {
        resetCount: this.referenceSpaceResetCount,
        resetTransform: matrixToArray(event?.transform?.matrix),
        discardedPreResetPoses: true,
      });
    }
    this._emit("referencespacereset", {
      resetCount: this.referenceSpaceResetCount,
      resetTransform: matrixToArray(event?.transform?.matrix),
    });
  }

  /**
   * Adds a pin from a real XR hit-test result.
   *
   * IMPORTANT: We intentionally do NOT call frame.getPose() after awaiting
   * createAnchor(). XRFrame.getPose() is only valid while that frame is active;
   * an await can resume after the XR animation callback has returned. The first
   * authoritative pose is instead captured by the next updateFrame() in which
   * this anchor is actually present in frame.trackedAnchors.
   *
   * frame/referenceSpace remain accepted for backward-compatible call sites but
   * are intentionally unused here.
   */
  async addPinFromHitTest({ hitResult, frame: _frame, referenceSpace: _referenceSpace, label = null, metadata = {} }) {
    if (!hitResult || typeof hitResult.createAnchor !== "function") {
      throw new Error(
        "This calibration pin requires XRHitTestResult.createAnchor(). " +
        "A reticle transform is intentionally not accepted as a calibration pin.",
      );
    }

    // Calling createAnchor() itself must happen while the hit-test result's frame
    // is active. The promise may resolve later, which is why no old-frame query
    // follows this await.
    const anchor = await hitResult.createAnchor();
    if (!anchor?.anchorSpace) {
      anchor?.delete?.();
      throw new Error("WebXR returned an anchor without anchorSpace.");
    }

    let persistentHandle = null;
    let persistence = "session-only";
    if (typeof anchor.requestPersistentHandle === "function") {
      try {
        persistentHandle = await anchor.requestPersistentHandle();
        persistence = "native-persistent";
      } catch (error) {
        console.warn("[calibration] persistent handle request failed", error);
      }
    }

    const id = uid("pin");
    const pin = {
      id,
      label: label ?? `Pin ${this.pins.size + 1}`,
      persistentHandle,
      persistence,
      createdAt: nowIso(),
      firstLocatedAt: null,
      metadata: deepCloneJson(metadata),
      // Filled only by updateFrame() from a live tracked anchor. These values are
      // diagnostic/reference data, never a substitute for live anchor tracking.
      creationReferencePoseMatrix: null,
      referenceGeometryPosition: null,
    };

    this.pins.set(id, pin);
    this.runtimeAnchors.set(id, anchor);
    this._setState("collecting", { pinId: id, awaitingFirstTrackedPose: true });
    this._emit("pinadded", { pin: deepCloneJson(pin) });
    return deepCloneJson(pin);
  }

  /**
   * Restores saved native persistent anchors into a newly created XRSession.
   * Failed/unavailable handles remain unresolved; serialized matrices are never
   * promoted to live anchors.
   */
  async restorePersistentAnchors(session) {
    const report = { restored: [], missing: [], unsupported: [], errors: {} };
    this.runtimeAnchors.clear();
    this.sessionAlignment = null;

    const persistentList = asArrayIfIterable(session?.persistentAnchors);
    for (const pin of this.pins.values()) {
      if (!pin.persistentHandle) {
        report.unsupported.push(pin.id);
        continue;
      }
      if (typeof session?.restorePersistentAnchor !== "function") {
        report.unsupported.push(pin.id);
        continue;
      }

      try {
        if (persistentList && !persistentList.includes(pin.persistentHandle)) {
          report.missing.push(pin.id);
          continue;
        }
        const anchor = await session.restorePersistentAnchor(pin.persistentHandle);
        if (!anchor?.anchorSpace) throw new Error("restored-anchor-has-no-anchorSpace");
        this.runtimeAnchors.set(pin.id, anchor);
        report.restored.push(pin.id);
      } catch (error) {
        console.warn(`[calibration] restore failed for ${pin.id}`, error);
        report.missing.push(pin.id);
        report.errors[pin.id] = String(error?.message ?? error);
      }
    }

    this._setState(
      this.calibration ? "loaded-needs-verification" : "collecting",
      { restoreReport: report },
    );
    this._emit("anchorsrestored", deepCloneJson(report));
    return report;
  }

  /**
   * Must be called synchronously from each XR animation callback after
   * frame.getViewerPose(referenceSpace). This function is the ONLY place where
   * live anchor poses are queried.
   */
  updateFrame({ frame, referenceSpace, viewerPose }) {
    this._observeReferenceSpace(referenceSpace);
    this.framePinState.clear();
    this.lastViewerPose = viewerPose ?? null;

    const views = viewerPose?.views ?? [];
    const trackedSet = frame?.trackedAnchors;
    const hasTrackedSet = Boolean(trackedSet && typeof trackedSet.has === "function");
    let trackedCount = 0;
    let visibleCount = 0;
    let locatableCount = 0;
    let errorCount = 0;

    for (const [pinId, pin] of this.pins) {
      const anchor = this.runtimeAnchors.get(pinId);
      const state = {
        pinId,
        label: pin.label,
        anchored: Boolean(anchor),
        tracked: false,
        locatable: false,
        visible: false,
        poseMatrix: null,
        position: null,
        projections: [],
        trackingSource: hasTrackedSet ? "frame.trackedAnchors" : "getPose-fallback",
        trackingError: null,
      };

      if (!anchor) {
        this.framePinState.set(pinId, state);
        continue;
      }

      state.tracked = hasTrackedSet ? trackedSet.has(anchor) : true;
      if (!state.tracked) {
        this.framePinState.set(pinId, state);
        continue;
      }

      try {
        // anchorSpace can itself throw after anchor.delete(). Keep the per-pin
        // error visible in diagnostics rather than breaking the whole XR frame.
        const anchorSpace = anchor.anchorSpace;
        const pose = frame.getPose(anchorSpace, referenceSpace);
        state.locatable = Boolean(pose);
        if (state.locatable) {
          const matrix = pose.transform.matrix;
          const position = translationFromMatrix(matrix);
          state.poseMatrix = matrixToArray(matrix);
          state.position = position;
          state.projections = views.map((view, viewIndex) => ({
            viewIndex,
            ...projectReferencePointToView(position, view, this.visibilityMargin),
          }));
          state.visible = state.projections.some((p) => p.visible);

          // Capture the first real tracked pose for diagnostics/migration. This
          // never makes an untracked saved pin count as live in a future session.
          if (!pin.creationReferencePoseMatrix) {
            pin.creationReferencePoseMatrix = state.poseMatrix.slice();
            pin.referenceGeometryPosition = position.slice();
            pin.firstLocatedAt = nowIso();
            this._emit("pinlocated", { pin: deepCloneJson(pin) });
          }
        }
      } catch (error) {
        state.trackingError = String(error?.message ?? error);
        errorCount += 1;
      }

      if (state.tracked && state.locatable) trackedCount += 1;
      if (state.locatable) locatableCount += 1;
      if (state.visible) visibleCount += 1;
      this.framePinState.set(pinId, state);
    }

    this.lastFrameSummary = {
      timestamp: nowIso(),
      totalPins: this.pins.size,
      runtimeAnchors: this.runtimeAnchors.size,
      trackedCount,
      locatableCount,
      visibleCount,
      errorCount,
      minPinsPerPose: this.minPinsPerPose,
      poseEligible: visibleCount >= this.minPinsPerPose,
      trackingSource: hasTrackedSet ? "frame.trackedAnchors" : "getPose-fallback",
    };

    this._emit("frameupdate", deepCloneJson(this.lastFrameSummary));
    return deepCloneJson(this.lastFrameSummary);
  }

  getVisiblePins() {
    return [...this.framePinState.values()].filter((pin) => pin.visible);
  }

  getFramePinState() {
    return [...this.framePinState.values()].map(deepCloneJson);
  }

  /**
   * Records a calibration/refinement pose only if enough real tracked anchors
   * are visible and the camera pose is sufficiently different from every prior
   * accepted pose.
   */
  captureCalibrationPose({ viewerPose = this.lastViewerPose, tag = "calibration" } = {}) {
    if (!viewerPose) return { accepted: false, reason: "no-viewer-pose" };

    const visiblePins = this.getVisiblePins();
    if (visiblePins.length < this.minPinsPerPose) {
      return {
        accepted: false,
        reason: "not-enough-visible-anchored-pins",
        visiblePins: visiblePins.length,
        required: this.minPinsPerPose,
      };
    }

    const currentPosition = posePosition(viewerPose);
    const currentOrientation = poseOrientation(viewerPose);
    const tooSimilar = this.calibrationPoses.some((sample) => {
      if (!currentPosition || !sample.viewerPosition) return false;
      const d = distance3(currentPosition, sample.viewerPosition);
      let angleDeg = Infinity;
      if (currentOrientation && sample.viewerOrientation) {
        angleDeg = quaternionAngularDistanceRad(currentOrientation, sample.viewerOrientation) * 180 / Math.PI;
      }
      // Reject only when BOTH translation and rotation are below thresholds. A
      // sufficiently large change in either dimension provides a new viewpoint.
      return d < this.minPoseTranslationM && angleDeg < this.minPoseRotationDeg;
    });

    if (tooSimilar) {
      return {
        accepted: false,
        reason: "pose-too-similar",
        minPoseTranslationM: this.minPoseTranslationM,
        minPoseRotationDeg: this.minPoseRotationDeg,
      };
    }

    const sample = {
      id: uid("pose"),
      tag,
      capturedAt: nowIso(),
      viewerMatrix: matrixToArray(viewerPose.transform.matrix),
      viewerPosition: currentPosition,
      viewerOrientation: currentOrientation,
      views: (viewerPose.views ?? []).map((view) => ({
        eye: view.eye ?? "none",
        transformMatrix: matrixToArray(view.transform.matrix),
        inverseTransformMatrix: matrixToArray(view.transform.inverse.matrix),
        projectionMatrix: matrixToArray(view.projectionMatrix),
      })),
      visiblePins: visiblePins.map((pinState) => ({
        pinId: pinState.pinId,
        poseMatrix: pinState.poseMatrix,
        position: pinState.position,
        projections: pinState.projections,
      })),
    };

    this.calibrationPoses.push(sample);
    this._setState("collecting", { capturedPoseId: sample.id });
    this._emit("posecaptured", deepCloneJson(sample));
    return { accepted: true, sample: deepCloneJson(sample), coverage: this.getCoverageReport() };
  }

  getCoverageReport() {
    const qualifying = this.calibrationPoses.filter(
      (sample) => (sample.visiblePins?.length ?? 0) >= this.minPinsPerPose,
    );
    return {
      qualifyingPoses: qualifying.length,
      requiredPoses: this.minCalibrationPoses,
      minPinsPerPose: this.minPinsPerPose,
      ready: qualifying.length >= this.minCalibrationPoses,
      poseIds: qualifying.map((sample) => sample.id),
    };
  }

  async solve({ mode = "initial", extra = {} } = {}) {
    const coverage = this.getCoverageReport();
    if (!coverage.ready) {
      throw new Error(
        `Calibration requires ${this.minCalibrationPoses} distinct poses with ` +
        `${this.minPinsPerPose} visible tracked pins each.`,
      );
    }
    if (typeof this.solveCalibration !== "function") {
      throw new Error(
        "No solveCalibration callback was provided. Connect this manager to the existing project calibration solver.",
      );
    }
    if (mode === "refinement" && this.calibration && this.requiresReferenceAlignment && !this.sessionAlignment) {
      throw new Error(
        "The existing calibration belongs to another/reset XR reference space. " +
        "Verify restored anchors before refinement so the old-to-current alignment is known.",
      );
    }

    const previous = deepCloneJson(this.calibration);
    let previousForSolver = previous;
    if (previous && this.requiresReferenceAlignment && this.sessionAlignment && typeof this.rebaseCalibration === "function") {
      previousForSolver = this.rebaseCalibration({
        calibration: deepCloneJson(previous),
        savedReferenceToCurrentReferenceMatrix: this.sessionAlignment.matrix.slice(),
        sessionAlignment: deepCloneJson(this.sessionAlignment),
      });
    }
    const candidate = await this.solveCalibration({
      mode,
      previousCalibration: deepCloneJson(previousForSolver),
      previousCalibrationOriginal: previous,
      previousCalibrationRequiresRebase: Boolean(previous && this.requiresReferenceAlignment && !this.rebaseCalibration),
      savedReferenceToCurrentReferenceMatrix: this.sessionAlignment?.matrix?.slice?.() ?? null,
      poses: deepCloneJson(this.calibrationPoses),
      pins: [...this.pins.values()].map(deepCloneJson),
      extra: deepCloneJson(extra),
    });
    if (!candidate) throw new Error("Calibration solver returned no candidate solution.");

    let validation = { accepted: true, score: null, details: null };
    if (typeof this.validateCalibration === "function") {
      validation = await this.validateCalibration({
        candidate: deepCloneJson(candidate),
        previousCalibration: deepCloneJson(previousForSolver),
        previousCalibrationOriginal: previous,
        previousCalibrationRequiresRebase: Boolean(previous && this.requiresReferenceAlignment && !this.rebaseCalibration),
        savedReferenceToCurrentReferenceMatrix: this.sessionAlignment?.matrix?.slice?.() ?? null,
        poses: deepCloneJson(this.calibrationPoses),
        pins: [...this.pins.values()].map(deepCloneJson),
        mode,
      });
      if (validation?.accepted === false) {
        this._emit("calibrationrejected", { mode, validation: deepCloneJson(validation) });
        return { accepted: false, candidate: deepCloneJson(candidate), validation: deepCloneJson(validation) };
      }
    }

    // The accepted candidate is defined by observations from the CURRENT
    // reference space. Archive the pose set associated with any previously
    // loaded calibration, then make this session authoritative.
    if (this.savedCalibrationPoses.length) {
      this.historicalCalibrationPoses.push(...deepCloneJson(this.savedCalibrationPoses));
      this.savedCalibrationPoses = [];
    }
    this.calibration = deepCloneJson(candidate);
    this.calibrationQuality = deepCloneJson(validation);
    this.loadedFromProfile = false;
    this.requiresReferenceAlignment = false;
    this.sessionAlignment = null;
    this._captureReferencePinSnapshot();
    this._setState("calibrated", { mode, validation: deepCloneJson(validation) });
    this._emit("calibrated", { mode, calibration: deepCloneJson(this.calibration), validation: deepCloneJson(validation) });
    return { accepted: true, calibration: deepCloneJson(this.calibration), validation: deepCloneJson(validation) };
  }

  async improve(extra = {}) {
    return this.solve({ mode: "refinement", extra });
  }

  /**
   * Select one real calibration frame as the canonical saved XR reference
   * snapshot. Using all pins from the same frame is essential: if the runtime
   * performs a reference-space reset between samples, absolute coordinates from
   * different frames should not be averaged together.
   */
  _captureReferencePinSnapshot() {
    const candidates = this.calibrationPoses
      .filter((sample) => (sample.visiblePins?.length ?? 0) >= this.minPinsPerPose)
      .sort((a, b) => (b.visiblePins?.length ?? 0) - (a.visiblePins?.length ?? 0));

    const sample = candidates[0] ?? null;
    if (!sample) {
      this.referencePinPositions = {};
      this.referencePinGeometry = [];
      this.referenceSnapshotPoseId = null;
      return;
    }

    this.referencePinPositions = pinPositionsFromSample(sample);
    this.referencePinGeometry = pairwiseGeometryFromPositions(this.referencePinPositions);
    this.referenceSnapshotPoseId = sample.id;
  }

  _currentCommonCorrespondences({ visibleOnly = true } = {}) {
    const saved = this.referencePinPositions ?? {};
    const states = [...this.framePinState.values()].filter((state) =>
      state.tracked && state.locatable && state.position && (!visibleOnly || state.visible));
    const common = states.filter((state) => Array.isArray(saved[state.pinId]));
    return {
      ids: common.map((state) => state.pinId),
      source: common.map((state) => saved[state.pinId].slice()),
      target: common.map((state) => state.position.slice()),
    };
  }

  /**
   * Estimates the rigid transform that maps coordinates stored in the saved
   * profile's XR reference frame into the current session's reference frame.
   */
  estimateCurrentSessionAlignment({ visibleOnly = true } = {}) {
    const corr = this._currentCommonCorrespondences({ visibleOnly });
    if (corr.ids.length < this.minPinsPerPose) {
      return {
        ok: false,
        reason: "not-enough-common-pins-for-session-alignment",
        commonPins: corr.ids.length,
        required: this.minPinsPerPose,
        pinIds: corr.ids,
      };
    }

    const fit = estimateRigidTransform3D(corr.source, corr.target, {
      minTriangleArea2: this.minAlignmentTriangleArea2,
    });
    const result = {
      ...fit,
      pinIds: corr.ids,
      thresholdM: this.sessionAlignmentRmseThresholdM,
      maxErrorThresholdM: this.sessionAlignmentMaxErrorThresholdM,
      crossValidationThresholdM: this.sessionAlignmentCrossValidationThresholdM,
      crossValidationErrorsM: [],
      crossValidationMaxErrorM: null,
    };
    if (fit.ok) {
      // Leave-one-out validation is only possible with >=4 points because each
      // training subset still needs three non-collinear correspondences. It is
      // intentionally diagnostic/reject-only: the final transform remains the
      // all-point least-squares estimate when every anchor is self-consistent.
      if (corr.ids.length >= 4) {
        for (let holdout = 0; holdout < corr.ids.length; holdout += 1) {
          const sourceTrain = corr.source.filter((_, i) => i !== holdout);
          const targetTrain = corr.target.filter((_, i) => i !== holdout);
          const cvFit = estimateRigidTransform3D(sourceTrain, targetTrain, {
            minTriangleArea2: this.minAlignmentTriangleArea2,
          });
          if (!cvFit.ok) continue;
          const predicted = mat4TransformEuclideanPoint(cvFit.matrix, corr.source[holdout]);
          const errorM = predicted ? distance3(predicted, corr.target[holdout]) : Infinity;
          result.crossValidationErrorsM.push({ pinId: corr.ids[holdout], errorM });
        }
        if (result.crossValidationErrorsM.length) {
          result.crossValidationMaxErrorM = Math.max(...result.crossValidationErrorsM.map((x) => x.errorM));
        }
      }

      const rmseOk = fit.rmseM <= this.sessionAlignmentRmseThresholdM;
      const maxErrorOk = fit.maxErrorM <= this.sessionAlignmentMaxErrorThresholdM;
      const crossValidationOk = result.crossValidationMaxErrorM == null ||
        result.crossValidationMaxErrorM <= this.sessionAlignmentCrossValidationThresholdM;
      result.accepted = rmseOk && maxErrorOk && crossValidationOk;
      result.reason = result.accepted
        ? "session-alignment-consistent"
        : (!rmseOk
          ? "session-alignment-residual-too-large"
          : (!maxErrorOk
            ? "session-alignment-max-error-too-large"
            : "session-alignment-cross-validation-failed"));
    } else {
      result.accepted = false;
    }
    return result;
  }

  /**
   * Cross-session verification of restored room anchoring. Verification checks
   * both pairwise geometry and the full old-reference -> current-reference rigid
   * alignment. Three collinear pins are rejected because they do not constrain a
   * unique 3D orientation around their common line.
   */
  verifyCurrentFrame() {
    if (!this.calibration) return { ok: false, reason: "no-calibration" };

    const visible = this.getVisiblePins();
    if (visible.length < this.minPinsPerPose) {
      const result = {
        ok: false,
        reason: "not-enough-visible-pins",
        visiblePins: visible.length,
        required: this.minPinsPerPose,
      };
      this._recordVerification(result);
      return result;
    }

    const baseline = this.referencePinGeometry ?? [];
    if (!baseline.length || Object.keys(this.referencePinPositions ?? {}).length < this.minPinsPerPose) {
      const result = {
        ok: false,
        reason: "no-reference-pin-snapshot",
        visiblePins: visible.length,
      };
      this._recordVerification(result);
      this._setState("verification-failed", { verification: result });
      return result;
    }

    const positions = new Map(visible.map((p) => [p.pinId, p.position]));
    const errors = [];
    const comparisons = [];
    for (const pair of baseline) {
      const a = positions.get(pair.a);
      const b = positions.get(pair.b);
      if (!a || !b) continue;
      const current = distance3(a, b);
      const error = current - pair.distanceM;
      errors.push(error);
      comparisons.push({ ...pair, currentDistanceM: current, errorM: error });
    }

    if (comparisons.length < 3) {
      const result = {
        ok: false,
        reason: "insufficient-common-pin-pairs",
        visiblePins: visible.length,
        pairComparisons: comparisons.length,
      };
      this._recordVerification(result);
      return result;
    }

    const geometryRmseM = rms(errors);
    const maxAbsErrorM = Math.max(...errors.map(Math.abs));
    const alignment = this.estimateCurrentSessionAlignment({ visibleOnly: true });
    const geometryOk =
      geometryRmseM <= this.anchorGeometryRmseThresholdM &&
      maxAbsErrorM <= this.anchorGeometryMaxErrorThresholdM;
    const alignmentOk = Boolean(alignment.ok && alignment.accepted);
    const ok = geometryOk && alignmentOk;

    const result = {
      ok,
      reason: ok
        ? "anchor-geometry-and-session-alignment-consistent"
        : (!geometryOk ? "anchor-geometry-drift" : alignment.reason),
      visiblePins: visible.length,
      geometryRmseM,
      maxAbsErrorM,
      geometryThresholdM: this.anchorGeometryRmseThresholdM,
      geometryMaxErrorThresholdM: this.anchorGeometryMaxErrorThresholdM,
      comparisons,
      sessionAlignment: deepCloneJson(alignment),
      overlayPins: visible.map((p) => ({
        pinId: p.pinId,
        label: p.label,
        projections: p.projections,
      })),
    };

    if (ok) {
      this.sessionAlignment = {
        verifiedAt: nowIso(),
        matrix: alignment.matrix.slice(),
        rmseM: alignment.rmseM,
        maxErrorM: alignment.maxErrorM,
        pinIds: alignment.pinIds.slice(),
      };
    } else {
      this.sessionAlignment = null;
    }

    this._recordVerification(result);
    this._setState(ok ? "verified" : "verification-failed", { verification: deepCloneJson(result) });
    return deepCloneJson(result);
  }

  _recordVerification(result) {
    this.verificationHistory.push({ checkedAt: nowIso(), ...deepCloneJson(result) });
    this._emit("verification", deepCloneJson(result));
  }

  getVerificationOverlay(viewIndex = 0) {
    return this.getVisiblePins()
      .map((pin) => {
        const p = pin.projections.find((projection) => projection.viewIndex === viewIndex);
        if (!p?.visible) return null;
        return { pinId: pin.pinId, label: pin.label, u: p.u, v: p.v, ndc: p.ndc };
      })
      .filter(Boolean);
  }

  getSessionAlignment() {
    return deepCloneJson(this.sessionAlignment);
  }

  /**
   * Returns the calibration in a form safe for the current XR session.
   *
   * Because calibration payloads are application-specific, the manager never
   * guesses which matrix inside them should be premultiplied. If a
   * rebaseCalibration callback was supplied, it is used. Otherwise the caller
   * receives the verified old->current reference-space matrix alongside the
   * untouched calibration.
   */
  getCurrentSessionCalibration() {
    if (!this.calibration) return null;
    if (!this.loadedFromProfile && !this.requiresReferenceAlignment) {
      return {
        usable: true,
        calibration: deepCloneJson(this.calibration),
        savedReferenceToCurrentReferenceMatrix: null,
        requiresConsumerRebase: false,
      };
    }
    if (this.state !== "verified" || !this.sessionAlignment) {
      return {
        usable: false,
        reason: "calibration-reference-not-verified-in-current-session",
        calibration: deepCloneJson(this.calibration),
        savedReferenceToCurrentReferenceMatrix: null,
        requiresConsumerRebase: true,
      };
    }

    if (typeof this.rebaseCalibration === "function") {
      const rebased = this.rebaseCalibration({
        calibration: deepCloneJson(this.calibration),
        savedReferenceToCurrentReferenceMatrix: this.sessionAlignment.matrix.slice(),
        sessionAlignment: deepCloneJson(this.sessionAlignment),
      });
      return {
        usable: true,
        calibration: deepCloneJson(rebased),
        savedReferenceToCurrentReferenceMatrix: this.sessionAlignment.matrix.slice(),
        requiresConsumerRebase: false,
      };
    }

    return {
      usable: true,
      calibration: deepCloneJson(this.calibration),
      savedReferenceToCurrentReferenceMatrix: this.sessionAlignment.matrix.slice(),
      requiresConsumerRebase: true,
    };
  }

  _serializeProfile() {
    return {
      schemaVersion: SCHEMA_VERSION,
      profileName: this.profileName,
      savedAt: nowIso(),
      calibration: deepCloneJson(this.calibration),
      calibrationQuality: deepCloneJson(this.calibrationQuality),
      pins: [...this.pins.values()].map(deepCloneJson),
      // If this is merely a loaded profile, its original pose set remains tied
      // to that saved calibration. Current unsolved poses are intentionally not
      // substituted because that would create a misleading mixed-space profile.
      calibrationPoses: deepCloneJson(this.loadedFromProfile ? this.savedCalibrationPoses : this.calibrationPoses),
      historicalCalibrationPoses: deepCloneJson(this.historicalCalibrationPoses),
      referencePinPositions: deepCloneJson(this.referencePinPositions ?? {}),
      referencePinGeometry: deepCloneJson(this.referencePinGeometry ?? []),
      referenceSnapshotPoseId: this.referenceSnapshotPoseId,
      verificationHistory: deepCloneJson(this.verificationHistory),
      requirements: {
        minPinsPerPose: this.minPinsPerPose,
        minCalibrationPoses: this.minCalibrationPoses,
        minPoseTranslationM: this.minPoseTranslationM,
        minPoseRotationDeg: this.minPoseRotationDeg,
        anchorGeometryRmseThresholdM: this.anchorGeometryRmseThresholdM,
        anchorGeometryMaxErrorThresholdM: this.anchorGeometryMaxErrorThresholdM,
        sessionAlignmentRmseThresholdM: this.sessionAlignmentRmseThresholdM,
        sessionAlignmentMaxErrorThresholdM: this.sessionAlignmentMaxErrorThresholdM,
        sessionAlignmentCrossValidationThresholdM: this.sessionAlignmentCrossValidationThresholdM,
      },
    };
  }

  _getProfilesFromKey(key) {
    if (!this.storage) return {};
    try {
      return JSON.parse(this.storage.getItem(key) ?? "{}") || {};
    } catch (error) {
      console.error(`[calibration] corrupt profile storage: ${key}`, error);
      return {};
    }
  }

  _getAllProfiles() {
    return this._getProfilesFromKey(this.storageKey);
  }

  saveProfile(name = this.profileName || DEFAULT_PROFILE) {
    if (!this.storage) throw new Error("Persistent browser storage is unavailable.");
    this.profileName = name;
    const profiles = this._getAllProfiles();
    profiles[name] = this._serializeProfile();
    this.storage.setItem(this.storageKey, JSON.stringify(profiles));
    this._emit("profilesaved", { name, savedAt: profiles[name].savedAt });
    return deepCloneJson(profiles[name]);
  }

  loadProfile(name = DEFAULT_PROFILE) {
    let profile = this._getAllProfiles()[name] ?? null;
    let sourceKey = this.storageKey;
    if (!profile) {
      for (const key of this.legacyStorageKeys) {
        profile = this._getProfilesFromKey(key)[name] ?? null;
        if (profile) { sourceKey = key; break; }
      }
    }
    if (!profile) return null;

    const migrated = this._migrateProfile(profile);
    this._applyProfile(migrated, name);
    if (sourceKey !== this.storageKey && this.storage) this.saveProfile(name);
    return deepCloneJson(migrated);
  }

  _migrateProfile(profile) {
    if (!profile || typeof profile !== "object") {
      throw new Error("Calibration profile must be a JSON object.");
    }
    if (profile.schemaVersion === SCHEMA_VERSION) return deepCloneJson(profile);
    if (![3, 4].includes(profile.schemaVersion)) {
      throw new Error(`Unsupported calibration profile schema: ${profile.schemaVersion}`);
    }

    const migrated = deepCloneJson(profile);
    migrated.schemaVersion = SCHEMA_VERSION;
    migrated.historicalCalibrationPoses = deepCloneJson(migrated.historicalCalibrationPoses ?? []);

    // v3 had no canonical per-profile position map. Prefer one captured frame
    // because every absolute coordinate in that frame shares one reference-space
    // state. v4 already contains this snapshot and is left intact.
    if (!migrated.referencePinPositions || Object.keys(migrated.referencePinPositions).length < this.minPinsPerPose) {
      const candidates = (migrated.calibrationPoses ?? [])
        .filter((sample) => (sample.visiblePins?.length ?? 0) >= this.minPinsPerPose)
        .sort((a, b) => (b.visiblePins?.length ?? 0) - (a.visiblePins?.length ?? 0));
      if (candidates[0]) {
        migrated.referencePinPositions = pinPositionsFromSample(candidates[0]);
        migrated.referenceSnapshotPoseId = candidates[0].id ?? null;
      } else {
        migrated.referencePinPositions = Object.fromEntries(
          (migrated.pins ?? [])
            .filter((pin) => Array.isArray(pin.referenceGeometryPosition))
            .map((pin) => [pin.id, pin.referenceGeometryPosition.slice(0, 3)]),
        );
        migrated.referenceSnapshotPoseId = null;
      }
    }
    migrated.referencePinGeometry = pairwiseGeometryFromPositions(migrated.referencePinPositions);
    return migrated;
  }

  _applyProfile(profile, name = profile.profileName ?? DEFAULT_PROFILE) {
    const migrated = this._migrateProfile(profile);
    this.profileName = name;
    this.calibration = deepCloneJson(migrated.calibration);
    this.calibrationQuality = deepCloneJson(migrated.calibrationQuality);
    this.pins = new Map((migrated.pins ?? []).map((pin) => [pin.id, deepCloneJson(pin)]));
    this.savedCalibrationPoses = deepCloneJson(migrated.calibrationPoses ?? []);
    this.historicalCalibrationPoses = deepCloneJson(migrated.historicalCalibrationPoses ?? []);
    this.calibrationPoses = [];
    this.referencePinPositions = deepCloneJson(migrated.referencePinPositions ?? {});
    this.referencePinGeometry = deepCloneJson(migrated.referencePinGeometry ?? []);
    this.referenceSnapshotPoseId = migrated.referenceSnapshotPoseId ?? null;
    this.verificationHistory = deepCloneJson(migrated.verificationHistory ?? []);
    this.runtimeAnchors.clear();
    this.framePinState.clear();
    this.sessionAlignment = null;
    this.loadedFromProfile = Boolean(this.calibration);
    this.requiresReferenceAlignment = Boolean(this.calibration);
    this._setState(this.calibration ? "loaded-needs-anchor-restore" : "collecting");
  }

  exportProfile(name = this.profileName || DEFAULT_PROFILE) {
    const profile = this._serializeProfile();
    profile.profileName = name;
    return JSON.stringify(profile, null, 2);
  }

  async importProfile(source, { saveAs = null } = {}) {
    const text = typeof source === "string" ? source : await source.text();
    const parsed = JSON.parse(text);
    const profile = this._migrateProfile(parsed);
    const name = saveAs ?? profile.profileName ?? DEFAULT_PROFILE;
    this._applyProfile(profile, name);
    if (this.storage) this.saveProfile(name);
    this._emit("profileimported", { name });
    return deepCloneJson(profile);
  }

  downloadProfile(name = this.profileName || DEFAULT_PROFILE) {
    if (typeof document === "undefined") {
      throw new Error("downloadProfile() is only available in a browser document.");
    }
    const json = this.exportProfile(name);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/[^a-z0-9_-]+/gi, "_")}.webxr-calibration.json`;
      a.click();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }

  getStatus() {
    const coverage = this.getCoverageReport();
    return {
      state: this.state,
      profileName: this.profileName,
      calibrated: Boolean(this.calibration),
      loadedFromProfile: this.loadedFromProfile,
      requiresReferenceAlignment: this.requiresReferenceAlignment,
      referenceSpaceResetCount: this.referenceSpaceResetCount,
      savedCalibrationPoseCount: this.savedCalibrationPoses.length,
      currentCalibrationPoseCount: this.calibrationPoses.length,
      pins: this.pins.size,
      runtimeAnchors: this.runtimeAnchors.size,
      frame: deepCloneJson(this.lastFrameSummary),
      coverage,
      canCalibrate: coverage.ready,
      canVerify: Boolean(this.calibration) && (this.lastFrameSummary?.visibleCount ?? 0) >= this.minPinsPerPose,
      persistentPins: [...this.pins.values()].filter((p) => p.persistentHandle).length,
      sessionAlignment: deepCloneJson(this.sessionAlignment),
      currentSessionCalibrationUsable: Boolean(
        this.calibration &&
        ((!this.loadedFromProfile && !this.requiresReferenceAlignment) ||
         (this.state === "verified" && this.sessionAlignment)),
      ),
    };
  }
}

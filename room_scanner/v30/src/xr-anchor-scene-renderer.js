import { mat4Multiply, matrixToArray } from "./mat4.js";

/**
 * XRAnchorScenePinRenderer
 * ------------------------
 * Binds visual scene objects to the LIVE 3D pose of XRAnchor objects.
 *
 * This class intentionally never reads screen-space u/v coordinates. The
 * canonical transform is `frame.getPose(anchor.anchorSpace, referenceSpace)`,
 * captured by WebXRCalibrationManager.updateFrame() during the current XR
 * animation callback. A scene object therefore remains fixed in the XR world
 * while the camera/view moves around it.
 *
 * The renderer is engine-agnostic. The default matrix adapter understands the
 * common Three.js Object3D shape (`object.matrix.fromArray(...)`), but callers
 * can provide `applyMatrix`, `addObject`, and `removeObject` callbacks for any
 * renderer.
 */
export class XRAnchorScenePinRenderer {
  constructor(manager, options = {}) {
    if (!manager || typeof manager.getFramePinState !== "function") {
      throw new TypeError("XRAnchorScenePinRenderer requires a WebXRCalibrationManager-like object.");
    }

    this.manager = manager;
    this.createObject = options.createObject ?? ((pinState) => ({
      pinId: pinState.pinId,
      visible: false,
      matrix: null,
    }));
    this.addObject = options.addObject ?? ((object) => options.scene?.add?.(object));
    this.removeObject = options.removeObject ?? ((object) => options.scene?.remove?.(object));
    this.applyMatrix = options.applyMatrix ?? defaultApplyMatrix;
    this.sceneFromReferenceMatrix = options.sceneFromReferenceMatrix ?? null;
    this.objects = new Map();
    this.lastUpdate = null;

    // EventTarget dispatch is synchronous. Since manager.updateFrame() emits
    // `frameupdate` before returning from the XR animation callback, this keeps
    // the visual transform in lockstep with the exact frame that located the
    // anchor and removes the easy-to-miss "forgot to update the pin" failure.
    this._frameListener = () => this.updateFromManager();
    manager.addEventListener?.("frameupdate", this._frameListener);
  }

  setSceneFromReferenceMatrix(matrix) {
    this.sceneFromReferenceMatrix = matrix ? matrixToArray(matrix) : null;
  }

  getObject(pinId) {
    return this.objects.get(pinId) ?? null;
  }

  updateFromManager() {
    const states = this.manager.getFramePinState();
    const liveIds = new Set();
    let located = 0;
    let hidden = 0;

    for (const state of states) {
      liveIds.add(state.pinId);
      let object = this.objects.get(state.pinId);
      if (!object) {
        object = this.createObject(state);
        if (!object) continue;
        this.objects.set(state.pinId, object);
        this.addObject?.(object, state);
      }

      // IMPORTANT: scene presence follows TRACKING/LOCATABILITY, not whether
      // the point currently lies inside the camera frustum. A world anchor does
      // not cease to exist just because the user looks away from it.
      const hasLivePose = Boolean(state.tracked && state.locatable && state.poseMatrix);
      setObjectVisible(object, hasLivePose);
      if (!hasLivePose) {
        hidden += 1;
        continue;
      }

      const referenceMatrix = state.poseMatrix;
      const sceneMatrix = this.sceneFromReferenceMatrix
        ? mat4Multiply(this.sceneFromReferenceMatrix, referenceMatrix)
        : referenceMatrix;

      this.applyMatrix(object, sceneMatrix, state);
      located += 1;
    }

    // Remove visuals for pins that were deleted from the manager entirely.
    for (const [pinId, object] of this.objects) {
      if (liveIds.has(pinId)) continue;
      this.removeObject?.(object, { pinId });
      this.objects.delete(pinId);
    }

    this.lastUpdate = {
      timestamp: new Date().toISOString(),
      objectCount: this.objects.size,
      located,
      hidden,
    };
    return { ...this.lastUpdate };
  }

  dispose() {
    this.manager.removeEventListener?.("frameupdate", this._frameListener);
    for (const [pinId, object] of this.objects) {
      this.removeObject?.(object, { pinId });
    }
    this.objects.clear();
  }
}

function setObjectVisible(object, visible) {
  if (object && "visible" in object) object.visible = visible;
}

function defaultApplyMatrix(object, matrix) {
  const values = matrixToArray(matrix);
  if (!values || values.length < 16) {
    throw new TypeError("Anchor scene matrix must contain 16 finite values.");
  }

  // Three.js Object3D path. matrixAutoUpdate MUST be disabled or the next
  // renderer update can overwrite the anchor transform with position/quaternion.
  if (object?.matrix?.fromArray) {
    object.matrixAutoUpdate = false;
    object.matrix.fromArray(values);
    object.matrixWorldNeedsUpdate = true;
    return;
  }

  // Generic engine hook used by several light render wrappers.
  if (typeof object?.setMatrix === "function") {
    object.setMatrix(values);
    return;
  }

  // Debug/plain-object path used by tests and custom renderers.
  object.matrix = values.slice();
}

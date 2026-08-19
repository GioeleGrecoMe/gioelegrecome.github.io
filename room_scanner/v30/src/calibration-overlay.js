/**
 * Screen-space DEBUG overlay for the normalized u/v projection returned by
 * WebXRCalibrationManager.getVerificationOverlay().
 *
 * IMPORTANT: this is NOT the canonical calibration-pin renderer. The overlay is
 * deliberately a fixed DOM layer because it visualizes where the live 3D anchor
 * projects into the current camera image. Use XRAnchorScenePinRenderer for the
 * actual world-locked scene object.
 */
export class CalibrationVerificationOverlay {
  constructor(container = document.body) {
    this.root = document.createElement("div");
    this.root.dataset.webxrCalibrationOverlay = "debug-screen-projection";
    Object.assign(this.root.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147483646",
      display: "none",
    });
    container.appendChild(this.root);
    this._boundManager = null;
    this._boundViewIndex = 0;
    this._frameListener = null;
  }

  show() {
    this.root.style.display = "block";
  }

  hide() {
    this.root.style.display = "none";
    this.root.replaceChildren();
  }

  /**
   * Auto-refresh from every manager frame update. EventTarget dispatch is
   * synchronous, so the projection displayed here belongs to the current XR
   * animation callback rather than to a cached placement-time coordinate.
   */
  bind(manager, { viewIndex = 0 } = {}) {
    this.unbind();
    this._boundManager = manager;
    this._boundViewIndex = viewIndex;
    this._frameListener = () => this.update(manager.getVerificationOverlay(viewIndex));
    manager.addEventListener?.("frameupdate", this._frameListener);
    this._frameListener();
    return this;
  }

  unbind() {
    if (this._boundManager && this._frameListener) {
      this._boundManager.removeEventListener?.("frameupdate", this._frameListener);
    }
    this._boundManager = null;
    this._frameListener = null;
    return this;
  }

  update(items) {
    this.root.replaceChildren();
    for (const item of items) {
      const marker = document.createElement("div");
      marker.textContent = item.label ?? item.pinId;
      marker.dataset.pinId = item.pinId;
      marker.dataset.markerKind = "debug-projected-anchor";
      Object.assign(marker.style, {
        position: "absolute",
        left: `${item.u * 100}%`,
        top: `${item.v * 100}%`,
        transform: "translate(-50%, -50%)",
        border: "2px solid currentColor",
        borderRadius: "999px",
        padding: "5px 8px",
        background: "rgba(0,0,0,0.45)",
        color: "white",
        font: "600 12px/1.2 system-ui, sans-serif",
        whiteSpace: "nowrap",
      });
      this.root.appendChild(marker);
    }
  }

  destroy() {
    this.unbind();
    this.root.remove();
  }
}

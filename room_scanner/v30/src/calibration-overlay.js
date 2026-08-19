/**
 * Tiny verification overlay for the normalized u/v positions returned by
 * WebXRCalibrationManager.getVerificationOverlay(). No network assets or
 * dependencies are used, so it works in an offline/PWA deployment.
 */
export class CalibrationVerificationOverlay {
  constructor(container = document.body) {
    this.root = document.createElement("div");
    this.root.dataset.webxrCalibrationOverlay = "true";
    Object.assign(this.root.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147483646",
      display: "none",
    });
    container.appendChild(this.root);
  }

  show() {
    this.root.style.display = "block";
  }

  hide() {
    this.root.style.display = "none";
    this.root.replaceChildren();
  }

  update(items) {
    this.root.replaceChildren();
    for (const item of items) {
      const marker = document.createElement("div");
      marker.textContent = item.label ?? item.pinId;
      marker.dataset.pinId = item.pinId;
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
    this.root.remove();
  }
}

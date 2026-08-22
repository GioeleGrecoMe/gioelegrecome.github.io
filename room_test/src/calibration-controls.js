/**
 * Optional UI wiring for Save / Load / Export / Import / Verify / Improve.
 *
 * The caller owns the application's visual design. This helper intentionally
 * expects existing button/input elements so it can be integrated without
 * replacing the project's UI framework.
 */
export function wireCalibrationControls(manager, elements = {}) {
  const {
    verifyButton,
    improveButton,
    saveButton,
    loadButton,
    exportButton,
    importInput,
    statusElement,
    onImproveRequested,
    profileName = "default",
  } = elements;

  const renderStatus = () => {
    if (!statusElement) return;
    const s = manager.getStatus();
    const frame = s.frame;
    statusElement.textContent = [
      `stato=${s.state}`,
      `pin=${s.pins}`,
      `ancorati=${s.runtimeAnchors}`,
      `visibili=${frame?.visibleCount ?? 0}`,
      `tracking=${frame ? (frame.realAnchorTrackingAvailable ? "XRAnchor" : "MANCANTE") : "n/a"}`,
      `worldlock=${frame?.worldLockDiagnostic?.status ?? "n/a"}`,
      `pose=${s.coverage.qualifyingPoses}/${s.coverage.requiredPoses}`,
      `calibrata=${s.calibrated ? "si" : "no"}`,
    ].join(" | ");
  };

  manager.addEventListener("statechange", renderStatus);
  manager.addEventListener("frameupdate", renderStatus);
  manager.addEventListener("posecaptured", renderStatus);

  verifyButton?.addEventListener("click", () => {
    const result = manager.verifyCurrentFrame();
    console.info("[calibration] verification", result);
    renderStatus();
  });

  improveButton?.addEventListener("click", async () => {
    // A refinement pose must first pass the same >=3 real visible anchors rule.
    const capture = manager.captureCalibrationPose({ tag: "refinement" });
    if (!capture.accepted) {
      console.warn("[calibration] refinement pose rejected", capture);
      return;
    }
    if (onImproveRequested) {
      await onImproveRequested({ manager, capture });
    } else {
      await manager.improve();
    }
    renderStatus();
  });

  saveButton?.addEventListener("click", () => {
    manager.saveProfile(profileName);
    renderStatus();
  });

  loadButton?.addEventListener("click", () => {
    manager.loadProfile(profileName);
    renderStatus();
  });

  exportButton?.addEventListener("click", () => manager.downloadProfile(profileName));

  importInput?.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    await manager.importProfile(file, { saveAs: profileName });
    importInput.value = "";
    renderStatus();
  });

  renderStatus();
  return { renderStatus };
}

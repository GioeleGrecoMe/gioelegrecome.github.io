# V30.28 phone validation

1. Apply the V30.28 patch over V30.27 EXP-4 and reload normally. Atomic boot remains active; Home must reach `Interfaccia pronta.` and the UI must remain clickable across repeated reloads.
2. Run the self-test once. The published build must identify itself as V30.28 and all runtime contracts should pass.
3. Run a short scan with slow lateral motion and revisit the same wall/corner several times. Deep live preview should remain frame-synchronised; Alva should remain the pose source.
4. Finish the scan and open 3D review. The optimiser status should report factor-graph iterations, reprojection error, mean pose correction and Deep residual rather than only a smoothing energy.
5. Try 5-10 iterations first. Reprojection error should decrease while pose corrections remain small. If pose corrections rapidly grow, stop: it indicates weak feature association / poor Alva prior rather than a reason to continue iterating.
6. Continue to 20-40 iterations only if the above is stable. The rebuilt Gaussian map should become thinner on repeated planar surfaces without simply collapsing all points onto one plane.
7. Save/reload the session and continue optimisation. The factor graph and Deep sequence state must survive reload.
8. Export/reimport `.r30`; the probabilistic graph must remain available for reprocessing.

Useful diagnostics: `probabilistic-sparse-evidence`, `deep-sequence-calibrated`, `probabilistic-optimization-complete`, reprojection RMSE, pose-shift mean, Deep relative error, MVS `priorEscapeRatio` and frame-sync events.

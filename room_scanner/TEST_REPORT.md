# Test report - Room Scanner V20.1.0

Data build: 2026-08-18

## Suite automatica

Comando:

```sh
./tests/run_all.sh
```

Esito corrente:

```text
PASS javascript_syntax
PASS core_geometry
PASS close_geometry_v20
PASS photo_targets
PASS depth_fit
PASS deep_metric_scaling
PASS geometry_hybrid_fit
PASS object_voxels
PASS rgb_object_points
PASS acoustic_surfaces
PASS signal_rir_latency
PASS audio_serialization
PASS audio_compatibility
PASS acoustic_association
PASS deep_worker_contract
PASS bootstrap
PASS workflow_state
PASS completion_guard
PASS coverage_guidance
PASS overlay_render
PASS checkpoint_clone
PASS post_xr_cleanup
PASS navigation_recovery
PASS checkpoint_recovery
PASS app_rir_pipeline
PASS static_contract
PASS http_smoke
PASS manifest_json
PASS build_info_json
ALL TESTS PASSED
```

## Cosa coprono i nuovi test

- `signal_rir_latency`: due lag hardware ignoti diversi producono lo stesso delay relativo dell'eco.
- `audio_serialization`: clock map clonabile, descrittore ESS coerente e offset speaker/microfono ruotati con il telefono.
- `audio_compatibility`: fallback dai vincoli DSP exact e dal sample rate richiesto al percorso audio nativo, con settings/capabilities effettivi serializzati.
- `geometry_hybrid_fit`: fit bounded su surfel rumorosi senza cambio di scala.
- `deep_metric_scaling`: calibrazione depth relativa direct e inverse.
- `acoustic_association`: posterior della superficie corretta, classe non assegnata, alpha per zona e preservazione manuale.
- `checkpoint_clone`: corner annotati, audio e geometria superano `structuredClone`.
- `app_rir_pipeline`: chirp sintetico, deconvoluzione, allineamento, eco noto e materiale inferito sulla parete corretta.

## Esclusioni

Non sono stati eseguiti in questo ambiente:

- una vera sessione `immersive-ar` Chrome Android/ARCore;
- Raw Camera Access e XR Depth hardware;
- misura della risposta dello speaker/microfono di un telefono;
- routing Bluetooth o USB;
- pressione di memoria e temperatura nel batch ONNX;
- validazione assoluta dei coefficienti di assorbimento con riferimento di laboratorio.

Queste prove sono descritte in `TEST_ON_PHONE.md`.

## Verifica pacchetto pulito

La release finale viene creata dopo la rigenerazione di `SHA256SUMS.txt`, estratta in una directory vuota, verificata con `sha256sum -c SHA256SUMS.txt` e sottoposta nuovamente a `./tests/run_all.sh`.

Il tentativo aggiuntivo di avvio visuale Chromium nel container non ha prodotto una pagina affidabile: il processo è rimasto bloccato nel sottosistema D-Bus/zygote dell'ambiente. Non viene quindi contato come prova browser superata. Il test HTTP degli asset e i test DOM/app-harness restano PASS.

## Patch diagnostica

Aggiunto `diagnostics_export.test.js`. La suite verifica che il modulo diagnostico:

- sia una dipendenza opzionale e non blocchi l'app se non disponibile;
- serializzi losslessly typed array/PCM in base64;
- produca record JSONL con schema esplicito;
- sia incluso nel service worker e negli asset HTTP;
- abbia pulsanti manuali in landing e HUD XR;
- riceva hook per runtime error, WebXR inatteso e processing fallito;
- legga gli store checkpoint/JPEG e PCM/RIR senza modificarli.

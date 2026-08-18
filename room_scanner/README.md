# Room Scanner V20.1.0 - Metric RIR Twin

Web app statica per costruire su smartphone un digital twin metrico e visuale-acustico di piu vani collegati.

Il pacchetto completo, l'architettura, i limiti e la procedura di misura sono descritti in `README_V20_1_0.md`.

Avvio locale:

```sh
python3 -m http.server 8000
```

Poi aprire `http://localhost:8000/` per la sola interfaccia. Una sessione WebXR immersiva richiede HTTPS, Chrome Android e un dispositivo ARCore compatibile.

Test automatici:

```sh
./tests/run_all.sh
```

## Debug

La build include un export diagnostico approfondito manuale e automatico con conferma. Vedere `DIAGNOSTICS_DEBUG.md`.

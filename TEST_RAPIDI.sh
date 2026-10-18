#!/bin/sh
set -eu
cd "$(dirname "$0")"
python3 soma31/rebuild.py
python3 verifica_pacchetto.py
run(){ printf 'TEST %-27s ... ' "$1"; shift; timeout 100s "$@" > /dev/null; printf '%s\n' 'PASS'; }
run 'PPG 31 - gate e avvio' node soma31/tests/test_onset31.js
run 'Feedback PPG 29' node soma31/tests/test_adaptive29.js
run 'Modulazione/voice-leading' node soma31/tests/test_harmony30.js
run 'Ambiente e STFT' node soma31/tests/test_spectral.js
run 'Toni ambientali' node soma31/tests/test_ambient.js
run 'FFT ambientale reale' node soma31/tests/test_real_fft.js
run 'DSP stereo e microfono' node soma31/tests/test_dsp.js
run 'Regressione 225 s' node soma31/tests/test_integration30.js
run 'Layout Chromium statico' python3 soma31/tests/test_browser30.py
printf '%s\n' 'SOMA 31 GH Pages: test locali completati; non sostituiscono collaudo HTTPS/audio/microfono dopo deploy.'

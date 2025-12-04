import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Square, Mic, Speaker, Activity, Settings, RefreshCw, AlertCircle, CheckCircle2, BarChart3, Fingerprint } from 'lucide-react';

type LogEntry = {
  id: number;
  time: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
};

type DeviceInfo = {
  deviceId: string;
  label: string;
};

// Costanti DSP
const FFT_SIZE = 2048;
const SMOOTHING = 0.85;
const FILTER_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const ADAPTATION_RATE = 0.05; // Velocità di apprendimento del filtro
const SIMILARITY_THRESHOLD = 0.6; // Soglia minima di correlazione

// --- COMPONENTE PRINCIPALE ---

export default function AdaptiveAudioLab() {
  // --- STATO ---
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAdapting, setIsAdapting] = useState(false);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);

  // Dispositivi
  const [inputDevices, setInputDevices] = useState<DeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<DeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>('');
  const [selectedOutput, setSelectedOutput] = useState<string>('');

  // Metriche
  const [similarity, setSimilarity] = useState(0);
  const [rmsInput, setRmsInput] = useState(0);
  const [rmsOutput, setRmsOutput] = useState(0);
  const [correctionGain, setCorrectionGain] = useState<number[]>(new Array(10).fill(0));

  // Logs
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // --- RIFERIMENTI AUDIO (Ref per evitare re-render) ---
  const nodes = useRef<{
    source: AudioBufferSourceNode | null;
    micSource: MediaStreamAudioSourceNode | null;
    analyserRef: AnalyserNode | null; // Analizza l'audio "pulito"
    analyserMic: AnalyserNode | null; // Analizza l'audio dalla stanza
    filters: BiquadFilterNode[]; // Banco di filtri EQ
    gainNode: GainNode | null;
  }>({
    source: null,
    micSource: null,
    analyserRef: null,
    analyserMic: null,
    filters: [],
    gainNode: null,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  // --- UTILS ---

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [
      ...prev.slice(-49), // Mantieni ultimi 50 log
      { id: Date.now(), time: new Date().toLocaleTimeString(), message, type }
    ]);
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // --- INIZIALIZZAZIONE ---

  useEffect(() => {
    // Carica lista devices
    const getDevices = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true }); // Richiedi permessi
        const devices = await navigator.mediaDevices.enumerateDevices();

        const inputs = devices.filter(d => d.kind === 'audioinput').map(d => ({ deviceId: d.deviceId, label: d.label || 'Microfono Sconosciuto' }));
        const outputs = devices.filter(d => d.kind === 'audiooutput').map(d => ({ deviceId: d.deviceId, label: d.label || 'Speaker Sconosciuto' }));

        setInputDevices(inputs);
        setOutputDevices(outputs);
        if (inputs.length > 0) setSelectedInput(inputs[0].deviceId);
        if (outputs.length > 0) setSelectedOutput(outputs[0].deviceId);

        addLog(`Dispositivi rilevati: ${inputs.length} Ingressi, ${outputs.length} Uscite`, 'success');
      } catch (e) {
        addLog('Errore accesso dispositivi audio. Verifica permessi.', 'error');
      }
    };
    getDevices();

    return () => {
      stopAudio();
    };
  }, []);

  // --- MOTORE AUDIO ---

  // Generatore di Rumore Rosa (Ideale per calibrazione EQ)
  const createPinkNoise = (ctx: AudioContext) => {
    const bufferSize = 4096;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0, b1, b2, b3, b4, b5, b6;
    b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      data[i] *= 0.11; // Compensazione gain
      b6 = white * 0.115926;
    }
    return buffer;
  };

  const startAudio = async () => {
    try {
      addLog('Inizializzazione Audio Context...', 'info');
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      setAudioContext(ctx);

      // 1. Setup Input (Microfono)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedInput ? { exact: selectedInput } : undefined,
          echoCancellation: false, // Disabilita elaborazione browser per misurazione pura
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      const micNode = ctx.createMediaStreamSource(stream);

      // 2. Setup Analysers
      const analyserRef = ctx.createAnalyser();
      const analyserMic = ctx.createAnalyser();
      analyserRef.fftSize = FFT_SIZE;
      analyserMic.fftSize = FFT_SIZE;
      analyserRef.smoothingTimeConstant = SMOOTHING;
      analyserMic.smoothingTimeConstant = SMOOTHING;

      // 3. Setup Catena Filtri (EQ Grafico)
      const filters: BiquadFilterNode[] = [];
      let inputNode: AudioNode | null = null;
      let lastFilter: AudioNode | null = null;

      FILTER_BANDS.forEach((freq, i) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1.4;
        filter.gain.value = 0; // Inizia piatto
        filters.push(filter);

        if (i === 0) inputNode = filter;
        else (lastFilter as AudioNode).connect(filter);
        lastFilter = filter;
      });

      // 4. Setup Sorgente (Rumore Rosa in Loop)
      const buffer = createPinkNoise(ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const mainGain = ctx.createGain();
      mainGain.gain.value = 0.5;

      // --- CONNESSIONI ---
      // Sorgente -> Analizzatore Riferimento (Cosa dovrebbe suonare)
      source.connect(analyserRef);
      // Sorgente -> Gain -> Filtri -> Speaker
      source.connect(mainGain);
      if (inputNode && lastFilter) {
        mainGain.connect(inputNode);
        (lastFilter as AudioNode).connect(ctx.destination);
      }

      // Mic -> Analizzatore Mic (Cosa suona davvero)
      micNode.connect(analyserMic);

      // Destinazione Output (Se il browser supporta setSinkId)
      if (selectedOutput && (ctx.destination as any).setSinkId) {
        try {
            await (ctx.destination as any).setSinkId(selectedOutput);
            addLog(`Output indirizzato a: ${selectedOutput}`, 'success');
        } catch(e) { console.warn("SetSinkId non supportato", e)}
      }

      // Salva ref
      nodes.current = {
        source,
        micSource: micNode,
        analyserRef,
        analyserMic,
        filters,
        gainNode: mainGain
      };

      source.start();
      setIsPlaying(true);
      addLog('Riproduzione e Analisi Avviate.', 'success');

      // Avvia ciclo visualizzazione e calcolo
      draw();

    } catch (e: any) {
      addLog(`Errore avvio audio: ${e.message}`, 'error');
    }
  };

  const stopAudio = () => {
    if (nodes.current.source) {
      try { nodes.current.source.stop(); } catch(e){}
      nodes.current.source.disconnect();
    }
    if (nodes.current.micSource) nodes.current.micSource.disconnect();
    if (audioContext) audioContext.close();

    // Reset stato
    setAudioContext(null);
    setIsPlaying(false);
    setIsAdapting(false);
    cancelAnimationFrame(animationRef.current!);
    addLog('Processo Audio Arrestato.', 'warning');
  };

  // --- LOGICA ADATTIVA E VISUALIZZAZIONE ---

  const calculateRMS = (data: Uint8Array) => {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const val = (data[i] - 128) / 128;
      sum += val * val;
    }
    return Math.sqrt(sum / data.length);
  };

  // Funzione semplice di similarità spettrale (Cross-correlation approssimata nel dominio frequenza)
  const calculateSpectralSimilarity = (ref: Uint8Array, mic: Uint8Array) => {
    let dotProduct = 0;
    let magA = 0;
    let magB = 0;
    // Usiamo solo i primi bin rilevanti
    const limit = Math.min(ref.length, 512);
    for(let i=0; i<limit; i++) {
        dotProduct += ref[i] * mic[i];
        magA += ref[i] * ref[i];
        magB += mic[i] * mic[i];
    }
    return dotProduct / (Math.sqrt(magA) * Math.sqrt(magB) + 0.0001);
  };

  const adaptFilters = (refData: Uint8Array, micData: Uint8Array) => {
    if (!nodes.current.filters.length || !isAdapting) return;

    // Mappa approssimativa da Filtro (Bands) a Bin FFT
    // FFT bin size = sampleRate / fftSize. E.g. 48000 / 2048 = ~23Hz per bin.
    const binSize = (audioContext?.sampleRate || 44100) / FFT_SIZE;

    const newGains = [...correctionGain];

    FILTER_BANDS.forEach((freq, index) => {
      // Trova il bin FFT corrispondente alla frequenza centrale del filtro
      const centerBin = Math.floor(freq / binSize);
      // Prendi una media intorno al centro (larghezza di banda stretta)
      const width = Math.max(1, Math.floor(centerBin * 0.1));

      let refSum = 0;
      let micSum = 0;

      for(let i = centerBin - width; i <= centerBin + width; i++) {
         if (i < refData.length) {
             refSum += refData[i];
             micSum += micData[i];
         }
      }

      const refAvg = refSum / (width * 2 + 1);
      const micAvg = micSum / (width * 2 + 1);

      // Calcolo Errore (Differenza in dB approssimata)
      // Se Mic < Ref, dobbiamo alzare il gain. Se Mic > Ref, abbassare.
      const error = refAvg - micAvg;

      // Fattore di scala per convertire valori byte (0-255) in dB utili per filtri
      // Questo è euristico per l'adattamento
      const deltaGain = error * 0.05;

      // RLS/LMS Semplificato: Aggiornamento pesi
      let currentGain = nodes.current.filters[index].gain.value;

      // Applica aggiornamento con learning rate
      currentGain += deltaGain * ADAPTATION_RATE;

      // Clamping per sicurezza (-15dB a +15dB)
      currentGain = Math.max(-15, Math.min(15, currentGain));

      nodes.current.filters[index].gain.setTargetAtTime(currentGain, audioContext!.currentTime, 0.1);
      newGains[index] = currentGain;
    });

    setCorrectionGain(newGains);
  };

  const draw = () => {
    if (!canvasRef.current || !nodes.current.analyserRef) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    const bufferLength = nodes.current.analyserRef.frequencyBinCount;
    const dataArrayRef = new Uint8Array(bufferLength);
    const dataArrayMic = new Uint8Array(bufferLength);
    const timeDomainRef = new Uint8Array(bufferLength);
    const timeDomainMic = new Uint8Array(bufferLength);

    // Ottieni dati
    nodes.current.analyserRef.getByteFrequencyData(dataArrayRef);
    nodes.current.analyserMic!.getByteFrequencyData(dataArrayMic);
    nodes.current.analyserRef.getByteTimeDomainData(timeDomainRef);
    nodes.current.analyserMic!.getByteTimeDomainData(timeDomainMic);

    // Calcola metriche
    const rmsR = calculateRMS(timeDomainRef);
    const rmsM = calculateRMS(timeDomainMic);
    const sim = calculateSpectralSimilarity(dataArrayRef, dataArrayMic);

    setRmsInput(rmsR); // Output interno
    setRmsOutput(rmsM); // Mic
    setSimilarity(sim);

    // Logica Adattiva (Ogni frame o quasi)
    // Adatta SOLO se c'è abbastanza segnale e non è clipping
    if (isAdapting && rmsM > 0.01 && sim > SIMILARITY_THRESHOLD) {
        adaptFilters(dataArrayRef, dataArrayMic);
    }

    // --- DISEGNO ---
    ctx.fillStyle = '#111827'; // Dark bg
    ctx.fillRect(0, 0, width, height);

    // Griglia
    ctx.beginPath();
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
        const x = (i / 10) * width;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        const y = (i / 10) * height;
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Funzione helper disegno spettro
    const drawSpectrum = (data: Uint8Array, color: string, fill: boolean = false) => {
        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        if (fill) ctx.fillStyle = color + '33'; // Low opacity

        const sliceWidth = width * 1.0 / (bufferLength / 2); // Zoom sulla prima metà (più rilevante)
        let x = 0;

        ctx.moveTo(0, height);
        for (let i = 0; i < bufferLength / 2; i++) {
            const v = data[i] / 255.0;
            const y = height - (v * height);

            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);

            x += sliceWidth;
        }

        if (fill) {
            ctx.lineTo(width, height);
            ctx.moveTo(0, height);
            ctx.fill();
        }
        ctx.stroke();
    };

    // 1. Spettro Riferimento (Target) - Ciano
    drawSpectrum(dataArrayRef, '#06b6d4', true); // Cyan

    // 2. Spettro Microfono (Reale) - Viola
    drawSpectrum(dataArrayMic, '#d946ef', false); // Fuchsia

    // Legenda su Canvas
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#06b6d4';
    ctx.fillText('Reference Signal (Target)', 10, 20);
    ctx.fillStyle = '#d946ef';
    ctx.fillText('Mic Input (Measured)', 10, 40);

    animationRef.current = requestAnimationFrame(draw);
  };

  // --- RENDER ---

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-6 font-sans">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* HEADER */}
        <div className="lg:col-span-3 flex justify-between items-center border-b border-gray-700 pb-4 mb-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2 text-blue-400">
              <Activity className="w-8 h-8" />
              Adaptive Room EQ
            </h1>
            <p className="text-gray-400 text-sm">Sistema di calibrazione audio in loop chiuso con filtro inverso.</p>
          </div>
          <div className="flex gap-3">
             {!isPlaying ? (
               <button
                onClick={startAudio}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 px-6 py-2 rounded-lg font-semibold transition-all shadow-lg shadow-green-900/50">
                <Play className="w-5 h-5" /> Avvia Processo
               </button>
             ) : (
               <button
                onClick={stopAudio}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 px-6 py-2 rounded-lg font-semibold transition-all">
                <Square className="w-5 h-5" /> Stop
               </button>
             )}
          </div>
        </div>

        {/* COLONNA SINISTRA: CONTROLLI & CONFIG */}
        <div className="space-y-6">

          {/* Settings Panel */}
          <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 shadow-xl">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5 text-gray-400" /> Configurazione I/O
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs uppercase text-gray-500 mb-1 flex items-center gap-1">
                  <Mic className="w-3 h-3" /> Input Sorgente (Microfono)
                </label>
                <select
                  className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm focus:border-blue-500 outline-none"
                  value={selectedInput}
                  onChange={(e) => setSelectedInput(e.target.value)}
                  disabled={isPlaying}
                >
                  {inputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase text-gray-500 mb-1 flex items-center gap-1">
                  <Speaker className="w-3 h-3" /> Output Monitor (Speakers)
                </label>
                <select
                  className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm focus:border-blue-500 outline-none"
                  value={selectedOutput}
                  onChange={(e) => setSelectedOutput(e.target.value)}
                  disabled={isPlaying}
                >
                   {outputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Adaptation Controls */}
          <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 shadow-xl relative overflow-hidden">
             {isPlaying && (
                <div className="absolute top-0 right-0 p-2">
                    <span className="animate-pulse w-3 h-3 bg-green-500 rounded-full inline-block"></span>
                </div>
             )}
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-gray-400" /> Controllo Adattivo
            </h2>

            <div className="space-y-4">
                <button
                    onClick={() => setIsAdapting(!isAdapting)}
                    disabled={!isPlaying}
                    className={`w-full py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors ${
                        isAdapting 
                        ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                        : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                    } ${!isPlaying ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    {isAdapting ? 'Adattamento Attivo...' : 'Abilita Correzione Auto'}
                    {isAdapting && <RefreshCw className="w-4 h-4 animate-spin" />}
                </button>

                <div className="text-xs text-gray-400 p-2 bg-gray-900 rounded border border-gray-700">
                    <p className="mb-1">Stato Algoritmo:</p>
                    <ul className="space-y-1">
                        <li className="flex justify-between">
                            <span>Chunk Intensity:</span>
                            <span className={rmsOutput > 0.01 ? 'text-green-400' : 'text-red-400'}>
                                {rmsOutput > 0.01 ? 'OK' : 'Basso'}
                            </span>
                        </li>
                        <li className="flex justify-between">
                            <span>Coerenza (Sim):</span>
                            <span className={similarity > SIMILARITY_THRESHOLD ? 'text-green-400' : 'text-yellow-500'}>
                                {(similarity * 100).toFixed(0)}%
                            </span>
                        </li>
                        <li className="flex justify-between">
                            <span>Threshold Check:</span>
                            <span className={similarity > SIMILARITY_THRESHOLD && rmsOutput > 0.01 ? 'text-green-400' : 'text-red-500'}>
                                {similarity > SIMILARITY_THRESHOLD && rmsOutput > 0.01 ? 'PASS' : 'WAIT'}
                            </span>
                        </li>
                    </ul>
                </div>
            </div>
          </div>

          {/* Filter Gains */}
          <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 shadow-xl">
             <h2 className="text-sm font-semibold mb-2 text-gray-400">Filtro Inverso Stimato (dB)</h2>
             <div className="grid grid-cols-5 gap-2">
                {FILTER_BANDS.map((freq, i) => (
                    <div key={freq} className="text-center">
                        <div className="h-16 w-full bg-gray-900 rounded relative overflow-hidden">
                            <div
                                className="absolute bottom-0 w-full transition-all duration-300 bg-blue-500 opacity-50"
                                style={{ height: `${((correctionGain[i] + 15) / 30) * 100}%` }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono z-10">
                                {correctionGain[i].toFixed(1)}
                            </div>
                        </div>
                        <span className="text-[10px] text-gray-500">{freq < 1000 ? freq : freq/1000 + 'k'}</span>
                    </div>
                ))}
             </div>
          </div>
        </div>

        {/* COLONNA CENTRALE/DESTRA: GRAFICI */}
        <div className="lg:col-span-2 space-y-6">

            {/* Visualizer */}
            <div className="bg-black rounded-xl border border-gray-700 overflow-hidden shadow-2xl relative h-80">
                <canvas
                    ref={canvasRef}
                    width={800}
                    height={320}
                    className="w-full h-full object-cover"
                />
                {!isPlaying && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                        <div className="text-center">
                            <Activity className="w-12 h-12 text-gray-500 mx-auto mb-2" />
                            <p className="text-gray-400">Avvia il processo per vedere l'analisi spettrale</p>
                        </div>
                    </div>
                )}
                {/* Overlay Info */}
                <div className="absolute top-2 right-2 flex flex-col items-end gap-2">
                    <div className="flex items-center gap-2 bg-gray-900/80 px-3 py-1 rounded text-xs">
                        <Fingerprint className="w-3 h-3 text-purple-400" />
                        <span>Correlation: {(similarity * 100).toFixed(1)}%</span>
                    </div>
                </div>
            </div>

            {/* System Status / Waitbars */}
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" /> Pipeline DSP in Tempo Reale
                </h3>

                <div className="space-y-4">
                    {/* Chunk Input Monitor */}
                    <div>
                        <div className="flex justify-between text-xs mb-1">
                            <span>Input Chunk Energy (RMS)</span>
                            <span>{(rmsOutput * 100).toFixed(0)}%</span>
                        </div>
                        <div className="h-2 bg-gray-900 rounded-full overflow-hidden">
                            <div
                                className={`h-full transition-all duration-100 ${rmsOutput > 0.8 ? 'bg-red-500' : 'bg-green-500'}`}
                                style={{ width: `${Math.min(100, rmsOutput * 500)}%` }} // Moltiplicatore per visibilità
                            />
                        </div>
                    </div>

                    {/* Processing Load Simulator */}
                    <div>
                        <div className="flex justify-between text-xs mb-1">
                            <span>Inverse Filter Calculation (Est.)</span>
                            <span>{isPlaying ? 'Active' : 'Idle'}</span>
                        </div>
                         <div className="h-2 bg-gray-900 rounded-full overflow-hidden relative">
                             {isPlaying && (
                                <div className="absolute inset-0 bg-blue-600/50 animate-progress-indeterminate"></div>
                             )}
                        </div>
                    </div>

                    {/* Logs Panel */}
                    <div className="mt-6 border-t border-gray-700 pt-4">
                        <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Event Log / Checklist</h4>
                        <div className="h-32 overflow-y-auto bg-gray-900/50 rounded p-2 text-xs font-mono space-y-1 scrollbar-thin scrollbar-thumb-gray-700">
                            {logs.length === 0 && <span className="text-gray-600 italic">Pronto per iniziare...</span>}
                            {logs.map((log) => (
                                <div key={log.id} className="flex gap-2">
                                    <span className="text-gray-500">[{log.time}]</span>
                                    <span className={
                                        log.type === 'error' ? 'text-red-400' :
                                        log.type === 'success' ? 'text-green-400' :
                                        log.type === 'warning' ? 'text-yellow-400' : 'text-blue-300'
                                    }>
                                        {log.message}
                                    </span>
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                </div>
            </div>

        </div>
      </div>

      {/* CSS per animazione loading */}
      <style>{`
        @keyframes progress-indeterminate {
          0% { left: -100%; width: 50%; }
          100% { left: 100%; width: 50%; }
        }
        .animate-progress-indeterminate {
          animation: progress-indeterminate 1.5s infinite linear;
        }
      `}</style>
    </div>
  );
}
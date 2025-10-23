// Lightweight wrapper around @remotion/whisper-web to transcribe PCM audio in the browser.
// We dynamically import the library to avoid SSR issues.

let libPromise = null;
let preparedModel = null;
// Track ongoing downloads per model to avoid restarting from 0%
const downloadPromises = new Map();

function cleanTranscriptText(text) {
  if (!text) return "";
  // Remove lines or tokens that are bracketed non-speech markers, e.g. [Music], [Applause], [BLANK_AUDIO]
  // Also collapse multiple spaces and trim.
  const filtered = text
    .split(/\s+/)
    .filter((tok) => !/^\[[^\]]+\]$/i.test(tok))
    .join(" ");
  return filtered.replace(/\s+/g, " ").trim();
}

export async function ensureWhisperWebLoaded(options = {}) {
  const modelName = options.model || "tiny.en";
  if (!libPromise) libPromise = import("@remotion/whisper-web");
  const lib = await libPromise;
  const support = await (lib.canUseWhisperWeb ? lib.canUseWhisperWeb(modelName) : { supported: true });
  if (!support || support.supported === false) {
    const reason = support?.detailedReason || "WebAssembly/Audio not supported in this environment";
    throw new Error(`@remotion/whisper-web not supported: ${reason}`);
  }
  const getLoaded = lib.getLoadedModels || (() => []);
  const already = getLoaded();
  if (!already || !already.includes?.(modelName)) {
    const download = lib.downloadWhisperModel || lib.default?.downloadWhisperModel;
    if (!download) throw new Error("@remotion/whisper-web: downloadWhisperModel not found");
    const onProgress = typeof options.onDownloadProgress === 'function' ? options.onDownloadProgress : () => {};
    // Reuse in-flight download if exists
    if (downloadPromises.has(modelName)) {
  console.log("[whisper-web] reuse in-flight download", modelName);
      await downloadPromises.get(modelName);
    } else {
  console.log("[whisper-web] start download", modelName);
      const p = (async () => {
        try {
          await download({ model: modelName, onProgress: (evt) => {
            try {
              const prog = typeof evt === 'number' ? evt : (evt?.progress ?? 0);
              console.log("[whisper-web] downloading", Math.round(prog * 100) + "%");
            } catch (_) {}
            onProgress(evt);
          }});
        } finally {
          // Ensure we clear the in-flight status on completion/failure
          downloadPromises.delete(modelName);
        }
      })();
      downloadPromises.set(modelName, p);
      await p;
    }
  }
  preparedModel = modelName;
  return lib;
}

// pcmF32: Float32Array mono PCM, sampleRate: number
export async function transcribeWhisperWeb(pcmF32, sampleRate, opts = {}) {
  const lib = await ensureWhisperWebLoaded(opts);
  const lang = opts.language || "en";
  const modelName = preparedModel || opts.model || "tiny.en";
  const transcribe = lib.transcribe || lib.default?.transcribe;
  if (!transcribe) {
    const keys = Object.keys(lib || {});
    throw new Error(`@remotion/whisper-web: transcribe() not found (exports: ${keys.join(", ")})`);
  }
  // Ensure we have a concrete Float32Array copy
  if (!pcmF32 || !pcmF32.length) {
    throw new Error("No audio data provided or audio data is empty (pre-check)");
  }
  const audioF32 = pcmF32 instanceof Float32Array ? pcmF32 : new Float32Array(pcmF32);
  if (audioF32.length < (sampleRate ? sampleRate * 0.2 : 3200)) {
    // Less than ~200ms of audio—often rejected by the model
    throw new Error("Audio too short. Please record at least 1 second of audio.");
  }

  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

  // Prefer 16k audio if resampler provided
  let audioForModel = audioF32;
  let effectiveSampleRate = sampleRate || 16000;
  try {
    const resample = lib.resampleTo16Khz || lib.default?.resampleTo16Khz;
    if (resample && sampleRate && sampleRate !== 16000) {
      const out = await resample({ audio: audioF32, sourceSampleRate: sampleRate });
      if (out && out.length) {
        audioForModel = out;
        effectiveSampleRate = 16000;
      }
    }
  } catch (_) { /* ignore */ }

  // Diagnostics to help pinpoint shape issues in the wild
  try {
  console.log("[whisper-web] audio length:", audioForModel?.length, "sr:", effectiveSampleRate, "typed:", audioForModel instanceof Float32Array);
  } catch (_) {}

  // Build args carefully; ensure audio is not overridden
  const baseArgs = { model: modelName, language: lang, onProgress };
  let res;
  try {
    // Primary: Use documented API - pass channelWaveform at 16kHz
  console.log("[whisper-web] transcribe primary");
    res = await transcribe({ ...baseArgs, channelWaveform: audioForModel, onProgress: (evt) => {
      try {
        const p = typeof evt === 'number' ? evt : (evt?.progress ?? 0);
  console.log("[whisper-web] transcribing", Math.round(p * 100) + "%");
      } catch (_) {}
      onProgress(evt);
    }});
  } catch (e1) {
    try {
      // Fallback 1: Alternate key name
  console.log("[whisper-web] transcribe fallback 1");
      res = await transcribe({ ...baseArgs, waveform: audioForModel, onProgress });
    } catch (e2) {
      try {
        // Fallback 2: pass plain JS array
  console.log("[whisper-web] transcribe fallback 2 (array)");
        res = await transcribe({ ...baseArgs, channelWaveform: Array.from(audioForModel), onProgress });
      } catch (e3) {
        try {
          // Fallback 3: object form
          console.log("[whisper-web] transcribe fallback 3 (object)");
          res = await transcribe({ ...baseArgs, channelWaveform: { data: audioForModel, sampleRate: effectiveSampleRate }, onProgress });
        } catch (e4) {
          try {
            // Fallback 4: older signature variants
            console.log("[whisper-web] transcribe fallback 4 (older signature)");
            res = await transcribe({ model: modelName, channelWaveform: audioForModel, language: lang, onProgress });
          } catch (e5) {
            try {
              // Fallback 5: use audioData + sampleRate keys
              console.log("[whisper-web] transcribe fallback 5 (audioData)");
              res = await transcribe({ ...baseArgs, audioData: audioForModel, sampleRate: effectiveSampleRate, onProgress });
            } catch (e6) {
              try {
                // Fallback 6: use pcm + sampleRate keys
                console.log("[whisper-web] transcribe fallback 6 (pcm)");
                res = await transcribe({ ...baseArgs, pcm: audioForModel, sampleRate: effectiveSampleRate, onProgress });
              } catch (e7) {
                try {
                  // Fallback 7: positional style (if supported)
                  console.log("[whisper-web] transcribe fallback 7 (positional)");
                  res = await transcribe(audioForModel, { sampleRate: effectiveSampleRate, model: modelName, language: lang, onProgress });
                } catch (e8) {
            // Enrich the final error with context to aid debugging
                  const msg = (e8 && e8.message) || (e7 && e7.message) || (e6 && e6.message) || (e5 && e5.message) || (e4 && e4.message) || (e3 && e3.message) || (e2 && e2.message) || (e1 && e1.message) || 'Unknown ASR error';
                  const enriched = new Error(`${msg} [len=${audioForModel?.length || 0}, sr=${effectiveSampleRate || 0}, typed=${audioForModel instanceof Float32Array}]`);
                  throw enriched;
                }
              }
            }
          }
        }
      }
    }
  }
  // Handle multiple possible response shapes across versions
  // Prefer returning both text and segments when requested
  const wantSegments = !!opts.returnSegments;
  const collect = (r) => ({
    text: cleanTranscriptText(
      r?.text || (Array.isArray(r?.transcription) ? r.transcription.map((t)=>t?.text||"").join(" ") : (Array.isArray(r?.segments) ? r.segments.map((s)=>s?.text||"").join(" ") : ""))
    ),
    segments: Array.isArray(r?.segments) ? r.segments : (Array.isArray(r?.transcription) ? r.transcription : [])
  });
  if (res && (wantSegments)) return collect(res);
  if (res && typeof res.text === "string") return cleanTranscriptText(res.text);
  if (res && Array.isArray(res.transcription)) return cleanTranscriptText(res.transcription.map((t) => t?.text || "").join(" "));
  if (res && Array.isArray(res.segments)) return cleanTranscriptText(res.segments.map((s) => s?.text || "").join(" "));
  return "";
}

// File-based API following the official docs: resampleTo16Khz({ file }) then transcribe({ channelWaveform })
export async function transcribeWhisperWebFromFile(file, opts = {}) {
  const lib = await ensureWhisperWebLoaded(opts);
  const modelName = preparedModel || opts.model || "tiny.en";
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const onResample = typeof opts.onResampleProgress === 'function' ? opts.onResampleProgress : (p) => onProgress(p);

  const resample = lib.resampleTo16Khz || lib.default?.resampleTo16Khz;
  const transcribe = lib.transcribe || lib.default?.transcribe;
  if (!resample) throw new Error("@remotion/whisper-web: resampleTo16Khz not found");
  if (!transcribe) throw new Error("@remotion/whisper-web: transcribe not found");

  // Let the library handle file decoding + resampling
  console.log("[whisper-web:file] resample start");
  const channelWaveform = await resample({ file, onProgress: (evt) => {
    try {
      const p = typeof evt === 'number' ? evt : (evt?.progress ?? 0);
  console.log("[whisper-web:file] resampling", Math.round(p * 100) + "%");
    } catch (_) {}
    onResample(evt);
  }});
  if (!channelWaveform || !channelWaveform.length) {
    throw new Error("No audio data received from resampleTo16Khz(file)");
  }
  try {
    console.debug("[whisper-web:file] audio length:", channelWaveform.length, "sr:", 16000, "typed:", channelWaveform instanceof Float32Array);
  } catch (_) {}

  console.log("[whisper-web:file] transcribe start");
  const res = await transcribe({ channelWaveform, model: modelName, onProgress: (evt) => {
    try {
      const p = typeof evt === 'number' ? evt : (evt?.progress ?? 0);
  console.log("[whisper-web:file] transcribing", Math.round(p * 100) + "%");
    } catch (_) {}
    onProgress(evt);
  }});
  const wantSegments = !!opts.returnSegments;
  const collect = (r) => ({
    text: cleanTranscriptText(
      r?.text || (Array.isArray(r?.transcription) ? r.transcription.map((t)=>t?.text||"").join(" ") : (Array.isArray(r?.segments) ? r.segments.map((s)=>s?.text||"").join(" ") : ""))
    ),
    segments: Array.isArray(r?.segments) ? r.segments : (Array.isArray(r?.transcription) ? r.transcription : [])
  });
  if (res && (wantSegments)) return collect(res);
  if (res && Array.isArray(res.transcription)) return cleanTranscriptText(res.transcription.map((t) => t?.text || "").join(" "));
  if (res && typeof res.text === "string") return cleanTranscriptText(res.text);
  if (res && Array.isArray(res.segments)) return cleanTranscriptText(res.segments.map((s) => s?.text || "").join(" "));
  return "";
}

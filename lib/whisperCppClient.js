// [Deprecated in favor of @remotion/whisper-web] Client-side helper to load whisper.cpp WebAssembly from /public/whisper
// Expected files:
// - /public/whisper/whisper.js (Emscripten glue)
// - /public/whisper/whisper.wasm
// - /public/whisper/ggml-tiny.en.bin (or your chosen model)
//
// This wrapper targets the typical API exposed by the official whisper.cpp wasm demo
// where a global `WhisperFactory` is provided by whisper.js. If your glue exposes a
// different API, adjust createContext/transcribe accordingly.

let whisperReady = null;
let whisperCtx = null;

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src='${src}']`);
    if (existing) return existing.addEventListener('load', () => resolve());
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = (e) => reject(new Error(`Failed to load script ${src}`));
    document.head.appendChild(s);
  });
}

export async function ensureWhisperLoaded() {
  if (whisperReady) return whisperReady;
  whisperReady = (async () => {
    await loadScriptOnce('/whisper/whisper.js');
    if (!window.WhisperFactory) {
      throw new Error('window.WhisperFactory not found. Check /public/whisper/whisper.js');
    }
    // Some builds expose create() returning a factory; others expose a function directly.
    const factory = await (window.WhisperFactory.create
      ? window.WhisperFactory.create({
          wasmPath: '/whisper/whisper.wasm'
        })
      : window.WhisperFactory({ wasmPath: '/whisper/whisper.wasm' }));
    return factory;
  })();
  return whisperReady;
}

export async function initWhisperContext(modelPath = '/whisper/ggml-tiny.en.bin') {
  const factory = await ensureWhisperLoaded();
  if (!factory.createContext) {
    throw new Error('Whisper factory missing createContext(). Please align with your build.');
  }
  whisperCtx = await factory.createContext(modelPath);
  return whisperCtx;
}

export async function transcribeWhisper(pcmF32, opts = {}) {
  if (!whisperCtx) await initWhisperContext(opts.modelPath);
  if (!whisperCtx.full && !whisperCtx.transcribe) {
    throw new Error('Whisper context missing full()/transcribe(). Please align with your build.');
  }

  // Common options
  const params = {
    language: opts.language || 'en',
    translate: false,
    // Add other decoding options if your glue supports them
  };

  // API variant A (ctx.full)
  if (whisperCtx.full) {
    await whisperCtx.full({ audio: pcmF32, ...params });
    if (typeof whisperCtx.getText === 'function') {
      return whisperCtx.getText();
    }
  }

  // API variant B (ctx.transcribe)
  if (whisperCtx.transcribe) {
    const res = await whisperCtx.transcribe(pcmF32, params);
    if (res && typeof res.text === 'string') return res.text;
  }

  throw new Error('Unknown whisper.cpp wasm API shape. Please adapt wrapper.');
}

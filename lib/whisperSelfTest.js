// Simple self-test to validate @remotion/whisper-web wiring using synthetic audio.
// Not used by UI; you can import and run in a debug button if needed.

import { transcribeWhisperWeb } from "./whisperWebClient";

export async function whisperSelfTest() {
  const sr = 16000;
  const dur = 1.2; // seconds
  const len = Math.floor(sr * dur);
  const toneHz = 220;
  const pcm = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    pcm[i] = 0.2 * Math.sin((2 * Math.PI * toneHz * i) / sr);
  }
  try {
    const text = await transcribeWhisperWeb(pcm, sr, { language: 'en', model: 'tiny.en' });
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

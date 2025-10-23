"use client";

import { useEffect, useRef, useState } from "react";

function useQuickWebSpeech() {
  const recRef = useRef(null);
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interimText, setInterimText] = useState("");
  const lastFinalRef = useRef("");

  const retryRef = useRef(0);
  const maxRetries = 3;
  const endResolveRef = useRef(null);
  const desiredRef = useRef(false);
  const restartTimerRef = useRef(null);
  const restartCountRef = useRef(0);
  const lastRestartAtRef = useRef(0);
  const lastResultAtRef = useRef(0);
  const isIOSRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ua = navigator.userAgent || '';
    isIOSRef.current = /iP(hone|od|ad)/.test(ua);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(!!SR);
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'en-US';
    // keep interim/continuous where possible; iOS may be unstable
    rec.interimResults = true;
    rec.continuous = true;

    rec.onstart = () => { setListening(true); };

    rec.onresult = (evt) => {
      let finals = '';
      let interim = '';
      for (let i = 0; i < evt.results.length; i++) {
        const r = evt.results[i];
        const t = r?.[0]?.transcript || '';
        if (!t) continue;
        if (r.isFinal) finals += t + ' ';
        else interim += t + ' ';
      }

      const dedupConsecutive = (s) => s.replace(/\s+/g, ' ').trim().split(' ').filter((w, i, a) => i === 0 || w.toLowerCase() !== a[i-1].toLowerCase()).join(' ');

      const collapseRepeatedSequences = (s, maxSeq = 4) => {
        if (!s) return '';
        const words = s.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
        let i = 0;
        while (i < words.length) {
          let removed = false;
          for (let k = Math.min(maxSeq, Math.floor((words.length - i) / 2)); k >= 1; k--) {
            const aStart = i;
            const bStart = i + k;
            const bEnd = i + 2 * k;
            if (bEnd > words.length) continue;
            let match = true;
            for (let t = 0; t < k; t++) {
              if (words[aStart + t].toLowerCase() !== words[bStart + t].toLowerCase()) { match = false; break; }
            }
            if (match) {
              words.splice(bStart, k);
              removed = true;
              break;
            }
          }
          if (!removed) i += 1;
        }
        return words.join(' ');
      };

      let finalsClean = collapseRepeatedSequences(dedupConsecutive(finals), 4);
      let interimClean = collapseRepeatedSequences(dedupConsecutive(interim), 4);

      if (finalsClean !== lastFinalRef.current) {
        lastFinalRef.current = finalsClean;
        setFinalText(finalsClean);
      }
      setInterimText(interimClean);
      lastResultAtRef.current = Date.now();
    };

    rec.onerror = (e) => {
      const err = e?.error || String(e);
      // quick gentle restart if desired
      if (desiredRef.current && retryRef.current < maxRetries) {
        retryRef.current += 1;
        try { rec.stop(); } catch (_) {}
        setListening(true);
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => { try { rec.start(); } catch (_) { setListening(false); } }, 120 * retryRef.current);
      } else {
        setListening(false);
      }
    };

    rec.onend = () => {
      // resolve stopAsync if awaiting
      if (typeof endResolveRef.current === 'function') {
        try { endResolveRef.current(); } catch (_) {}
        endResolveRef.current = null;
        setListening(false);
        return;
      }
      // auto-restart quickly if desired
      if (desiredRef.current) {
        const now = Date.now();
        const since = now - (lastRestartAtRef.current || 0);
        if (restartCountRef.current < 50 && since > 50) {
          lastRestartAtRef.current = now;
          restartCountRef.current += 1;
          if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
          const delay = isIOSRef.current ? 120 : 60;
          setListening(true);
          restartTimerRef.current = setTimeout(() => { try { rec.start(); } catch (_) { setListening(false); } }, delay);
        } else {
          setListening(false);
        }
      } else {
        setListening(false);
      }
    };

    recRef.current = rec;
    return () => { try { rec.stop(); } catch(_){} recRef.current = null; if (restartTimerRef.current) clearTimeout(restartTimerRef.current); };
  }, []);

  const start = useCallback(() => {
    retryRef.current = 0;
    desiredRef.current = true;
    if (!recRef.current) return false;
    try { recRef.current.start(); setListening(true); return true; } catch (e) { setListening(false); return false; }
  }, []);

  const stop = useCallback(() => {
    desiredRef.current = false;
    try { recRef.current && recRef.current.stop(); } catch (_) {}
    setListening(false);
  }, []);

  const reset = useCallback(() => { setFinalText(''); setInterimText(''); lastFinalRef.current = ''; }, []);

  return { supported, listening, finalText, interimText, start, stop, reset };
}

export default function TestPage() {
  const ws = useQuickWebSpeech();
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Mic test (Web Speech)</h1>
      <div className="mb-3">Supported: {String(ws.supported)}</div>
      <div className="mb-3">Listening: {String(ws.listening)}</div>
      <div className="flex gap-2 mb-4">
        <button className="px-3 py-2 bg-blue-600 text-white rounded" onClick={()=>ws.start()}>Start</button>
        <button className="px-3 py-2 bg-gray-200 rounded" onClick={()=>ws.stop()}>Stop</button>
        <button className="px-3 py-2 bg-gray-100 rounded" onClick={()=>ws.reset()}>Reset</button>
      </div>
      <div className="mb-2 text-sm text-gray-600">Say: "Hello, good morning"</div>
  <div className="p-3 border rounded mb-2 bg-gray-50 whitespace-pre-wrap">Final: {ws.finalText}</div>
  <div className="p-3 border rounded bg-white whitespace-pre-wrap">Interim: {ws.interimText}</div>
    </div>
  );
}

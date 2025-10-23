"use client";

import { useEffect, useRef, useState } from "react";

function useQuickWebSpeech() {
  const recRef = useRef(null);
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interimText, setInterimText] = useState("");
  const lastFinalRef = useRef("");

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(!!SR);
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = true;
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
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
      const dedup = (s) => s.replace(/\s+/g, ' ').trim().split(' ').filter((w, i, a) => i === 0 || w.toLowerCase() !== a[i-1].toLowerCase()).join(' ');
      const collapseTailRepeats = (s) => {
        const words = s.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
        let n = words.length;
        for (let k = Math.floor(n/2); k >= 2; k--) {
          const a = words.slice(n - k);
          const b = words.slice(n - 2*k, n - k);
          if (a.length === b.length && a.join(' ').toLowerCase() === b.join(' ').toLowerCase()) {
            words.splice(n - k, k);
            n = words.length;
            k = Math.floor(n/2) + 1;
          }
        }
        return words.join(' ');
      };
      const deduped = collapseTailRepeats(dedup(finals));
      const inter = collapseTailRepeats(dedup(interim));
      if (deduped !== lastFinalRef.current) {
        lastFinalRef.current = deduped;
        setFinalText(deduped);
      }
      setInterimText(inter);
    };
    recRef.current = rec;
    return () => { try { rec.stop(); } catch(_){} recRef.current = null; };
  }, []);

  const start = async () => {
    if (!recRef.current) return false;
    try { recRef.current.start(); return true; } catch(e) { return false; }
  };
  const stop = () => { try { recRef.current && recRef.current.stop(); } catch(_){} };
  const reset = () => { setFinalText(''); setInterimText(''); lastFinalRef.current = ''; };
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

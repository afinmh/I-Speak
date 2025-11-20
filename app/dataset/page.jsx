"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useAssessment from "@/hooks/useAssessment";
import { NUMERICAL_FEATURES_ORDER } from "@/lib/featureMapping";

const STORAGE_KEY = "ispeak_dataset_rows_v1";
const HASIL_CACHE_KEY = "ispeak_hasil_cache_v1";

function loadRows() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRows(rows) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {}
}

function toCSV(rows) {
  const headers = ["File Name", "Transcript", ...NUMERICAL_FEATURES_ORDER];
  const esc = (v) => {
    const s = (v ?? "").toString();
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(esc).join(",")];
  for (const r of rows) {
    const row = [r.fileName || "", r.transcript || ""]; 
    for (const k of NUMERICAL_FEATURES_ORDER) row.push(r.features?.[k] ?? 0);
    lines.push(row.map(esc).join(","));
  }
  return lines.join("\n");
}

function formatValue(v) {
  if (v === null || v === undefined) return "";
  const num = Number(v);
  if (!Number.isFinite(num)) return "";
  // Show integer without decimals
  if (Math.abs(num - Math.round(num)) < 1e-9) return String(Math.round(num));
  // Limit to 4 decimals, strip trailing zeros and trailing dot
  return num.toFixed(4).replace(/0+$/,'').replace(/\.$/,'');
}

export default function DatasetPage() {
  const { setFile, setTranscript, setModel, run, status, result, errors } = useAssessment();
  const [rows, setRows] = useState([]);
  const [audioFile, setAudioFile] = useState(null);
  const [transcript, setTranscriptInput] = useState("");
  const [hasilMap, setHasilMap] = useState({}); // { [filename]: transcript }
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setRows(loadRows());
  }, []);

  // Load hasil.json via API and build filename->transcript map
  useEffect(() => {
    let cancelled = false;
    async function loadHasil() {
      try {
        // Try cached first
        const cached = typeof window !== "undefined" ? window.localStorage.getItem(HASIL_CACHE_KEY) : null;
        if (cached) {
          const parsed = JSON.parse(cached);
          if (!cancelled && parsed && typeof parsed === "object") setHasilMap(parsed);
        }
        const res = await fetch("/api/data/hasil", { cache: "no-store" });
        const j = await res.json();
        const items = Array.isArray(j?.items) ? j.items : [];
        const map = {};
        for (const it of items) {
          const fn = (it?.Filename || it?.filename || it?.file || "").toString().trim();
          const tx = (it?.Transkrip || it?.transkrip || it?.transcript || "").toString();
          if (fn && tx) map[fn] = tx;
        }
        if (!cancelled) {
          setHasilMap(map);
          try { window.localStorage.setItem(HASIL_CACHE_KEY, JSON.stringify(map)); } catch {}
        }
      } catch (_) {
        // ignore
      }
    }
    loadHasil();
    return () => { cancelled = true; };
  }, []);

  // After a run completes, if we have a fresh result and a file, persist it
  useEffect(() => {
    if (!busy) return;
    if (!result) return;
    if (!audioFile) return;
    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fileName: audioFile?.name || "audio",
      transcript: result.transcript || transcript,
      features: result.features || {},
      createdAt: new Date().toISOString()
    };
    setRows((prev) => {
      const next = [...prev, entry];
      saveRows(next);
      return next;
    });
    setBusy(false);
  }, [result]);

  const autoTranscript = useMemo(() => (audioFile ? (hasilMap[audioFile.name] || "") : ""), [audioFile, hasilMap]);
  const effectiveTranscript = autoTranscript || transcript;
  const canExtract = useMemo(() => !!audioFile && (effectiveTranscript?.trim()?.length > 0), [audioFile, effectiveTranscript]);

  async function onExtractSave() {
    if (!canExtract || busy) return;
    setBusy(true);
    // Skip model API calls; still computes all 40 features and data endpoints.
    // Use auto transcript from hasil.json when available, else require manual transcript.
    await run({ skipModels: true, model: "skip", file: audioFile, transcript: effectiveTranscript });
  }

  function onDownloadCSV() {
    const csv = toCSV(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dataset_${new Date().toISOString().slice(0,19).replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function onClearAll() {
    if (!confirm("Clear all saved rows?")) return;
    setRows([]);
    saveRows([]);
  }

  function onRemove(id) {
    const next = rows.filter((r) => r.id !== id);
    setRows(next);
    saveRows(next);
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Dataset Builder</h1>
      <p className="text-sm text-gray-600">Input audio + transcript, extract 40 features, store locally, and export CSV.</p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-sm font-medium">Audio File</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="block w-full border rounded p-2"
            onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
          />

          <div>
            <label className="block text-sm font-medium">Transcript</label>
            <textarea
              rows={6}
              className="block w-full border rounded p-2"
              placeholder={autoTranscript ? "Auto from hasil.json (optional to edit)" : "Paste or type transcript here..."}
              value={transcript}
              onChange={(e) => setTranscriptInput(e.target.value)}
              disabled={!!autoTranscript}
            />
            {audioFile && autoTranscript && (
              <p className="text-xs text-green-700 mt-1">Auto transcript found for <span className="font-mono">{audioFile.name}</span> from hasil.json.</p>
            )}
            {audioFile && !autoTranscript && (!transcript || transcript.trim().length === 0) && (
              <p className="text-xs text-red-700 mt-1">Transcript required: filename not found in hasil.json.</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              disabled={!canExtract || busy}
              onClick={onExtractSave}
              className={`px-4 py-2 rounded text-white ${canExtract && !busy ? "bg-black" : "bg-gray-400 cursor-not-allowed"}`}
            >
              {busy ? "Processing..." : "Extract & Save"}
            </button>
            <span className="text-sm text-gray-600">{status}</span>
          </div>
          {errors && Object.keys(errors).length > 0 && (
            <div className="text-sm text-red-600">
              {Object.entries(errors).map(([k,v]) => (
                <div key={k}>{k}: {String(v)}</div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            <button onClick={onDownloadCSV} className="px-4 py-2 rounded border border-black text-black">Download CSV</button>
            <button onClick={onClearAll} className="px-4 py-2 rounded border border-gray-400 text-gray-700">Clear All</button>
          </div>
          <div className="text-sm text-gray-600">Rows: {rows.length}</div>
        </div>
      </div>

      <div className="overflow-auto border rounded">
        <table className="min-w-[1200px] w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-left sticky left-0 bg-gray-100">File Name</th>
              <th className="p-2 text-left sticky left-[180px] bg-gray-100">Transcript</th>
              {NUMERICAL_FEATURES_ORDER.map((h) => (
                <th key={h} className="p-2 text-left">{h}</th>
              ))}
              <th className="p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2 align-top sticky left-0 bg-white/90 backdrop-blur-sm max-w-[180px] truncate" title={r.fileName}>{r.fileName}</td>
                <td className="p-2 align-top sticky left-[180px] bg-white/90 backdrop-blur-sm max-w-[320px] truncate" title={r.transcript}>{r.transcript}</td>
                {NUMERICAL_FEATURES_ORDER.map((k) => (
                  <td key={k} className="p-2 align-top">{formatValue(r.features?.[k] ?? 0)}</td>
                ))}
                <td className="p-2 align-top">
                  <button onClick={() => onRemove(r.id)} className="text-red-600">Delete</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={NUMERICAL_FEATURES_ORDER.length + 3} className="p-4 text-center text-gray-500">No rows yet. Add audio + transcript, then Extract & Save.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

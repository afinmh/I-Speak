"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AuthGate from "@/app/components/AuthGate";
import { supabase } from "@/lib/supabaseClient";
import { useUiState } from "@/app/components/UiStateProvider";
import { subscribeWhisper, getWhisperState } from "@/lib/globalWhisperState";
import FeatureComputer from "@/app/components/FeatureComputer";

export default function DashboardDetailPage() {
  return (
    <AuthGate>
      <DetailContent />
    </AuthGate>
  );
}

function DetailContent() {
  const ui = useUiState();
  const params = useParams();
  const id = params?.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    let active = true;
    async function load() {
      setLoading(true); setError(""); ui.start("Loading detail…");
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      try {
        const res = await fetch(`/api/dashboard/mahasiswa/${id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (res.status === 401) {
          console.warn("[Dashboard Detail] Token expired or unauthorized, clearing local session...");
          await supabase.auth.signOut({ scope: 'local' });
          return;
        }
        if (!res.ok) {
          const j = await res.json().catch(()=>({}));
          throw new Error(j?.error || "Failed to load mahasiswa detail");
        }
        const j = await res.json();
        if (!active) return;
        setData(j);
      } catch (e) {
        if (!active) return;
        setError(e?.message || String(e));
      } finally {
        if (active) setLoading(false);
        ui.end();
      }
    }
    load();
    return () => { active = false; };
  }, [id]);

  const m = data?.mahasiswa;
  const recs = data?.rekaman || [];
  // Find task 6 record id
  const recTask6 = recs.find((r) => Number(r?.tugas_id) === 6) || null;

  const featureRef = useRef(null);
  const [processing, setProcessing] = useState(false);
  const [overall, setOverall] = useState(null); // {cefr, subscores}
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadTotal, setDownloadTotal] = useState(0);
  const [asrStatus, setAsrStatus] = useState("");
  const [lastStatusAt, setLastStatusAt] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const prevStatusRef = useRef("");
  const [whisper, setWhisper] = useState(getWhisperState());

  // Keep whisper download progress synced
  useEffect(() => {
    const unsub = subscribeWhisper((st) => setWhisper(st));
    return () => { if (typeof unsub === "function") unsub(); };
  }, []);

  const percentFromStatus = (s) => {
    const m = String(s || "").match(/(\d{1,3})%/);
    const n = m ? Number(m[1]) : null;
    if (n !== null && isFinite(n)) return Math.max(0, Math.min(100, n));
    return null;
  };

  async function processTask6() {
    if (!recTask6) {
      console.error("[processTask6] No task 6 recording found");
      return;
    }
    console.log("[processTask6] START", { recId: recTask6.id });
    try {
      setProcessing(true);
      setProcessingProgress(0);
      setAsrStatus("Fetching audio...");
      setLastStatusAt(Date.now());
      
      console.log("[processTask6] Fetching audio from /api/media/rekaman/" + recTask6.id);
      const res = await fetch(`/api/media/rekaman/${recTask6.id}`);
      if (!res.ok) {
        console.error("[processTask6] Fetch failed", res.status);
        throw new Error("Failed to fetch audio");
      }
      const blob = await res.blob();
      console.log("[processTask6] Audio fetched", { size: blob.size, type: blob.type });
      
      setAsrStatus("Starting feature extraction...");
      setProcessingProgress(5);
      
      console.log("[processTask6] Calling compute");
      const fileObj = new File([blob], `task6_${recTask6.id}.webm`, { type: blob.type || "audio/webm" });
      // Use task 6 text as reference topic for Topic Relevance calculation
      const refTopic = recTask6?.tugas_teks || "";
      console.log("[processTask6] Using reference topic:", refTopic);
      const r = await featureRef.current.compute(fileObj, refTopic);
      console.log("[processTask6] Feature extraction done", { hasFeatures: !!r?.features, hasTranscript: !!r?.transcript });
      
      const features = r?.features;
      if (!features) {
        console.error("[processTask6] No features returned");
        throw new Error("Feature extraction failed");
      }
      
      console.log("[processTask6] Saving score to batch API");
      // Save score server-side (batch API with single item)
      await fetch("/api/score/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ rekaman_id: recTask6.id, features }] }) });
      
      // Upload transcript to rekaman
      if (r?.transcript) {
        console.log("[processTask6] Uploading transcript", { length: r.transcript.length });
        await fetch(`/api/rekaman/${recTask6.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ transkrip: r.transcript }) });
      }
      
      console.log("[processTask6] Updating overall state");
      // Update overall panel from interpreted outputs and subscores
      setOverall({
        cefr: r?.interpreted?.CEFR?.label || recTask6?.score?.score_cefr || "-",
        subs: {
          Fluency: r?.interpreted?.Fluency?.value ?? null,
          Pronoun: r?.interpreted?.Pronunciation?.value ?? null,
          Prosody: r?.interpreted?.Prosody?.value ?? null,
          Coherence: r?.interpreted?.["Coherence and Cohesion"]?.value ?? null,
          "Topic Relevance": r?.interpreted?.["Topic Relevance"]?.value ?? null,
          Complexity: r?.interpreted?.Complexity?.value ?? null,
          Accuracy: r?.interpreted?.Accuracy?.value ?? null
        }
      });
      setProcessingProgress(100);
      console.log("[processTask6] SUCCESS");
    } catch (e) {
      console.error("[processTask6] ERROR", e);
      alert(e?.message || String(e));
    } finally {
      setProcessing(false);
      setTimeout(() => { setProcessingProgress(0); setAsrStatus(""); }, 400);
    }
  }

  function sanitizeName(name) {
    const base = String(name || "student").normalize("NFKD").replace(/[^\w\s-]+/g, "").trim();
    return base.replace(/\s+/g, "_");
  }
  function extFromContentType(ct) {
    const c = String(ct || "").toLowerCase();
    if (c.includes("audio/mpeg")) return ".mp3";
    if (c.includes("audio/wav")) return ".wav";
    if (c.includes("audio/ogg")) return ".ogg";
    if (c.includes("audio/mp4")) return ".m4a";
    if (c.includes("audio/webm")) return ".webm";
    return ".webm";
  }

  async function downloadAllAudios() {
    if (!recs.length || downloadingAll) return;
    try {
      setDownloadingAll(true);
      setDownloadProgress(0);
      setDownloadTotal(recs.length);
      let JSZip = null;
      try { JSZip = (await import("jszip")).default; } catch (_) {}
      const nameBase = sanitizeName(m?.nama);
      const ordered = recs.slice().sort((a,b)=>Number(a.tugas_id)-Number(b.tugas_id));
      if (JSZip) {
        const zip = new JSZip();
        const concurrency = Math.min(5, ordered.length);
        let completed = 0;
        let lastUiUpdate = 0;
        let nextIndex = 0;
        async function worker() {
          while (true) {
            const idx = nextIndex++;
            if (idx >= ordered.length) break;
            const r = ordered[idx];
            try {
              const resp = await fetch(`/api/media/rekaman/${r.id}`);
              if (resp.ok) {
                const buf = await resp.arrayBuffer();
                const ext = extFromContentType(resp.headers.get("content-type"));
                const tIdx = Number(r.tugas_id) || 0;
                const fname = `${nameBase}_test${tIdx}${ext}`;
                zip.file(fname, buf, { compression: "STORE" });
              }
            } catch(_) {}
            completed++;
            const now = performance.now();
            if (now - lastUiUpdate > 100 || completed === ordered.length) {
              lastUiUpdate = now;
              setDownloadProgress(completed);
            }
          }
        }
        await Promise.all(Array.from({length: concurrency}, ()=>worker()));
        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${nameBase}_audios.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        for (const r of ordered) {
          const resp = await fetch(`/api/media/rekaman/${r.id}`);
          if (!resp.ok) continue;
          const blob = await resp.blob();
          const ext = extFromContentType(resp.headers.get("content-type"));
          const idx = Number(r.tugas_id) || 0;
          const fname = `${nameBase}_test${idx}${ext}`;
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = fname;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          setDownloadProgress(idx + 1);
          await new Promise((res)=>setTimeout(res,150));
        }
      }
    } catch (e) {
      console.error(e);
      alert(e?.message || "Failed to download audios");
    } finally {
      setDownloadingAll(false);
      setTimeout(()=>{ setDownloadProgress(0); setDownloadTotal(0); }, 400);
    }
  }

  return (
    <div className="min-h-[80vh] bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-6xl mx-auto px-4 py-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">{m ? m.nama : "Mahasiswa"}</h1>
            <div className="text-sm text-gray-600 mt-1">{m?.program_studi} · {m?.kota} · Age {m?.umur}</div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard" className="text-sm px-3 py-1.5 rounded-lg bg-white border hover:bg-gray-50 shadow-sm">← Back</Link>
            <button
              onClick={downloadAllAudios}
              disabled={downloadingAll || !recs.length}
              className={`text-sm px-3 py-1.5 rounded-lg flex items-center gap-2 shadow border border-black/30 bg-gradient-to-r from-black to-gray-700 text-white hover:from-gray-900 hover:to-black transition ${downloadingAll?"opacity-60 cursor-not-allowed":""}`}
              title="Download all audio recordings"
            >
              {downloadingAll ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" /></svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v11" /><path d="m6 11 6 6 6-6" /><path d="M4 19h16" /></svg>
              )}
              {downloadingAll?`Downloading…${downloadTotal?` (${downloadProgress}/${downloadTotal})`:""}`:"Download Audios"}
            </button>
          </div>
        </div>
      {error && <div className="mt-3 p-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded">{error}</div>}
      {loading ? (
        <div className="mt-6 text-gray-600">Loading…</div>
      ) : (
        <>
          {/* Overall summary from Task 6 (presented as overall) */}
          {(() => {
            const s = overall ? null : (recTask6?.score || null);
            const cefr = overall?.cefr || s?.score_cefr || "-";
            const subs = overall?.subs || (s ? {
              Fluency: s.fluency, Pronoun: s.pronunciation, Prosody: s.prosody,
              Coherence: s.coherence, "Topic Relevance": s.topic_relevance, Complexity: s.complexity, Accuracy: s.accuracy
            } : null);
            const CEFR_DESC = { A1: "Beginner", A2: "Elementary", B1: "Intermediate", B2: "Upper-Intermediate", C1: "Advanced", C2: "Proficient" };
            const desc = CEFR_DESC[cefr] || "";
            return (
              <div className="mt-4 p-6 border-2 rounded-2xl bg-gradient-to-br from-white to-gray-50 shadow-lg">
                <div className="flex flex-col items-center justify-center gap-3 mb-6">
                  <div className="text-sm font-medium text-gray-500 uppercase tracking-wider">Overall CEFR Level</div>
                  <div className="flex items-center gap-4">
                    <div className="text-6xl font-black text-black">{cefr}</div>
                    <div className="text-left">
                      <div className="text-2xl font-bold text-gray-800">{desc}</div>
                    </div>
                  </div>
                </div>
                {subs && (
                  <div className="mt-6 pt-6 border-t">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Sub-Components</div>
                    <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
                      {Object.entries(subs).map(([k,v]) => (
                        <div key={k} className="flex flex-col items-center justify-center p-2 rounded-lg border bg-white hover:border-gray-400 transition">
                          <span className="text-[10px] text-gray-500 mb-0.5 text-center leading-tight">{k}</span>
                          <span className="text-lg font-bold text-black">{scoreToCEFR(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-3">
                  <button onClick={processTask6} disabled={!recTask6 || processing} className="rounded-lg bg-black hover:bg-neutral-800 text-white px-4 py-2 shadow">
                    {processing ? "Processing..." : (recTask6?.score ? "Re-process" : "Process")}
                  </button>
                </div>
              </div>
            );
          })()}
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            {recs.map((r) => (
              <div key={r.id} className="border rounded-2xl p-4 bg-white shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">{r.tugas_title || `Task ${r.tugas_id}`}</div>
                  <div className="text-xs text-gray-500">#{r.id}</div>
                </div>
                <audio src={`/api/media/rekaman/${r.id}`} controls className="w-full mt-3 rounded" preload="none" />
                {/* per-audio scores hidden; only player is shown */}
              </div>
            ))}
            {recs.length === 0 && (
              <div className="text-gray-600">No recordings found.</div>
            )}
          </div>
          {/* hidden inline feature computer */}
          <FeatureComputer
            ref={featureRef}
            onStatus={(s) => {
              if (s !== prevStatusRef.current) {
                prevStatusRef.current = s;
                setAsrStatus(s);
                setLastStatusAt(Date.now());
              }
              const p = percentFromStatus(s);
              if (p !== null) {
                setProcessingProgress(Math.max(0, Math.min(100, Math.round(p))));
              }
            }}
          />
        </>
      )}
      </div>

      {/* Processing overlay with Whisper download & progress */}
      {processing && (
        <div className="fixed inset-0 z-50 bg-white/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-gray-100 shadow-xl p-5">
            <div className="text-lg font-semibold">Processing Task 6</div>
            <div className="text-sm text-gray-600 mt-1">Please wait, this may take a few minutes.</div>

            {/* Whisper download progress (if still downloading) */}
            {whisper?.downloading && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-sm">
                  <span>Downloading Whisper</span>
                  <span>{Math.round(whisper.progress)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded h-2 overflow-hidden">
                  <div className="bg-black h-2" style={{ width: `${Math.round(whisper.progress)}%` }} />
                </div>
              </div>
            )}

            {/* Current ASR/compute status */}
            <div className="mt-3 text-xs text-gray-600">
              <span>{asrStatus || (whisper?.loaded ? "Starting..." : whisper?.status)}</span>
              {lastStatusAt > 0 && Date.now() - lastStatusAt > 30000 && (
                <span className="text-amber-600"> — still working… large model load or network, please wait</span>
              )}
            </div>

            {/* Progress bar */}
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm mb-1">
                <span>Progress</span>
                <span>{processingProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded h-2 overflow-hidden">
                <div className="h-2 bg-black" style={{ width: `${processingProgress}%` }} />
              </div>
            </div>

            <div className="mt-4 text-xs text-gray-500">Tip: Keep this tab open during processing.</div>
          </div>
        </div>
      )}
    </div>
  );
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "-";
}

function scoreToCEFR(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "-";
  // Use range-based mapping like in featureMapping.js
  if (n <= 0.5) return "A1";
  if (n <= 1.5) return "A2";
  if (n <= 2.5) return "B1";
  if (n <= 3.5) return "B2";
  if (n <= 4.5) return "C1";
  return "C2";
}

"use client";

import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AuthGate from "@/app/components/AuthGate";
import { supabase } from "@/lib/supabaseClient";

export default function DashboardDetailPage() {
  return (
    <AuthGate>
      <DetailContent />
    </AuthGate>
  );
}

function DetailContent() {
  const params = useParams();
  const id = params?.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    let active = true;
    async function load() {
      setLoading(true); setError("");
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      try {
        const res = await fetch(`/api/dashboard/mahasiswa/${id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
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
      }
    }
    load();
    return () => { active = false; };
  }, [id]);

  const m = data?.mahasiswa;
  const recs = data?.rekaman || [];
  // Find task 6 record id
  const recTask6 = recs.find((r) => Number(r?.tugas_id) === 6) || null;

  // Inline feature computer (reuses useAssessment logic)
  const FeatureComputer = forwardRef(function FC(_, ref) {
    const useAssessment = require("@/hooks/useAssessment").default;
    const { setFile, setRefTopic, setModel, setTranscript, run, result, status } = useAssessment();
    const resolverRef = useRef(null);
    useEffect(() => { if (result && resolverRef.current) { const res = resolverRef.current; resolverRef.current = null; res(result); } }, [result]);
    useImperativeHandle(ref, () => ({
      async computeFromBlob(blob, filename = "audio.webm", refTopic = "") {
        return new Promise(async (resolve) => {
          resolverRef.current = resolve;
          try { setModel("whisper"); setTranscript(""); } catch (_) {}
          const file = new File([blob], filename, { type: blob.type || "audio/webm" });
          setRefTopic(refTopic);
          setFile(file);
          setTimeout(() => run(), 0);
        });
      }
    }));
    return null;
  });
  const featureRef = useRef(null);
  const [processing, setProcessing] = useState(false);
  const [overall, setOverall] = useState(null); // {cefr, subscores}
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadTotal, setDownloadTotal] = useState(0);

  async function processTask6() {
    if (!recTask6) return;
    try {
      setProcessing(true);
      const res = await fetch(`/api/media/rekaman/${recTask6.id}`);
      if (!res.ok) throw new Error("Failed to fetch audio");
      const blob = await res.blob();
      const r = await featureRef.current.computeFromBlob(blob, `task6_${recTask6.id}.webm`, "");
      const features = r?.features;
      if (!features) throw new Error("Feature extraction failed");
  // Save score server-side (batch API with single item)
  await fetch("/api/score/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ rekaman_id: recTask6.id, features }] }) });
      // Upload transcript to rekaman
      if (r?.transcript) {
        await fetch(`/api/rekaman/${recTask6.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ transkrip: r.transcript }) });
      }
      // Update overall panel from interpreted outputs and subscores
      setOverall({
        cefr: r?.interpreted?.CEFR?.label || recTask6?.score?.score_cefr || "-",
        subs: {
          Fluency: r?.interpreted?.Fluency?.value ?? null,
          Pronunciation: r?.interpreted?.Pronunciation?.value ?? null,
          Prosody: r?.interpreted?.Prosody?.value ?? null,
          Coherence: r?.interpreted?.["Coherence and Cohesion"]?.value ?? null,
          "Topic Relevance": r?.interpreted?.["Topic Relevance"]?.value ?? null,
          Complexity: r?.interpreted?.Complexity?.value ?? null,
          Accuracy: r?.interpreted?.Accuracy?.value ?? null
        }
      });
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setProcessing(false);
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">{m ? m.nama : "Mahasiswa"}</h1>
            <div className="text-sm text-gray-600">{m?.program_studi} · {m?.kota} · Age {m?.umur}</div>
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
              Fluency: s.fluency, Pronunciation: s.pronunciation, Prosody: s.prosody,
              Coherence: s.coherence, "Topic Relevance": s.topic_relevance, Complexity: s.complexity, Accuracy: s.accuracy
            } : null);
            const CEFR_DESC = { A1: "Beginner", A2: "Elementary", B1: "Intermediate", B2: "Upper-Intermediate", C1: "Advanced", C2: "Proficient" };
            const desc = CEFR_DESC[cefr] || "";
            return (
              <div className="mt-4 p-4 border rounded-xl bg-white">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-600">Overall</div>
                  <div className="inline-flex items-center gap-2 bg-black text-white rounded-full px-3 py-1 text-sm">
                    <span className="font-semibold">{cefr}</span>
                    <span className="opacity-90">{desc}</span>
                  </div>
                </div>
                {subs && (
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    {Object.entries(subs).map(([k,v]) => (
                      <div key={k} className="flex items-center justify-between p-2 rounded border bg-white">
                        <span className="text-gray-600">{k}</span>
                        <span className="font-medium">{num(v)}</span>
                      </div>
                    ))}
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
          <FeatureComputer ref={featureRef} />
        </>
      )}
      </div>
    </div>
  );
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "-";
}

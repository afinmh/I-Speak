"use client";

import { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AuthGate from "@/app/components/AuthGate";
import { supabase } from "@/lib/supabaseClient";
import useAssessment from "@/hooks/useAssessment";
import { transcribeWhisperWebFromFile } from "@/lib/whisperWebClient";
import { subscribeWhisper, getWhisperState } from "@/lib/globalWhisperState";

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
  const [processing, setProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState("");
  const [currentRec, setCurrentRec] = useState(null);
  const [whisper, setWhisper] = useState(getWhisperState());
  const [adminName, setAdminName] = useState("");
  const processorRef = useRef(null);

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
        const email = sess?.session?.user?.email || "";
        if (email && !adminName) setAdminName(email.split("@")[0]);
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

  // Whisper progress subscription
  useEffect(() => {
    const unsub = subscribeWhisper((st) => setWhisper(st));
    return () => { if (typeof unsub === "function") unsub(); };
  }, []);

  const onProcessClick = useCallback(async (rec) => {
    setCurrentRec(rec);
    if (!rec) return;
    try {
      setProcessing(true);
      setProcessStatus("Preparing...");
      // Fetch audio blob
      const audioRes = await fetch(`/api/media/rekaman/${rec.id}`);
      if (!audioRes.ok) throw new Error("Failed to fetch audio");
      const blob = await audioRes.blob();
      const file = new File([blob], `rekaman_${rec.id}.webm`, { type: blob.type || "audio/webm" });
      // Determine reference topic
      let refTopic = rec.ref_topic || rec.tugas_teks || "";
      // If refTopic missing, fetch from tugas table by tugas index
      try {
        const idx = Number(rec.tugas_id);
        if ((!refTopic || refTopic.trim().length === 0) && Number.isFinite(idx) && idx > 0) {
          const tres = await fetch(`/api/tugas?index=${idx}`);
          if (tres.ok) {
            const tj = await tres.json().catch(()=>({}));
            refTopic = tj?.tugas?.teks || refTopic || "";
          }
        }
      } catch (_) {}
      // Determine transcript (existing or Whisper fallback)
      let tx = String(rec.transkrip || "").trim();
      if (!tx) {
        setProcessStatus("Auto-transcribing (downloading model)...");
        const asr = await transcribeWhisperWebFromFile(file, {
          model: "tiny.en",
          onDownloadProgress: (evt) => {
            const p = typeof evt === 'number' ? evt : (evt?.progress ?? 0);
            setProcessStatus(`Downloading Whisper ${Math.round((p||0)*100)}%`);
          },
          onProgress: (evt) => {
            const p = typeof evt === 'number' ? evt : (evt?.progress ?? 0);
            setProcessStatus(`Transcribing ${Math.round((p||0)*100)}%`);
          },
          returnSegments: false
        });
        tx = (typeof asr === 'string' ? asr : (asr?.text || "")).trim();
      }
      // Save transcript back to rekaman (always if we have one)
      if (tx) {
        try {
          await fetch(`/api/rekaman/${rec.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ transkrip: tx })
          });
        } catch (_) {}
      }
      setProcessStatus("Computing features...");
      const res = await processorRef.current.compute(file, refTopic, tx);
      const features = res?.features;
      if (!features) throw new Error("Feature extraction failed");
      setProcessStatus("Saving scores...");
      const bres = await fetch("/api/score/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ rekaman_id: rec.id, features }] })
      });
      if (!bres.ok) {
        const j = await bres.json().catch(()=>({}));
        throw new Error(j?.error || "Batch Score API failed");
      }
      setProcessStatus("Done");
      // reload detail
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      const fresh = await fetch(`/api/dashboard/mahasiswa/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (fresh.ok) setData(await fresh.json());
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setProcessing(false);
      setCurrentRec(null);
      setProcessStatus("");
    }
  }, [id]);

  const AdminProcessor = useMemo(() => {
    const Comp = forwardRef(function FeatureComputer({ onStatus }, ref) {
      const { file, setFile, setRefTopic, setTranscript, run, result, status } = useAssessment();
      const resolverRef = useRef(null);
      const onStatusRef = useRef(onStatus);
      const pendingStartRef = useRef(null);
      useEffect(() => { if (result && resolverRef.current) { const r = resolverRef.current; resolverRef.current = null; r(result); } }, [result]);
      useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);
      useEffect(() => { if (typeof onStatusRef.current === "function") onStatusRef.current(status || ""); }, [status]);
      useEffect(() => { const p = pendingStartRef.current; if (p && p.file && file === p.file) { try { run(); } finally { pendingStartRef.current = null; } } }, [file, run]);
      useImperativeHandle(ref, () => ({
        async compute(file, refTopic = "", transcript = "") {
          return new Promise(async (resolve) => {
            resolverRef.current = resolve;
            pendingStartRef.current = { file, refTopic, transcript };
            setRefTopic(refTopic);
            setTranscript(transcript || "");
            setFile(file);
          });
        }
      }));
      return null;
    });
    return Comp;
  }, []);

  const m = data?.mahasiswa;
  const recs = data?.rekaman || [];

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
            <button onClick={async()=>{ await supabase.auth.signOut(); }} className="text-sm px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-black shadow-sm">Sign out</button>
          </div>
        </div>
      {error && <div className="mt-3 p-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded">{error}</div>}
      {loading ? (
        <div className="mt-6 text-gray-600">Loading…</div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            {recs.map((r) => (
              <div key={r.id} className="border rounded-2xl p-4 bg-white shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">{r.tugas_title || `Task ${r.tugas_id}`}</div>
                  <div className="text-xs text-gray-500">#{r.id}</div>
                </div>
                <audio src={`/api/media/rekaman/${r.id}`} controls className="w-full mt-3 rounded" preload="none" />
                <div className="mt-3 text-sm grid grid-cols-2 gap-x-3 gap-y-1">
                  <div className="text-gray-600">CEFR</div>
                  <div className="font-medium"><span className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 border text-xs">{r.score?.score_cefr ?? '-'}</span></div>
                  <div className="text-gray-600">Fluency</div>
                  <div>{num(r.score?.fluency)}</div>
                  <div className="text-gray-600">Pronunciation</div>
                  <div>{num(r.score?.pronunciation)}</div>
                  <div className="text-gray-600">Prosody</div>
                  <div>{num(r.score?.prosody)}</div>
                  <div className="text-gray-600">Coherence</div>
                  <div>{num(r.score?.coherence)}</div>
                  <div className="text-gray-600">Topic Relevance</div>
                  <div>{num(r.score?.topic_relevance)}</div>
                  <div className="text-gray-600">Complexity</div>
                  <div>{num(r.score?.complexity)}</div>
                  <div className="text-gray-600">Accuracy</div>
                  <div>{num(r.score?.accuracy)}</div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => onProcessClick(r)}
                    className="px-3 py-1.5 rounded-lg text-white shadow-sm "
                    style={{ backgroundColor: r.score ? '#0ea5e9' : '#16a34a' }}
                  >{r.score ? 'Re-process' : 'Process'}</button>
                </div>
              </div>
            ))}
            {recs.length === 0 && (
              <div className="text-gray-600">No recordings found.</div>
            )}
          </div>
        </>
      )}
      </div>

      {/* Admin processor (hidden) */}
      <AdminProcessor ref={processorRef} onStatus={(s)=>setProcessStatus(s)} />

      {/* Processing overlay */}
      {processing && (
        <div className="fixed inset-0 z-50 bg-white/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-gray-100 shadow-xl p-5">
            <div className="text-lg font-semibold">Processing recording</div>
            <div className="text-sm text-gray-600 mt-1">This may take a moment, especially the first time.</div>
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
            <div className="mt-3 text-xs text-gray-600">{processStatus || (whisper?.loaded ? 'Starting...' : whisper?.status)}</div>
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

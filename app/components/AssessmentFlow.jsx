"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import Countdown from "@/app/components/Countdown";
import { subscribeWhisper, getWhisperState } from "@/lib/globalWhisperState";
import useAssessment from "@/hooks/useAssessment";

const FeatureComputer = forwardRef(function FeatureComputer({ onStatus }, ref) {
  const { file, setFile, setRefTopic, setModel, setTranscript, run, result, status } = useAssessment();
  const resolverRef = useRef(null);
  const onStatusRef = useRef(onStatus);
  // Pending start coordination to ensure state is set before calling run()
  const pendingStartRef = useRef(null); // { file, refTopic }

  useEffect(() => {
    if (result && resolverRef.current) {
      const resolve = resolverRef.current;
      resolverRef.current = null;
      resolve(result);
    }
  }, [result]);

  // Keep latest callback without retriggering on dependency changes
  useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);
  useEffect(() => {
    if (typeof onStatusRef.current === "function") onStatusRef.current(status || "");
  }, [status]);

  // Wait for hook file state to match requested file before starting run()
  useEffect(() => {
    const pending = pendingStartRef.current;
    if (pending && pending.file && file === pending.file) {
      // Start now that state is applied
      try { run(); } finally { pendingStartRef.current = null; }
    }
  }, [file, run]);

  useImperativeHandle(ref, () => ({
    async compute(file, refTopic = "") {
      return new Promise(async (resolve) => {
        resolverRef.current = resolve;
        pendingStartRef.current = { file, refTopic };
        // Force Whisper-only transcript mode for assessment: don't use DB/manual transcript
        try {
          setModel("whisper");
          setTranscript("");
        } catch (_) {}
        setRefTopic(refTopic);
        setFile(file);
        // run() will be called by the effect when file state reflects this file
      });
    }
  }));
  return null;
});

function useMediaRecorder() {
  const mediaRef = useRef(null);
  const [supported, setSupported] = useState(false);
  const [permissionError, setPermissionError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [chunks, setChunks] = useState([]);

  const canUseMedia = useCallback(() => (
    typeof window !== "undefined"
    && typeof navigator !== "undefined"
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === "function"
    && typeof window.MediaRecorder !== "undefined"
  ), []);

  useEffect(() => {
    setSupported(canUseMedia());
  }, [canUseMedia]);

  const requestPermission = useCallback(async () => {
    try {
      if (!canUseMedia()) {
        setPermissionError("Mic not supported in this browser");
        setSupported(false);
        return false;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Immediately stop to only request permission without recording
      stream.getTracks().forEach((t) => t.stop());
      setPermissionError("");
      setSupported(true);
      return true;
    } catch (e) {
      console.error(e);
      setPermissionError(e?.message || String(e));
      return false;
    }
  }, [canUseMedia]);

  const start = useCallback(async () => {
    try {
      if (!canUseMedia()) {
        setPermissionError("Mic not supported in this browser");
        setSupported(false);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Choose a mimeType that's supported by the browser (Safari/iOS often dislikes audio/webm)
      let mr = null;
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/m4a",
        "audio/mpeg"
      ];
      let chosen = null;
      try {
        for (const c of candidates) {
          if (typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(c)) {
            chosen = c;
            break;
          }
        }
        try {
          mr = chosen ? new MediaRecorder(stream, { mimeType: chosen }) : new MediaRecorder(stream);
        } catch (innerErr) {
          // Fallback: try without mimeType (some Safari builds reject unknown mime types)
          try { mr = new MediaRecorder(stream); chosen = null; } catch (e) { throw innerErr || e; }
        }
      } catch (e) {
        // If MediaRecorder construction fails, stop tracks and surface an error
        stream.getTracks().forEach((t) => t.stop());
        console.error("MediaRecorder init failed", e);
        setPermissionError(e?.message || String(e));
        setSupported(false);
        return;
      }
      const localChunks = [];
      mr.ondataavailable = (e) => { if (e?.data && e.data.size > 0) localChunks.push(e.data); };
      mr.onstop = () => {
        setChunks(localChunks);
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
      };
      mediaRef.current = mr;
      setChunks([]);
      setIsRecording(true);
      // Start with default timeslice (let the browser buffer) — some browsers emit dataavailable only on stop
      try { mr.start(); } catch (e) { console.warn("MediaRecorder.start failed", e); }
    } catch (e) {
      console.error(e);
      setPermissionError(e?.message || String(e));
    }
  }, []);

  const stop = useCallback(() => {
    const mr = mediaRef.current;
    if (mr && mr.state !== "inactive") {
      mr.stop();
    }
  }, []);

  const reset = useCallback(() => {
    setChunks([]);
  }, []);

  return { supported, permissionError, isRecording, chunks, start, stop, reset, requestPermission };
}

export default function AssessmentFlow() {
  const [step, setStep] = useState(0); // 0=form, 1..6 tasks, 7=finish
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // mahasiswa form state
  const [nama, setNama] = useState("");
  const [prodi, setProdi] = useState("");
  const [umur, setUmur] = useState(18);
  const [jk, setJk] = useState("laki-laki");
  const [kota, setKota] = useState("");
  const [mahasiswa, setMahasiswa] = useState(null);

  // task data and recordings
  const [currentTugas, setCurrentTugas] = useState(null);
  const [imageForTask4, setImageForTask4] = useState(null);
  const [prepLeft, setPrepLeft] = useState(0);
  const [recLeft, setRecLeft] = useState(0);
  const [recordReady, setRecordReady] = useState(false);
  const [uploaded, setUploaded] = useState([]); // [{ tugas, rekaman, file, refTopic? }]

  const { supported, permissionError, isRecording, chunks, start, stop, reset, requestPermission } = useMediaRecorder();
  const featureRef = useRef(null);
  // Track which task ID has already started prep to avoid reruns for the same task
  const lastStartedTaskIdRef = useRef(null);

  // Load tugas for current step (1..6)
  useEffect(() => {
    let active = true;
    async function loadTugas() {
      if (step >= 1 && step <= 6) {
        setError("");
        setCurrentTugas(null);
        setImageForTask4(null);
        setRecordReady(false);
        reset();
        try {
          const res = await fetch(`/api/tugas?index=${step}`);
          if (!res.ok) throw new Error("Gagal ambil tugas");
          const j = await res.json();
          if (!active) return;
          setCurrentTugas(j?.tugas || null);
          // If this is task 4, fetch a random image
          if (step === 4) {
            try {
              const gres = await fetch('/api/gambar/random');
              if (gres.ok) {
                const gj = await gres.json();
                if (gj?.gambar) setImageForTask4(gj.gambar);
              }
            } catch (_) {}
          }
        } catch (e) {
          if (!active) return;
          setError(e?.message || String(e));
        }
      }
    }
    loadTugas();
    return () => { active = false; };
  }, [step, reset]);

  const alreadyUploaded = useMemo(() => (
    !!currentTugas && uploaded.some((x) => x?.tugas?.id === currentTugas?.id)
  ), [uploaded, currentTugas]);

  // Handle prep & record timers when tugas loads (skip if already uploaded)
  useEffect(() => {
    if (!currentTugas || alreadyUploaded) return;
    const taskId = currentTugas?.id ?? null;
    // Only start prep/record once per task ID
    if (taskId && lastStartedTaskIdRef.current === taskId) return;

    let prepTimer = null;
    let recTimer = null;

    async function runTaskTimers() {
      // Request microphone permission before starting prep
      const ok = await requestPermission();
      if (!ok) {
        // Stop here if permission denied
        return;
      }

      const prep = Number(currentTugas?.prep_time || 0);
      const rec = Number(currentTugas?.record_time || 0);
      setPrepLeft(prep);
      setRecLeft(rec);
      setRecordReady(false);

      // Mark this task as started so prep won't rerun for this task again
      if (taskId) {
        lastStartedTaskIdRef.current = taskId;
      }

      function startRecordCountdown() {
        setRecordReady(true);
        // small delay before starting recorder to allow UI update showing prep=0
        setTimeout(() => {
          start();
          const recEndAt = Date.now() + rec * 1000;
          recTimer = setInterval(() => {
            const msLeft = recEndAt - Date.now();
            if (msLeft <= 0) {
              setRecLeft(0);
              clearInterval(recTimer);
              try { stop(); } catch (_) {}
            } else {
              setRecLeft(Math.ceil(msLeft / 1000));
            }
          }, 250);
        }, 250);
      }

      if (prep > 0) {
        const prepEndAt = Date.now() + prep * 1000;
        prepTimer = setInterval(() => {
          const msLeft = prepEndAt - Date.now();
          if (msLeft <= 0) {
            setPrepLeft(0);
            clearInterval(prepTimer);
            // Ensure recording starts strictly after UI has shown prep=0
            setTimeout(() => startRecordCountdown(), 200);
          } else {
            setPrepLeft(Math.ceil(msLeft / 1000));
          }
        }, 250);
      } else {
        // No prep time; start recording sequence directly
        startRecordCountdown();
      }
    }

    runTaskTimers();

    return () => {
      if (prepTimer) clearInterval(prepTimer);
      if (recTimer) clearInterval(recTimer);
      // Do not reset lastStartedTaskIdRef here to keep per-task one-time guarantee
    };
  }, [currentTugas, alreadyUploaded, requestPermission, start, stop]);

  // When recording stops and we have chunks, upload to /api/rekaman (only once)
  useEffect(() => {
    async function upload() {
      if (!chunks || chunks.length === 0) return;
      if (!mahasiswa?.id || !currentTugas?.id) return;
      if (alreadyUploaded) return;
      try {
        setLoading(true);
        const blob = new Blob(chunks, { type: "audio/webm" });
        const file = new File([blob], `tugas_${currentTugas.id}.webm`, { type: "audio/webm" });
        const fd = new FormData();
        fd.set("mahasiswa_id", String(mahasiswa.id));
        fd.set("tugas_id", String(currentTugas.id));
        fd.set("file", file);
        const res = await fetch("/api/rekaman", { method: "POST", body: fd });
        if (!res.ok) throw new Error("Upload rekaman gagal");
        const j = await res.json();
        // Determine reference topic: for task 4 use image topic, else use tugas text
        const refTopic = (step === 4 && imageForTask4?.topic)
          ? imageForTask4.topic
          : (currentTugas?.teks || "");
        // Keep which task index this recording belongs to for later compute rules
        setUploaded((arr) => [...arr, { tugas: currentTugas, rekaman: j?.rekaman, file, refTopic, stepIndex: step }]);
        reset();
        setRecordReady(false);
      } catch (e) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    }
    if (!isRecording && recLeft === 0 && recordReady && currentTugas && !alreadyUploaded) {
      upload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, recLeft, recordReady, alreadyUploaded]);

  const canNext = useMemo(() => {
    if (step === 0) return true;
    const ok = uploaded.some((x) => x?.tugas?.id === currentTugas?.id);
    return ok && !isRecording && !loading;
  }, [step, uploaded, currentTugas, isRecording, loading]);

  const onSubmitMahasiswa = useCallback(async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const body = { nama, program_studi: prodi, umur: Number(umur), jenis_kelamin: jk, kota };
      const res = await fetch("/api/mahasiswa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const j = await res.json().catch(()=>({}));
        throw new Error(j?.error || "Gagal simpan mahasiswa");
      }
      const j = await res.json();
      setMahasiswa(j?.mahasiswa);
      setStep(1);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [nama, prodi, umur, jk, kota]);

  const nextStep = useCallback(() => {
    if (step >= 1 && step < 6) setStep(step + 1);
    else if (step === 6) setStep(7);
  }, [step]);

  const [scoring, setScoring] = useState(false);
  const [scoreDone, setScoreDone] = useState([]);
  const [scoreResults, setScoreResults] = useState({}); // { [rekaman_id]: result }
  const [taskProgress, setTaskProgress] = useState([]); // per uploaded item percent
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [asrStatus, setAsrStatus] = useState("");
  const [lastStatusAt, setLastStatusAt] = useState(0);
  const prevStatusRef = useRef("");
  const [whisper, setWhisper] = useState(getWhisperState());
  const pendingItemsRef = useRef([]);

  // keep whisper download progress synced
  useEffect(() => {
    const unsub = subscribeWhisper((st) => setWhisper(st));
    return () => { if (typeof unsub === "function") unsub(); };
  }, []);

  const percentFromStatus = useCallback((s) => {
    const m = String(s || "").match(/(\d{1,3})%/);
    const n = m ? Number(m[1]) : null;
    if (n !== null && isFinite(n)) return Math.max(0, Math.min(100, n));
    return null;
  }, []);

  const runScoring = useCallback(async () => {
    setScoring(true);
    setError("");
    setTaskProgress(uploaded.map(() => 0));
    setCurrentIdx(-1);
    try {
      const itemsToCompute = uploaded
        .map((it, idx) => ({ it, idx }))
        .filter(({ it }) => it?.stepIndex === 6);

      console.log("[AssessmentFlow] runScoring start", { total: uploaded.length, toCompute: itemsToCompute.length });
      try { await fetch("/api/debug", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "runScoring-start", data: { total: uploaded.length, toCompute: itemsToCompute.length } }) }); } catch(_) {}

      if (itemsToCompute.length === 0) {
        setError("Tidak ada rekaman untuk Task 6. Silakan rekam Task 6 dulu.");
        return;
      }

      for (let k = 0; k < itemsToCompute.length; k++) {
        const i = itemsToCompute[k].idx;
        const item = itemsToCompute[k].it;
        const recId = item?.rekaman?.id;
        if (!recId) continue;
        setCurrentIdx(i);
        setAsrStatus("Preparing...");
        setLastStatusAt(Date.now());
        console.log("[AssessmentFlow] task start", { index: i, recId, tugasId: item?.tugas?.id, file: item?.file?.name });
        try { await fetch("/api/debug", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "task-start", data: { index: i, recId, tugasId: item?.tugas?.id } }) }); } catch(_) {}
        // Use per-item reference topic; for task 4 it's the image topic
        const refText = item?.refTopic || item?.tugas?.teks || "";
  const res = await featureRef.current.compute(item.file, refText);
        const features = res?.features;
        if (!features) throw new Error("Feature extraction failed");
        console.log("[AssessmentFlow] task features ready", { index: i, keys: Object.keys(features || {}).length });
        try { await fetch("/api/debug", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "task-features-ready", data: { index: i, keys: Object.keys(features || {}).length } }) }); } catch(_) {}
        // Stash features for batch save later
        pendingItemsRef.current.push({ rekaman_id: recId, features });
        // Save result locally for summary view
        setScoreResults((prev) => ({ ...prev, [recId]: res }));
        setScoreDone((arr) => [...arr, recId]);
        setTaskProgress((arr) => arr.map((v, idx) => idx === i ? 100 : v));
        console.log("[AssessmentFlow] task done", { index: i, recId });
        try { await fetch("/api/debug", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "task-done", data: { index: i, recId } }) }); } catch(_) {}

        // Immediately upload transcript to rekaman (store as 'transkrip')
        try {
          if (item?.stepIndex === 6 && res?.transcript) {
            await fetch(`/api/rekaman/${recId}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ transkrip: res.transcript })
            });
          }
        } catch (_) {}
      }
      // Batch save all features at once to DB
      const items = pendingItemsRef.current.slice();
      if (items.length > 0) {
        const bres = await fetch("/api/score/batch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items })
        });
        if (!bres.ok) {
          const j = await bres.json().catch(()=>({}));
          throw new Error(j?.error || "Batch Score API failed");
        }
      }
    } catch (e) {
      console.error("[AssessmentFlow] runScoring error", e);
      try { await fetch("/api/debug", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "runScoring-error", data: { message: e?.message || String(e) } }) }); } catch(_) {}
      setError(e?.message || String(e));
    } finally {
      console.log("[AssessmentFlow] runScoring end");
      try { await fetch("/api/debug", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "runScoring-end" }) }); } catch(_) {}
      setScoring(false);
      setCurrentIdx(-1);
    }
  }, [uploaded]);

  return (
    <div>
      <FeatureComputer
        ref={featureRef}
        onStatus={useCallback((s) => {
          // Skip if identical to last to avoid render loops
          if (s !== prevStatusRef.current) {
            prevStatusRef.current = s;
            setAsrStatus(s);
            setLastStatusAt(Date.now());
          }
          const p = percentFromStatus(s);
          if (currentIdx >= 0 && p !== null) {
            setTaskProgress((prev) => {
              const old = prev[currentIdx] ?? 0;
              const np = Math.max(0, Math.min(100, Math.round(p)));
              if (Math.round(old) === np) return prev; // no change
              return prev.map((v, idx) => (idx === currentIdx ? np : v));
            });
          }
          console.log("[AssessmentFlow] status", { index: currentIdx, s });
        }, [currentIdx, percentFromStatus])}
      />
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          {/* Compact header for mobile (match /model) */}
          <div className="flex items-center gap-3 md:hidden">
            <Image src="/loogo.png" alt="I‑Speak Logo" width={40} height={40} className="rounded-full shadow-sm" />
            <div className="flex flex-col">
              <div className="text-lg font-semibold">I‑Speak</div>
              <div className="text-xs text-neutral-500">Automated Speech Assessment</div>
            </div>
          </div>

          {/* Large title for desktop, hidden on mobile */}
          <h1 className="hidden md:block text-3xl font-extrabold tracking-tight">I‑Speak Assessment</h1>

          {mahasiswa && <div className="text-sm text-gray-600">{mahasiswa?.nama} · Step {Math.min(step,6)}/6</div>}
        </div>
        {/* Progress bar for steps */}
        <div className="w-full h-2 bg-gray-200 rounded-full mb-4 overflow-hidden">
          <div
            className="h-full bg-black transition-all"
            style={{ width: `${Math.min(step,6) / 6 * 100}%` }}
          />
        </div>
        {error && <div className="p-3 mb-4 text-sm text-red-800 bg-red-100 rounded">{error}</div>}

        {step === 0 && (
          <form onSubmit={onSubmitMahasiswa} className="space-y-4 bg-white/70 backdrop-blur rounded-xl shadow p-6 border border-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm">Full Name</span>
                <input required value={nama} onChange={(e)=>setNama(e.target.value)} className="mt-1 w-full border border-gray-300 focus:border-black focus:ring-black p-2 rounded" placeholder="Your full name" />
              </label>
              <label className="block">
                <span className="text-sm">Major / Program</span>
                <input required value={prodi} onChange={(e)=>setProdi(e.target.value)} className="mt-1 w-full border border-gray-300 focus:border-black focus:ring-black p-2 rounded" placeholder="e.g., Informatics" />
              </label>
              <label className="block">
                <span className="text-sm">Age</span>
                <input required type="number" min={1} value={umur} onChange={(e)=>setUmur(e.target.value)} className="mt-1 w-full border border-gray-300 focus:border-black focus:ring-black p-2 rounded" />
              </label>
              <label className="block">
                <span className="text-sm">Gender</span>
                <select value={jk} onChange={(e)=>setJk(e.target.value)} className="mt-1 w-full border border-gray-300 focus:border-black focus:ring-black p-2 rounded">
                  <option value="laki-laki">Male</option>
                  <option value="perempuan">Female</option>
                </select>
              </label>
              <label className="block md:col-span-2">
                <span className="text-sm">City</span>
                <input required value={kota} onChange={(e)=>setKota(e.target.value)} className="mt-1 w-full border border-gray-300 focus:border-black focus:ring-black p-2 rounded" placeholder="Current city" />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <button disabled={loading} className="rounded-lg bg-black hover:bg-neutral-800 transition text-white px-5 py-2.5 shadow">
                {loading ? "Saving..." : "Start Task 1"}
              </button>
            </div>
          </form>
        )}

        {step >= 1 && step <= 6 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">Student: {mahasiswa?.nama} • Step {step}/6</div>
              <div className={`text-sm ${supported ? "text-green-700" : "text-red-700"}`}>{supported ? "Mic Ready" : "Mic not supported"}</div>
            </div>
            {permissionError && (
              <div className="flex items-center justify-between text-sm text-red-700 bg-red-50 border border-red-100 rounded p-2">
                <span>Mic error: {permissionError}</span>
                <button onClick={requestPermission} className="px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700">Retry microphone</button>
              </div>
            )}

            <div className="p-6 bg-white/70 backdrop-blur rounded-xl border border-gray-100 shadow">
              {/* Centered title and timers like the screenshot */}
              <div className="text-center">
                <div className="mt-1 text-sm text-gray-600 font-bold tracking-tight">{currentTugas?.judul || `Task ${step}`} {currentTugas?.kategori}</div>
                <div className="mt-4 flex items-center justify-center gap-10">
                  <Countdown
                    label="Prep"
                    total={Number(currentTugas?.prep_time||0)}
                    remaining={prepLeft}
                    color="#16a34a"
                    active={prepLeft > 0}
                  />
                  <Countdown
                    label="Record"
                    total={Number(currentTugas?.record_time||0)}
                    remaining={recLeft}
                    color="#dc2626"
                    active={isRecording || (recordReady && recLeft > 0)}
                  />
                </div>
              </div>
              <p className="whitespace-pre-wrap border rounded-lg p-4 bg-white text-gray-800 mt-6 leading-relaxed">{currentTugas?.teks}</p>
              {step === 4 && (
                <div className="mt-4">
                  {imageForTask4?.image_url || imageForTask4?.resolved_url ? (
                    <div className="p-3 border rounded-lg bg-white">
                      <div className="text-sm text-gray-600 mb-2">Describe this picture:</div>
                      {/* Use plain img to avoid Next Image domain restrictions for arbitrary URLs */}
                      <img
                        src={`/api/media/image?${imageForTask4?.image_url ? `src=${encodeURIComponent(imageForTask4.image_url)}` : (imageForTask4?.resolved_url ? `src=${encodeURIComponent(imageForTask4.resolved_url)}` : "")}`}
                        alt={imageForTask4.topic || "Random image"}
                        className="w-full max-h-64 object-contain rounded"
                        onError={(e)=>{ e.currentTarget.alt = "(Image failed to load)"; e.currentTarget.style.display='none'; }}
                      />
                      {/* Hide topic text per request */}
                    </div>
                  ) : (
                    <div className="p-3 border rounded-lg bg-amber-50 text-amber-800 text-sm">
                      No image available from database; the task text will be used as the reference topic.
                    </div>
                  )}
                </div>
              )}
              {!alreadyUploaded && (
                <div className="mt-4 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1 rounded-full ${recordReady ? "bg-red-600 text-white" : "bg-gray-300 text-gray-700"}`}>
                      {isRecording ? "Recording..." : recordReady ? "Record" : "Waiting..."}
                    </span>
                    <span className="text-gray-500">Auto-starts</span>
                  </div>
                  {(!supported || permissionError) && (
                    <button onClick={requestPermission} className="px-3 py-1 rounded bg-black text-white hover:bg-neutral-800">Enable microphone</button>
                  )}
                </div>
              )}
              {alreadyUploaded && (
                <div className="mt-4 text-sm text-green-700">Recording has been finished.</div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button onClick={nextStep} disabled={!canNext} className="rounded-lg bg-black hover:bg-neutral-800 transition text-white px-5 py-2.5 shadow">
                {step < 6 ? (loading ? "Uploading..." : "Next Task") : "Finish"}
              </button>
            </div>
          </div>
        )}

        {step === 7 && (
          <div className="space-y-4">
            <div className="text-sm text-gray-600">Saved recordings: {uploaded.length} file(s)</div>

            {/* Overall result summary (represents student-level result) */}
            {(() => {
              const task6 = uploaded.find((u) => u?.stepIndex === 6);
              const rec6 = task6?.rekaman?.id;
              const res = rec6 ? scoreResults[rec6] : null;
              const cefrLabel = res?.interpreted?.CEFR?.label || "-";
              const CEFR_DESC = { A1: "Beginner", A2: "Elementary", B1: "Intermediate", B2: "Upper-Intermediate", C1: "Advanced", C2: "Proficient" };
              const cefrDesc = CEFR_DESC[cefrLabel] || "";
              const hasOverall = !!res;
              return hasOverall ? (
                <div className="p-4 rounded-xl border bg-white/80">
                  <div className="font-semibold mb-2">Overall Result</div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">CEFR</span>
                    <span className="inline-flex items-center gap-2 bg-black text-white rounded-full px-3 py-1 shadow-sm">
                      <span className="font-semibold tracking-wide">{cefrLabel}</span>
                      <span className="opacity-90">{cefrDesc}</span>
                    </span>
                  </div>
                </div>
              ) : null;
            })()}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {uploaded.map((u, i) => {
                const recId = u?.rekaman?.id;
                const res = recId ? scoreResults[recId] : null;
                const transcript = res?.transcript || "";
                const shortTr = transcript.length > 140 ? transcript.slice(0, 140) + "…" : transcript;
                return (
                  <div key={i} className="p-3 rounded border bg-white/60">
                    <div className="font-semibold">{u.tugas?.judul}</div>
                    <audio src={URL.createObjectURL(u.file)} controls className="w-full mt-2" />
                    {/* Hide transcript for Task 6; optional for others */}
                    {transcript && u?.stepIndex !== 6 ? (
                      <div className="mt-2 text-xs text-gray-700">
                        <div className="font-medium text-gray-800 mb-1">Transcript</div>
                        <div className="whitespace-pre-wrap">{shortTr}</div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              {(() => {
                const task6 = uploaded.find((u) => u?.stepIndex === 6);
                const rec6 = task6?.rekaman?.id;
                const done6 = rec6 ? scoreDone.includes(rec6) : false;
                if (done6 && !scoring) {
                  return (
                    <button onClick={() => { 
                      // reset to start
                      setScoreDone([]);
                      setScoreResults({});
                      setTaskProgress([]);
                      pendingItemsRef.current = [];
                      setUploaded([]);
                      setMahasiswa(null);
                      setStep(0);
                    }} className="rounded-lg bg-black hover:bg-neutral-800 transition text-white px-5 py-2.5 shadow">Finish</button>
                  );
                }
                return (
                  <button onClick={runScoring} disabled={scoring || !task6} className="rounded-lg bg-black hover:bg-neutral-800 transition text-white px-5 py-2.5 shadow">
                    {scoring ? "Processing..." : "Process"}
                  </button>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Process overlay with Whisper download & single overall progress */}
      {scoring && (
        <div className="fixed inset-0 z-50 bg-white/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-gray-100 shadow-xl p-5">
            <div className="text-lg font-semibold">Processing</div>
            <div className="text-sm text-gray-600 mt-1">Please wait, this may take around 5–10 minutes.</div>

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

            {/* Single overall progress bar */}
            <div className="mt-4">
              {(() => {
                const overall = Math.round(currentIdx >= 0 ? (taskProgress[currentIdx] || 0) : 0);
                return (
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span>Progress</span>
                      <span>{overall}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded h-2 overflow-hidden">
                      <div className="h-2 bg-black" style={{ width: `${overall}%` }} />
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="mt-4 text-xs text-gray-500">Tip: Keep this tab open. You can navigate between pages; download continues in the background.</div>
          </div>
        </div>
      )}
    </div>
  );
}

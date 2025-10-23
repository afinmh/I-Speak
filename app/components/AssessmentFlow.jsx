"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import Countdown from "@/app/components/Countdown";
// Whisper fallback removed per requirements; no global Whisper state needed
import useAssessment from "@/hooks/useAssessment";

const FeatureComputer = forwardRef(function FeatureComputer({ onStatus }, ref) {
  const { file, setFile, setRefTopic, setTranscript, run, result, status } = useAssessment();
  const resolverRef = useRef(null);
  const onStatusRef = useRef(onStatus);
  // Pending start coordination to ensure state is set before calling run()
  const pendingStartRef = useRef(null); // { file, refTopic, transcript }

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
    async compute(file, refTopic = "", transcript = "") {
      return new Promise(async (resolve) => {
        resolverRef.current = resolve;
        pendingStartRef.current = { file, refTopic, transcript };
        setRefTopic(refTopic);
        setTranscript(transcript || "");
        setFile(file);
        // run() will be called by the effect when file state reflects this file
      });
    }
  }));
  return null;
});

// Simple Web Speech API hook for en-US recognition with interim results
function useWebSpeech() {
  const recRef = useRef(null);
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [finalText, setFinalText] = useState("");
  const [interimText, setInterimText] = useState("");
  const lastFinalRef = useRef("");
  const retryRef = useRef(0);
  const maxRetries = 2;
  const endResolveRef = useRef(null);
  const desiredRef = useRef(false); // whether we want recognition running (per task)
  const sessionRef = useRef(0); // increment per beginForTask to isolate restarts
  const restartTimerRef = useRef(null);
  const restartCountRef = useRef(0);
  const lastRestartAtRef = useRef(0);
  const lastResultAtRef = useRef(0);
  const watchdogRef = useRef(null);
  const isIOSRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
  const ua = navigator.userAgent || "";
  isIOSRef.current = /iP(hone|od|ad)/.test(ua);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(!!SR);
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'en-US';
  // On iOS, continuous/interim can be unstable; use short turns and restart
  rec.interimResults = !isIOSRef.current;
  rec.continuous = !isIOSRef.current;
    rec.onstart = () => { setListening(true); };
    rec.onresult = (evt) => {
      // Build fresh from current session and collapse consecutive duplicates
      let finals = '';
      let interim = '';
      const len = evt.results.length;
      for (let i = 0; i < len; i++) {
        const r = evt.results[i];
        const t = r?.[0]?.transcript || '';
        if (!t) continue;
        if (r.isFinal) finals += t + ' ';
        else interim += t + ' ';
      }
      const dedupConsecutive = (s) => s
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter((w, i, a) => i === 0 || w.toLowerCase() !== a[i-1].toLowerCase())
        .join(' ');
      // Remove immediate repeated sequences up to maxSeq words (collapse duplicates)
      const collapseRepeatedSequences = (s, maxSeq = 4) => {
        if (!s) return '';
        const words = s.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
        let i = 0;
        while (i < words.length) {
          let removed = false;
          // try longest sequence first
          for (let k = Math.min(maxSeq, Math.floor((words.length - i) / 2)); k >= 1; k--) {
            const aStart = i;
            const aEnd = i + k; // exclusive
            const bStart = i + k;
            const bEnd = i + 2 * k;
            if (bEnd > words.length) continue;
            let match = true;
            for (let t = 0; t < k; t++) {
              if (words[aStart + t].toLowerCase() !== words[bStart + t].toLowerCase()) { match = false; break; }
            }
            if (match) {
              // remove the second duplicate block
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
      // Avoid regressing final text; only update when it actually changes
      if (finalsClean !== lastFinalRef.current) {
        lastFinalRef.current = finalsClean;
        setFinalText(finalsClean);
      }
      setInterimText(interimClean);
      lastResultAtRef.current = Date.now();
    };
    rec.onerror = (e) => {
      const err = e?.error || String(e);
      setError(err);
      // If desired, quickly attempt a gentle restart to avoid going to false listening
      if (desiredRef.current && retryRef.current < maxRetries) {
        retryRef.current += 1;
        try { rec.stop(); } catch (_) {}
        // preemptively show listening to avoid UI flicker
        setListening(true);
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => {
          try { rec.start(); } catch (_) { setListening(false); }
        }, 120 * retryRef.current);
      } else {
        // otherwise show not listening
        setListening(false);
      }
    };
    rec.onend = () => {
      // If stopAsync is awaiting, resolve and skip auto-restart
      if (typeof endResolveRef.current === 'function') {
        try { endResolveRef.current(); } catch (_) {}
        endResolveRef.current = null;
        setListening(false);
        return;
      }
      // Auto-restart quickly when still desired to minimize missed speech
      if (desiredRef.current) {
        const now = Date.now();
        const since = now - (lastRestartAtRef.current || 0);
        if (restartCountRef.current < 50 && since > 50) {
          lastRestartAtRef.current = now;
          restartCountRef.current += 1;
          if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
          const delay = isIOSRef.current ? 120 : 60;
          // mark listening true preemptively to avoid UI flipping to false during tiny gap
          setListening(true);
          restartTimerRef.current = setTimeout(() => {
            try { rec.start(); } catch (e) { setListening(false); }
          }, delay);
        } else {
          setListening(false);
        }
      } else {
        setListening(false);
      }
    };
    recRef.current = rec;
    return () => {
      try { rec.stop(); } catch (_) {}
      recRef.current = null;
      if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; }
    };
  }, []);

  const start = useCallback(() => {
    setError("");
    retryRef.current = 0;
    if (!recRef.current) return false;
    if (listening) return true;
    try { recRef.current.start(); setListening(true); return true; } catch (e) { setError(e?.message || String(e)); return false; }
  }, [listening]);
  const stop = useCallback(() => {
    if (!recRef.current) return;
    try { recRef.current.stop(); } catch (_) {}
  }, []);
  const stopAsync = useCallback(() => {
    return new Promise((resolve) => {
      if (!recRef.current) { resolve(); return; }
      endResolveRef.current = resolve;
      try { recRef.current.stop(); } catch (_) { resolve(); }
    });
  }, []);
  const beginFresh = useCallback(async () => {
    setError("");
    if (listening) {
      await stopAsync();
    }
    await new Promise((r) => setTimeout(r, 100));
    try { recRef.current && recRef.current.start(); setListening(true); } catch (e) { setError(e?.message || String(e)); }
  }, [listening, stopAsync]);
  const beginForTask = useCallback(async () => {
    desiredRef.current = true;
    sessionRef.current += 1;
    restartCountRef.current = 0;
    lastResultAtRef.current = Date.now();
    // Start watchdog to refresh session after long inactivity (~20s)
    if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; }
    watchdogRef.current = setInterval(() => {
      if (!desiredRef.current || !recRef.current) return;
      const now = Date.now();
      const idle = now - (lastResultAtRef.current || 0);
      if (listening && idle > 20000) {
        try { recRef.current.stop(); } catch (_) {}
        // onend will auto-restart due to desiredRef
        lastResultAtRef.current = Date.now();
      }
    }, 3000);
    // If already listening (e.g., continued from mic test), do not restart; just mark desired
    if (!listening) {
      await beginFresh();
    }
  }, [beginFresh, listening]);
  const endForTask = useCallback(async () => {
    desiredRef.current = false;
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; }
    await stopAsync();
  }, [stopAsync]);
  const reset = useCallback(() => { setFinalText(""); setInterimText(""); setError(""); }, []);

  return { supported, listening, error, finalText, interimText, start, stop, stopAsync, beginFresh, beginForTask, endForTask, reset };
}

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
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const localChunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) localChunks.push(e.data); };
      mr.onstop = () => {
        setChunks(localChunks);
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
      };
      mediaRef.current = mr;
      setChunks([]);
      setIsRecording(true);
      mr.start();
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
  // One-time mic test gating before Task 1
  const [micTestOpen, setMicTestOpen] = useState(false);
  const [micTestDone, setMicTestDone] = useState(false);

  const { supported, permissionError, isRecording, chunks, start, stop, reset, requestPermission } = useMediaRecorder();
  const featureRef = useRef(null);
  // Track which task ID has already started prep to avoid reruns for the same task
  const lastStartedTaskIdRef = useRef(null);
  // Web Speech per-task recognized text
  const [recognizedByTask, setRecognizedByTask] = useState({}); // { [taskId]: text }
  const ws = useWebSpeech();

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
    // For Task 1, delay timers until mic test is completed
    if (step === 1 && !micTestDone) return;
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
          // Start Web Speech recognition alongside recording (best-effort), ensuring fresh start per task
          (async () => {
            try {
              // Clear UI text but keep mic session if it's already running from mic test
              ws.reset();
              await ws.beginForTask();
            } catch (_) {}
          })();
          start();
          const recEndAt = Date.now() + rec * 1000;
          recTimer = setInterval(() => {
            const msLeft = recEndAt - Date.now();
            if (msLeft <= 0) {
              setRecLeft(0);
              clearInterval(recTimer);
              try { stop(); } catch (_) {}
              try { ws.endForTask(); } catch (_) {}
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
  }, [currentTugas, alreadyUploaded, requestPermission, start, stop, step, micTestDone]);
  // No mic check modal: directly proceed with timers per task

  // Ensure recognition is not running when moving between steps/tasks
  const prevStepRef = useRef(step);
  useEffect(() => {
    // Only clean up when the step actually changes (avoid firing on mic-test state changes)
    if (prevStepRef.current !== step) {
      try { ws.endForTask(); ws.reset(); } catch (_) {}
      prevStepRef.current = step;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

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
  // send recognized transcript to backend for persistence
  const recogText = (ws.finalText || ws.interimText || '').trim();
  if (recogText) fd.set("transkrip", recogText);
  const res = await fetch("/api/rekaman", { method: "POST", body: fd });
        if (!res.ok) throw new Error("Upload rekaman gagal");
        const j = await res.json();
        // Determine reference topic: for task 4 use image topic, else use tugas text
        const refTopic = (step === 4 && imageForTask4?.topic)
          ? imageForTask4.topic
          : (currentTugas?.teks || "");
        // stash recognition text per task id
        setRecognizedByTask((prev) => ({ ...prev, [currentTugas.id]: recogText }));
        setUploaded((arr) => [...arr, { tugas: currentTugas, rekaman: j?.rekaman, file, refTopic, transcript: recogText }]);
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
      // Start a one-time mic test modal with live recognition
      try {
        if (ws?.supported) {
          setMicTestOpen(true);
          await ws.beginFresh();
        } else {
          setMicTestOpen(true);
        }
      } catch (_) { setMicTestOpen(true); }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [nama, prodi, umur, jk, kota, ws]);

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
  const pendingItemsRef = useRef([]);
  const [showNoSupportModal, setShowNoSupportModal] = useState(true);

  // No Whisper fallback; show a modal if browser ASR is unsupported

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
      console.log("[AssessmentFlow] runScoring start", { total: uploaded.length });
      try { await fetch("/api/debug", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "runScoring-start", data: { total: uploaded.length } }) }); } catch(_) {}
      for (let i = 0; i < uploaded.length; i++) {
        const item = uploaded[i];
        const recId = item?.rekaman?.id;
        if (!recId) continue;
        setCurrentIdx(i);
        setAsrStatus("Preparing...");
        setLastStatusAt(Date.now());
        console.log("[AssessmentFlow] task start", { index: i, recId, tugasId: item?.tugas?.id, file: item?.file?.name });
        try { await fetch("/api/debug", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "task-start", data: { index: i, recId, tugasId: item?.tugas?.id } }) }); } catch(_) {}
        // Use per-item reference topic; for task 4 it's the image topic
        const refText = item?.refTopic || item?.tugas?.teks || "";
        let tx = (item?.transcript || recognizedByTask[item?.tugas?.id] || '').trim();
        if (!tx) {
          // Do not fallback to Whisper; proceed without ASR transcript
          setAsrStatus("No transcript available; proceeding without ASR");
        }
        const res = await featureRef.current.compute(item.file, refText, tx);
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
  }, [uploaded, recognizedByTask]);

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
            className="h-full bg-blue-600 transition-all"
            style={{ width: `${Math.min(step,6) / 6 * 100}%` }}
          />
        </div>
        {error && <div className="p-3 mb-4 text-sm text-red-800 bg-red-100 rounded">{error}</div>}

        {step === 0 && (
          <form onSubmit={onSubmitMahasiswa} className="space-y-4 bg-white/70 backdrop-blur rounded-xl shadow p-6 border border-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm">Full Name</span>
                <input required value={nama} onChange={(e)=>setNama(e.target.value)} className="mt-1 w-full border border-gray-300 focus:border-blue-500 focus:ring-blue-500 p-2 rounded" placeholder="Your full name" />
              </label>
              <label className="block">
                <span className="text-sm">Major / Program</span>
                <input required value={prodi} onChange={(e)=>setProdi(e.target.value)} className="mt-1 w-full border border-gray-300 focus:border-blue-500 focus:ring-blue-500 p-2 rounded" placeholder="e.g., Informatics" />
              </label>
              <label className="block">
                <span className="text-sm">Age</span>
                <input required type="number" min={1} value={umur} onChange={(e)=>setUmur(e.target.value)} className="mt-1 w-full border border-gray-300 focus:border-blue-500 focus:ring-blue-500 p-2 rounded" />
              </label>
              <label className="block">
                <span className="text-sm">Gender</span>
                <select value={jk} onChange={(e)=>setJk(e.target.value)} className="mt-1 w-full border border-gray-300 focus:border-blue-500 focus:ring-blue-500 p-2 rounded">
                  <option value="laki-laki">Male</option>
                  <option value="perempuan">Female</option>
                </select>
              </label>
              <label className="block md:col-span-2">
                <span className="text-sm">City</span>
                <input required value={kota} onChange={(e)=>setKota(e.target.value)} className="mt-1 w-full border border-gray-300 focus:border-blue-500 focus:ring-blue-500 p-2 rounded" placeholder="Current city" />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <button disabled={loading} className="rounded-lg bg-blue-600 hover:bg-blue-700 transition text-white px-5 py-2.5 shadow">
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
            {/* Web Speech recognition is used when supported; no Whisper fallback */}
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
                    <button onClick={requestPermission} className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">Enable microphone</button>
                  )}
                </div>
              )}
              {/* Live recognized text preview */}
              <div className="mt-3 text-xs">
                <div className="text-gray-600 mb-1">Recognized text (auto):</div>
                <div className="p-2 rounded border bg-gray-50 min-h-10 text-gray-800">
                  {(ws.finalText || ws.interimText || recognizedByTask[currentTugas?.id] || '').trim() || <span className="text-gray-400">(empty)</span>}
                </div>
                {!ws.supported && (
                  <div className="text-amber-700 bg-amber-50 border border-amber-100 rounded p-2 mt-2">Browser Web Speech API not supported; transcript will be empty unless entered manually later.</div>
                )}
                {ws.error && (
                  <div className="text-red-700 bg-red-50 border border-red-100 rounded p-2 mt-2">Speech error: {ws.error}</div>
                )}
              </div>
              {alreadyUploaded && (
                <div className="mt-4 text-sm text-green-700">Recording has been finished.</div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button onClick={nextStep} disabled={!canNext} className="rounded-lg bg-blue-600 hover:bg-blue-700 transition text-white px-5 py-2.5 shadow">
                {step < 6 ? (loading ? "Uploading..." : "Next Task") : "Finish"}
              </button>
            </div>
          </div>
        )}

        {step === 7 && (
          <div className="space-y-4">
            <div className="text-sm text-gray-600">Saved recordings: {uploaded.length} file(s)</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {uploaded.map((u, i) => {
                const recId = u?.rekaman?.id;
                const res = recId ? scoreResults[recId] : null;
                const cefrLabel = res?.interpreted?.CEFR?.label || "-";
                const topicSim = res?.features ? Math.round(Number(res.features["Topic Similarity (%)"]) || 0) : null;
                const transcript = res?.transcript || u?.transcript || "";
                const shortTr = transcript.length > 140 ? transcript.slice(0, 140) + "…" : transcript;
                return (
                  <div key={i} className="p-3 rounded border bg-white/60">
                    <div className="font-semibold">{u.tugas?.judul}</div>
                    <audio src={URL.createObjectURL(u.file)} controls className="w-full mt-2" />
                    <div className="mt-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Status</span>
                        <span className={scoreDone.includes(recId) ? "text-green-700" : "text-gray-600"}>
                          {scoreDone.includes(recId) ? "Scored" : "Pending"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">CEFR</span>
                        <span className="font-medium">{cefrLabel}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Topic Similarity</span>
                        <span className="font-medium">{topicSim !== null ? `${topicSim}%` : "-"}</span>
                      </div>
                    </div>
                    {transcript ? (
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
              <button onClick={runScoring} disabled={scoring || scoreDone.length === uploaded.length} className="rounded-lg bg-green-600 hover:bg-green-700 transition text-white px-5 py-2.5 shadow">
                {scoring ? "Computing..." : (scoreDone.length === 0 ? "Compute & Save Scores" : "Re-compute All")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Unsupported browser modal for Web Speech (hidden during mic test) */}
      {step >= 1 && step <= 6 && !ws.supported && showNoSupportModal && !micTestOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl bg-white border border-gray-100 shadow-xl p-6">
            <div className="text-lg font-semibold">Browser is not supported</div>
            <div className="text-sm text-gray-700 mt-1">Browser is not supported, Results will be generated by Admin.</div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setShowNoSupportModal(false)} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">Got it</button>
            </div>
          </div>
        </div>
      )}

      {/* One-time mic test before Task 1 */}
      {step === 1 && micTestOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-lg w-full rounded-2xl bg-white border border-gray-100 shadow-xl p-6">
            <div className="text-lg font-semibold">Microphone check</div>
            <div className="text-sm text-gray-700 mt-1">Read the sentence below and make sure text appears:</div>
            <div className="mt-2 p-3 bg-gray-50 rounded border text-sm font-medium">"Hello, good morning"</div>
            <div className="mt-4">
              <div className="text-xs text-gray-600 mb-1">Live transcript:</div>
              <div className="min-h-[64px] whitespace-pre-wrap p-3 bg-white border rounded text-sm">
                {ws.finalText || ws.interimText || (ws.supported ? "(No speech yet)" : "(Speech recognition is not supported in this browser)")}
              </div>
            </div>
            {(ws.error || permissionError) && (
              <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-100 rounded p-2">{ws.error || permissionError}</div>
            )}
            <div className="mt-5 flex justify-between">
              <button type="button" className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 text-gray-800" onClick={async ()=>{ try { const t = Promise.race([ws.stopAsync(), new Promise(r=>setTimeout(r,1200))]); await t; ws.reset(); await ws.beginFresh(); } catch(_){} }}>Retry</button>
              <button type="button" className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white" onClick={async ()=>{ try { const t = Promise.race([ws.stopAsync(), new Promise(r=>setTimeout(r,1200))]); await t; ws.reset(); } catch(_){} setMicTestDone(true); setMicTestOpen(false); try { await ws.beginFresh(); } catch(_){} }}>OK, continue</button>
            </div>
          </div>
        </div>
      )}

      {/* Compute overlay with per-task progress */}
      {scoring && (
        <div className="fixed inset-0 z-50 bg-white/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-gray-100 shadow-xl p-5">
            <div className="text-lg font-semibold">Computing assessments</div>
            <div className="text-sm text-gray-600 mt-1">This may take a moment, especially the first time.</div>

            {/* Current ASR/compute status */}
            <div className="mt-3 text-xs text-gray-600">
              {currentIdx >= 0 && (
                <span className="font-medium">Task {currentIdx + 1}/{uploaded.length}: </span>
              )}
              <span>{asrStatus || "Starting..."}</span>
              {lastStatusAt > 0 && Date.now() - lastStatusAt > 30000 && (
                <span className="text-amber-600"> — still working… large model load or network, please wait</span>
              )}
            </div>

            {/* Per-task indicators */}
            <div className="mt-4 space-y-2 max-h-64 overflow-auto">
              {(uploaded.length ? uploaded : new Array(6).fill(null)).map((u, i) => {
                const title = u?.tugas?.judul ? u.tugas.judul : `Task ${i + 1}`;
                const haveFile = !!u;
                const val = taskProgress[i] ?? (haveFile ? 0 : 0);
                return (
                  <div key={i} className="border rounded p-2 bg-white">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="truncate mr-2">{title}{!haveFile && " (not recorded)"}</span>
                      <span>{Math.round(val || 0)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded h-2 overflow-hidden">
                      <div className={`h-2 ${haveFile ? 'bg-blue-600' : 'bg-gray-300'}`} style={{ width: `${Math.round(val || 0)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 text-xs text-gray-500">Tip: Keep this tab open while computation runs.</div>
          </div>
        </div>
      )}
    </div>
  );
}

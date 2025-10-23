"use client";

import { useEffect, useMemo, useState } from "react";
import SplashLoader from "@/app/components/SplashLoader";
import { ensureWhisperWebLoaded } from "@/lib/whisperWebClient";
import { updateWhisperState } from "@/lib/globalWhisperState";

export default function PreloadWhisper({ model = "tiny.en" }) {
  const [visible, setVisible] = useState(true);
  const [pct, setPct] = useState(0);
  const [status, setStatus] = useState("Preparing Whisper model...");

  // Show at most 50% on the splash; continue in background
  const shownPct = useMemo(() => Math.min(50, Math.round(pct)), [pct]);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        console.log("[PreloadWhisper] start", { model });
        updateWhisperState({ downloading: true, loaded: false, progress: 0, status: `Downloading ${model}...` });
        await ensureWhisperWebLoaded({
          model,
          onDownloadProgress: (evt) => {
            const p = typeof evt === "number" ? evt : (evt?.progress ?? 0);
            const v = Math.max(0, Math.min(100, Math.round(p * 100)));
            if (!cancelled) {
              setPct(v);
              setStatus(`Downloading Whisper (${v}%)`);
            }
            console.log("[PreloadWhisper] progress", v);
            updateWhisperState({ downloading: v < 100, loaded: v >= 100, progress: v, status: `Downloading ${model}... ${v}%` });
          }
        });
        if (!cancelled) {
          // Model finished loading
          console.log("[PreloadWhisper] loaded");
          updateWhisperState({ downloading: false, loaded: true, progress: 100, status: "Ready" });
        }
      } catch (e) {
        if (!cancelled) {
          console.error("[PreloadWhisper] error", e);
          setStatus(e?.message || String(e));
          // Hide splash if unsupported; state remains not loaded
          setVisible(false);
          updateWhisperState({ downloading: false, loaded: false, status: `Error: ${e?.message || e}` });
        }
      } finally {
        // Hide splash once hitting 50% or after a short time if fast
        setTimeout(() => { if (!cancelled) setVisible(false); }, 400);
      }
    }
    start();
    return () => { cancelled = true; };
  }, [model]);

  return (
    <SplashLoader visible={visible} progress={shownPct} status={status} />
  );
}

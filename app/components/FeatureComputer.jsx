"use client";

import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import useAssessment from "@/hooks/useAssessment";

const FeatureComputer = forwardRef(function FeatureComputer({ onStatus }, ref) {
  const { file, setFile, setRefTopic, setModel, setTranscript, run, result, status } = useAssessment();
  const resolverRef = useRef(null);
  const onStatusRef = useRef(onStatus);
  const pendingStartRef = useRef(null); // { file, refTopic }

  useEffect(() => {
    if (result && resolverRef.current) {
      console.log("[FeatureComputer] result received, resolving");
      const resolve = resolverRef.current;
      resolverRef.current = null;
      resolve(result);
    }
  }, [result]);

  // Keep latest callback without retriggering on dependency changes
  useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);
  useEffect(() => {
    console.log("[FeatureComputer] status changed:", status);
    if (typeof onStatusRef.current === "function") onStatusRef.current(status || "");
  }, [status]);

  // Wait for hook file state to match requested file before starting run()
  useEffect(() => {
    const pending = pendingStartRef.current;
    console.log("[FeatureComputer] file effect", { hasPending: !!pending, pendingFile: pending?.file?.name, currentFile: file?.name, match: pending?.file === file });
    if (pending && pending.file && file === pending.file) {
      console.log("[FeatureComputer] file state matched, calling run()");
      try { run(); } finally { pendingStartRef.current = null; }
    }
  }, [file, run]);

  useImperativeHandle(ref, () => ({
    async compute(file, refTopic = "") {
      console.log("[FeatureComputer] compute called", { filename: file?.name, size: file?.size });
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
        console.log("[FeatureComputer] State set, waiting for effect to trigger run()");
        // run() will be called by the effect when file state reflects this file
      });
    }
  }));
  return null;
});

export default FeatureComputer;

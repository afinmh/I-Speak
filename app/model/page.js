"use client";
import Image from "next/image";
import { Poppins } from "next/font/google";
import AssessClient from "../components/AssessClient";
import SplashLoader from "../components/SplashLoader";
import { useEffect, useRef, useState } from "react";

const poppins = Poppins({ subsets: ["latin"], weight: ["500", "700"], display: "swap" });

export default function ModelPage() {
  const [booting, setBooting] = useState(true);
  const [progress, setProgress] = useState(0);
  const [bootStatus, setBootStatus] = useState("Initializing...");
  const hiddenEarlyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const HIDE_THRESHOLD = 50; // %
    // No Whisper preload here: we only warm up lightweight assets
    // Simulate half progress while warming assets
    setProgress(20);

    (async () => {
      try {
        setBootStatus("Warming up assets...");
        setProgress(40);
        await Promise.allSettled([
          fetch("/api/data/idioms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hello world" }) }),
          fetch("/api/data/bundles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hello world" }) }),
        ]);
      } catch (_) {}
    })();

    (async () => {
      try {
        setBootStatus("Loading text embeddings...");
        setProgress(70);
        const { pipeline, env } = await import("@xenova/transformers");
        env.allowLocalModels = false;
        await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
      } catch (_) {}
    })();

    const done = setTimeout(() => {
      if (!cancelled) {
        setProgress(100);
        setBootStatus("Ready");
        if (!hiddenEarlyRef.current) setBooting(false);
      }
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(done);
    };
  }, []);

  return (
    <div className={`min-h-screen p-4 md:p-8 bg-white text-black ${poppins.className}`}>
      <SplashLoader visible={booting} progress={progress} status={bootStatus} />
      <header className="mb-6 md:mb-8">
        <div className="flex items-center gap-3 md:gap-4">
          <Image src="/loogo.png" alt="I‑Speak Logo" width={40} height={40} priority className="rounded-full shadow-sm" />
          <div className="flex flex-col">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">I‑Speak</h1>
            <p className="text-sm md:text-base text-neutral-500">Automated Speech Assessment</p>
          </div>
        </div>
      </header>
      <AssessClient />
    </div>
  );
}

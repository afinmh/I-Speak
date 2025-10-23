"use client";
import Image from "next/image";
import { useMemo } from "react";

export default function SplashLoader({ visible, progress = 0, status = "Loading..." }) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const aria = useMemo(() => `${pct}%`, [pct]);
  if (!visible) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white">
      <div className="w-full max-w-md px-6">
        <div className="flex items-center justify-center mb-6" aria-hidden>
          <Image src="/loading.gif" alt="Loading" width={100} height={100} priority unoptimized />
        </div>
        <div className="w-full bg-neutral-200 rounded-full h-2 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Loading">
          <div className="h-full bg-black transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 text-sm text-neutral-600 text-center">{status} — {aria}</p>
        <p className="mt-1 text-xs text-neutral-400 text-center">
          It might take a little longer the first time, but only at startup.
        </p>
      </div>
    </div>
  );
}

"use client";

import { createContext, useContext, useMemo, useState } from "react";

const UiStateCtx = createContext(null);

export function UiStateProvider({ children }) {
  const [busyCount, setBusyCount] = useState(0);
  const [message, setMessage] = useState("");

  const api = useMemo(() => ({
    isBusy: busyCount > 0,
    message,
    start: (msg) => { setMessage(msg || ""); setBusyCount((c) => c + 1); },
    end: () => { setBusyCount((c) => Math.max(0, c - 1)); if (busyCount <= 1) setMessage(""); },
    withBusy: async (msg, fn) => { api.start(msg); try { return await fn(); } finally { api.end(); } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [busyCount, message]);

  return (
    <UiStateCtx.Provider value={api}>
      {children}
      <GlobalLoader isBusy={busyCount > 0} message={message} />
    </UiStateCtx.Provider>
  );
}

export function useUiState() {
  const ctx = useContext(UiStateCtx);
  if (!ctx) throw new Error("useUiState must be used within UiStateProvider");
  return ctx;
}

function GlobalLoader({ isBusy, message }) {
  return (
    <div
      aria-live="polite"
      aria-busy={isBusy}
      className={`fixed inset-0 transition ${isBusy?"opacity-100 pointer-events-auto":"opacity-0 pointer-events-none"}`}
      style={{ zIndex: 60 }}
    >
      {/* Backdrop with blur */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      {/* Centered modal */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-[92%] sm:w-[420px] max-w-[90vw] rounded-2xl bg-white/95 shadow-xl border border-black/10">
          <div className="p-5 flex items-center gap-3">
            <div className="flex-none w-10 h-10 rounded-full bg-black text-white flex items-center justify-center">
              <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" /></svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{message || "Processing…"}</div>
              <div className="text-xs text-gray-600">Please wait a moment</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

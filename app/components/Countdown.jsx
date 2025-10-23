"use client";

export default function Countdown({ label, total = 0, remaining = 0, color = "#2563eb", active = false }) {
  const t = Math.max(0, Number(total) || 0);
  const r = Math.max(0, Math.min(t, Number(remaining) || 0));
  const pct = t > 0 ? (1 - r / t) : 1;
  const deg = Math.round(pct * 360);
  const bg = `conic-gradient(${color} ${deg}deg, #e5e7eb 0deg)`; // tailwind gray-200 fallback
  return (
    <div className="flex items-center gap-3" aria-label={`${label} countdown`}>
      <div className={`relative w-14 h-14 rounded-full ${active ? "animate-pulse" : ""}`} style={{ background: bg }}>
        <div className="absolute inset-1 rounded-full bg-white flex items-center justify-center text-sm font-semibold" aria-live="polite">
          {r}s
        </div>
      </div>
      <div className="text-sm">
        <div className="font-medium text-gray-800">{label}</div>
        <div className="text-gray-500">{t}s total</div>
      </div>
    </div>
  );
}

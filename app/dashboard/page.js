"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AuthGate from "@/app/components/AuthGate";
import { supabase } from "@/lib/supabaseClient";

export default function DashboardPage() {
  return (
    <AuthGate>
      <DashboardContent />
    </AuthGate>
  );
}

function DashboardContent() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError("");
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      try {
        const res = await fetch("/api/dashboard/mahasiswa", {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (!res.ok) {
          const j = await res.json().catch(()=>({}));
          throw new Error(j?.error || "Failed to load mahasiswa");
        }
        const j = await res.json();
        if (!active) return;
        setItems(Array.isArray(j?.mahasiswa) ? j.mahasiswa : []);
      } catch (e) {
        if (!active) return;
        setError(e?.message || String(e));
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((m) =>
      String(m.nama || "").toLowerCase().includes(q) ||
      String(m.program_studi || "").toLowerCase().includes(q) ||
      String(m.kota || "").toLowerCase().includes(q)
    );
  }, [items, query]);

  async function fetchStudentDetail(id) {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    const res = await fetch(`/api/dashboard/mahasiswa/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!res.ok) throw new Error("Failed to load student detail");
    return await res.json();
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

  async function downloadAudiosForStudent(e, m) {
    e.preventDefault();
    e.stopPropagation();
    try {
      setDownloadingId(m.id);
      const detail = await fetchStudentDetail(m.id);
      const recs = (detail?.rekaman || []).slice().sort((a,b)=>Number(a.tugas_id)-Number(b.tugas_id));
      if (!recs.length) {
        alert("No recordings found for this student.");
        setDownloadingId(null);
        return;
      }
      const nameBase = sanitizeName(m.nama);
      // Try to zip using jszip; fallback to individual downloads if not available
      let JSZip = null;
      try { JSZip = (await import("jszip")).default; } catch (_) {}
      if (JSZip) {
        const zip = new JSZip();
        for (const r of recs) {
          const resp = await fetch(`/api/media/rekaman/${r.id}`);
          if (!resp.ok) continue;
          const buf = await resp.arrayBuffer();
          const ext = extFromContentType(resp.headers.get("content-type"));
          const idx = Number(r.tugas_id) || 0;
          const fname = `${nameBase}_test${idx}${ext}`;
          zip.file(fname, buf);
        }
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
        // Fallback: download individually (may be blocked by some browsers)
        for (const r of recs) {
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
          await new Promise((res) => setTimeout(res, 150));
        }
      }
      setDownloadingId(null);
    } catch (err) {
      console.error(err);
      alert(err?.message || "Failed to download audios");
      setDownloadingId(null);
    }
  }

  return (
    <div className="min-h-[80vh] bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-6xl mx-auto px-4 py-5">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>
            <p className="text-sm text-gray-600">Select a student to view their recordings and scores.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/images" className="text-sm px-3 py-1.5 rounded-lg bg-white border hover:bg-gray-50 shadow-sm">Images Admin</Link>
            <button onClick={async()=>{ await supabase.auth.signOut(); }} className="text-sm px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-black shadow-sm">Sign out</button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search name, program, city…" className="w-full sm:w-80 border rounded-lg p-2 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-black/20" />
          <div className="text-xs text-gray-500">{filtered.length} result(s)</div>
        </div>
      {error && <div className="mt-3 p-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded">{error}</div>}
      {loading ? (
        <div className="mt-6 text-gray-600">Loading…</div>
      ) : (
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((m) => (
            <Link key={m.id} href={`/dashboard/${m.id}`} className="group block border rounded-2xl p-4 bg-white hover:shadow-md transition">
              <div className="flex items-center gap-3">
                <div className="flex-none w-10 h-10 rounded-full bg-black text-white flex items-center justify-center font-semibold shadow-sm">
                  {String(m.nama || "?").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-lg font-semibold group-hover:text-black">{m.nama}</div>
                    <div className="flex items-center gap-2">
                      <span className="flex-none inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-black/5 text-black border border-black/20">
                        {m.rekaman_count ?? 0} rec
                      </span>
                      <button
                        onClick={(e)=>downloadAudiosForStudent(e, m)}
                        disabled={downloadingId === m.id}
                        className={`text-xs px-2 py-1 rounded flex items-center gap-1 shadow border border-black/30 bg-gradient-to-r from-black to-gray-700 text-white hover:from-gray-900 hover:to-black transition ${downloadingId===m.id?"opacity-60 cursor-not-allowed":""}`}
                        title="Download all audios as ZIP"
                      >
                        {downloadingId===m.id ? (
                          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" /></svg>
                        ) : (
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v11" /><path d="m6 11 6 6 6-6" /><path d="M4 19h16" /></svg>
                        )}
                        {downloadingId===m.id?"Downloading…":"Download"}
                      </button>
                    </div>
                  </div>
                  <div className="text-sm text-gray-600 truncate">{m.program_studi} · {m.kota}</div>
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-400">ID: {m.id}</div>
            </Link>
          ))}
          {items.length === 0 && (
            <div className="text-gray-600">No students found.</div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

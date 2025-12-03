"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AuthGate from "@/app/components/AuthGate";
import { supabase } from "@/lib/supabaseClient";
import { useUiState } from "@/app/components/UiStateProvider";

export default function DashboardPage() {
  return (
    <AuthGate>
      <DashboardContent />
    </AuthGate>
  );
}

function DashboardContent() {
  const ui = useUiState();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadTotal, setDownloadTotal] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, nama }

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(""); ui.start("Loading list…");
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      try {
        const res = await fetch("/api/dashboard/mahasiswa", {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (res.status === 401) {
          console.warn("[Dashboard] Token expired or unauthorized, clearing local session...");
          await supabase.auth.signOut({ scope: 'local' });
          return;
        }
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
        ui.end();
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
    if (res.status === 401) {
      console.warn("[Dashboard] Token expired, clearing local session...");
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error("Session expired");
    }
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
      setDownloadTotal(recs.length);
      setDownloadProgress(0);
      const nameBase = sanitizeName(m.nama);
      // Try to zip using jszip; fallback to individual downloads if not available
      let JSZip = null;
      try { JSZip = (await import("jszip")).default; } catch (_) {}
      if (JSZip) {
        const zip = new JSZip();
        // Concurrent fetch with worker pool
        const concurrency = Math.min(5, recs.length);
        let completed = 0;
        let lastUiUpdate = 0;
        async function worker(startIndex) {
          while (true) {
            const idx = nextIndex++;
            if (idx >= recs.length) break;
            const r = recs[idx];
            try {
              const resp = await fetch(`/api/media/rekaman/${r.id}`);
              if (resp.ok) {
                const buf = await resp.arrayBuffer();
                const ext = extFromContentType(resp.headers.get("content-type"));
                const tIdx = Number(r.tugas_id) || 0;
                const fname = `${nameBase}_test${tIdx}${ext}`;
                // Use STORE (no compression) for speed; audio already compressed
                zip.file(fname, buf, { compression: "STORE" });
              }
            } catch (_) {}
            completed++;
            // Throttle UI updates to every 100ms or on completion
            const now = performance.now();
            if (now - lastUiUpdate > 100 || completed === recs.length) {
              lastUiUpdate = now;
              setDownloadProgress(completed);
            }
          }
        }
        let nextIndex = 0;
        const workers = [];
        for (let i = 0; i < concurrency; i++) workers.push(worker(i));
        await Promise.all(workers);
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
          setDownloadProgress(idx + 1);
          await new Promise((res) => setTimeout(res, 150));
        }
      }
      setDownloadingId(null);
      setTimeout(()=>{ setDownloadProgress(0); setDownloadTotal(0); }, 300);
    } catch (err) {
      console.error(err);
      alert(err?.message || "Failed to download audios");
      setDownloadingId(null);
      setDownloadProgress(0); setDownloadTotal(0);
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
            <Link href="/dashboard/tugas" className="text-sm px-3 py-1.5 rounded-lg bg-white border hover:bg-gray-50 shadow-sm">Tasks</Link>
            <Link href="/dashboard/images" className="text-sm px-3 py-1.5 rounded-lg bg-white border hover:bg-gray-50 shadow-sm">Images</Link>
            <button 
              onClick={async()=>{ 
                try {
                  ui.start("Signing out…");
                  await supabase.auth.signOut();
                  window.location.href = '/dashboard';
                } catch (e) {
                  console.error('Sign out error:', e);
                } finally {
                  ui.end();
                }
              }} 
              className="text-sm px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-black shadow-sm"
            >
              Sign out
            </button>
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
                        onClick={(e)=>{ ui.start("Preparing ZIP…"); downloadAudiosForStudent(e, m).finally(()=>ui.end()); }}
                        disabled={downloadingId === m.id}
                        className={`text-xs p-2 rounded flex items-center gap-1 shadow border border-black/30 bg-gradient-to-r from-black to-gray-700 text-white hover:from-gray-900 hover:to-black transition ${downloadingId===m.id?"opacity-60 cursor-not-allowed":""}`}
                        title="Download all audios as ZIP"
                      >
                        {downloadingId===m.id ? (
                          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" /></svg>
                        ) : (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v11" /><path d="m6 11 6 6 6-6" /><path d="M4 19h16" /></svg>
                        )}
                      </button>
                      <button
                        onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); setConfirmDelete({ id: m.id, nama: m.nama }); }}
                        className="text-xs p-2 rounded flex items-center gap-1 shadow border border-red-600 bg-red-600 text-white hover:bg-red-700"
                        title="Delete user and all associated data"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6v-2h8v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
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
      {confirmDelete && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={()=>setConfirmDelete(null)} />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-[92%] sm:w-[460px] bg-white rounded-2xl shadow-xl border">
              <div className="p-5">
                <div className="flex items-center gap-3">
                  <div className="flex-none w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6v-2h8v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">Hapus semua data</div>
                    <div className="text-sm text-gray-600">Mahasiswa: {confirmDelete.nama}</div>
                  </div>
                </div>
                <div className="mt-3 text-sm text-gray-700">Tindakan ini akan menghapus seluruh rekaman, skor, dan data mahasiswa. Tindakan tidak dapat dibatalkan.</div>
                <div className="mt-4 flex justify-end gap-2">
                  <button onClick={()=>setConfirmDelete(null)} className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50">Batal</button>
                  <button
                    onClick={async ()=>{
                      const id = confirmDelete.id;
                      setConfirmDelete(null);
                      try {
                        await ui.withBusy("Deleting user…", async ()=>{
                          const { data: sess } = await supabase.auth.getSession();
                          const token = sess?.session?.access_token;
                          const res = await fetch(`/api/dashboard/mahasiswa/${id}/delete`, {
                            method: "DELETE",
                            headers: token ? { Authorization: `Bearer ${token}` } : {}
                          });
                          if (!res.ok) {
                            const j = await res.json().catch(()=>({}));
                            throw new Error(j?.error || "Delete failed");
                          }
                          setItems((prev)=>prev.filter((x)=>x.id !== id));
                        });
                      } catch (e) {
                        alert(e?.message || "Delete failed");
                      }
                    }}
                    className="px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700"
                  >Hapus</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

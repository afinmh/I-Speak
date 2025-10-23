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
          <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search name, program, city…" className="w-full sm:w-80 border rounded-lg p-2 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
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
                <div className="flex-none w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-semibold shadow-sm">
                  {String(m.nama || "?").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-lg font-semibold group-hover:text-blue-600">{m.nama}</div>
                    <span className="flex-none inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                      {m.rekaman_count ?? 0} rec
                    </span>
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

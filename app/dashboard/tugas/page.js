"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AuthGate from "@/app/components/AuthGate";
import { supabase } from "@/lib/supabaseClient";
import { useUiState } from "@/app/components/UiStateProvider";

export default function TugasManagementPage() {
  return (
    <AuthGate>
      <TugasContent />
    </AuthGate>
  );
}

function TugasContent() {
  const ui = useUiState();
  const [tugas, setTugas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({});

  useEffect(() => {
    loadTugas();
  }, []);

  async function loadTugas() {
    setLoading(true);
    setError("");
    ui.start("Loading tasks…");
    try {
      const res = await fetch("/api/tugas");
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to load tasks");
      }
      const j = await res.json();
      setTugas(Array.isArray(j?.tugas) ? j.tugas : []);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
      ui.end();
    }
  }

  function startEdit(t) {
    setEditingId(t.id);
    setFormData({
      judul: t.judul || "",
      kategori: t.kategori || "",
      teks: t.teks || "",
      prep_time: t.prep_time || 0,
      record_time: t.record_time || 0
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setFormData({});
  }

  async function saveEdit() {
    if (!editingId) return;
    try {
      ui.start("Saving…");
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      
      const res = await fetch("/api/tugas", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          id: editingId,
          ...formData
        })
      });
      
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to update task");
      }
      
      await loadTugas();
      cancelEdit();
    } catch (e) {
      alert(e?.message || "Failed to save");
    } finally {
      ui.end();
    }
  }

  return (
    <div className="min-h-[80vh] bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-6xl mx-auto px-4 py-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Task Management</h1>
            <p className="text-sm text-gray-600 mt-1">Edit task details, preparation time, and recording time</p>
          </div>
          <Link href="/dashboard" className="text-sm px-3 py-1.5 rounded-lg bg-white border hover:bg-gray-50 shadow-sm inline-flex items-center gap-2">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Back
          </Link>
        </div>

        {error && <div className="mb-4 p-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded">{error}</div>}

        {loading ? (
          <div className="text-gray-600">Loading…</div>
        ) : (
          <div className="space-y-4">
            {tugas.map((t) => (
              <div key={t.id} className="border-2 rounded-2xl p-5 bg-white shadow-sm">
                {editingId === t.id ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Judul</label>
                      <input
                        type="text"
                        value={formData.judul || ""}
                        onChange={(e) => setFormData({ ...formData, judul: e.target.value })}
                        className="w-full border rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-black/20"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Kategori</label>
                      <input
                        type="text"
                        value={formData.kategori || ""}
                        onChange={(e) => setFormData({ ...formData, kategori: e.target.value })}
                        placeholder="Contoh: Read Aloud Short, Describe Picture"
                        className="w-full border rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-black/20"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Teks</label>
                      <textarea
                        value={formData.teks || ""}
                        onChange={(e) => setFormData({ ...formData, teks: e.target.value })}
                        rows={5}
                        className="w-full border rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-black/20"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Waktu Persiapan (detik)</label>
                        <input
                          type="number"
                          value={formData.prep_time || 0}
                          onChange={(e) => setFormData({ ...formData, prep_time: Number(e.target.value) })}
                          min="0"
                          className="w-full border rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-black/20"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Waktu Rekam (detik)</label>
                        <input
                          type="number"
                          value={formData.record_time || 0}
                          onChange={(e) => setFormData({ ...formData, record_time: Number(e.target.value) })}
                          min="0"
                          className="w-full border rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-black/20"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={saveEdit} className="px-4 py-2 rounded-lg bg-black text-white hover:bg-gray-800">
                        Save
                      </button>
                      <button onClick={cancelEdit} className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="text-xl font-bold">{t.judul}</div>
                          {t.kategori && <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">{t.kategori}</span>}
                        </div>
                        {t.teks && <div className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{t.teks}</div>}
                      </div>
                      <button
                        onClick={() => startEdit(t)}
                        className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 text-sm flex items-center gap-2 flex-shrink-0"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        Edit
                      </button>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        <span className="text-gray-600">Prep: <span className="font-semibold">{t.prep_time || 0}s</span></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <circle cx="12" cy="12" r="3" fill="currentColor" />
                        </svg>
                        <span className="text-gray-600">Record: <span className="font-semibold">{t.record_time || 0}s</span></span>
                      </div>
                      <div className="text-xs text-gray-400">ID: {t.id}</div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

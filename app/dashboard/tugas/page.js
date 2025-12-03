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
      if (res.status === 401) {
        console.warn("[Tugas] Token expired, clearing local session...");
        await supabase.auth.signOut({ scope: 'local' });
        return;
      }
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
      
      if (res.status === 401) {
        console.warn("[Tugas] Token expired, signing out...");
        await supabase.auth.signOut();
        return;
      }
      
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-10">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight mb-2">Task Management</h1>
            <p className="text-slate-600">Manage and edit your assessment tasks</p>
          </div>
          <Link 
            href="/dashboard" 
            className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 hover:shadow-md transition-all duration-200 text-sm font-medium text-slate-700"
          >
            <svg className="w-4 h-4 group-hover:-translate-x-1 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Back to Dashboard
          </Link>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3">
            <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div className="text-sm text-red-800">{error}</div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
              <p className="text-slate-600 font-medium">Loading tasks...</p>
            </div>
          </div>
        ) : tugas.length === 0 ? (
          <div className="text-center py-20">
            <svg className="w-16 h-16 mx-auto text-slate-300 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="9" x2="15" y2="9" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            <p className="text-slate-600 font-medium">No tasks available</p>
          </div>
        ) : (
          <div className="space-y-5">
            {tugas.map((t) => (
              <div 
                key={t.id} 
                className="group relative bg-white border border-slate-200 rounded-2xl p-6 hover:shadow-lg hover:border-slate-300 transition-all duration-300"
              >
                {editingId === t.id ? (
                  <div className="space-y-5">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Task Title</label>
                      <input
                        type="text"
                        value={formData.judul || ""}
                        onChange={(e) => setFormData({ ...formData, judul: e.target.value })}
                        className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                        placeholder="Enter task title"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Category</label>
                      <input
                        type="text"
                        value={formData.kategori || ""}
                        onChange={(e) => setFormData({ ...formData, kategori: e.target.value })}
                        placeholder="e.g., Read Aloud Short, Describe Picture"
                        className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Task Content</label>
                      <textarea
                        value={formData.teks || ""}
                        onChange={(e) => setFormData({ ...formData, teks: e.target.value })}
                        rows={6}
                        className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all resize-none"
                        placeholder="Enter task description or content"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Preparation Time (seconds)</label>
                        <div className="relative">
                          <input
                            type="number"
                            value={formData.prep_time || 0}
                            onChange={(e) => setFormData({ ...formData, prep_time: Number(e.target.value) })}
                            min="0"
                            className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                          />
                          <div className="absolute right-4 top-3.5 text-slate-400 text-sm">sec</div>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Recording Time (seconds)</label>
                        <div className="relative">
                          <input
                            type="number"
                            value={formData.record_time || 0}
                            onChange={(e) => setFormData({ ...formData, record_time: Number(e.target.value) })}
                            min="0"
                            className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                          />
                          <div className="absolute right-4 top-3.5 text-slate-400 text-sm">sec</div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 pt-2">
                      <button 
                        onClick={saveEdit} 
                        className="px-6 py-3 rounded-xl bg-slate-900 text-white font-medium hover:bg-slate-800 active:scale-95 transition-all duration-200 shadow-lg shadow-slate-900/20"
                      >
                        Save Changes
                      </button>
                      <button 
                        onClick={cancelEdit} 
                        className="px-6 py-3 rounded-xl border border-slate-200 bg-white font-medium hover:bg-slate-50 active:scale-95 transition-all duration-200"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-3 flex-wrap">
                          <h2 className="text-xl font-bold text-slate-900 tracking-tight">{t.judul}</h2>
                          {t.kategori && (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                              {t.kategori}
                            </span>
                          )}
                        </div>
                        {t.teks && (
                          <div className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap bg-slate-50 rounded-xl p-4 border border-slate-100">
                            {t.teks}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => startEdit(t)}
                        className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-sm font-medium text-slate-700 transition-all duration-200 shadow-sm hover:shadow"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        Edit
                      </button>
                    </div>
                    
                    <div className="flex items-center gap-1 mt-5 pt-4 border-t border-slate-100">
                      <div className="flex items-center gap-6 text-sm flex-1 flex-wrap">
                        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50">
                          <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                          <span className="text-slate-600">
                            Prep: <span className="font-semibold text-slate-900">{t.prep_time || 0}s</span>
                          </span>
                        </div>
                        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50">
                          <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <circle cx="12" cy="12" r="3" fill="currentColor" />
                          </svg>
                          <span className="text-slate-600">
                            Record: <span className="font-semibold text-slate-900">{t.record_time || 0}s</span>
                          </span>
                        </div>
                      </div>
                      <div className="text-xs text-slate-400 font-mono px-3 py-1 rounded-lg bg-slate-50">
                        #{t.id}
                      </div>
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

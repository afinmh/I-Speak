"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import AuthGate from "@/app/components/AuthGate";
import { useUiState } from "@/app/components/UiStateProvider";
import { supabase } from "@/lib/supabaseClient";

export default function ImagesAdminPage() {
  return (
    <AuthGate>
      <ImagesContent />
    </AuthGate>
  );
}

function ImagesContent() {
  const ui = useUiState();
  const [topic, setTopic] = useState("");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);

  async function loadList() {
    ui.start("Loading images…");
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    const res = await fetch("/api/dashboard/images?limit=100", {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (res.status === 401) {
      console.warn("[Images] Token expired, clearing local session...");
      await supabase.auth.signOut({ scope: 'local' });
      ui.end();
      return;
    }
    if (res.ok) {
      const j = await res.json();
      setItems(Array.isArray(j?.items) ? j.items : []);
    }
    ui.end();
  }

  useEffect(() => {
    loadList();
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    if (!topic.trim()) { setError("Topic is required"); return; }
    if (!file) { setError("Image file is required"); return; }
    setLoading(true); ui.start("Uploading image…");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      const fd = new FormData();
      fd.set("topic", topic.trim());
      fd.set("file", file);
      const res = await fetch("/api/gambar/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd
      });
      if (res.status === 401) {
        console.warn("[Images] Token expired, clearing local session...");
        await supabase.auth.signOut({ scope: 'local' });
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(()=>({}));
        throw new Error(j?.error || "Upload failed");
      }
      setTopic(""); setFile(null);
      await loadList();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false); ui.end();
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Images Admin</h1>
        <Link href="/dashboard" className="text-sm inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border shadow-sm hover:bg-gray-50 text-black">
          ← Back
        </Link>
      </div>

      <form onSubmit={onSubmit} className="mt-4 p-4 border rounded-xl bg-white space-y-3">
        <div>
          <label className="block text-sm">Topic (required)</label>
          <input value={topic} onChange={(e)=>setTopic(e.target.value)} className="mt-1 w-full border rounded p-2" placeholder="e.g., Daily Life" required />
        </div>
        <div>
          <label className="block text-sm">Image File (required)</label>
          <input type="file" accept="image/*" onChange={(e)=>setFile(e.target.files?.[0] || null)} className="mt-1" required />
        </div>
        <button disabled={loading} className="rounded bg-black text-white px-4 py-2 hover:bg-neutral-800 shadow">
          {loading ? "Uploading..." : "Upload"}
        </button>
        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
      </form>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        {items.map((g) => {
          const srcParam = g.image_url
            ? `src=${encodeURIComponent(g.image_url)}`
            : (g.resolved_url ? `src=${encodeURIComponent(g.resolved_url)}` : "");
          const imgSrc = srcParam ? `/api/media/image?${srcParam}` : null;
          return (
            <div key={g.id} className="border rounded-xl p-3 bg-white">
              <div className="text-sm text-gray-600">{g.topic}</div>
              {imgSrc ? (
                <Image
                  src={imgSrc}
                  alt={g.topic || "Uploaded image"}
                  width={800}
                  height={600}
                  className="w-full h-48 object-contain mt-2"
                  priority={false}
                />
              ) : (
                <div className="mt-2 text-xs text-gray-500">(No image URL)</div>
              )}
              <div className="text-xs text-gray-500 mt-1">{new Date(g.uploaded_at).toLocaleString()}</div>
            </div>
          );
        })}
        {items.length === 0 && <div className="text-gray-600">No images yet.</div>}
      </div>
    </div>
  );
}

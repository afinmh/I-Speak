import { NextRequest } from "next/server";
import { json, error } from "../../../_utils/respond";
import { createClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAnonServerClientWithToken(accessToken) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const supa = createClient(url, anon, { auth: { persistSession: false } });
  return { supa, accessToken };
}

async function requireAuth(req /** @type {NextRequest} */) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const anon = getAnonServerClientWithToken(token);
  if (!anon) return null;
  const { supa } = anon;
  const { data, error: e } = await supa.auth.getUser(token);
  if (e || !data?.user) return null;
  return data.user;
}

export async function GET(req, ctx) {
  try {
    const user = await requireAuth(req);
    if (!user) return error("Unauthorized", 401);

    const p = await ctx?.params;
    const id = Number(p?.id);
    if (!id) return error("Invalid mahasiswa id", 400);

    const supa = getServiceClient();
    const { data: mahasiswa, error: e1 } = await supa
      .from("mahasiswa")
      .select("*")
      .eq("id", id)
      .single();
    if (e1) return error(e1.message, 500);

    const { data: rekaman, error: e2 } = await supa
      .from("rekaman_mahasiswa")
      .select("id, tugas_id, audio_url, uploaded_at")
      .eq("mahasiswa_id", id)
      .order("tugas_id", { ascending: true });
    if (e2) return error(e2.message, 500);

    const recIds = (rekaman || []).map((r) => r.id);
    let scoresByRec = {};
    if (recIds.length) {
      const { data: scores } = await supa
        .from("score_mahasiswa")
        .select("*")
        .in("rekaman_id", recIds);
      if (Array.isArray(scores)) {
        for (const s of scores) scoresByRec[s.rekaman_id] = s;
      }
    }

    // fetch tugas titles (if tugas table exists)
    const tugasIds = Array.from(new Set((rekaman || []).map((r) => r.tugas_id))).filter(Boolean);
    let tugasTitle = {};
    if (tugasIds.length) {
      const { data: tugas } = await supa
        .from("tugas")
        .select("id, judul")
        .in("id", tugasIds);
      if (Array.isArray(tugas)) {
        for (const t of tugas) tugasTitle[t.id] = t.judul;
      }
    }

    const recOut = (rekaman || []).map((r) => ({
      ...r,
      score: scoresByRec[r.id] || null,
      tugas_title: tugasTitle[r.tugas_id] || null,
    }));

    return json({ ok: true, mahasiswa, rekaman: recOut });
  } catch (e) {
    return error(e?.message || "Failed to load detail", 500);
  }
}

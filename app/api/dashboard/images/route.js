import { NextRequest } from "next/server";
import { json, error } from "../../_utils/respond";
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

export async function GET(req /** @type {NextRequest} */) {
  try {
    const user = await requireAuth(req);
    if (!user) return error("Unauthorized", 401);

    const { searchParams } = new URL(req.url);
    const limit = Math.min(200, Number(searchParams.get("limit") || 50));

    const supa = getServiceClient();
    const { data, error: e1 } = await supa
      .from("gambar")
      .select("id, topic, image_url, uploaded_at")
      .order("uploaded_at", { ascending: false })
      .limit(limit);
    if (e1) return error(e1.message, 500);

    // Resolve URLs for each item similarly to /gambar/random
    const out = [];
    for (const g of (data || [])) {
      let resolved_url = null;
      try {
        if (typeof g.image_url === "string" && /^https?:\/\//i.test(g.image_url)) {
          resolved_url = g.image_url;
        } else if (g.image_url) {
          const p = g.image_url;
          const { data: signed } = await supa.storage.from("images").createSignedUrl(p, 60 * 60 * 24 * 7);
          resolved_url = signed?.signedUrl || null;
          if (!resolved_url) {
            const { data: pub } = await supa.storage.from("images").getPublicUrl(p);
            resolved_url = pub?.publicUrl || null;
          }
        }
      } catch (_) {}
      out.push({ ...g, resolved_url });
    }

    return json({ ok: true, items: out });
  } catch (e) {
    return error(e?.message || "Failed to list images", 500);
  }
}

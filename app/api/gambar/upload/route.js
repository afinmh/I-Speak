import { NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabaseServer";
import { createClient } from "@supabase/supabase-js";

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

export async function POST(req /** @type {NextRequest} */) {
  try {
    const user = await requireAuth(req);
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const form = await req.formData();
    const topic = (form.get("topic") || "").toString().trim();
    const file = form.get("file");
    if (!topic) return new Response(JSON.stringify({ error: "Topic is required" }), { status: 400 });
    if (!file) return new Response(JSON.stringify({ error: "Image file is required" }), { status: 400 });

    const supa = getServiceClient();
    const bucket = "images"; // distinct bucket for images
    const ts = Date.now();
    const safeName = (file.name || "image").replace(/[^a-z0-9_.-]/gi, "_");
    const path = `topic_${topic.replace(/\s+/g, "-").toLowerCase()}/${ts}_${safeName}`;

    const { error: uerr } = await supa.storage
      .from(bucket)
      .upload(path, file, { contentType: file.type || "image/*" });
    if (uerr && uerr.message && !uerr.message.includes("The resource already exists")) {
      return new Response(JSON.stringify({ error: uerr.message }), { status: 500 });
    }
  // Store the object path in DB to be robust for both public/private buckets
  const image_url = path;

    const { data, error } = await supa
      .from("gambar")
      .insert([{ topic, image_url }])
      .select("*")
      .single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

    return new Response(JSON.stringify({ ok: true, gambar: { ...data, resolved_url: (await (async () => {
      try {
        const { data: signed } = await supa.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
        if (signed?.signedUrl) return signed.signedUrl;
      } catch (_) {}
      try {
        const { data: pub } = supa.storage.from(bucket).getPublicUrl(path);
        return pub?.publicUrl || null;
      } catch (_) { return null; }
    })()) } }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500 });
  }
}

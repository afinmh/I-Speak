import { getServiceClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supa = getServiceClient();
    // First get count for random offset
    const { count, error: cntErr } = await supa
      .from("gambar")
      .select("id", { count: "exact", head: true });
    if (cntErr) throw cntErr;
    if (!count || count <= 0) {
      return new Response(JSON.stringify({ ok: true, gambar: null }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const offset = Math.floor(Math.random() * count);
    const { data, error } = await supa
      .from("gambar")
      .select("id, topic, image_url, uploaded_at")
      .range(offset, offset)
      .single();
    if (error) throw error;
    // Resolve URL: if image_url looks like a full URL, return as-is.
    // Otherwise treat it as a storage path under the 'images' bucket and create a signed URL (7 days) or public URL fallback.
    let resolved_url = null;
    try {
      if (typeof data?.image_url === "string" && /^https?:\/\//i.test(data.image_url)) {
        resolved_url = data.image_url;
      } else if (data?.image_url) {
        const p = data.image_url;
        const { data: signed } = await supa.storage.from("images").createSignedUrl(p, 60 * 60 * 24 * 7);
        resolved_url = signed?.signedUrl || null;
        if (!resolved_url) {
          const { data: pub } = supa.storage.from("images").getPublicUrl(p);
          resolved_url = pub?.publicUrl || null;
        }
      }
    } catch (_) {}
    return new Response(JSON.stringify({ ok: true, gambar: { ...data, resolved_url } }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("/api/gambar/random error", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
}

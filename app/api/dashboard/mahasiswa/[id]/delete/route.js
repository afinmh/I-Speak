import { NextRequest } from "next/server";
import { json, error } from "../../../../_utils/respond";
import { getServiceClient, getBucketName } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAuth(req /** @type {NextRequest} */) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  // For admin-only delete, you might validate user role here.
  return token; // allow if authenticated
}

function extractPathFromUrl(url, bucket) {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    const idx = u.pathname.indexOf(`/object/`);
    if (idx >= 0) {
      const after = u.pathname.slice(idx + "/object/".length);
      // public/<bucket>/<path> or sign/<bucket>/<path>
      const parts = after.split("/");
      const bIndex = parts.indexOf(bucket);
      if (bIndex >= 0) {
        const rel = parts.slice(bIndex + 1).join("/");
        return rel || null;
      }
    }
    // If it's already relative
    if (!u.protocol || u.protocol === "") return String(url);
  } catch (_) {}
  return null;
}

export async function DELETE(req /** @type {NextRequest} */, { params }) {
  try {
    const token = await requireAuth(req);
    if (!token) return error("Unauthorized", 401);

    const id = Number(params?.id);
    if (!id) return error("Invalid mahasiswa id", 400);

    const supa = getServiceClient();
    const bucket = getBucketName();

    // Fetch recordings
    const { data: rekaman, error: eRec } = await supa
      .from("rekaman_mahasiswa")
      .select("id, audio_url")
      .eq("mahasiswa_id", id);
    if (eRec) return error(eRec.message, 500);

    const recIds = (rekaman || []).map(r => r.id);
    const paths = [];
    for (const r of rekaman || []) {
      const p = extractPathFromUrl(r.audio_url, bucket);
      if (p) paths.push(p);
    }

    // Delete scores
    if (recIds.length) {
      await supa.from("score_mahasiswa").delete().in("rekaman_id", recIds);
    }

    // Delete storage files
    if (paths.length) {
      await supa.storage.from(bucket).remove(paths);
    }

    // Delete recordings
    await supa.from("rekaman_mahasiswa").delete().eq("mahasiswa_id", id);

    // Finally delete mahasiswa row
    await supa.from("mahasiswa").delete().eq("id", id);

    return json({ ok: true, deleted: { recs: recIds.length, files: paths.length } });
  } catch (e) {
    return error(e?.message || "Failed to delete mahasiswa", 500);
  }
}

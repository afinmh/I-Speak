import { NextRequest } from "next/server";
import { getServiceClient, getBucketName } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guessContentType(path) {
  const p = String(path || "").toLowerCase();
  if (p.endsWith(".mp3")) return "audio/mpeg";
  if (p.endsWith(".wav")) return "audio/wav";
  if (p.endsWith(".ogg")) return "audio/ogg";
  if (p.endsWith(".m4a")) return "audio/mp4";
  return "audio/webm";
}

function extractStoragePath(urlOrPath) {
  // If it's already a storage path like mhs_x/tugas_y/file.webm, return as-is
  if (urlOrPath && !/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  // Otherwise parse URL patterns like .../object/public/<bucket>/<path>
  try {
    const u = new URL(String(urlOrPath));
    const parts = u.pathname.split("/");
    const idx = parts.findIndex((p) => p === "public" || p === "sign" || p === "authenticated");
    if (idx >= 0 && parts.length > idx + 2) {
      // parts[idx+1] should be bucket name, remainder is path
      return parts.slice(idx + 2).join("/");
    }
  } catch (_) {}
  return null;
}

export async function GET(req, ctx) {
  try {
    const p = await ctx?.params;
    const id = Number(p?.id);
    if (!id) return new Response("Bad Request", { status: 400 });

    const supa = getServiceClient();
    const { data: rec, error: e1 } = await supa
      .from("rekaman_mahasiswa")
      .select("audio_url")
      .eq("id", id)
      .single();
    if (e1) return new Response(e1.message, { status: 404 });

    const bucket = getBucketName(); // defaults to 'recordings'

    // Resolve storage path
    const path = extractStoragePath(rec?.audio_url);
    if (!path) return new Response("Audio path not found", { status: 404 });

    const { data: blob, error: e2 } = await supa.storage.from(bucket).download(path);
    if (e2 || !blob) return new Response(e2?.message || "Download failed", { status: 500 });

    // For Node runtime, blob can be a Blob; convert to ArrayBuffer
    const ab = await blob.arrayBuffer();
    const ct = guessContentType(path);
    return new Response(Buffer.from(ab), {
      status: 200,
      headers: {
        "content-type": ct,
        "cache-control": "private, max-age=0",
        "cross-origin-resource-policy": "same-origin",
      }
    });
  } catch (e) {
    return new Response(e?.message || "Server error", { status: 500 });
  }
}

import { NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guessContentType(path) {
  const p = String(path || "").toLowerCase();
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".gif")) return "image/gif";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function extractImagePathFromUrl(url) {
  try {
    const u = new URL(String(url));
    const parts = u.pathname.split("/");
    // Match /storage/v1/object/public/images/<...path...>
    const idx = parts.findIndex((p) => p === "public");
    if (idx >= 0 && parts[idx - 1] === "object" && parts[idx + 1] === "images") {
      return decodeURIComponent(parts.slice(idx + 2).join("/"));
    }
    // Signed URL variant may include /object/sign/..., but the path after bucket name remains the object key
    const idx2 = parts.findIndex((p) => p === "sign");
    if (idx2 >= 0) {
      const bucketIdx = parts.findIndex((p) => p === "images");
      if (bucketIdx >= 0 && parts.length > bucketIdx + 1) {
        return decodeURIComponent(parts.slice(bucketIdx + 1).join("/"));
      }
    }
  } catch (_) {}
  return null;
}

export async function GET(req /** @type {NextRequest} */) {
  try {
    const { searchParams } = new URL(req.url);
    const pathParam = searchParams.get("path");
    const urlParam = searchParams.get("src") || searchParams.get("url");

    let objectPath = pathParam || null;
    if (!objectPath && urlParam) objectPath = extractImagePathFromUrl(urlParam);
    if (!objectPath) return new Response("Bad Request", { status: 400 });

    const supa = getServiceClient();
    const { data: blob, error } = await supa.storage.from("images").download(objectPath);
    if (error || !blob) return new Response(error?.message || "Not found", { status: 404 });

    const ab = await blob.arrayBuffer();
    return new Response(Buffer.from(ab), {
      status: 200,
      headers: {
        "content-type": guessContentType(objectPath),
        "cache-control": "private, max-age=0",
        "cross-origin-resource-policy": "same-origin",
      }
    });
  } catch (e) {
    return new Response(e?.message || "Server error", { status: 500 });
  }
}

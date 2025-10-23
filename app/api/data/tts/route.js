import { NextRequest, NextResponse } from "next/server";

// Ensure Node.js runtime for Buffer support
export const runtime = "nodejs";

// Minimal helpers to standardize responses
function json(data, status = 200) {
  return NextResponse.json(data, { status });
}
function error(message, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req /** @type {NextRequest} */) {
  try {
    const body = await req.json();
    const textRaw = (body?.text || "").toString();
    const text = textRaw.slice(0, 180); // keep within public TTS limits
    if (!text) return error("text is required", 400);

    // Lazy import to avoid bundling if unused
    const { getAudioUrl } = await import("google-tts-api");
    const url = getAudioUrl(text, {
      lang: "en",
      slow: false,
      host: "https://translate.google.com",
    });
    const resp = await fetch(url);
    if (!resp.ok) return error("TTS fetch failed", 500);
    const buf = await resp.arrayBuffer();
    // Return base64 to simplify client decode
    const base64 = Buffer.from(buf).toString("base64");
    return json({ audioBase64: base64, contentType: resp.headers.get("content-type") || "audio/mpeg" });
  } catch (e) {
    return error(e?.message || "TTS error", 500);
  }
}

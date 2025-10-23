import { json, error } from "../../_utils/respond";
export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";
import { getEmbedder, cosine } from "@/lib/serverEmbeddings";

export async function POST(req) {
  try {
    const body = await req.json();
  const text = typeof body?.text === "string" ? body.text : "";
  const reference = typeof body?.reference === "string" ? body.reference : "";
  if (!text || !reference) return json({ similarityPercent: 0 });
    const emb = await getEmbedder();
    const a = await emb(text, { pooling: "mean", normalize: true });
    const b = await emb(reference, { pooling: "mean", normalize: true });
    const sim = cosine(a.data, b.data) * 100;
    return json({ similarityPercent: sim });
  } catch (e) {
    console.error("[/api/data/topic-similarity] error:", e);
    return error(e?.message || "Topic similarity error", 500);
  }
}

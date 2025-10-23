import { json, error } from "../../_utils/respond";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { countLexicalBundles } from "@/lib/lexicalBundles";

export async function POST(req) {
  try {
    const body = await req.json();
  const text = typeof body?.text === "string" ? body.text : "";
  if (!text) return json({ bigram_count: 0, trigram_count: 0, fourgram_count: 0, bigram_matches: [], trigram_matches: [], fourgram_matches: [] });
  const res = countLexicalBundles(text);
    return json(res);
  } catch (e) {
    console.error("[/api/data/bundles] error:", e);
    return error(e?.message || "Bundles processing error", 500);
  }
}

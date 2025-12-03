import { NextRequest } from "next/server";
import { json, error } from "../../_utils/respond";
import { getServiceClient } from "@/lib/supabaseServer";
import { buildSubconstructVector, getCEFRLabel } from "@/lib/featureMapping";
import { loadModel } from "@/lib/modelLoader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function numericFromRaw(raw) {
  if (typeof raw === "number") return raw;
  if (raw && typeof raw.score === "number") return raw.score;
  if (raw && typeof raw.value === "number") return raw.value;
  if (Array.isArray(raw) && raw.length) {
    let bestIdx = 0, bestVal = -Infinity;
    for (let i = 0; i < raw.length; i++) {
      const v = Number(raw[i]);
      if (Number.isFinite(v) && v > bestVal) { bestVal = v; bestIdx = i; }
    }
    return bestIdx;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req /** @type {NextRequest} */) {
  try {
    const body = await req.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) return error("Body wajib: { items: [{ rekaman_id, features }, ...] }", 400);

    const host = req.headers.get("host") || "";
    const proto = req.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
    const baseUrl = host ? `${proto}://${host}` : undefined;

    const keys = [
      "Fluency",
      "Pronunciation",
      "Prosody",
      "Coherence and Cohesion",
      "Topic Relevance",
      "Complexity",
      "Accuracy"
    ];

    const supa = getServiceClient();
    const inserted = [];

    for (const it of items) {
      const { rekaman_id, features } = it || {};
      if (!rekaman_id || typeof features !== "object") continue;
      const scores = Object.create(null);
      for (const k of keys) {
        const vec = buildSubconstructVector(features, k);
        const model = await loadModel(k, { baseUrl });
        scores[k] = numericFromRaw(model.predict(vec));
      }
      const cefrModel = await loadModel("CEFR", { baseUrl });
      const cefrIdx = numericFromRaw(cefrModel.predict(keys.map((k) => scores[k])));
      const score_cefr = getCEFRLabel(cefrIdx);

      const payload = {
        rekaman_id,
        score_cefr,
        fluency: scores["Fluency"],
        pronunciation: scores["Pronunciation"],
        prosody: scores["Prosody"],
        coherence: scores["Coherence and Cohesion"],
        topic_relevance: scores["Topic Relevance"],
        complexity: scores["Complexity"],
        accuracy: scores["Accuracy"]
      };
      const { data, error: dberr } = await supa
        .from("score_mahasiswa")
        .insert([payload])
        .select("*")
        .single();
      if (!dberr && data) inserted.push(data);
    }

    return json({ ok: true, insertedCount: inserted.length, scores: inserted });
  } catch (e) {
    return error(e?.message || "Batch scoring gagal", 500);
  }
}

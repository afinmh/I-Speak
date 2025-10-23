import { NextRequest } from "next/server";
import { json, error } from "./respond";
import { buildSubconstructVector, buildFullVector, getSubconstructFeatureNames } from "@/lib/featureMapping";
import { loadModel } from "@/lib/modelLoader";

export function makeSubconstructRoute(modelKey) {
  async function POST(req /** @type {NextRequest} */) {
    try {
      const body = await req.json();
      const features = body?.features;
      if (!features || typeof features !== "object") {
        return error("Body must be { features: {<name>: number, ...} }", 400, {
          requiredOrder: getSubconstructFeatureNames(modelKey)
        });
      }

      // Helper: turn model raw output into a numeric class/index for downstream usage
      const numericFromRaw = (raw) => {
        if (typeof raw === "number") return raw;
        if (raw && typeof raw.score === "number") return raw.score;
        if (raw && typeof raw.value === "number") return raw.value;
        if (Array.isArray(raw) && raw.length > 0) {
          let bestIdx = 0;
          let bestVal = -Infinity;
          for (let i = 0; i < raw.length; i++) {
            const v = Number(raw[i]);
            if (Number.isFinite(v) && v > bestVal) { bestVal = v; bestIdx = i; }
          }
          return bestIdx; // use argmax index as numeric score
        }
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
      };

      let vector;
      let meta;
      if (modelKey === "CEFR") {
        // Build CEFR input as 7 subconstruct scores (in fixed order)
        const subKeys = [
          "Fluency",
          "Pronunciation",
          "Prosody",
          "Coherence and Cohesion",
          "Topic Relevance",
          "Complexity",
          "Accuracy"
        ];
        const subVectors = Object.create(null);
        const subRaws = Object.create(null);
        const subScores = [];
  const host = req.headers.get('host') || '';
  const proto = req.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
  const baseUrl = host ? `${proto}://${host}` : undefined;
        for (const k of subKeys) {
          const v = buildSubconstructVector(features, k);
          subVectors[k] = v;
          const m = await loadModel(k, { baseUrl });
          const r = m.predict(v);
          subRaws[k] = r;
          subScores.push(numericFromRaw(r));
        }
        vector = subScores; // 7-dim input expected by CEFR model
        meta = { subconstructOrder: subKeys, subconstructVectors: subVectors, subconstructRaw: subRaws };
      } else {
        vector = buildSubconstructVector(features, modelKey);
      }

  const host2 = req.headers.get('host') || '';
  const proto2 = req.headers.get('x-forwarded-proto') || (host2.includes('localhost') ? 'http' : 'https');
  const baseUrl = host2 ? `${proto2}://${host2}` : undefined;
      const model = await loadModel(modelKey, { baseUrl });
      const raw = model.predict(vector);

      return json({
        model: modelKey,
        featureOrder: modelKey === "CEFR" ? undefined : getSubconstructFeatureNames(modelKey),
        inputVector: vector,
        result: raw,
        ...(meta ? { meta } : {})
      });
    } catch (e) {
      console.error(`[${modelKey}] route error:`, e);
      return error(e?.message || "Prediction error", 500);
    }
  }

  async function GET() {
    if (modelKey === "CEFR") {
      return json({ ok: true, route: modelKey, expects: "POST { features }", input: "7 subconstruct scores", order: [
        "Fluency","Pronunciation","Prosody","Coherence and Cohesion","Topic Relevance","Complexity","Accuracy"
      ]});
    }
    return json({ ok: true, route: modelKey, expects: "POST { features }", featureOrder: getSubconstructFeatureNames(modelKey) });
  }

  return { POST, GET };
}

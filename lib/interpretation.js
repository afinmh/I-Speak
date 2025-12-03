// Map numeric outputs to human-friendly labels/ranges per subconstruct.
// This is a heuristic placeholder. Adjust thresholds to match your training labels.

const ranges = {
  // 6-class generic scale using Beginner → Master
  generic6: [
    { max: 0.5, label: "A1" },
    { max: 1.5, label: "A2" },
    { max: 2.5, label: "B1" },
    { max: 3.5, label: "B2" },
    { max: 4.5, label: "C1" },
    { max: Infinity, label: "C2" }
  ],
  percent: [
    { max: 20, label: "A1" },
    { max: 40, label: "A2" },
    { max: 60, label: "B1" },
    { max: 80, label: "B2" },
    { max: Infinity, label: "C1" }
  ],
  cefrIndex: [
    { max: 0.5, label: "A1" },
    { max: 1.5, label: "A2" },
    { max: 2.5, label: "B1" },
    { max: 3.5, label: "B2" },
    { max: 4.5, label: "C1" },
    { max: Infinity, label: "C2" }
  ]
};

const subconstructMapping = {
  Fluency: "generic6",
  Pronunciation: "generic6",
  Prosody: "generic6",
  "Coherence and Cohesion": "generic6",
  "Topic Relevance": "generic6",
  Complexity: "generic6",
  Accuracy: "generic6",
  CEFR: "cefrIndex"
};

export function interpretValue(scaleName, value) {
  const scale = ranges[scaleName];
  if (!scale) return { label: String(value), value };
  const v = Number(value);
  for (const r of scale) {
    if (v <= r.max) return { label: r.label, value: v };
  }
  return { label: String(v), value: v };
}

export function interpretOutput(subconstruct, raw) {
  // raw may be a number, object with score/proba, or array, depending on model converter
  let numeric;
  if (typeof raw === "number") {
    numeric = raw;
  } else if (raw && typeof raw.score === "number") {
    numeric = raw.score;
  } else if (raw && typeof raw.value === "number") {
    numeric = raw.value;
  } else if (Array.isArray(raw) && raw.length > 0) {
    // If an array is returned, it is likely a class-probability vector.
    // Use argmax index as the predicted class (0..n-1) rather than raw[0].
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < raw.length; i++) {
      const v = Number(raw[i]);
      if (Number.isFinite(v) && v > bestVal) { bestVal = v; bestIdx = i; }
    }
    numeric = bestIdx;
  } else {
    numeric = Number(raw);
  }
  if (!Number.isFinite(numeric)) return { label: "N/A", value: raw };
  const scaleName = subconstructMapping[subconstruct] || "generic5";
  return interpretValue(scaleName, numeric);
}

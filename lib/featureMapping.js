// Shared feature mapping and vectorization utilities for model inputs

// Keep in sync with Python NUMERICAL_FEATURES_ORDER in ispeak.py
export const NUMERICAL_FEATURES_ORDER = [
  "Durasi (s)",
  "MFCC (%)",
  "Semantic Coherence (%)",
  "Pause Freq",
  "Token Count",
  "Type Count",
  "TTR",
  "Pitch Range (Hz)",
  "Articulation Rate",
  "MLR",
  "Mean Pitch",
  "Stdev Pitch",
  "Mean Energy",
  "Stdev Energy",
  "Num Prominences",
  "Prominence Dist Mean",
  "Prominence Dist Std",
  "WPM",
  "WPS",
  "Total Words",
  "Linking Count",
  "Discourse Count",
  "Filled Pauses",
  "Long Pause (s)",
  "Topic Similarity (%)",
  "Grammar Errors",
  "Idioms Found",
  "CEFR A1",
  "CEFR A2",
  "CEFR B1",
  "CEFR B2",
  "CEFR C1",
  "CEFR C2",
  "CEFR UNKNOWN",
  "Bigram Count",
  "Trigram Count",
  "Fourgram Count",
  "Synonym Variations",
  "Avg Tree Depth",
  "Max Tree Depth"
];

export const SUBCONSTRUCTS = {
  Fluency: [
    "Total Words",
    "WPM",
    "WPS",
    "Filled Pauses",
    "MLR",
    "Pause Freq",
    "Durasi (s)"
  ],
  Pronunciation: ["Articulation Rate", "Pitch Range (Hz)", "MFCC (%)"],
  Prosody: [
    "Mean Pitch",
    "Stdev Pitch",
    "Mean Energy",
    "Stdev Energy",
    "Num Prominences",
    "Prominence Dist Mean",
    "Prominence Dist Std"
  ],
  "Coherence and Cohesion": [
    "Semantic Coherence (%)",
    "Discourse Count",
    "Linking Count"
  ],
  "Topic Relevance": ["Topic Similarity (%)"],
  Complexity: [
    "Idioms Found",
    "Bigram Count",
    "Trigram Count",
    "Fourgram Count",
    "Synonym Variations",
    "CEFR A1",
    "CEFR A2",
    "CEFR B1",
    "CEFR B2",
    "CEFR C1",
    "CEFR C2",
    "CEFR UNKNOWN",
    "Avg Tree Depth",
    "Max Tree Depth",
    "Token Count",
    "Type Count",
    "TTR"
  ],
  Accuracy: ["Grammar Errors"]
};

export const CEFR_MAPPING = [
  { max: 0.5, label: "A1" },
  { max: 1.5, label: "A2" },
  { max: 2.5, label: "B1" },
  { max: 3.5, label: "B2" },
  { max: 4.5, label: "C1" },
  { max: Infinity, label: "C2" }
];

// Map a numeric CEFR index to its label using range-based mapping
export function getCEFRLabel(value) {
  const numValue = toNumberSafe(value);
  for (const range of CEFR_MAPPING) {
    if (numValue <= range.max) {
      return range.label;
    }
  }
  return "B2"; // default fallback
}

// Build full vector in the exact NUMERICAL_FEATURES_ORDER from a feature map
export function buildFullVector(features) {
  return NUMERICAL_FEATURES_ORDER.map((name) => toNumberSafe(features?.[name]));
}

// Build a sub-vector in the order required by the subconstruct-specific model
export function buildSubconstructVector(features, subconstructName) {
  const fnames = SUBCONSTRUCTS[subconstructName];
  if (!fnames) throw new Error(`Unknown subconstruct: ${subconstructName}`);
  return fnames.map((name) => toNumberSafe(features?.[name]));
}

export function getSubconstructFeatureNames(subconstructName) {
  if (subconstructName === "CEFR") return [...NUMERICAL_FEATURES_ORDER];
  const fnames = SUBCONSTRUCTS[subconstructName];
  if (!fnames) throw new Error(`Unknown subconstruct: ${subconstructName}`);
  return [...fnames];
}

function toNumberSafe(v) {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

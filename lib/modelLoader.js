// Utilities to load converted JS models (from scikit-learn via m2cgen) on server side
// Assumption: each model file exports a function or object to compute scores.
// We'll normalize to a predict(vector) function returning { label, proba?, raw? }.

import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import vm from "node:vm";

const requireCJS = createRequire(import.meta.url);

const MODEL_FILE_BY_KEY = {
  Fluency: "Fluency_rf_model.js",
  Pronunciation: "Pronunciation_rf_model.js",
  Prosody: "Prosody_rf_model.js",
  "Coherence and Cohesion": "Coherence_and_Cohesion_rf_model.js",
  "Topic Relevance": "Topic_Relevance_rf_model.js",
  Complexity: "Complexity_rf_model.js",
  Accuracy: "Accuracy_rf_model.js",
  CEFR: "CEFR_rf_model.js"
};

const cache = new Map();

function getModelAbsolutePath(modelFile) {
  // Resolve relative to this file so it works regardless of process.cwd()
  // This file lives at: i-speak/lib/modelLoader.js
  // Models live at:     i-speak/public/model_js/<file>
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "..", "public", "model_js", modelFile);
}

export async function loadModel(modelKey, opts = {}) {
  if (!MODEL_FILE_BY_KEY[modelKey]) throw new Error(`Unknown model: ${modelKey}`);
  if (cache.has(modelKey)) return cache.get(modelKey);

  const absPath = getModelAbsolutePath(MODEL_FILE_BY_KEY[modelKey]);
  let predictor;
  try {
    // Try requiring as a module first
    const mod = requireCJS(absPath);
    if (typeof mod === "function") {
      predictor = mod;
    } else if (mod && typeof mod.score === "function") {
      predictor = mod.score;
    } else if (mod && typeof mod.predict === "function") {
      predictor = mod.predict;
    } else if (mod && typeof mod.default === "function") {
      predictor = mod.default;
    } else if (mod && mod.default && typeof mod.default.score === "function") {
      predictor = mod.default.score;
    } else if (mod && mod.default && typeof mod.default.predict === "function") {
      predictor = mod.default.predict;
    }
  } catch (_) {
    // ignore and fallback to VM
  }

  if (!predictor) {
    // Fallback: evaluate plain JS file that declares function score(input) { ... }
    let code;
    try {
      code = await fs.readFile(absPath, "utf8");
    } catch (_) {
      // If reading from filesystem fails (e.g., serverless), fetch from public URL
      const baseUrl = (() => {
        if (opts.baseUrl) return opts.baseUrl;
        if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
        if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
        if (process.env.SITE_URL) return process.env.SITE_URL;
        return "http://localhost:3000";
      })();
      const publicUrl = new URL(`/model_js/${MODEL_FILE_BY_KEY[modelKey]}`, baseUrl).toString();
      const resp = await fetch(publicUrl);
      if (!resp.ok) throw new Error(`Failed to load model from ${publicUrl}`);
      code = await resp.text();
    }
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: absPath });
    predictor = sandbox.score || sandbox.predict || (sandbox.default && sandbox.default.score);
  }

  if (typeof predictor !== "function") {
    throw new Error(`Model ${modelKey} did not export or define a callable score()`);
  }

  // Scaler for CEFR model (mean and std from Python pipeline)
  // NOTE: With CEFR now using 7 subconstruct scores, the scaler should have length 7.
  // TODO: Replace with actual values from Python pipeline training (order below).
  // Order: [Fluency, Pronunciation, Prosody, Coherence&Cohesion, Topic Relevance, Complexity, Accuracy]
  const CEFR_MEAN = [0,0,0,0,0,0,0];
  const CEFR_STD = [1,1,1,1,1,1,1];

  function scaleVector(vector, mean, std) {
    return vector.map((v, i) => std[i] !== 0 ? (v - mean[i]) / std[i] : v);
  }

  // APPROXIMATE scalers for subconstructs trained on standardized features.
  // These are heuristic means/stds to bring raw features to ~z-score scale
  // so the tree thresholds (around -3..+3) in the converted models are meaningful.
  // Replace with exact training stats when available.
  const APPROX_SCALERS = {
    // Order per SUBCONSTRUCTS in lib/featureMapping.js
    Fluency: {
      mean: [100, 120, 2.0, 5, 10, 50, 60],
      std:  [ 60,  40, 0.8, 5,  6, 40, 40]
    },
    Pronunciation: {
      mean: [2.5, 100, 60],
      std:  [1.0,  60, 20]
    },
    // Complexity feature order (17 items):
    // [Idioms, Bigram, Trigram, Fourgram, SynVar, CEFR A1, A2, B1, B2, C1, C2, UNKNOWN, AvgDepth, MaxDepth, Token, Type, TTR]
    Complexity: {
      mean: [0.5, 2, 1, 0.5, 30, 20, 20, 20, 20, 10, 5, 5, 12, 25, 120, 80, 0.6],
      std:  [1.0, 3, 2, 1.0, 15, 15, 15, 15, 15, 10, 7, 8,  6, 10,  60, 40, 0.15]
    }
  };

  const api = {
    predict(vector) {
      let input = vector;
      if (modelKey === "CEFR") {
        // Standarisasi input vector CEFR
        input = scaleVector(vector, CEFR_MEAN, CEFR_STD);
      } else if (APPROX_SCALERS[modelKey]) {
        const { mean, std } = APPROX_SCALERS[modelKey];
        if (Array.isArray(mean) && Array.isArray(std) && mean.length === vector.length && std.length === vector.length) {
          input = scaleVector(vector, mean, std);
        }
      }
      const raw = predictor(input);
      // Some converters return a numeric class or probability array. We simply return whatever
      // they compute and let API route map it to labels when needed.
      return raw;
    }
  };

  cache.set(modelKey, api);
  return api;
}

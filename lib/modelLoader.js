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

  function scaleVector(vector, mean, scale) {
    return vector.map((v, i) => scale[i] !== 0 ? (v - mean[i]) / scale[i] : v);
  }

  // Load scaler JSON files for each model
  async function loadScaler(modelKey) {
    const scalerFile = MODEL_FILE_BY_KEY[modelKey]?.replace('_rf_model.js', '_scaler.json');
    if (!scalerFile) return null;
    
    const absPath = getModelAbsolutePath(scalerFile);
    try {
      const content = await fs.readFile(absPath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      // If reading from filesystem fails, try fetching from public URL
      try {
        const baseUrl = (() => {
          if (opts.baseUrl) return opts.baseUrl;
          if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
          if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
          if (process.env.SITE_URL) return process.env.SITE_URL;
          return "http://localhost:3000";
        })();
        const publicUrl = new URL(`/model_js/${scalerFile}`, baseUrl).toString();
        const resp = await fetch(publicUrl);
        if (!resp.ok) return null;
        return await resp.json();
      } catch {
        return null;
      }
    }
  }

  // Load scaler for this model
  const scaler = await loadScaler(modelKey);

  const api = {
    predict(vector) {
      let input = vector;
      
      // Apply scaler if available (for all models except CEFR which doesn't need scaling)
      if (scaler && modelKey !== "CEFR") {
        const { mean, scale } = scaler;
        if (Array.isArray(mean) && Array.isArray(scale) && mean.length === vector.length && scale.length === vector.length) {
          input = scaleVector(vector, mean, scale);
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

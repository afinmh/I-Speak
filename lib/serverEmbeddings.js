let embPromise = null;

export async function getEmbedder() {
  if (!embPromise) {
    embPromise = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");
      // Vercel serverless: only /tmp is writable
      env.cacheDir = "/tmp";
      env.allowLocalModels = false; // force remote download
      // Optional: avoid spawning too many threads in wasm on serverless
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.numThreads = 1;
      }
      return pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    })();
  }
  return embPromise;
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// Server-side Supabase client helper
// Uses service role for row-level insertions from API routes. Do NOT expose service key to client.
import { createClient } from "@supabase/supabase-js";

function getEnv(name, fallback) {
  return process.env[name] ?? fallback;
}

const SUPABASE_URL = getEnv("SUPABASE_URL", getEnv("NEXT_PUBLIC_SUPABASE_URL"));
const SUPABASE_ANON_KEY = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE = getEnv("SUPABASE_SERVICE_ROLE");

if (!SUPABASE_URL) {
  console.warn("[supabase] SUPABASE_URL not set. API routes depending on Supabase will fail.");
}

export function getServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    throw new Error("Supabase service credentials missing: set SUPABASE_URL and SUPABASE_SERVICE_ROLE");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false },
    global: { headers: { "X-Client-Info": "i-speak-server" } }
  });
}

export function getAnonClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase anon credentials missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { "X-Client-Info": "i-speak-anon" } }
  });
}

export function getBucketName() {
  return getEnv("SUPABASE_BUCKET", "recordings");
}

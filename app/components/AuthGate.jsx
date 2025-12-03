"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("signin"); // signin | signup

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => { sub?.subscription?.unsubscribe?.(); mounted = false; };
  }, []);

  async function handleSignIn(e) {
    e.preventDefault();
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message);
  }

  async function handleSignUp(e) {
    e.preventDefault();
    setError("");
    const { error: err } = await supabase.auth.signUp({ email, password });
    if (err) setError(err.message);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  // Listen for auth errors globally and auto-logout
  useEffect(() => {
    if (!session) return;
    
    const handleAuthError = async (response) => {
      if (response?.status === 401) {
        console.warn("[AuthGate] Detected 401 Unauthorized, clearing local session...");
        // Clear local session without server request since token is expired
        await supabase.auth.signOut({ scope: 'local' });
      }
    };

    // Intercept fetch globally for 401 errors
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      try {
        const response = await originalFetch(...args);
        if (response.status === 401 && args[0]?.includes?.('/api/dashboard')) {
          await handleAuthError(response);
        }
        return response;
      } catch (error) {
        throw error;
      }
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [session]);

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-gray-600">Checking session…</div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
        <div className="mx-auto max-w-md sm:max-w-lg px-4 sm:px-6 py-8 sm:py-12">
          <div className="rounded-2xl border bg-white/95 shadow-sm">
            <div className="p-5 sm:p-8">
              <div className="text-center mb-5 sm:mb-6">
                <div className="text-2xl sm:text-3xl font-extrabold tracking-tight">I‑Speak Admin</div>
                <div className="mt-1 text-sm sm:text-base text-gray-600">Sign in to access the dashboard</div>
              </div>
              {error && <div className="mb-3 p-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded">{error}</div>}
              <form onSubmit={mode === "signin" ? handleSignIn : handleSignUp} className="space-y-4 sm:space-y-5">
                <div>
                  <label className="block text-sm sm:text-base">Email</label>
                  <input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} className="mt-1 w-full border rounded-xl px-4 py-3 sm:py-3.5 focus:outline-none focus:ring-2 focus:ring-black/20 text-base" placeholder="you@institution.edu" required inputMode="email" autoComplete="email" />
                </div>
                <div>
                  <label className="block text-sm sm:text-base">Password</label>
                  <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} className="mt-1 w-full border rounded-xl px-4 py-3 sm:py-3.5 focus:outline-none focus:ring-2 focus:ring-black/20 text-base" placeholder="Your password" required autoComplete="current-password" />
                </div>
                <button className="w-full rounded-xl bg-black text-white py-3.5 sm:py-4 text-base font-semibold hover:bg-neutral-800 transition active:scale-[0.99]">
                  {mode === "signin" ? "Sign in" : "Create account"}
                </button>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <a href="/" className="inline-flex items-center gap-1 text-gray-700 hover:text-black">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                    Back
                  </a>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>{children}</>
  );
}

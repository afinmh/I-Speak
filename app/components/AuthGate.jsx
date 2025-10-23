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

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-gray-600">Checking session…</div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center bg-gradient-to-b from-gray-50 to-white">
        <div className="w-full max-w-md p-6 bg-white border rounded-2xl shadow-sm">
          <div className="text-center mb-4">
            <div className="text-2xl font-bold tracking-tight">I‑Speak Admin</div>
            <div className="text-sm text-gray-600">Sign in to access the dashboard</div>
          </div>
          {error && <div className="mb-3 p-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded">{error}</div>}
          <form onSubmit={mode === "signin" ? handleSignIn : handleSignUp} className="space-y-3">
            <div>
              <label className="block text-sm">Email</label>
              <input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} className="mt-1 w-full border rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-200" required />
            </div>
            <div>
              <label className="block text-sm">Password</label>
              <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} className="mt-1 w-full border rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-200" required />
            </div>
            <button className="w-full rounded-lg bg-blue-600 text-white py-2 hover:bg-blue-700 transition">{mode === "signin" ? "Sign in" : "Create account"}</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <>{children}</>
  );
}

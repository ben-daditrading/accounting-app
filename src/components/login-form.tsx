"use client";

import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/browser";

export function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const nextPath = useMemo(() => searchParams.get("next") || "/transactions", [searchParams]);
  const authError = searchParams.get("error");
  const isConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const allowedEmailDomain = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN?.toLowerCase() ?? "daditrading.com";
  const initialError = authError === "unauthorized_domain"
    ? `Only @${allowedEmailDomain} accounts are allowed.`
    : null;

  useEffect(() => {
    if (authError !== "unauthorized_domain" || !isConfigured) return;
    const supabase = createClient();
    void supabase.auth.signOut();
  }, [authError, isConfigured]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isConfigured) {
      setError("Auth is not configured.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${nextPath}`,
        },
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      setSuccess("Check your email for the login link.");
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Sign-in failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Admin-created <strong>@{allowedEmailDomain}</strong> accounts only.
      </p>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-700">Email</label>
          <input
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={`name@${allowedEmailDomain}`}
            required
          />
        </div>

        {(error || initialError) && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error ?? initialError}</p>
        )}
        {success && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</p>
        )}

        <button
          type="submit"
          disabled={loading || !isConfigured}
          className="w-full rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {loading ? "Sending…" : "Send magic link"}
        </button>
      </form>
    </div>
  );
}

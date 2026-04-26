"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/browser";

const inputClassName =
  "w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400";

export function LoginForm() {
  const router = useRouter();
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
    ? `Only @${allowedEmailDomain} accounts are allowed to access this app.`
    : null;

  useEffect(() => {
    if (authError !== "unauthorized_domain" || !isConfigured) {
      return;
    }

    const supabase = createClient();
    void supabase.auth.signOut();
  }, [authError, isConfigured]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isConfigured) {
      setError("Supabase auth is not configured yet.");
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
      setError(unknownError instanceof Error ? unknownError.message : "Failed to sign in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-2xl font-semibold">Sign in</h2>
        <p className="mt-2 text-sm text-zinc-600">Use the internal credentials managed through Supabase Auth.</p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-2 block text-sm font-medium text-zinc-700">Email</label>
          <input
            className={inputClassName}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={`name@${allowedEmailDomain}`}
            required
          />
        </div>


        {error || initialError ? (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error ?? initialError}</p>
        ) : null}
        {success ? (
          <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</p>
        ) : null}
        {!isConfigured ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Supabase auth environment variables are not configured yet, so sign-in is scaffolded but inactive.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={loading || !isConfigured}
          className="w-full rounded-xl bg-zinc-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
        >
          {loading ? "Sending link..." : "Send magic link"}
        </button>
      </form>

      <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
        Accounts are admin-created only. Only authenticated <strong>@{allowedEmailDomain}</strong> users can access the app.
      </div>

      <p className="mt-4 text-sm text-zinc-500">
        Back to <Link href="/" className="font-medium text-zinc-900">overview</Link>
      </p>
    </section>
  );
}

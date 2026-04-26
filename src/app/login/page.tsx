import { Suspense } from "react";

import { LoginForm } from "@/components/login-form";

function LoginCardFallback() {
  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="h-6 w-32 animate-pulse rounded bg-zinc-200" />
      <div className="mt-4 h-24 animate-pulse rounded-2xl bg-zinc-100" />
    </section>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10 text-zinc-950 lg:px-8">
      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <section className="space-y-5">
          <div className="inline-flex rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-600">
            accounting.daditrading.com
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Internal accounting access
          </h1>
          <p className="max-w-xl text-lg leading-8 text-zinc-600">
            This app is set up for simple email and password auth inside the application. Cloudflare can still handle the subdomain and tunnel, but the login experience can stay familiar for the team.
          </p>
          <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Recommended setup</h2>
            <ul className="mt-3 space-y-2 text-sm text-zinc-700">
              <li>• Host app at `accounting.daditrading.com`</li>
              <li>• Use Cloudflare Tunnel for origin exposure</li>
              <li>• Use Supabase Auth for email/password login</li>
              <li>• Keep Cloudflare Access optional for later extra hardening</li>
            </ul>
          </div>
        </section>

        <Suspense fallback={<LoginCardFallback />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}

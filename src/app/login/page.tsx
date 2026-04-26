import { Suspense } from "react";

import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-[calc(100vh-49px)] items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Suspense
          fallback={
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <div className="h-6 w-24 animate-pulse rounded bg-zinc-200" />
              <div className="mt-4 h-20 animate-pulse rounded-xl bg-zinc-100" />
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}

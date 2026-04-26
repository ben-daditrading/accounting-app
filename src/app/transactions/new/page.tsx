import Link from "next/link";

import { TransactionEntryForm } from "@/components/transaction-entry-form";

export default function NewTransactionPage() {
  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10 text-zinc-950 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-500">Transactions / New</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">New transaction</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
              This is the first-pass entry screen based on the spreadsheet split. The top section is the transaction header, the middle preserves left-side source lines, and the bottom captures balanced journal entries.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100"
          >
            Back to overview
          </Link>
        </div>

        <TransactionEntryForm />
      </div>
    </main>
  );
}

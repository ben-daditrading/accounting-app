import Link from "next/link";

import { listTransactions } from "@/lib/server/transactions";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const result = await listTransactions();
  const transactions = result.mode === "database" ? result.items : [];

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10 text-zinc-950 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-500">Transactions</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Transaction list</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
              One logical transaction per row. Journal details stay underneath in the relational model instead of being mixed into the same spreadsheet grid.
            </p>
          </div>
          <Link
            href="/transactions/new"
            className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            New transaction
          </Link>
        </div>

        {result.mode === "placeholder" ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            Database is not connected yet, so this page is showing the final shape but not live records yet.
          </section>
        ) : null}

        <section className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {transactions.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-zinc-500" colSpan={5}>
                    No transactions yet.
                  </td>
                </tr>
              ) : (
                transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="px-4 py-3">{transaction.transactionDate}</td>
                    <td className="px-4 py-3">{transaction.transactionType}</td>
                    <td className="px-4 py-3">
                      {transaction.summaryAmount ?? "-"} {transaction.currencyCode}
                    </td>
                    <td className="px-4 py-3">{transaction.summaryDescription ?? "-"}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                        {transaction.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}

import Link from "next/link";
import { Paperclip } from "lucide-react";

import { listTransactions } from "@/lib/server/transactions";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const result = await listTransactions();
  const transactions = result.mode === "database" ? result.items : [];

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Transactions</h1>
        <Link
          href="/transactions/new"
          className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          + New
        </Link>
      </div>

      {result.mode === "placeholder" && (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Database not connected.
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2.5 w-[100px]">Date</th>
              <th className="px-3 py-2.5 w-[90px]">Type</th>
              <th className="px-3 py-2.5 w-[100px] text-right">Amount</th>
              <th className="px-3 py-2.5">Description</th>
              <th className="px-3 py-2.5 w-[50px] text-center">DR/CR</th>
              <th className="px-3 py-2.5">Account</th>
              <th className="px-3 py-2.5 w-[110px] text-right">Line Amt</th>
              <th className="px-3 py-2.5 w-[36px]"></th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-zinc-400" colSpan={8}>
                  No transactions yet.
                </td>
              </tr>
            ) : (
              transactions.map((tx) => {
                const lineCount = Math.max(tx.lines.length, 1);
                const isNonCad = tx.currency !== "CAD";

                return tx.lines.length === 0 ? (
                  // Transaction with no journal lines (shouldn't happen, but handle gracefully)
                  <tr key={tx.transactId} className="border-b border-zinc-200 hover:bg-zinc-50/50">
                    <td className="px-3 py-2 tabular-nums">{tx.transactDate}</td>
                    <td className="px-3 py-2 capitalize">{tx.typeName ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatAmount(tx.totalAmount, isNonCad ? tx.currency : null)}
                    </td>
                    <td className="px-3 py-2 text-zinc-700">{tx.description}</td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2">
                      <ReceiptLink receiptRef={tx.receiptRef} />
                    </td>
                  </tr>
                ) : (
                  tx.lines.map((line, i) => {
                    const isFirst = i === 0;
                    const isLast = i === lineCount - 1;
                    const lineIsNonCad = line.currency !== "CAD";

                    return (
                      <tr
                        key={`${tx.transactId}-${line.lineNumber}`}
                        className={`${isLast ? "border-b border-zinc-200" : ""} hover:bg-zinc-50/50`}
                      >
                        {/* Header columns only on first row */}
                        {isFirst ? (
                          <>
                            <td className="px-3 py-1.5 align-top tabular-nums" rowSpan={lineCount}>
                              {tx.transactDate}
                            </td>
                            <td className="px-3 py-1.5 align-top capitalize" rowSpan={lineCount}>
                              {tx.typeName ?? "—"}
                            </td>
                            <td
                              className={`px-3 py-1.5 align-top text-right tabular-nums ${isNonCad ? "text-red-600" : ""}`}
                              rowSpan={lineCount}
                            >
                              {isNonCad && (
                                <span className="mr-1 text-xs font-medium">{tx.currency}</span>
                              )}
                              {formatNumber(tx.totalAmount)}
                            </td>
                            <td className="px-3 py-1.5 align-top text-zinc-700" rowSpan={lineCount}>
                              {tx.description}
                            </td>
                          </>
                        ) : null}

                        {/* Journal line columns on every row */}
                        <td className="px-3 py-1.5 text-center font-medium text-zinc-500">
                          {line.drCr}
                        </td>
                        <td className="px-3 py-1.5 text-zinc-700">
                          {line.accountName ?? "—"}
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right tabular-nums ${lineIsNonCad ? "text-red-600" : ""}`}
                        >
                          {lineIsNonCad && (
                            <span className="mr-1 text-xs font-medium">{line.currency}</span>
                          )}
                          {formatNumber(line.amount)}
                        </td>

                        {/* Receipt icon only on first row */}
                        {isFirst ? (
                          <td className="px-3 py-1.5 align-top text-center" rowSpan={lineCount}>
                            <ReceiptLink receiptRef={tx.receiptRef} />
                          </td>
                        ) : null}
                      </tr>
                    );
                  })
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReceiptLink({ receiptRef }: { receiptRef: string | null }) {
  if (!receiptRef) return null;

  return (
    <a
      href={receiptRef}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center text-zinc-400 hover:text-zinc-700"
      title="View receipt"
    >
      <Paperclip className="h-3.5 w-3.5" />
    </a>
  );
}

function formatNumber(value: string | null) {
  if (!value) return "—";
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatAmount(value: string | null, currencyPrefix: string | null) {
  const formatted = formatNumber(value);
  if (!currencyPrefix) return formatted;
  return `${currencyPrefix} ${formatted}`;
}

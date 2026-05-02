import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, FileText, Paperclip, Search } from "lucide-react";

import { listTransactions } from "@/lib/server/transactions";
import {
  filterTransactions,
  normalizeSortDirection,
  normalizeTransactionSort,
  sortTransactions,
  type SortDirection,
  type TransactionSortKey,
} from "@/lib/transactions-view";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  sort?: string;
  direction?: string;
  search?: string;
  showMeta?: string;
}>;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const result = await listTransactions();
  const transactions = result.mode === "database" ? result.items : [];
  const params = (await searchParams) ?? {};
  const sort = normalizeTransactionSort(params.sort);
  const direction = normalizeSortDirection(params.direction);
  const search = params.search?.trim() ?? "";
  const filteredTransactions = filterTransactions(transactions, search);
  const sortedTransactions = sortTransactions(filteredTransactions, sort, direction);
  const hasActiveFilters = Boolean(search);
  const showMeta = params.showMeta === "1";
  const exportQuery = buildQueryString({ sort, direction, search, showMeta: showMeta ? "1" : undefined });

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-semibold">Transactions</h1>
        <div className="flex items-center gap-2">
          <DownloadMenu exportQuery={exportQuery} disabled={result.mode !== "database"} />
          <Link
            href="/transactions/import-batch"
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Import batch
          </Link>
          <Link
            href="/transactions/new"
            className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            + New
          </Link>
        </div>
      </div>

      {result.mode === "placeholder" && (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Database not connected.
        </p>
      )}

      <form action="/transactions" method="get" className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="direction" value={direction} />
        <input type="hidden" name="showMeta" value={showMeta ? "1" : ""} />
        <label className="relative block w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            name="search"
            defaultValue={search}
            placeholder="Search transactions, accounts, notes..."
            className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 outline-none ring-0 placeholder:text-zinc-400 focus:border-zinc-500"
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Search
          </button>
          <Link
            href={`/transactions?${buildQueryString({
              sort,
              direction,
              search,
              showMeta: showMeta ? undefined : "1",
            })}`}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            {showMeta ? "Hide added/updated" : "Show added/updated"}
          </Link>
          {hasActiveFilters ? (
            <Link
              href={`/transactions?${buildQueryString({ showMeta: showMeta ? "1" : undefined })}`}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
            <tr>
              {showMeta ? (
                <>
                  <th className="w-[150px] px-3 py-2.5">Added at</th>
                  <th className="w-[150px] px-3 py-2.5">
                    <SortLink
                      label="Last updated"
                      sortKey="updated"
                      currentSort={sort}
                      currentDirection={direction}
                      search={search}
                      showMeta={showMeta}
                    />
                  </th>
                </>
              ) : null}
              <th className="w-[120px] px-3 py-2.5">
                <SortLink
                  label="Date"
                  sortKey="date"
                  currentSort={sort}
                  currentDirection={direction}
                  search={search}
                  showMeta={showMeta}
                />
              </th>
              <th className="w-[90px] px-3 py-2.5">Type</th>
              <th className="w-[110px] px-3 py-2.5 text-right">
                <SortLink
                  label="Amount"
                  sortKey="amount"
                  currentSort={sort}
                  currentDirection={direction}
                  align="right"
                  search={search}
                  showMeta={showMeta}
                />
              </th>
              <th className="px-3 py-2.5">Description</th>
              <th className="w-[50px] px-3 py-2.5 text-center">DR/CR</th>
              <th className="px-3 py-2.5">Account</th>
              <th className="w-[110px] px-3 py-2.5 text-right">Line Amt</th>
              <th className="w-[36px] px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {sortedTransactions.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-zinc-400" colSpan={showMeta ? 10 : 8}>
                  {transactions.length === 0 ? "No transactions yet." : "No transactions match your search."}
                </td>
              </tr>
            ) : (
              sortedTransactions.map((tx) => {
                const lineCount = Math.max(tx.lines.length, 1);
                const isNonCad = tx.currency !== "CAD";

                return tx.lines.length === 0 ? (
                  <tr key={tx.transactId} className="border-b border-zinc-200 hover:bg-zinc-50/50">
                    {showMeta ? (
                      <>
                        <td className="px-3 py-2 text-zinc-600">{formatDateTime(tx.createdAt)}</td>
                        <td className="px-3 py-2 text-zinc-600">{formatDateTime(tx.updatedAt)}</td>
                      </>
                    ) : null}
                    <td className="px-3 py-2 tabular-nums">{tx.transactDate}</td>
                    <td className="px-3 py-2 capitalize">{tx.typeName ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatAmount(tx.totalAmount, isNonCad ? tx.currency : null)}
                    </td>
                    <td className="px-3 py-2 text-zinc-700">
                      <div>{tx.description}</div>
                      <SourceLinks receiptRef={tx.receiptRef} statementRef={tx.statementRef} />
                    </td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
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
                        {isFirst ? (
                          <>
                            {showMeta ? (
                              <>
                                <td className="px-3 py-1.5 align-top text-zinc-600" rowSpan={lineCount}>
                                  {formatDateTime(tx.createdAt)}
                                </td>
                                <td className="px-3 py-1.5 align-top text-zinc-600" rowSpan={lineCount}>
                                  {formatDateTime(tx.updatedAt)}
                                </td>
                              </>
                            ) : null}
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
                              {isNonCad && <span className="mr-1 text-xs font-medium">{tx.currency}</span>}
                              {formatNumber(tx.totalAmount)}
                            </td>
                            <td className="px-3 py-1.5 align-top text-zinc-700" rowSpan={lineCount}>
                              <div>{tx.description}</div>
                              <SourceLinks receiptRef={tx.receiptRef} statementRef={tx.statementRef} />
                            </td>
                          </>
                        ) : null}

                        <td className="px-3 py-1.5 text-center font-medium text-zinc-500">
                          {line.drCr}
                        </td>
                        <td className="px-3 py-1.5 text-zinc-700">
                          {line.accountName ?? "—"}
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right tabular-nums ${lineIsNonCad ? "text-red-600" : ""}`}
                        >
                          {lineIsNonCad && <span className="mr-1 text-xs font-medium">{line.currency}</span>}
                          {formatNumber(line.amount)}
                        </td>

                        {isFirst ? (
                          <td className="px-3 py-1.5 align-top text-center" rowSpan={lineCount}>
                            <SourceIcons receiptRef={tx.receiptRef} statementRef={tx.statementRef} />
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

function SortLink({
  label,
  sortKey,
  currentSort,
  currentDirection,
  search,
  showMeta,
  align = "left",
}: {
  label: string;
  sortKey: TransactionSortKey;
  currentSort: TransactionSortKey;
  currentDirection: SortDirection;
  search?: string;
  showMeta?: boolean;
  align?: "left" | "right";
}) {
  const isActive = currentSort === sortKey;
  const nextDirection = isActive && currentDirection === "asc" ? "desc" : "asc";
  const icon = !isActive ? (
    <ArrowUpDown className="h-3.5 w-3.5" />
  ) : currentDirection === "asc" ? (
    <ArrowUp className="h-3.5 w-3.5" />
  ) : (
    <ArrowDown className="h-3.5 w-3.5" />
  );

  const href = `/transactions?${buildQueryString({
    sort: sortKey,
    direction: nextDirection,
    search,
    showMeta: showMeta ? "1" : undefined,
  })}`;

  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1 hover:text-zinc-700 ${align === "right" ? "justify-end w-full" : ""}`}
    >
      <span>{label}</span>
      {icon}
    </Link>
  );
}

function DownloadMenu({
  exportQuery,
  disabled,
}: {
  exportQuery: string;
  disabled: boolean;
}) {
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-400"
      >
        <Download className="h-4 w-4" />
        Download
      </button>
    );
  }

  return (
    <div className="flex items-center overflow-hidden rounded-lg border border-zinc-300 bg-white text-sm font-medium text-zinc-700">
      <span className="inline-flex items-center gap-2 px-3 py-2 text-zinc-500">
        <Download className="h-4 w-4" />
        Download
      </span>
      <a className="border-l border-zinc-300 px-3 py-2 hover:bg-zinc-50" href={`/api/transactions/export?format=csv&${exportQuery}`}>
        CSV
      </a>
      <a className="border-l border-zinc-300 px-3 py-2 hover:bg-zinc-50" href={`/api/transactions/export?format=xlsx&${exportQuery}`}>
        XLSX
      </a>
    </div>
  );
}

function buildQueryString(params: {
  sort?: string;
  direction?: string;
  search?: string;
  showMeta?: string;
}) {
  const query = new URLSearchParams();
  if (params.sort) query.set("sort", params.sort);
  if (params.direction) query.set("direction", params.direction);
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.showMeta) query.set("showMeta", params.showMeta);
  return query.toString();
}

function SourceIcons({ receiptRef, statementRef }: { receiptRef: string | null; statementRef: string | null }) {
  if (!receiptRef && !statementRef) return null;

  return (
    <div className="inline-flex items-center gap-1">
      {receiptRef ? (
        <a
          href={receiptRef}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-zinc-400 hover:text-zinc-700"
          title="View receipt"
        >
          <Paperclip className="h-3.5 w-3.5" />
        </a>
      ) : null}
      {statementRef ? (
        <a
          href={statementRef}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-zinc-400 hover:text-zinc-700"
          title="View statement"
        >
          <FileText className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </div>
  );
}

function SourceLinks({ receiptRef, statementRef }: { receiptRef: string | null; statementRef: string | null }) {
  if (!receiptRef && !statementRef) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
      {receiptRef ? (
        <a href={receiptRef} target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-700">
          Receipt source
        </a>
      ) : null}
      {statementRef ? (
        <a href={statementRef} target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-700">
          Statement source
        </a>
      ) : null}
    </div>
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

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

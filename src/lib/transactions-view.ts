export type TransactionLineView = {
  transactId: string;
  lineNumber: number;
  drCr: string;
  amount: string;
  currency: string;
  amountCad: string | null;
  accountId: number;
  accountName: string | null;
  memo: string | null;
};

export type TransactionView = {
  transactId: string;
  transactDate: string;
  typeId: number | null;
  typeName: string | null;
  description: string;
  totalAmount: string;
  currency: string;
  receiptRef: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lines: TransactionLineView[];
};

export type TransactionSortKey = "date" | "amount" | "updated";
export type SortDirection = "asc" | "desc";

export function normalizeTransactionSort(sort?: string): TransactionSortKey {
  if (sort === "amount" || sort === "updated") return sort;
  return "date";
}

export function normalizeSortDirection(direction?: string): SortDirection {
  return direction === "asc" ? "asc" : "desc";
}

export function filterTransactions(items: TransactionView[], search?: string) {
  const query = search?.trim().toLowerCase();
  if (!query) return items;

  return items.filter((tx) => {
    const haystack = [
      tx.transactId,
      tx.transactDate,
      tx.typeName,
      tx.description,
      tx.totalAmount,
      tx.currency,
      tx.receiptRef,
      tx.createdAt,
      tx.updatedAt,
      ...tx.lines.flatMap((line) => [
        line.accountName,
        line.memo,
        line.drCr,
        line.amount,
        line.currency,
      ]),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

export function sortTransactions(
  items: TransactionView[],
  sort: TransactionSortKey,
  direction: SortDirection,
) {
  return [...items].sort((a, b) => {
    const multiplier = direction === "asc" ? 1 : -1;

    if (sort === "amount") {
      const amountDiff = Number(a.totalAmount) - Number(b.totalAmount);
      if (amountDiff !== 0) return amountDiff * multiplier;
    } else if (sort === "updated") {
      const updatedDiff = compareIsoLike(a.updatedAt, b.updatedAt);
      if (updatedDiff !== 0) return updatedDiff * multiplier;
    } else {
      const dateDiff = a.transactDate.localeCompare(b.transactDate);
      if (dateDiff !== 0) return dateDiff * multiplier;
    }

    return compareIsoLike(b.createdAt, a.createdAt);
  });
}

function compareIsoLike(a?: string | null, b?: string | null) {
  const left = a ?? "";
  const right = b ?? "";
  return left.localeCompare(right);
}

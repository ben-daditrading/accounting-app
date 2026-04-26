import { asc, desc, eq, sql } from "drizzle-orm";

import { normalizeText, optionalText } from "@/lib/accounting/normalize";
import { getDb, schema } from "@/lib/db";
import type { TransactionInput } from "@/lib/validation/transaction";

const { accounts, journalLines, transactionTypes, transactions } = schema;

export async function listTransactions() {
  if (!process.env.DATABASE_URL) {
    return {
      mode: "placeholder" as const,
      items: [],
    };
  }

  const db = getDb();

  // Fetch transactions with type names
  const txRows = await db
    .select({
      transactId: transactions.transactId,
      transactDate: transactions.transactDate,
      typeId: transactions.typeId,
      typeName: transactionTypes.typeName,
      description: transactions.description,
      totalAmount: transactions.totalAmount,
      currency: transactions.currency,
      receiptRef: transactions.receiptRef,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .leftJoin(transactionTypes, eq(transactions.typeId, transactionTypes.typeId))
    .orderBy(desc(transactions.transactDate), desc(transactions.createdAt))
    .limit(100);

  if (txRows.length === 0) {
    return { mode: "database" as const, items: [] };
  }

  // Fetch journal lines for those transactions
  const txIds = txRows.map((t) => t.transactId);
  const lineRows = await db
    .select({
      transactId: journalLines.transactId,
      lineNumber: journalLines.lineNumber,
      drCr: journalLines.drCr,
      amount: journalLines.amount,
      currency: journalLines.currency,
      amountCad: journalLines.amountCad,
      accountId: journalLines.accountId,
      accountName: accounts.accountName,
      memo: journalLines.memo,
    })
    .from(journalLines)
    .leftJoin(accounts, eq(journalLines.accountId, accounts.accountId))
    .where(
      txIds.length === 1
        ? eq(journalLines.transactId, txIds[0])
        : sql`${journalLines.transactId} IN (${sql.join(txIds.map((id) => sql`${id}`), sql`, `)})`
    )
    .orderBy(asc(journalLines.lineNumber));

  // Group lines by transaction
  const linesByTx = new Map<string, typeof lineRows>();
  for (const line of lineRows) {
    const arr = linesByTx.get(line.transactId) ?? [];
    arr.push(line);
    linesByTx.set(line.transactId, arr);
  }

  const items = txRows.map((tx) => ({
    ...tx,
    lines: linesByTx.get(tx.transactId) ?? [],
  }));

  return {
    mode: "database" as const,
    items,
  };
}

export async function listAccounts() {
  if (!process.env.DATABASE_URL) {
    return [];
  }

  const db = getDb();
  return db
    .select({
      accountId: accounts.accountId,
      accountNumber: accounts.accountNumber,
      accountName: accounts.accountName,
      accountType: accounts.accountType,
      currency: accounts.currency,
    })
    .from(accounts)
    .where(eq(accounts.isActive, true))
    .orderBy(accounts.accountName);
}

export async function listTransactionTypes() {
  if (!process.env.DATABASE_URL) {
    return [];
  }

  const db = getDb();
  return db
    .select({
      typeId: transactionTypes.typeId,
      typeName: transactionTypes.typeName,
      description: transactionTypes.description,
    })
    .from(transactionTypes)
    .orderBy(transactionTypes.typeName);
}

export async function createTransaction(input: TransactionInput, _actor = "system") {
  const db = getDb();

  return db.transaction(async (tx) => {
    await tx.insert(transactions).values({
      transactId: normalizeText(input.transactId),
      transactDate: input.transactDate,
      typeId: input.typeId,
      description: normalizeText(input.description),
      totalAmount: input.totalAmount,
      currency: normalizeText(input.currency),
      exchangeRate: optionalText(input.exchangeRate),
      receiptRef: optionalText(input.receiptRef),
      notes: optionalText(input.notes),
    });

    const journalLineValues = input.journalLines.map((line, index) => ({
      transactId: normalizeText(input.transactId),
      lineNumber: index + 1,
      accountId: line.accountId,
      drCr: line.drCr,
      amount: line.amount,
      currency: normalizeText(line.currency),
      amountCad: optionalText(line.amountCad),
      memo: optionalText(line.memo),
    }));

    await tx.insert(journalLines).values(journalLineValues);

    return { transactId: input.transactId };
  });
}

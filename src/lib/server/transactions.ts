import { desc, eq } from "drizzle-orm";

import { isMeaningfulSourceLine, normalizeText, optionalAmount, optionalText } from "@/lib/accounting/normalize";
import { getDb, schema } from "@/lib/db";
import type { TransactionDraftInput } from "@/lib/validation/transaction";

const { accounts, auditLog, journalEntries, receipts, transactionSourceLines, transactions } = schema;

type AccountDbLike = Pick<ReturnType<typeof getDb>, "select" | "insert">;

export async function listTransactions() {
  if (!process.env.DATABASE_URL) {
    return {
      mode: "placeholder" as const,
      items: [],
    };
  }

  const db = getDb();
  const items = await db
    .select({
      id: transactions.id,
      transactionDate: transactions.transactionDate,
      transactionType: transactions.transactionType,
      summaryAmount: transactions.summaryAmount,
      currencyCode: transactions.currencyCode,
      summaryDescription: transactions.summaryDescription,
      status: transactions.status,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .orderBy(desc(transactions.transactionDate), desc(transactions.createdAt))
    .limit(100);

  return {
    mode: "database" as const,
    items,
  };
}

async function getOrCreateAccountId(db: AccountDbLike, accountName: string) {
  const normalizedName = normalizeText(accountName);

  const existing = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.name, normalizedName)).limit(1);
  if (existing[0]?.id) {
    return existing[0].id;
  }

  const inserted = await db
    .insert(accounts)
    .values({
      name: normalizedName,
      active: true,
    })
    .returning({ id: accounts.id });

  return inserted[0].id;
}

export async function createTransactionDraft(input: TransactionDraftInput, actor = "system") {
  const db = getDb();

  return db.transaction(async (tx) => {
    const insertedTransactions = await tx
      .insert(transactions)
      .values({
        transactionDate: input.transactionDate,
        transactionType: normalizeText(input.transactionType),
        summaryAmount: optionalAmount(input.summaryAmount),
        currencyCode: normalizeText(input.currencyCode),
        summaryDescription: optionalText(input.summaryDescription),
        receiptDate: optionalText(input.receiptDate),
        notes: optionalText(input.notes),
        status: "draft",
        source: "manual",
        createdBy: actor,
        updatedBy: actor,
      })
      .returning({ id: transactions.id });

    const transactionId = insertedTransactions[0].id;

    const sourceLineValues = input.sourceLines
      .filter(isMeaningfulSourceLine)
      .map((line, index) => ({
        transactionId,
        sortOrder: index,
        lineDate: optionalText(line.lineDate),
        lineType: optionalText(line.lineType),
        lineAmount: optionalAmount(line.lineAmount),
        currencyCode: normalizeText(line.currencyCode),
        lineDescription: optionalText(line.lineDescription),
        rawAmountText: optionalText(line.lineAmount),
        rawTypeText: optionalText(line.lineType),
        rawDescriptionText: optionalText(line.lineDescription),
      }));

    if (sourceLineValues.length > 0) {
      await tx.insert(transactionSourceLines).values(sourceLineValues);
    }

    const journalEntryValues = [] as Array<{
      transactionId: string;
      sortOrder: number;
      side: "DR" | "CR";
      accountId: string;
      rawAccountName: string;
      amount: string;
      currencyCode: string;
      rawAmountText: string;
      memo: string | null;
    }>;

    for (const [index, entry] of input.journalEntries.entries()) {
      const accountId = await getOrCreateAccountId(tx, entry.accountName);
      journalEntryValues.push({
        transactionId,
        sortOrder: index,
        side: entry.side,
        accountId,
        rawAccountName: normalizeText(entry.accountName),
        amount: normalizeText(entry.amount),
        currencyCode: normalizeText(entry.currencyCode),
        rawAmountText: normalizeText(entry.amount),
        memo: optionalText(entry.memo),
      });
    }

    await tx.insert(journalEntries).values(journalEntryValues);

    await tx.insert(auditLog).values({
      entityType: "transaction",
      entityId: transactionId,
      action: "create",
      actor,
      beforeJson: null,
      afterJson: {
        transactionDate: input.transactionDate,
        transactionType: input.transactionType,
        currencyCode: input.currencyCode,
        summaryAmount: input.summaryAmount || null,
        summaryDescription: input.summaryDescription || null,
        sourceLineCount: sourceLineValues.length,
        journalEntryCount: journalEntryValues.length,
      },
    });

    return { transactionId };
  });
}

export async function attachReceiptToTransaction(
  params: {
    transactionId: string;
    bucket: string;
    objectKey: string;
    fileName: string;
    mimeType?: string | null;
    fileSizeBytes?: number | null;
    checksumSha256?: string | null;
  },
  actor = "system",
) {
  const db = getDb();

  await db.insert(receipts).values({
    transactionId: params.transactionId,
    bucket: params.bucket,
    objectKey: params.objectKey,
    fileName: params.fileName,
    mimeType: params.mimeType ?? null,
    fileSizeBytes: params.fileSizeBytes ?? null,
    checksumSha256: params.checksumSha256 ?? null,
    uploadedBy: actor,
  });

  await db.insert(auditLog).values({
    entityType: "receipt",
    entityId: params.transactionId,
    action: "upload",
    actor,
    beforeJson: null,
    afterJson: {
      transactionId: params.transactionId,
      bucket: params.bucket,
      objectKey: params.objectKey,
      fileName: params.fileName,
    },
  });
}

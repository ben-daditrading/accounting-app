import AdmZip from "adm-zip";
import { GoogleGenAI } from "@google/genai";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { optionalText } from "@/lib/accounting/normalize";
import { getDb, schema } from "@/lib/db";
import { isR2Configured, uploadStatementToR2 } from "@/lib/r2/server";
import { createTransaction, listAccounts, listTransactionTypes } from "@/lib/server/transactions";
import { transactionInputSchema, type TransactionInput } from "@/lib/validation/transaction";

const { statementBatches, statementBatchItems, transactions } = schema;

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp"]);
const PROCESSING_CONCURRENCY = Number(process.env.STATEMENT_BATCH_CONCURRENCY ?? "3");
const PARSER_PROVIDER = process.env.RECEIPT_OCR_PROVIDER?.toLowerCase() ?? "gemini";
const GEMINI_MODEL = process.env.RECEIPT_OCR_GEMINI_MODEL ?? "gemini-3.1-flash";
const GEMINI_MAX_OUTPUT_TOKENS = Number(process.env.RECEIPT_OCR_GEMINI_MAX_OUTPUT_TOKENS ?? "4096");

type StoredUpload = {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
};

type StatementRowExtraction = {
  statementDate?: string | null;
  rawDescription?: string | null;
  withdrawalAmount?: string | null;
  depositAmount?: string | null;
  runningBalance?: string | null;
  direction?: "withdrawal" | "deposit" | null;
  accountSerial?: string | null;
  confidenceScore?: number | null;
  warnings?: string[];
};

type StatementExtraction = {
  institutionName?: string | null;
  statementPeriodStart?: string | null;
  statementPeriodEnd?: string | null;
  statementSerial?: string | null;
  openingBalance?: string | null;
  closingBalance?: string | null;
  rows?: StatementRowExtraction[];
  rawText?: string | null;
  confidenceScore?: number | null;
  confidenceReason?: string | null;
  warnings?: string[];
};

type DuplicateMatch = {
  transactId: string;
  transactDate: string;
  description: string;
  totalAmount: string;
  currency: string;
  accountSerial: string | null;
};

type ReviewStatus = "queued" | "processing" | "ready" | "needs_review" | "duplicate" | "error" | "deleted" | "submitted";
type ColorState = "green" | "yellow" | "red" | "gray";
type JournalLineInput = TransactionInput["journalLines"][number];

type StatementBatchSummary = {
  batchId: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  sourceName: string | null;
  status: string;
  statementPeriodStart: string | null;
  statementPeriodEnd: string | null;
  statementSerial: string | null;
  institutionName: string | null;
  openingBalance: string | null;
  closingBalance: string | null;
  counts: {
    total: number;
    processed: number;
    queued: number;
    processing: number;
    ready: number;
    needsReview: number;
    duplicate: number;
    error: number;
    deleted: number;
    submitted: number;
  };
};

type StatementBatchItemClient = {
  itemId: string;
  batchId: string;
  sourceFileName: string;
  status: ReviewStatus;
  colorState: ColorState;
  confidenceScore: string;
  confidenceReason: string | null;
  statementDate: string | null;
  rawDescription: string | null;
  direction: string | null;
  withdrawalAmount: string | null;
  depositAmount: string | null;
  runningBalance: string | null;
  accountSerial: string | null;
  duplicateMatchesJson: DuplicateMatch[] | null;
  proposedTransactionJson: TransactionInput | null;
  editedTransactionJson: TransactionInput | null;
  warningsJson: string[] | null;
  errorMessage: string | null;
  postedTransactId: string | null;
  postedStatementRef: string | null;
  createdAt: string;
  updatedAt: string;
};

type UpdateStatementBatchItemInput = {
  transaction: TransactionInput;
  status?: ReviewStatus;
};

declare global {
  var __statementBatchWorkers: Map<string, Promise<void>> | undefined;
}

const batchWorkers = globalThis.__statementBatchWorkers ?? new Map<string, Promise<void>>();
globalThis.__statementBatchWorkers = batchWorkers;

let geminiClient: GoogleGenAI | null = null;

function getImportsRoot() {
  return path.join(process.cwd(), "tmp", "statement-batches");
}

function getBatchTempDir(batchId: string) {
  return path.join(getImportsRoot(), batchId);
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function detectMimeType(name: string, fallback?: string) {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return fallback || "application/octet-stream";
}

async function saveUpload(batchId: string, upload: StoredUpload) {
  const dir = getBatchTempDir(batchId);
  await ensureDir(dir);
  const filePath = path.join(dir, `${Date.now()}-${safeName(upload.name)}`);
  await fs.writeFile(filePath, upload.bytes);
  return filePath;
}

async function cleanupBatchTempFiles(batchId: string) {
  await fs.rm(getBatchTempDir(batchId), { recursive: true, force: true });
}

function buildSha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJsonFromText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Statement parser returned empty output");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
  return JSON.parse(candidate);
}

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  if (!geminiClient) geminiClient = new GoogleGenAI({ apiKey });
  return geminiClient;
}

function makeStatementPrompt(fileName: string) {
  return [
    "You are extracting structured accounting data from a bank statement. Return JSON only.",
    "Extract statement metadata plus transaction rows. Do not invent values. Use null when unknown.",
    "Do not include opening balance or closing balance as transaction rows.",
    "For each row, determine whether it is a withdrawal or deposit and extract running balance when visible.",
    `Source file: ${fileName}`,
    JSON.stringify({
      institutionName: null,
      statementPeriodStart: null,
      statementPeriodEnd: null,
      statementSerial: null,
      openingBalance: null,
      closingBalance: null,
      rawText: null,
      confidenceScore: null,
      confidenceReason: null,
      warnings: [],
      rows: [
        {
          statementDate: null,
          rawDescription: null,
          withdrawalAmount: null,
          depositAmount: null,
          runningBalance: null,
          direction: null,
          accountSerial: null,
          confidenceScore: null,
          warnings: [],
        },
      ],
    }),
  ].join("\n\n");
}

async function extractStatement(file: StoredUpload) {
  if (PARSER_PROVIDER && PARSER_PROVIDER !== "gemini") throw new Error(`Unsupported parser provider: ${PARSER_PROVIDER}`);
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    config: { maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS },
    contents: [
      {
        parts: [
          { inlineData: { data: Buffer.from(file.bytes).toString("base64"), mimeType: file.mimeType } },
          { text: makeStatementPrompt(file.name) },
        ],
      },
    ],
  });
  const text = response.text?.trim();
  if (!text) throw new Error("Statement parser returned empty output");
  return {
    provider: "gemini",
    model: GEMINI_MODEL,
    extraction: parseJsonFromText(text) as StatementExtraction,
  };
}

function normalizeMoney(value?: string | number | null) {
  if (value == null || value === "") return null;
  const numeric = Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(numeric)) return null;
  return numeric.toFixed(2);
}

function normalizeDate(value?: string | null) {
  if (!value) return null;
  if (/^20\d{2}-\d{2}-\d{2}$/.test(value)) return value;
  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const mm = slash[1].padStart(2, "0");
    const dd = slash[2].padStart(2, "0");
    const yyyy = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "statement";
}

function buildTransactId(date: string, description: string, used: Set<string>) {
  const base = `STMT-${date.replace(/-/g, "")}-${slug(description).slice(0, 12).toUpperCase() || "ITEM"}`;
  let index = 1;
  let candidate = `${base}-${String(index).padStart(3, "0")}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${base}-${String(index).padStart(3, "0")}`;
  }
  used.add(candidate);
  return candidate;
}

function deriveDirection(row: StatementRowExtraction) {
  if (row.direction === "deposit" || row.direction === "withdrawal") return row.direction;
  if (normalizeMoney(row.depositAmount)) return "deposit";
  return "withdrawal";
}

function buildFingerprint(params: { statementDate: string; rawDescription: string; direction: string; amount: string; runningBalance?: string | null; accountSerial?: string | null }) {
  return createHash("sha256")
    .update([
      params.accountSerial ?? "",
      params.statementDate,
      params.rawDescription.trim().toLowerCase(),
      params.direction,
      params.amount,
      params.runningBalance ?? "",
    ].join("|"))
    .digest("hex");
}

function selectTypeId(typeRows: Awaited<ReturnType<typeof listTransactionTypes>>, direction: string) {
  const wanted = direction === "deposit" ? "deposit" : "expense";
  return typeRows.find((row) => row.typeName.toLowerCase() === wanted)?.typeId ?? typeRows[0]?.typeId ?? null;
}

function findAccountIdByNumber(accountRows: Awaited<ReturnType<typeof listAccounts>>, accountNumber: string) {
  return accountRows.find((row) => row.accountNumber === accountNumber)?.accountId ?? null;
}

function findAccountIdByInternalKey(accountRows: Awaited<ReturnType<typeof listAccounts>>, internalKey: string) {
  return accountRows.find((row) => row.internalKey === internalKey)?.accountId ?? null;
}

function classifyStatementRow(description: string) {
  const lower = description.toLowerCase();
  if (lower.includes("service charge") || lower.includes("statement fee") || lower.includes("self serv")) return "bank_fee";
  if (lower.includes("card products")) return "card_payment";
  if (lower.includes("cheque")) return "cheque";
  if (lower.includes("waiver")) return "waiver";
  if (lower.includes("deposit") || lower.includes("credit")) return "deposit";
  return "unknown";
}

function buildJournalLines(params: {
  classification: string;
  direction: string;
  amount: string;
  currency: string;
  accountSerial?: string | null;
  accountRows: Awaited<ReturnType<typeof listAccounts>>;
}): { journalLines: JournalLineInput[]; warnings: string[] } {
  const warnings: string[] = [];
  const bankId = findAccountIdByInternalKey(params.accountRows, "BANK_ACCOUNT_CAD") ?? findAccountIdByNumber(params.accountRows, "1002");
  const receivableId = findAccountIdByNumber(params.accountRows, "1062");
  const bankChargesId = findAccountIdByInternalKey(params.accountRows, "BANK_CHARGES") ?? findAccountIdByNumber(params.accountRows, "8715");
  const cardChargesId = findAccountIdByInternalKey(params.accountRows, "CREDIT_CARD_CHARGES") ?? findAccountIdByNumber(params.accountRows, "2707");
  if (!bankId) return { journalLines: [] as JournalLineInput[], warnings: ["Missing bank account mapping"] };

  if (params.direction === "deposit") {
    const creditId = receivableId ?? findAccountIdByNumber(params.accountRows, "8000");
    if (!creditId) return { journalLines: [] as JournalLineInput[], warnings: ["Missing deposit mapping"] };
    return {
      journalLines: [
        { accountId: bankId, accountSerial: params.accountSerial ?? "", drCr: "DR", amount: params.amount, currency: params.currency, amountCad: "", memo: "Statement deposit" },
        { accountId: creditId, accountSerial: "", drCr: "CR", amount: params.amount, currency: params.currency, amountCad: "", memo: "Statement deposit source" },
      ],
      warnings,
    };
  }

  if (params.classification === "bank_fee" && bankChargesId) {
    return {
      journalLines: [
        { accountId: bankChargesId, accountSerial: "", drCr: "DR", amount: params.amount, currency: params.currency, amountCad: "", memo: "Bank charge" },
        { accountId: bankId, accountSerial: params.accountSerial ?? "", drCr: "CR", amount: params.amount, currency: params.currency, amountCad: "", memo: "Bank statement withdrawal" },
      ],
      warnings,
    };
  }

  if (params.classification === "card_payment" && cardChargesId) {
    return {
      journalLines: [
        { accountId: cardChargesId, accountSerial: params.accountSerial ?? "", drCr: "DR", amount: params.amount, currency: params.currency, amountCad: "", memo: "Card payment" },
        { accountId: bankId, accountSerial: params.accountSerial ?? "", drCr: "CR", amount: params.amount, currency: params.currency, amountCad: "", memo: "Bank statement withdrawal" },
      ],
      warnings,
    };
  }

  warnings.push("Ambiguous statement classification, defaulted to receivable clearing and needs review");
  const fallbackId = receivableId ?? findAccountIdByNumber(params.accountRows, "8000");
  if (!fallbackId) return { journalLines: [] as JournalLineInput[], warnings: ["Missing fallback mapping"] };
  return {
    journalLines: [
      { accountId: fallbackId, accountSerial: "", drCr: "DR", amount: params.amount, currency: params.currency, amountCad: "", memo: "Statement review required" },
      { accountId: bankId, accountSerial: params.accountSerial ?? "", drCr: "CR", amount: params.amount, currency: params.currency, amountCad: "", memo: "Bank statement withdrawal" },
    ],
    warnings,
  };
}

async function findDuplicateMatches(params: { statementDate: string; currency: string; totalAmount: string; rawDescription: string; accountSerial?: string | null }) {
  const db = getDb();
  const descLike = `%${params.rawDescription.toLowerCase()}%`;
  const rows = await db
    .select({
      transactId: transactions.transactId,
      transactDate: transactions.transactDate,
      description: transactions.description,
      totalAmount: transactions.totalAmount,
      currency: transactions.currency,
      accountSerial: sql<string | null>`(
        select jl.account_serial
        from journal_lines jl
        where jl.transact_id = ${transactions.transactId}
        order by jl.line_number asc
        limit 1
      )`,
    })
    .from(transactions)
    .where(sql`
      ${transactions.transactDate} = ${params.statementDate}
      and ${transactions.currency} = ${params.currency}
      and ${transactions.totalAmount} = ${params.totalAmount}
      and lower(${transactions.description}) like ${descLike}
    `)
    .orderBy(desc(transactions.createdAt))
    .limit(10);

  return rows.map((row) => ({
    transactId: row.transactId,
    transactDate: row.transactDate,
    description: row.description,
    totalAmount: String(row.totalAmount),
    currency: row.currency,
    accountSerial: row.accountSerial,
  }));
}

function deriveColor(status: ReviewStatus): ColorState {
  if (status === "ready" || status === "submitted") return "green";
  if (status === "deleted") return "gray";
  if (status === "needs_review" || status === "queued" || status === "processing") return "yellow";
  return "red";
}

async function processBatchFile(batchId: string, itemId: string, file: StoredUpload, sourcePath: string) {
  const db = getDb();
  const { provider, model, extraction } = await extractStatement(file);
  const periodStart = normalizeDate(extraction.statementPeriodStart);
  const periodEnd = normalizeDate(extraction.statementPeriodEnd);
  const openingBalance = normalizeMoney(extraction.openingBalance);
  const closingBalance = normalizeMoney(extraction.closingBalance);
  const statementSerial = optionalText(extraction.statementSerial);
  const institutionName = optionalText(extraction.institutionName);

  await db.update(statementBatches).set({
    statementPeriodStart: periodStart,
    statementPeriodEnd: periodEnd,
    statementSerial,
    institutionName,
    openingBalance,
    closingBalance,
    updatedAt: new Date(),
  }).where(eq(statementBatches.batchId, batchId));

  const rows = extraction.rows ?? [];
  const accountRows = await listAccounts();
  const typeRows = await listTransactionTypes();
  const usedIds = new Set<string>();

  await db.delete(statementBatchItems).where(and(eq(statementBatchItems.batchId, batchId), eq(statementBatchItems.itemId, itemId)));

  let index = 0;
  for (const row of rows) {
    index += 1;
    const statementDate = normalizeDate(row.statementDate) ?? periodEnd ?? new Date().toISOString().slice(0, 10);
    const rawDescription = optionalText(row.rawDescription) ?? `Statement row ${index}`;
    const withdrawalAmount = normalizeMoney(row.withdrawalAmount);
    const depositAmount = normalizeMoney(row.depositAmount);
    const direction = deriveDirection(row);
    const amount = direction === "deposit" ? depositAmount : withdrawalAmount;
    const runningBalance = normalizeMoney(row.runningBalance);
    const accountSerial = optionalText(row.accountSerial) ?? statementSerial ?? null;
    const classification = classifyStatementRow(rawDescription);
    const warnings = [...(extraction.warnings ?? []), ...(row.warnings ?? [])];

    if (!amount) {
      warnings.push("Could not determine row amount");
    }

    const { journalLines, warnings: journalWarnings } = amount
      ? buildJournalLines({ classification, direction, amount, currency: "CAD", accountSerial, accountRows })
      : { journalLines: [] as JournalLineInput[], warnings: ["Missing amount"] };
    warnings.push(...journalWarnings);

    const typeId = selectTypeId(typeRows, direction);
    if (!typeId) warnings.push("No transaction type mapping found");

    const transactId = buildTransactId(statementDate, rawDescription, usedIds);
    const description = `${direction === "deposit" ? "Deposit" : "Statement"} — ${rawDescription}`;
    const totalAmount = amount ?? "0.00";
    const duplicateMatches = amount
      ? await findDuplicateMatches({ statementDate, currency: "CAD", totalAmount, rawDescription, accountSerial })
      : [];
    if (duplicateMatches.length > 0) warnings.push("Possible duplicate statement transaction");

    const fingerprint = buildFingerprint({ statementDate, rawDescription, direction, amount: totalAmount, runningBalance, accountSerial });
    const proposedTransaction: TransactionInput | null = typeId && amount && journalLines.length >= 2
      ? {
          transactId,
          transactDate: statementDate,
          typeId,
          description,
          totalAmount,
          currency: "CAD",
          exchangeRate: "",
          receiptRef: "",
          statementRef: "",
          notes: `Imported from bank statement${accountSerial ? ` (${accountSerial})` : ""}`,
          journalLines,
        }
      : null;

    const status: ReviewStatus = proposedTransaction && duplicateMatches.length === 0 && warnings.length === 0 ? "ready" : duplicateMatches.length > 0 ? "duplicate" : proposedTransaction ? "needs_review" : "error";

    await db.insert(statementBatchItems).values({
      batchId,
      sourceFileName: file.name,
      sourcePath,
      mimeType: file.mimeType,
      fileSize: file.bytes.byteLength,
      sha256: buildSha256(file.bytes),
      sourcePage: 1,
      lineIndex: index,
      statementDate,
      rawDescription,
      direction,
      withdrawalAmount,
      depositAmount,
      runningBalance,
      accountSerial,
      sourceFingerprint: fingerprint,
      status,
      colorState: deriveColor(status),
      confidenceScore: String(row.confidenceScore ?? extraction.confidenceScore ?? 0),
      confidenceReason: optionalText(extraction.confidenceReason),
      parserProvider: provider,
      parserModel: model,
      parserRawText: extraction.rawText ?? null,
      parserJson: row,
      duplicateMatchesJson: duplicateMatches,
      proposedTransactionJson: proposedTransaction,
      editedTransactionJson: proposedTransaction,
      warningsJson: warnings,
      errorMessage: proposedTransaction ? null : "Could not build transaction draft",
      processedAt: new Date(),
    });
  }
}

async function claimNextQueuedItem(batchId: string) {
  const db = getDb();
  const rows = await db.execute(sql`
    update imports.statement_batch_items
    set status = 'processing', color_state = 'gray', updated_at = now()
    where item_id = (
      select item_id
      from imports.statement_batch_items
      where batch_id = ${batchId} and status = 'queued'
      order by created_at asc
      for update skip locked
      limit 1
    )
    returning item_id
  `);
  const row = (rows as { rows?: Array<{ item_id: string }> }).rows?.[0];
  return row?.item_id ?? null;
}

async function recalculateBatchCounts(batchId: string) {
  const db = getDb();
  const rows = await db
    .select({ status: statementBatchItems.status })
    .from(statementBatchItems)
    .where(eq(statementBatchItems.batchId, batchId));
  const counts = {
    totalItems: rows.length,
    processedItems: rows.filter((row) => ["ready", "needs_review", "duplicate", "error", "deleted", "submitted"].includes(row.status)).length,
    readyItems: rows.filter((row) => row.status === "ready").length,
    needsReviewItems: rows.filter((row) => row.status === "needs_review").length,
    duplicateItems: rows.filter((row) => row.status === "duplicate").length,
    errorItems: rows.filter((row) => row.status === "error").length,
    deletedItems: rows.filter((row) => row.status === "deleted").length,
    submittedItems: rows.filter((row) => row.status === "submitted").length,
  };
  const inFlight = rows.some((row) => row.status === "queued" || row.status === "processing");
  await db.update(statementBatches).set({
    ...counts,
    status: inFlight ? "processing" : "ready_for_review",
    updatedAt: new Date(),
  }).where(eq(statementBatches.batchId, batchId));
}

async function processItem(itemId: string) {
  const db = getDb();
  const [item] = await db.select().from(statementBatchItems).where(eq(statementBatchItems.itemId, itemId)).limit(1);
  if (!item) return;
  try {
    const bytes = new Uint8Array(await fs.readFile(item.sourcePath));
    await processBatchFile(item.batchId, item.itemId, { name: item.sourceFileName, mimeType: item.mimeType, bytes }, item.sourcePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Statement processing failed";
    await db.update(statementBatchItems).set({ status: "error", colorState: "red", errorMessage: message, updatedAt: new Date() }).where(eq(statementBatchItems.itemId, itemId));
  }
  await recalculateBatchCounts(item.batchId);
}

async function runBatchWorkers(batchId: string) {
  await recalculateBatchCounts(batchId);
  const workers = Array.from({ length: PROCESSING_CONCURRENCY }, async () => {
    while (true) {
      const itemId = await claimNextQueuedItem(batchId);
      if (!itemId) break;
      await processItem(itemId);
    }
  });
  await Promise.all(workers);
  await recalculateBatchCounts(batchId);
}

export function startStatementBatchProcessing(batchId: string) {
  const existing = batchWorkers.get(batchId);
  if (existing) return existing;
  const promise = runBatchWorkers(batchId).catch((error) => console.error("Statement batch processing failed", error)).finally(() => batchWorkers.delete(batchId));
  batchWorkers.set(batchId, promise);
  return promise;
}

function batchRowToSummary(batch: typeof statementBatches.$inferSelect): StatementBatchSummary {
  return {
    batchId: batch.batchId,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    createdBy: batch.createdBy,
    sourceName: batch.sourceName,
    status: batch.status,
    statementPeriodStart: batch.statementPeriodStart ?? null,
    statementPeriodEnd: batch.statementPeriodEnd ?? null,
    statementSerial: batch.statementSerial,
    institutionName: batch.institutionName,
    openingBalance: batch.openingBalance == null ? null : String(batch.openingBalance),
    closingBalance: batch.closingBalance == null ? null : String(batch.closingBalance),
    counts: {
      total: batch.totalItems,
      processed: batch.processedItems,
      queued: Math.max(batch.totalItems - batch.processedItems - batch.deletedItems - batch.submittedItems, 0),
      processing: batch.status === "processing" ? Math.max(batch.totalItems - batch.processedItems, 0) : 0,
      ready: batch.readyItems,
      needsReview: batch.needsReviewItems,
      duplicate: batch.duplicateItems,
      error: batch.errorItems,
      deleted: batch.deletedItems,
      submitted: batch.submittedItems,
    },
  };
}

function itemRowToClient(item: typeof statementBatchItems.$inferSelect): StatementBatchItemClient {
  return {
    itemId: item.itemId,
    batchId: item.batchId,
    sourceFileName: item.sourceFileName,
    status: item.status as ReviewStatus,
    colorState: item.colorState as ColorState,
    confidenceScore: String(item.confidenceScore ?? "0.00"),
    confidenceReason: item.confidenceReason,
    statementDate: item.statementDate ?? null,
    rawDescription: item.rawDescription,
    direction: item.direction,
    withdrawalAmount: item.withdrawalAmount == null ? null : String(item.withdrawalAmount),
    depositAmount: item.depositAmount == null ? null : String(item.depositAmount),
    runningBalance: item.runningBalance == null ? null : String(item.runningBalance),
    accountSerial: item.accountSerial,
    duplicateMatchesJson: (item.duplicateMatchesJson as DuplicateMatch[] | null) ?? null,
    proposedTransactionJson: (item.proposedTransactionJson as TransactionInput | null) ?? null,
    editedTransactionJson: (item.editedTransactionJson as TransactionInput | null) ?? null,
    warningsJson: (item.warningsJson as string[] | null) ?? null,
    errorMessage: item.errorMessage,
    postedTransactId: item.postedTransactId,
    postedStatementRef: item.postedStatementRef,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export async function listStatementBatches() {
  const db = getDb();
  const rows = await db.select().from(statementBatches).orderBy(desc(statementBatches.createdAt)).limit(20);
  return rows.map(batchRowToSummary);
}

export async function getStatementBatch(batchId: string) {
  const db = getDb();
  const [row] = await db.select().from(statementBatches).where(eq(statementBatches.batchId, batchId)).limit(1);
  return row ? batchRowToSummary(row) : null;
}

export async function listStatementBatchItems(batchId: string) {
  const db = getDb();
  const rows = await db.select().from(statementBatchItems).where(eq(statementBatchItems.batchId, batchId)).orderBy(asc(statementBatchItems.createdAt), asc(statementBatchItems.lineIndex));
  return rows.map(itemRowToClient);
}

export async function createStatementBatch(params: { files: Array<{ name: string; mimeType: string; bytes: Uint8Array }>; createdBy?: string | null; }) {
  const db = getDb();
  const batchId = randomUUID();
  const expanded: StoredUpload[] = [];

  for (const file of params.files) {
    const ext = path.extname(file.name).toLowerCase();
    if (ext === ".zip") {
      const zip = new AdmZip(Buffer.from(file.bytes));
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const entryName = path.basename(entry.entryName);
        const entryExt = path.extname(entryName).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(entryExt)) continue;
        expanded.push({ name: entryName, mimeType: detectMimeType(entryName), bytes: new Uint8Array(entry.getData()) });
      }
      continue;
    }
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
    expanded.push({ name: file.name, mimeType: detectMimeType(file.name, file.mimeType), bytes: file.bytes });
  }

  if (expanded.length === 0) throw new Error("No supported bank statement files found in upload.");

  await db.insert(statementBatches).values({
    batchId,
    createdBy: params.createdBy ?? null,
    sourceName: params.files.length === 1 ? params.files[0]?.name ?? "Statement upload" : `Statement upload (${params.files.length} files)`,
    status: "uploaded",
    totalItems: expanded.length,
  });

  for (const file of expanded) {
    const sourcePath = await saveUpload(batchId, file);
    await db.insert(statementBatchItems).values({
      itemId: randomUUID(),
      batchId,
      sourceFileName: file.name,
      sourcePath,
      mimeType: file.mimeType,
      fileSize: file.bytes.byteLength,
      sha256: buildSha256(file.bytes),
      status: "queued",
      colorState: "yellow",
      confidenceScore: "0.00",
      rawDescription: "Processing uploaded statement file",
    });
  }

  await recalculateBatchCounts(batchId);
  startStatementBatchProcessing(batchId);
  return getStatementBatch(batchId);
}

export async function updateStatementBatchItem(itemId: string, input: UpdateStatementBatchItemInput) {
  const db = getDb();
  const nextStatus = input.status ?? "needs_review";
  if (!["ready", "needs_review", "deleted"].includes(nextStatus)) throw new Error("Unsupported item status update.");
  const parsed = input.transaction == null ? null : transactionInputSchema.safeParse(input.transaction);
  if (nextStatus !== "deleted" && !parsed?.success) throw new Error("Validation failed for edited transaction.");

  await db.update(statementBatchItems).set({
    editedTransactionJson: nextStatus === "deleted" ? sql`${statementBatchItems.editedTransactionJson}` : parsed?.data,
    status: nextStatus,
    colorState: deriveColor(nextStatus),
    confidenceReason: nextStatus === "ready" ? "Manually reviewed and marked ready" : "Needs human review",
    errorMessage: null,
    deletedAt: nextStatus === "deleted" ? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(statementBatchItems.itemId, itemId));

  const [updated] = await db.select().from(statementBatchItems).where(eq(statementBatchItems.itemId, itemId)).limit(1);
  if (!updated) throw new Error("Statement batch item not found.");
  await recalculateBatchCounts(updated.batchId);
  return itemRowToClient(updated);
}

export async function submitStatementBatch(batchId: string) {
  if (!isR2Configured()) {
    throw new Error("R2 storage is not configured.");
  }

  const db = getDb();
  const items = await db.select().from(statementBatchItems).where(eq(statementBatchItems.batchId, batchId)).orderBy(asc(statementBatchItems.createdAt), asc(statementBatchItems.lineIndex));
  const blocking = items.filter((item) => !["ready", "deleted", "submitted"].includes(item.status));
  if (blocking.length > 0) throw new Error("All yellow and red rows must be resolved before submission.");

  await db.update(statementBatches).set({ status: "submitting", updatedAt: new Date() }).where(eq(statementBatches.batchId, batchId));

  const results: Array<{ itemId: string; transactId?: string; error?: string }> = [];
  for (const item of items) {
    if (item.status === "deleted" || item.status === "submitted") continue;
    try {
      const transaction = transactionInputSchema.parse((item.editedTransactionJson ?? item.proposedTransactionJson) as TransactionInput);
      const bytes = new Uint8Array(await fs.readFile(item.sourcePath));
      const upload = await uploadStatementToR2({
        batchId,
        fileName: item.sourceFileName,
        mimeType: item.mimeType,
        bytes,
      });
      const statementRef = `/api/receipts/${upload.objectKey}`;
      const finalTransaction: TransactionInput = {
        ...transaction,
        statementRef,
      };
      await createTransaction(finalTransaction);
      await db.update(statementBatchItems).set({
        status: "submitted",
        colorState: "green",
        finalTransactionJson: finalTransaction,
        postedTransactId: finalTransaction.transactId,
        postedStatementRef: statementRef,
        submittedAt: new Date(),
        updatedAt: new Date(),
        errorMessage: null,
      }).where(eq(statementBatchItems.itemId, item.itemId));
      results.push({ itemId: item.itemId, transactId: finalTransaction.transactId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Submission failed";
      await db.update(statementBatchItems).set({ status: "error", colorState: "red", errorMessage: message, updatedAt: new Date() }).where(eq(statementBatchItems.itemId, item.itemId));
      results.push({ itemId: item.itemId, error: message });
    }
  }

  await recalculateBatchCounts(batchId);
  const remaining = await db.select({ status: statementBatchItems.status }).from(statementBatchItems).where(eq(statementBatchItems.batchId, batchId));
  if (remaining.every((item) => item.status === "submitted" || item.status === "deleted")) {
    await cleanupBatchTempFiles(batchId);
  }
  const summary = await getStatementBatch(batchId);
  return { summary, results };
}

import AdmZip from "adm-zip";
import { GoogleGenAI } from "@google/genai";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { optionalText } from "@/lib/accounting/normalize";
import { getDb, schema } from "@/lib/db";
import { isR2Configured, uploadReceiptToR2 } from "@/lib/r2/server";
import { createTransaction, listAccounts, listTransactionTypes } from "@/lib/server/transactions";
import { transactionInputSchema, type TransactionInput } from "@/lib/validation/transaction";

const { receiptBatches, receiptBatchItems, transactions } = schema;

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp"]);
const PROCESSING_CONCURRENCY = Number(process.env.RECEIPT_BATCH_CONCURRENCY ?? "5");
const OCR_PROVIDER = process.env.RECEIPT_OCR_PROVIDER?.toLowerCase() ?? "gemini";
const GEMINI_MODEL = process.env.RECEIPT_OCR_GEMINI_MODEL ?? "gemini-3.1-flash";
const GEMINI_MAX_OUTPUT_TOKENS = Number(process.env.RECEIPT_OCR_GEMINI_MAX_OUTPUT_TOKENS ?? "4096");

type StoredUpload = {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
};

type OcrExtraction = {
  merchant?: string | null;
  transactDate?: string | null;
  currency?: string | null;
  totalAmount?: string | null;
  subtotal?: string | null;
  tax?: string | null;
  tip?: string | null;
  cardLast4?: string | null;
  description?: string | null;
  notes?: string | null;
  documentType?: string | null;
  paymentMethod?: string | null;
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
  receiptRef: string | null;
  notes: string | null;
};

type ReviewStatus = "queued" | "processing" | "ready" | "needs_review" | "duplicate" | "error" | "deleted" | "submitted";

type ColorState = "green" | "yellow" | "red" | "gray";

type JournalLineInput = TransactionInput["journalLines"][number];

type EditableBatchItem = {
  itemId: string;
  batchId: string;
  sourceFileName: string;
  sourcePath: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  status: ReviewStatus;
  colorState: ColorState;
  confidenceScore: string;
  confidenceReason: string | null;
  ocrProvider: string | null;
  ocrModel: string | null;
  ocrRawText: string | null;
  ocrJson: OcrExtraction | null;
  duplicateMatchesJson: DuplicateMatch[] | null;
  proposedTransactionJson: TransactionInput | null;
  editedTransactionJson: TransactionInput | null;
  finalTransactionJson: TransactionInput | null;
  warningsJson: string[] | null;
  errorMessage: string | null;
  postedTransactId: string | null;
  postedReceiptRef: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  submittedAt: string | null;
  deletedAt: string | null;
};

type UpdateBatchItemInput = {
  transaction: TransactionInput;
  status?: ReviewStatus;
};

type BatchSummary = {
  batchId: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  sourceName: string | null;
  status: string;
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

declare global {
  var __receiptBatchWorkers: Map<string, Promise<void>> | undefined;
}

const batchWorkers = globalThis.__receiptBatchWorkers ?? new Map<string, Promise<void>>();
globalThis.__receiptBatchWorkers = batchWorkers;

let geminiClient: GoogleGenAI | null = null;

function getImportsRoot() {
  return path.join(process.cwd(), "tmp", "receipt-batches");
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

function fileStem(name: string) {
  return path.basename(name, path.extname(name));
}

function parseJsonFromText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("OCR model returned empty output");
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(candidate.slice(start, end + 1));
  }
  if (start >= 0 && end === -1) {
    throw new Error("OCR JSON output appears truncated before the closing brace");
  }
  return JSON.parse(candidate);
}

function makeOcrPrompt(fileName: string) {
  return [
    "You are extracting structured accounting data from one receipt or source document. Return JSON only. Do not invent values; use null for unknowns.",
    "",
    "FIELD RULES:",
    "- merchant: The business/vendor/store/restaurant/payee NAME only (e.g. \"Red Star Seafood Restaurant\", \"Tim Hortons\", \"Shell Gas Station\"). Never put purchased items, menu listings, or a description of the transaction here. If the receipt has a business name in any language, use the English name if available, otherwise transliterate. If no business name is visible at all, use a short category label (Parking, Dining, Hotel, Grocery, etc.).",
    "- description: A very short phrase (3-8 words) summarizing the purchase (e.g. \"dim sum lunch\", \"75 min parking\", \"weekly groceries\", \"2 large coffees\"). Do NOT include the merchant/vendor name — it will be prepended automatically.",
    "- notes: 2-3 sentences of useful accounting context — notable line items, payment details, anything an accountant reviewing this later would find helpful. Do NOT copy the raw receipt text here. This should be analytical, not a transcript.",
    "- rawText: A faithful OCR-style transcription of the visible document text, preserving line breaks where useful. Omit repeated boilerplate if needed. Cap at ~1000 characters; truncation is acceptable.",
    "- transactDate: ISO YYYY-MM-DD format.",
    "- Money fields (totalAmount, subtotal, tax, tip): strings with exactly 2 decimal places.",
    "- currency: If the receipt shows only $ without specifying USD or another currency, default to CAD.",
    "- confidenceScore: 0.0-1.0 float.",
    "- confidenceReason, warnings: keep concise.",
    "",
    `Source file: ${fileName}`,
    "JSON shape:",
    JSON.stringify({
      merchant: null,
      transactDate: null,
      currency: null,
      totalAmount: null,
      subtotal: null,
      tax: null,
      tip: null,
      cardLast4: null,
      description: null,
      notes: null,
      documentType: null,
      paymentMethod: null,
      rawText: null,
      confidenceScore: null,
      confidenceReason: null,
      warnings: [],
    }),
  ].join("\n");
}

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey });
  }
  return geminiClient;
}

function makeGeminiSinglePassPrompt(fileName: string) {
  return [
    makeOcrPrompt(fileName),
    "Analyze the attached image or PDF directly in a single pass. Use only information visible in the document.",
    "If there are multiple sections (e.g. merchant receipt + card slip), use the merchant receipt as primary and mention ambiguity in warnings.",
    "IMPORTANT: The JSON must be complete and valid. If a field is uncertain, use null and explain in warnings.",
  ].join("\n\n");
}

async function extractWithGemini(file: StoredUpload) {
  const ai = getGeminiClient();
  const inlineData = {
    inlineData: {
      data: Buffer.from(file.bytes).toString("base64"),
      mimeType: file.mimeType,
    },
  };

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    config: {
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
    },
    contents: [
      {
        parts: [
          inlineData,
          { text: makeGeminiSinglePassPrompt(file.name) },
        ],
      },
    ],
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Gemini OCR returned empty output");
  }

  const json = parseJsonFromText(text) as OcrExtraction;

  return {
    provider: "gemini",
    model: GEMINI_MODEL,
    extraction: json,
  };
}

async function extractReceipt(file: StoredUpload) {
  if (OCR_PROVIDER && OCR_PROVIDER !== "gemini") {
    throw new Error(`Unsupported OCR provider: ${OCR_PROVIDER}. Use gemini.`);
  }

  return extractWithGemini(file);
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
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "receipt";
}

function buildTransactId(date: string, merchant: string, used: Set<string>) {
  const base = `RCPT-${date.replace(/-/g, "")}-${slug(merchant).slice(0, 12).toUpperCase() || "ITEM"}`;
  let index = 1;
  let candidate = `${base}-${String(index).padStart(3, "0")}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${base}-${String(index).padStart(3, "0")}`;
  }
  used.add(candidate);
  return candidate;
}

function classifyCategory(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("parking")) return "parking";
  if (lower.includes("compass") || lower.includes("transit") || lower.includes("ticket")) return "transit";
  if (lower.includes("ferry")) return "travel";
  if (lower.includes("hotel") || lower.includes("motel") || lower.includes("lodging")) return "travel";
  if (lower.includes("grocery")) return "grocery";
  if (lower.includes("restaurant") || lower.includes("coffee") || lower.includes("meal") || lower.includes("cafe")) return "meal";
  if (lower.includes("deposit")) return "deposit";
  return "purchase";
}

function categoryLabel(category: string) {
  if (category === "meal") return "Dining";
  if (category === "parking") return "Parking";
  if (category === "transit") return "Transportation";
  if (category === "travel") return "Travel";
  if (category === "grocery") return "Groceries";
  if (category === "deposit") return "Deposit";
  return "Purchase";
}

function looksLikeMerchantLine(line: string) {
  const value = line.trim();
  if (!value) return false;
  const lower = value.toLowerCase();
  if (value.length < 3 || value.length > 80) return false;
  if (!/[a-z]/i.test(value)) return false;
  if (/^\$?[\d\s.,/-]+$/.test(value)) return false;
  if (/(receipt|thank you|purchase|approved|transaction|auth|terminal|card|visa|mastercard|subtotal|total|tax|tip|change|invoice|merchant copy|cardholder copy)/i.test(lower)) return false;
  if (/\b(original blend|coffee|large|small|medium|milk|cream|sugar|combo|qty|quantity)\b/i.test(lower)) return false;
  return true;
}

function inferMerchantFromRawText(rawText?: string | null) {
  if (!rawText) return null;
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);

  for (const line of lines) {
    if (looksLikeMerchantLine(line)) {
      return line;
    }
  }

  return null;
}

function shouldReviewWarning(warning: string) {
  return /(missing or invalid|inferred or missing|no transaction type mapping|missing expense or payment account mapping|missing deposit account mapping|duplicate|guessed|uncertain|blurry|illegible|ambiguous)/i.test(
    warning,
  );
}

function selectTypeId(typeRows: Awaited<ReturnType<typeof listTransactionTypes>>, category: string) {
  const wanted = category === "deposit" ? "deposit" : "expense";
  return typeRows.find((row) => row.typeName.toLowerCase() === wanted)?.typeId ?? typeRows[0]?.typeId ?? null;
}

function findAccountId(accountRows: Awaited<ReturnType<typeof listAccounts>>, accountNumber: string) {
  return accountRows.find((row) => row.accountNumber === accountNumber)?.accountId ?? null;
}

function selectCardAccount(accountRows: Awaited<ReturnType<typeof listAccounts>>, cardLast4?: string | null) {
  if (cardLast4) {
    const exact = accountRows.find((row) => row.accountNumber.includes(cardLast4));
    if (exact) return exact.accountId;
  }
  return accountRows.find((row) => row.accountNumber.startsWith("VISA-"))?.accountId ?? null;
}

function buildJournalLines(params: {
  category: string;
  currency: string;
  totalAmount: string;
  subtotal?: string | null;
  tax?: string | null;
  tip?: string | null;
  cardLast4?: string | null;
  accountRows: Awaited<ReturnType<typeof listAccounts>>;
}) {
  const warnings: string[] = [];
  const accountMap: Record<string, string | null> = {
    meal: "MEAL-EXP",
    parking: "PARKING-EXP",
    transit: "MISC-EXP",
    travel: "TRAVEL-EXP",
    grocery: "GROCERY-EXP",
    purchase: "MISC-EXP",
    deposit: null,
  };

  if (params.category === "deposit") {
    const bankId = findAccountId(params.accountRows, "SCOTIA-DADI");
    const suspenseId = findAccountId(params.accountRows, params.currency === "USD" ? "IMPORT-SUSP-USD" : "IMPORT-SUSP");
    if (!bankId || !suspenseId) return { journalLines: [] as JournalLineInput[], warnings: ["Missing deposit account mapping"] };
    const journalLines: JournalLineInput[] = [
      { accountId: bankId, drCr: "DR", amount: params.totalAmount, currency: params.currency, amountCad: "", memo: "Deposit" },
      { accountId: suspenseId, drCr: "CR", amount: params.totalAmount, currency: params.currency, amountCad: "", memo: "Import suspense" },
    ];
    return {
      journalLines,
      warnings,
    };
  }

  const expenseNumber = accountMap[params.category] ?? "MISC-EXP";
  const expenseId = findAccountId(params.accountRows, expenseNumber);
  const cardId = selectCardAccount(params.accountRows, params.cardLast4);
  const gstId = findAccountId(params.accountRows, "GST-EXP");
  const tipId = findAccountId(params.accountRows, "TIP-EXP");
  if (!expenseId || !cardId) {
    return { journalLines: [] as JournalLineInput[], warnings: ["Missing expense or payment account mapping"] };
  }

  const journalLines: JournalLineInput[] = [];
  journalLines.push({
    accountId: expenseId,
    drCr: "DR",
    amount: params.subtotal || params.totalAmount,
    currency: params.currency,
    amountCad: "",
    memo: `${params.category} expense`,
  });
  if (!params.subtotal) warnings.push("Subtotal missing, full amount posted to main expense line");
  if (params.tax && Number(params.tax) > 0 && gstId) {
    journalLines.push({ accountId: gstId, drCr: "DR", amount: params.tax, currency: params.currency, amountCad: "", memo: "Receipt tax" });
  }
  if (params.tip && Number(params.tip) > 0 && tipId) {
    journalLines.push({ accountId: tipId, drCr: "DR", amount: params.tip, currency: params.currency, amountCad: "", memo: "Receipt tip" });
  }
  journalLines.push({
    accountId: cardId,
    drCr: "CR",
    amount: params.totalAmount,
    currency: params.currency,
    amountCad: "",
    memo: params.cardLast4 ? `Card ending ${params.cardLast4}` : "Card payment",
  });

  return { journalLines, warnings };
}

async function findDuplicateMatches(params: { transactDate: string; currency: string; totalAmount: string; merchant: string }) {
  const db = getDb();
  const merchantLike = `%${params.merchant.toLowerCase()}%`;
  const rows = await db
    .select({
      transactId: transactions.transactId,
      transactDate: transactions.transactDate,
      description: transactions.description,
      totalAmount: transactions.totalAmount,
      currency: transactions.currency,
      receiptRef: transactions.receiptRef,
      notes: transactions.notes,
    })
    .from(transactions)
    .where(sql`
      ${transactions.transactDate} = ${params.transactDate}
      and ${transactions.currency} = ${params.currency}
      and ${transactions.totalAmount} = ${params.totalAmount}
      and (
        lower(${transactions.description}) like ${merchantLike}
        or lower(coalesce(${transactions.notes}, '')) like ${merchantLike}
      )
    `)
    .orderBy(desc(transactions.createdAt))
    .limit(10);

  return rows.map((row) => ({
    transactId: row.transactId,
    transactDate: row.transactDate,
    description: row.description,
    totalAmount: String(row.totalAmount),
    currency: row.currency,
    receiptRef: row.receiptRef,
    notes: row.notes,
  }));
}

function deriveColor(status: ReviewStatus): ColorState {
  if (status === "ready" || status === "submitted") return "green";
  if (status === "deleted") return "gray";
  if (status === "needs_review" || status === "queued" || status === "processing") return "yellow";
  return "red";
}

async function buildDraftFromExtraction(file: StoredUpload, extraction: OcrExtraction, usedIds: Set<string>) {
  const accountRows = await listAccounts();
  const typeRows = await listTransactionTypes();
  const warnings = [...(extraction.warnings ?? [])];
  const rawMerchant = optionalText(extraction.merchant);
  const totalAmount = normalizeMoney(extraction.totalAmount);
  const subtotal = normalizeMoney(extraction.subtotal);
  const tax = normalizeMoney(extraction.tax);
  const tip = normalizeMoney(extraction.tip);
  const rawDescription = optionalText(extraction.description);
  const category = classifyCategory([rawMerchant, extraction.documentType, rawDescription, extraction.rawText].filter(Boolean).join(" "));
  const inferredMerchant = inferMerchantFromRawText(extraction.rawText);
  let merchant = rawMerchant;
  if (!merchant || (rawDescription && merchant.toLowerCase() === rawDescription.toLowerCase())) {
    merchant = inferredMerchant ?? categoryLabel(category);
    if (!inferredMerchant) {
      warnings.push("No explicit merchant name found on the document");
    }
  }
  const transactDate = normalizeDate(extraction.transactDate) ?? new Date().toISOString().slice(0, 10);
  const currency = optionalText(extraction.currency)?.toUpperCase() ?? "CAD";
  const shortDesc = rawDescription ?? `${categoryLabel(category)} expense`;
  const description = merchant ? `${merchant} - ${shortDesc}` : shortDesc;
  const notes = optionalText(extraction.notes) ?? "Batch import draft";
  const typeId = selectTypeId(typeRows, category);
  const confidenceScore = Math.max(0, Math.min(1, extraction.confidenceScore ?? 0.5));

  if (!totalAmount) warnings.push("Total amount missing or invalid");
  if (!extraction.transactDate) warnings.push("Receipt date was inferred or missing");
  if (!typeId) warnings.push("No transaction type mapping found");

  const { journalLines, warnings: lineWarnings } = totalAmount
    ? buildJournalLines({
        category,
        currency,
        totalAmount,
        subtotal,
        tax,
        tip,
        cardLast4: extraction.cardLast4,
        accountRows,
      })
    : { journalLines: [] as JournalLineInput[], warnings: [] as string[] };
  warnings.push(...lineWarnings);
  const reviewWarnings = warnings.filter(shouldReviewWarning);

  const transactId = buildTransactId(transactDate, merchant, usedIds);
  const transaction: TransactionInput = {
    transactId,
    transactDate,
    typeId: typeId ?? 1,
    description,
    totalAmount: totalAmount ?? "0.00",
    currency,
    exchangeRate: "",
    receiptRef: "",
    notes,
    journalLines,
  };

  const duplicates = totalAmount
    ? await findDuplicateMatches({ transactDate, currency, totalAmount, merchant })
    : [];

  let status: ReviewStatus = "ready";
  if (!totalAmount || journalLines.length < 2) {
    status = "error";
  } else if (duplicates.length > 0) {
    status = "duplicate";
  } else if (reviewWarnings.length > 0 || confidenceScore < 0.85) {
    status = "needs_review";
  }

  if (confidenceScore < 0.4 && status !== "duplicate") {
    status = "error";
  }

  return {
    extraction: {
      ...extraction,
      merchant,
      transactDate,
      currency,
      totalAmount,
      subtotal,
      tax,
      tip,
      description,
      notes,
      confidenceScore,
      warnings,
    },
    transaction,
    duplicates,
    warnings,
    status,
    colorState: deriveColor(status),
    confidenceScore,
    confidenceReason: extraction.confidenceReason ?? (warnings.length ? warnings.join("; ") : "High-confidence OCR result"),
  };
}

async function recalculateBatchCounts(batchId: string) {
  const db = getDb();
  const items = await db
    .select({ status: receiptBatchItems.status })
    .from(receiptBatchItems)
    .where(eq(receiptBatchItems.batchId, batchId));

  const counts = {
    total: items.length,
    processed: items.filter((item) => !["queued", "processing"].includes(item.status)).length,
    ready: items.filter((item) => item.status === "ready").length,
    needsReview: items.filter((item) => item.status === "needs_review").length,
    duplicate: items.filter((item) => item.status === "duplicate").length,
    error: items.filter((item) => item.status === "error").length,
    deleted: items.filter((item) => item.status === "deleted").length,
    submitted: items.filter((item) => item.status === "submitted").length,
  };
  const processing = items.filter((item) => item.status === "processing").length;
  const queued = items.filter((item) => item.status === "queued").length;

  let status = "review";
  if (items.length === 0) status = "uploaded";
  else if (queued > 0 || processing > 0) status = "processing";
  else if (counts.submitted === counts.total - counts.deleted && counts.total > 0) status = counts.error > 0 ? "completed_with_errors" : "completed";
  else if (counts.ready + counts.deleted === counts.total) status = "review";
  else status = "review";

  await db
    .update(receiptBatches)
    .set({
      status,
      totalItems: counts.total,
      processedItems: counts.processed,
      readyItems: counts.ready,
      needsReviewItems: counts.needsReview,
      duplicateItems: counts.duplicate,
      errorItems: counts.error,
      deletedItems: counts.deleted,
      submittedItems: counts.submitted,
      updatedAt: new Date(),
    })
    .where(eq(receiptBatches.batchId, batchId));
}

async function claimNextQueuedItem(batchId: string) {
  const db = getDb();
  const [candidate] = await db
    .select({ itemId: receiptBatchItems.itemId })
    .from(receiptBatchItems)
    .where(and(eq(receiptBatchItems.batchId, batchId), eq(receiptBatchItems.status, "queued")))
    .orderBy(asc(receiptBatchItems.createdAt))
    .limit(1);

  if (!candidate) return null;

  const updated = await db
    .update(receiptBatchItems)
    .set({ status: "processing", colorState: "yellow", updatedAt: new Date() })
    .where(and(eq(receiptBatchItems.itemId, candidate.itemId), eq(receiptBatchItems.status, "queued")))
    .returning({ itemId: receiptBatchItems.itemId });

  if (updated.length === 0) return null;
  return candidate.itemId;
}

async function getUsedTransactIds() {
  const db = getDb();
  const rows = await db.select({ transactId: transactions.transactId }).from(transactions);
  return new Set(rows.map((row) => row.transactId));
}

async function processItem(itemId: string) {
  const db = getDb();
  const [item] = await db
    .select()
    .from(receiptBatchItems)
    .where(eq(receiptBatchItems.itemId, itemId))
    .limit(1);

  if (!item) return;

  try {
    const bytes = new Uint8Array(await fs.readFile(item.sourcePath));
    const upload: StoredUpload = {
      name: item.sourceFileName,
      mimeType: item.mimeType,
      bytes,
    };
    const ocr = await extractReceipt(upload);
    const draft = await buildDraftFromExtraction(upload, ocr.extraction, await getUsedTransactIds());

    await db
      .update(receiptBatchItems)
      .set({
        status: draft.status,
        colorState: draft.colorState,
        confidenceScore: draft.confidenceScore.toFixed(2),
        confidenceReason: draft.confidenceReason,
        ocrProvider: ocr.provider,
        ocrModel: ocr.model,
        ocrRawText: optionalText(draft.extraction.rawText),
        ocrJson: draft.extraction,
        duplicateMatchesJson: draft.duplicates,
        proposedTransactionJson: draft.transaction,
        editedTransactionJson: draft.transaction,
        finalTransactionJson: null,
        warningsJson: draft.warnings,
        errorMessage: draft.status === "error" ? draft.warnings.join("; ") : null,
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(receiptBatchItems.itemId, itemId));
  } catch (error) {
    await db
      .update(receiptBatchItems)
      .set({
        status: "error",
        colorState: "red",
        confidenceScore: "0.00",
        confidenceReason: error instanceof Error ? error.message : "Processing failed",
        errorMessage: error instanceof Error ? error.message : "Processing failed",
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(receiptBatchItems.itemId, itemId));
  }
}

export async function reprocessReceiptBatchItem(itemId: string) {
  const db = getDb();
  const [item] = await db
    .select()
    .from(receiptBatchItems)
    .where(eq(receiptBatchItems.itemId, itemId))
    .limit(1);

  if (!item) throw new Error("Receipt batch item not found.");
  if (item.status === "submitted") throw new Error("Cannot reprocess an already submitted item.");

  await db
    .update(receiptBatchItems)
    .set({ status: "processing", colorState: "gray", updatedAt: new Date() })
    .where(eq(receiptBatchItems.itemId, itemId));

  await processItem(itemId);
  await recalculateBatchCounts(item.batchId);

  const [updated] = await db
    .select()
    .from(receiptBatchItems)
    .where(eq(receiptBatchItems.itemId, itemId))
    .limit(1);
  return itemRowToClient(updated);
}

async function runBatchWorkers(batchId: string) {
  await recalculateBatchCounts(batchId);

  const workers = Array.from({ length: PROCESSING_CONCURRENCY }, async () => {
    while (true) {
      const itemId = await claimNextQueuedItem(batchId);
      if (!itemId) break;
      await processItem(itemId);
      await recalculateBatchCounts(batchId);
    }
  });

  await Promise.all(workers);
  await recalculateBatchCounts(batchId);
}

export function startBatchProcessing(batchId: string) {
  const existing = batchWorkers.get(batchId);
  if (existing) return existing;

  const promise = runBatchWorkers(batchId)
    .catch((error) => {
      console.error("Batch processing failed", error);
    })
    .finally(() => {
      batchWorkers.delete(batchId);
    });

  batchWorkers.set(batchId, promise);
  return promise;
}

function batchRowToSummary(batch: typeof receiptBatches.$inferSelect): BatchSummary {
  return {
    batchId: batch.batchId,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    createdBy: batch.createdBy,
    sourceName: batch.sourceName,
    status: batch.status,
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

function itemRowToClient(item: typeof receiptBatchItems.$inferSelect): EditableBatchItem {
  return {
    itemId: item.itemId,
    batchId: item.batchId,
    sourceFileName: item.sourceFileName,
    sourcePath: item.sourcePath,
    mimeType: item.mimeType,
    fileSize: item.fileSize,
    sha256: item.sha256,
    status: item.status as ReviewStatus,
    colorState: item.colorState as ColorState,
    confidenceScore: String(item.confidenceScore ?? "0.00"),
    confidenceReason: item.confidenceReason,
    ocrProvider: item.ocrProvider,
    ocrModel: item.ocrModel,
    ocrRawText: item.ocrRawText,
    ocrJson: (item.ocrJson as OcrExtraction | null) ?? null,
    duplicateMatchesJson: (item.duplicateMatchesJson as DuplicateMatch[] | null) ?? null,
    proposedTransactionJson: (item.proposedTransactionJson as TransactionInput | null) ?? null,
    editedTransactionJson: (item.editedTransactionJson as TransactionInput | null) ?? null,
    finalTransactionJson: (item.finalTransactionJson as TransactionInput | null) ?? null,
    warningsJson: (item.warningsJson as string[] | null) ?? null,
    errorMessage: item.errorMessage,
    postedTransactId: item.postedTransactId,
    postedReceiptRef: item.postedReceiptRef,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    processedAt: item.processedAt?.toISOString() ?? null,
    submittedAt: item.submittedAt?.toISOString() ?? null,
    deletedAt: item.deletedAt?.toISOString() ?? null,
  };
}

export async function listReceiptBatches() {
  const db = getDb();
  const rows = await db.select().from(receiptBatches).orderBy(desc(receiptBatches.createdAt)).limit(20);
  return rows.map(batchRowToSummary);
}

export async function getReceiptBatch(batchId: string) {
  const db = getDb();
  const [row] = await db.select().from(receiptBatches).where(eq(receiptBatches.batchId, batchId)).limit(1);
  return row ? batchRowToSummary(row) : null;
}

export async function listReceiptBatchItems(batchId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(receiptBatchItems)
    .where(eq(receiptBatchItems.batchId, batchId))
    .orderBy(asc(receiptBatchItems.createdAt));
  return rows.map(itemRowToClient);
}

export async function createReceiptBatch(params: {
  files: Array<{ name: string; mimeType: string; bytes: Uint8Array }>;
  createdBy?: string | null;
}) {
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
        const bytes = entry.getData();
        expanded.push({
          name: entryName,
          mimeType: detectMimeType(entryName),
          bytes: new Uint8Array(bytes),
        });
      }
      continue;
    }

    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
    expanded.push({ name: file.name, mimeType: detectMimeType(file.name, file.mimeType), bytes: file.bytes });
  }

  if (expanded.length === 0) {
    throw new Error("No supported receipt files found in upload.");
  }

  await db.insert(receiptBatches).values({
    batchId,
    createdBy: params.createdBy ?? null,
    sourceName: params.files.length === 1 ? params.files[0]?.name ?? "Batch upload" : `Batch upload (${params.files.length} files)`,
    status: "uploaded",
    totalItems: expanded.length,
  });

  for (const file of expanded) {
    const sourcePath = await saveUpload(batchId, file);
    await db.insert(receiptBatchItems).values({
      batchId,
      sourceFileName: file.name,
      sourcePath,
      mimeType: file.mimeType,
      fileSize: file.bytes.byteLength,
      sha256: buildSha256(file.bytes),
      status: "queued",
      colorState: "yellow",
      confidenceScore: "0.00",
    });
  }

  await recalculateBatchCounts(batchId);
  startBatchProcessing(batchId);
  return getReceiptBatch(batchId);
}

export async function updateReceiptBatchItem(itemId: string, input: UpdateBatchItemInput) {
  const db = getDb();
  const nextStatus = input.status ?? "needs_review";
  if (!["ready", "needs_review", "deleted"].includes(nextStatus)) {
    throw new Error("Unsupported item status update.");
  }

  const parsed = input.transaction == null ? null : transactionInputSchema.safeParse(input.transaction);
  if (nextStatus !== "deleted" && !parsed?.success) {
    throw new Error("Validation failed for edited transaction.");
  }

  const warnings: string[] = [];
  const readyAllowed = nextStatus === "ready";
  const hasDuplicate = false;
  if (hasDuplicate) warnings.push("Duplicate override preserved");

  await db
    .update(receiptBatchItems)
    .set({
      editedTransactionJson: nextStatus === "deleted" ? sql`${receiptBatchItems.editedTransactionJson}` : parsed?.data,
      status: nextStatus,
      colorState: deriveColor(nextStatus),
      confidenceReason: nextStatus === "ready" ? "Manually reviewed and marked ready" : "Needs human review",
      errorMessage: null,
      warningsJson: warnings,
      deletedAt: nextStatus === "deleted" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(receiptBatchItems.itemId, itemId));

  const [updated] = await db.select().from(receiptBatchItems).where(eq(receiptBatchItems.itemId, itemId)).limit(1);
  if (!updated) throw new Error("Receipt batch item not found.");

  if (readyAllowed) {
    transactionInputSchema.parse(parsed?.data);
  }

  await recalculateBatchCounts(updated.batchId);
  return itemRowToClient(updated);
}

export async function submitReceiptBatch(batchId: string) {
  if (!isR2Configured()) {
    throw new Error("R2 storage is not configured.");
  }

  const db = getDb();
  const items = await db
    .select()
    .from(receiptBatchItems)
    .where(eq(receiptBatchItems.batchId, batchId))
    .orderBy(asc(receiptBatchItems.createdAt));

  const blocking = items.filter((item) => !["ready", "deleted", "submitted"].includes(item.status));
  if (blocking.length > 0) {
    throw new Error("All yellow and red rows must be resolved before submission.");
  }

  await db.update(receiptBatches).set({ status: "submitting", updatedAt: new Date() }).where(eq(receiptBatches.batchId, batchId));

  const results: Array<{ itemId: string; transactId?: string; error?: string }> = [];
  for (const item of items) {
    if (item.status === "deleted" || item.status === "submitted") continue;

    try {
      const transaction = transactionInputSchema.parse((item.editedTransactionJson ?? item.proposedTransactionJson) as TransactionInput);
      const bytes = new Uint8Array(await fs.readFile(item.sourcePath));
      const upload = await uploadReceiptToR2({
        transactionId: transaction.transactId,
        fileName: item.sourceFileName,
        mimeType: item.mimeType,
        bytes,
      });
      const receiptRef = `/api/receipts/${upload.objectKey}`;

      const finalTransaction: TransactionInput = {
        ...transaction,
        receiptRef,
      };
      await createTransaction(finalTransaction);

      await db
        .update(receiptBatchItems)
        .set({
          status: "submitted",
          colorState: "green",
          finalTransactionJson: finalTransaction,
          postedTransactId: finalTransaction.transactId,
          postedReceiptRef: receiptRef,
          submittedAt: new Date(),
          updatedAt: new Date(),
          errorMessage: null,
        })
        .where(eq(receiptBatchItems.itemId, item.itemId));

      results.push({ itemId: item.itemId, transactId: finalTransaction.transactId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Submission failed";
      await db
        .update(receiptBatchItems)
        .set({
          status: "error",
          colorState: "red",
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(receiptBatchItems.itemId, item.itemId));
      results.push({ itemId: item.itemId, error: message });
    }
  }

  await recalculateBatchCounts(batchId);
  const remaining = await db
    .select({ status: receiptBatchItems.status })
    .from(receiptBatchItems)
    .where(eq(receiptBatchItems.batchId, batchId));
  if (remaining.every((item) => item.status === "submitted" || item.status === "deleted")) {
    await cleanupBatchTempFiles(batchId);
  }
  const summary = await getReceiptBatch(batchId);
  return { summary, results };
}

export async function getReceiptBatchItemFile(itemId: string) {
  const db = getDb();
  const [item] = await db
    .select({ sourcePath: receiptBatchItems.sourcePath, mimeType: receiptBatchItems.mimeType, sourceFileName: receiptBatchItems.sourceFileName })
    .from(receiptBatchItems)
    .where(eq(receiptBatchItems.itemId, itemId))
    .limit(1);

  if (!item) return null;
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(item.sourcePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  return {
    bytes,
    mimeType: item.mimeType,
    fileName: item.sourceFileName,
  };
}

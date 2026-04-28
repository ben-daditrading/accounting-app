import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// -- SUPPORTING LOOKUP TABLES --

export const accounts = pgTable(
  "accounts",
  {
    accountId: serial("account_id").primaryKey(),
    accountNumber: varchar("account_number", { length: 20 }).notNull(),
    accountName: varchar("account_name", { length: 100 }).notNull(),
    accountType: varchar("account_type", { length: 20 }).notNull(),
    currency: char("currency", { length: 3 }).default("CAD").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("accounts_account_number_unique_idx").on(table.accountNumber),
    check("accounts_account_type_check", sql`${table.accountType} IN ('asset','liability','equity','revenue','expense')`),
  ],
);

export const transactionTypes = pgTable(
  "transaction_types",
  {
    typeId: serial("type_id").primaryKey(),
    typeName: varchar("type_name", { length: 50 }).notNull(),
    description: text("description"),
  },
  (table) => [uniqueIndex("transaction_types_type_name_unique_idx").on(table.typeName)],
);

// -- TABLE 1: TRANSACTION HEADERS --

export const transactions = pgTable(
  "transactions",
  {
    transactId: varchar("transact_id", { length: 30 }).primaryKey(),
    transactDate: date("transact_date").notNull(),
    typeId: integer("type_id").references(() => transactionTypes.typeId),
    description: text("description").notNull(),
    totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull(),
    currency: char("currency", { length: 3 }).default("CAD").notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 10, scale: 6 }),
    receiptRef: varchar("receipt_ref", { length: 255 }),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_transactions_date").on(table.transactDate),
    index("idx_transactions_type").on(table.typeId),
    check("transactions_total_amount_check", sql`${table.totalAmount} >= 0`),
  ],
);

// -- TABLE 2: JOURNAL LINES --

export const journalLines = pgTable(
  "journal_lines",
  {
    lineId: serial("line_id").primaryKey(),
    transactId: varchar("transact_id", { length: 30 })
      .notNull()
      .references(() => transactions.transactId, { onDelete: "cascade" }),
    lineNumber: smallint("line_number").notNull(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.accountId),
    drCr: char("dr_cr", { length: 2 }).notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    currency: char("currency", { length: 3 }).default("CAD").notNull(),
    amountCad: numeric("amount_cad", { precision: 15, scale: 2 }),
    memo: text("memo"),
  },
  (table) => [
    index("idx_journal_lines_transact").on(table.transactId),
    index("idx_journal_lines_account").on(table.accountId),
    index("idx_journal_lines_dr_cr").on(table.drCr),
    uniqueIndex("journal_lines_transact_line_unique_idx").on(table.transactId, table.lineNumber),
    check("journal_lines_dr_cr_check", sql`${table.drCr} IN ('DR','CR')`),
    check("journal_lines_amount_check", sql`${table.amount} > 0`),
  ],
);

export const importsSchema = pgSchema("imports");

export const receiptBatches = importsSchema.table(
  "receipt_batches",
  {
    batchId: uuid("batch_id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    createdBy: varchar("created_by", { length: 255 }),
    sourceName: varchar("source_name", { length: 255 }),
    status: varchar("status", { length: 32 }).default("uploaded").notNull(),
    totalItems: integer("total_items").default(0).notNull(),
    processedItems: integer("processed_items").default(0).notNull(),
    readyItems: integer("ready_items").default(0).notNull(),
    needsReviewItems: integer("needs_review_items").default(0).notNull(),
    duplicateItems: integer("duplicate_items").default(0).notNull(),
    errorItems: integer("error_items").default(0).notNull(),
    deletedItems: integer("deleted_items").default(0).notNull(),
    submittedItems: integer("submitted_items").default(0).notNull(),
  },
  (table) => [
    index("receipt_batches_status_idx").on(table.status),
    index("receipt_batches_created_at_idx").on(table.createdAt),
  ],
);

export const receiptBatchItems = importsSchema.table(
  "receipt_batch_items",
  {
    itemId: uuid("item_id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => receiptBatches.batchId, { onDelete: "cascade" }),
    sourceFileName: varchar("source_file_name", { length: 255 }).notNull(),
    sourcePath: text("source_path").notNull(),
    mimeType: varchar("mime_type", { length: 120 }).notNull(),
    fileSize: integer("file_size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).default("queued").notNull(),
    colorState: varchar("color_state", { length: 16 }).default("yellow").notNull(),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 2 }).default("0.00").notNull(),
    confidenceReason: text("confidence_reason"),
    ocrProvider: varchar("ocr_provider", { length: 32 }),
    ocrModel: varchar("ocr_model", { length: 120 }),
    ocrRawText: text("ocr_raw_text"),
    ocrJson: jsonb("ocr_json"),
    duplicateMatchesJson: jsonb("duplicate_matches_json"),
    proposedTransactionJson: jsonb("proposed_transaction_json"),
    editedTransactionJson: jsonb("edited_transaction_json"),
    finalTransactionJson: jsonb("final_transaction_json"),
    warningsJson: jsonb("warnings_json"),
    errorMessage: text("error_message"),
    postedTransactId: varchar("posted_transact_id", { length: 30 }),
    postedReceiptRef: varchar("posted_receipt_ref", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
    submittedAt: timestamp("submitted_at"),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("receipt_batch_items_batch_id_idx").on(table.batchId),
    index("receipt_batch_items_status_idx").on(table.status),
    index("receipt_batch_items_sha256_idx").on(table.sha256),
  ],
);

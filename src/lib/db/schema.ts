import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionDate: date("transaction_date").notNull(),
    transactionType: varchar("transaction_type", { length: 120 }).notNull(),
    summaryAmount: numeric("summary_amount", { precision: 14, scale: 2 }),
    currencyCode: varchar("currency_code", { length: 3 }).default("CAD").notNull(),
    summaryDescription: text("summary_description"),
    receiptDate: date("receipt_date"),
    status: varchar("status", { length: 32 }).default("draft").notNull(),
    source: varchar("source", { length: 32 }).default("manual").notNull(),
    notes: text("notes"),
    legacyImportRef: text("legacy_import_ref"),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    ...timestamps,
  },
  (table) => [
    index("transactions_transaction_date_idx").on(table.transactionDate),
    index("transactions_transaction_type_idx").on(table.transactionType),
    index("transactions_status_idx").on(table.status),
  ],
);

export const transactionSourceLines = pgTable(
  "transaction_source_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").default(0).notNull(),
    lineDate: date("line_date"),
    lineType: varchar("line_type", { length: 120 }),
    lineAmount: numeric("line_amount", { precision: 14, scale: 2 }),
    currencyCode: varchar("currency_code", { length: 3 }),
    lineDescription: text("line_description"),
    rawAmountText: text("raw_amount_text"),
    rawTypeText: text("raw_type_text"),
    rawDescriptionText: text("raw_description_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("transaction_source_lines_transaction_id_idx").on(table.transactionId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 32 }),
    name: varchar("name", { length: 200 }).notNull(),
    accountClass: varchar("account_class", { length: 32 }),
    subtype: varchar("subtype", { length: 64 }),
    active: boolean("active").default(true).notNull(),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [uniqueIndex("accounts_name_unique_idx").on(table.name)],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").default(0).notNull(),
    side: varchar("side", { length: 2 }).notNull(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    rawAccountName: varchar("raw_account_name", { length: 200 }),
    amount: numeric("amount", { precision: 14, scale: 2 }),
    currencyCode: varchar("currency_code", { length: 3 }).default("CAD").notNull(),
    rawAmountText: text("raw_amount_text"),
    memo: text("memo"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("journal_entries_transaction_id_idx").on(table.transactionId),
    index("journal_entries_account_id_idx").on(table.accountId),
    index("journal_entries_side_idx").on(table.side),
  ],
);

export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    storageProvider: varchar("storage_provider", { length: 32 }).default("r2").notNull(),
    bucket: varchar("bucket", { length: 120 }).notNull(),
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: varchar("mime_type", { length: 120 }),
    fileSizeBytes: integer("file_size_bytes"),
    checksumSha256: text("checksum_sha256"),
    uploadedBy: text("uploaded_by"),
    ocrStatus: varchar("ocr_status", { length: 32 }).default("not_started").notNull(),
    ocrText: text("ocr_text"),
    ocrJson: jsonb("ocr_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("receipts_transaction_id_unique_idx").on(table.transactionId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    actor: text("actor"),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_entity_type_idx").on(table.entityType),
    index("audit_log_entity_id_idx").on(table.entityId),
  ],
);

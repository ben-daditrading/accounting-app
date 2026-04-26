import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
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
    receiptRef: varchar("receipt_ref", { length: 100 }),
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

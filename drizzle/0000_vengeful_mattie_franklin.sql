CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32),
	"name" varchar(200) NOT NULL,
	"account_class" varchar(32),
	"subtype" varchar(64),
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" varchar(32) NOT NULL,
	"actor" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"side" varchar(2) NOT NULL,
	"account_id" uuid,
	"raw_account_name" varchar(200),
	"amount" numeric(14, 2),
	"currency_code" varchar(3) DEFAULT 'CAD' NOT NULL,
	"raw_amount_text" text,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"storage_provider" varchar(32) DEFAULT 'r2' NOT NULL,
	"bucket" varchar(120) NOT NULL,
	"object_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" varchar(120),
	"file_size_bytes" integer,
	"checksum_sha256" text,
	"uploaded_by" text,
	"ocr_status" varchar(32) DEFAULT 'not_started' NOT NULL,
	"ocr_text" text,
	"ocr_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_source_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"line_date" date,
	"line_type" varchar(120),
	"line_amount" numeric(14, 2),
	"currency_code" varchar(3),
	"line_description" text,
	"raw_amount_text" text,
	"raw_type_text" text,
	"raw_description_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_date" date NOT NULL,
	"transaction_type" varchar(120) NOT NULL,
	"summary_amount" numeric(14, 2),
	"currency_code" varchar(3) DEFAULT 'CAD' NOT NULL,
	"summary_description" text,
	"receipt_date" date,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"source" varchar(32) DEFAULT 'manual' NOT NULL,
	"notes" text,
	"legacy_import_ref" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_source_lines" ADD CONSTRAINT "transaction_source_lines_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_name_unique_idx" ON "accounts" USING btree ("name");--> statement-breakpoint
CREATE INDEX "audit_log_entity_type_idx" ON "audit_log" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "audit_log_entity_id_idx" ON "audit_log" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "journal_entries_transaction_id_idx" ON "journal_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "journal_entries_account_id_idx" ON "journal_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "journal_entries_side_idx" ON "journal_entries" USING btree ("side");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_transaction_id_unique_idx" ON "receipts" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_source_lines_transaction_id_idx" ON "transaction_source_lines" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transactions_transaction_date_idx" ON "transactions" USING btree ("transaction_date");--> statement-breakpoint
CREATE INDEX "transactions_transaction_type_idx" ON "transactions" USING btree ("transaction_type");--> statement-breakpoint
CREATE INDEX "transactions_status_idx" ON "transactions" USING btree ("status");
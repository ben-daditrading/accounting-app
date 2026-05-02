CREATE TABLE "imports"."statement_batches" (
  "batch_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by" varchar(255),
  "source_name" varchar(255),
  "status" varchar(32) DEFAULT 'uploaded' NOT NULL,
  "statement_period_start" date,
  "statement_period_end" date,
  "statement_serial" varchar(64),
  "institution_name" varchar(255),
  "opening_balance" numeric(15, 2),
  "closing_balance" numeric(15, 2),
  "total_items" integer DEFAULT 0 NOT NULL,
  "processed_items" integer DEFAULT 0 NOT NULL,
  "ready_items" integer DEFAULT 0 NOT NULL,
  "needs_review_items" integer DEFAULT 0 NOT NULL,
  "duplicate_items" integer DEFAULT 0 NOT NULL,
  "error_items" integer DEFAULT 0 NOT NULL,
  "deleted_items" integer DEFAULT 0 NOT NULL,
  "submitted_items" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports"."statement_batch_items" (
  "item_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL,
  "source_file_name" varchar(255) NOT NULL,
  "source_path" text NOT NULL,
  "mime_type" varchar(120) NOT NULL,
  "file_size" integer NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "source_page" integer,
  "line_index" integer,
  "statement_date" date,
  "raw_description" text,
  "direction" varchar(16),
  "withdrawal_amount" numeric(15, 2),
  "deposit_amount" numeric(15, 2),
  "running_balance" numeric(15, 2),
  "account_serial" varchar(64),
  "source_fingerprint" varchar(128),
  "status" varchar(32) DEFAULT 'queued' NOT NULL,
  "color_state" varchar(16) DEFAULT 'yellow' NOT NULL,
  "confidence_score" numeric(4, 2) DEFAULT '0.00' NOT NULL,
  "confidence_reason" text,
  "parser_provider" varchar(32),
  "parser_model" varchar(120),
  "parser_raw_text" text,
  "parser_json" jsonb,
  "duplicate_matches_json" jsonb,
  "proposed_transaction_json" jsonb,
  "edited_transaction_json" jsonb,
  "final_transaction_json" jsonb,
  "warnings_json" jsonb,
  "error_message" text,
  "posted_transact_id" varchar(30),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "processed_at" timestamp,
  "submitted_at" timestamp,
  "deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "imports"."statement_batch_items" ADD CONSTRAINT "statement_batch_items_batch_id_statement_batches_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "imports"."statement_batches"("batch_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "statement_batches_status_idx" ON "imports"."statement_batches" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "statement_batches_created_at_idx" ON "imports"."statement_batches" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "statement_batch_items_batch_id_idx" ON "imports"."statement_batch_items" USING btree ("batch_id");
--> statement-breakpoint
CREATE INDEX "statement_batch_items_status_idx" ON "imports"."statement_batch_items" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "statement_batch_items_sha256_idx" ON "imports"."statement_batch_items" USING btree ("sha256");
--> statement-breakpoint
CREATE INDEX "statement_batch_items_fingerprint_idx" ON "imports"."statement_batch_items" USING btree ("source_fingerprint");

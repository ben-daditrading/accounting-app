CREATE SCHEMA "imports";
--> statement-breakpoint
CREATE TABLE "imports"."receipt_batch_items" (
	"item_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"source_file_name" varchar(255) NOT NULL,
	"source_path" text NOT NULL,
	"mime_type" varchar(120) NOT NULL,
	"file_size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"color_state" varchar(16) DEFAULT 'yellow' NOT NULL,
	"confidence_score" numeric(4, 2) DEFAULT '0.00' NOT NULL,
	"confidence_reason" text,
	"ocr_provider" varchar(32),
	"ocr_model" varchar(120),
	"ocr_raw_text" text,
	"ocr_json" jsonb,
	"duplicate_matches_json" jsonb,
	"proposed_transaction_json" jsonb,
	"edited_transaction_json" jsonb,
	"final_transaction_json" jsonb,
	"warnings_json" jsonb,
	"error_message" text,
	"posted_transact_id" varchar(30),
	"posted_receipt_ref" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"submitted_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "imports"."receipt_batches" (
	"batch_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(255),
	"source_name" varchar(255),
	"status" varchar(32) DEFAULT 'uploaded' NOT NULL,
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
ALTER TABLE "imports"."receipt_batch_items" ADD CONSTRAINT "receipt_batch_items_batch_id_receipt_batches_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "imports"."receipt_batches"("batch_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_batch_items_batch_id_idx" ON "imports"."receipt_batch_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "receipt_batch_items_status_idx" ON "imports"."receipt_batch_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "receipt_batch_items_sha256_idx" ON "imports"."receipt_batch_items" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "receipt_batches_status_idx" ON "imports"."receipt_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "receipt_batches_created_at_idx" ON "imports"."receipt_batches" USING btree ("created_at");
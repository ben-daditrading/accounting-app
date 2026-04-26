CREATE TABLE "accounts" (
	"account_id" serial PRIMARY KEY NOT NULL,
	"account_number" varchar(20) NOT NULL,
	"account_name" varchar(100) NOT NULL,
	"account_type" varchar(20) NOT NULL,
	"currency" char(3) DEFAULT 'CAD' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	CONSTRAINT "accounts_account_type_check" CHECK ("accounts"."account_type" IN ('asset','liability','equity','revenue','expense'))
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"line_id" serial PRIMARY KEY NOT NULL,
	"transact_id" varchar(30) NOT NULL,
	"line_number" smallint NOT NULL,
	"account_id" integer NOT NULL,
	"dr_cr" char(2) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"currency" char(3) DEFAULT 'CAD' NOT NULL,
	"amount_cad" numeric(15, 2),
	"memo" text,
	CONSTRAINT "journal_lines_dr_cr_check" CHECK ("journal_lines"."dr_cr" IN ('DR','CR')),
	CONSTRAINT "journal_lines_amount_check" CHECK ("journal_lines"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "transaction_types" (
	"type_id" serial PRIMARY KEY NOT NULL,
	"type_name" varchar(50) NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"transact_id" varchar(30) PRIMARY KEY NOT NULL,
	"transact_date" date NOT NULL,
	"type_id" integer,
	"description" text NOT NULL,
	"total_amount" numeric(15, 2) NOT NULL,
	"currency" char(3) DEFAULT 'CAD' NOT NULL,
	"exchange_rate" numeric(10, 6),
	"receipt_ref" varchar(100),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_total_amount_check" CHECK ("transactions"."total_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_transact_id_transactions_transact_id_fk" FOREIGN KEY ("transact_id") REFERENCES "public"."transactions"("transact_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_type_id_transaction_types_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."transaction_types"("type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_account_number_unique_idx" ON "accounts" USING btree ("account_number");--> statement-breakpoint
CREATE INDEX "idx_journal_lines_transact" ON "journal_lines" USING btree ("transact_id");--> statement-breakpoint
CREATE INDEX "idx_journal_lines_account" ON "journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_journal_lines_dr_cr" ON "journal_lines" USING btree ("dr_cr");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_lines_transact_line_unique_idx" ON "journal_lines" USING btree ("transact_id","line_number");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_types_type_name_unique_idx" ON "transaction_types" USING btree ("type_name");--> statement-breakpoint
CREATE INDEX "idx_transactions_date" ON "transactions" USING btree ("transact_date");--> statement-breakpoint
CREATE INDEX "idx_transactions_type" ON "transactions" USING btree ("type_id");
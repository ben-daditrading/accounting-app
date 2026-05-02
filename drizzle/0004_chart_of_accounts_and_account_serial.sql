ALTER TABLE "accounts" RENAME TO "chart_of_accounts";

ALTER INDEX "accounts_account_number_unique_idx" RENAME TO "chart_of_accounts_account_number_unique_idx";
ALTER TABLE "chart_of_accounts" RENAME CONSTRAINT "accounts_account_type_check" TO "chart_of_accounts_account_type_check";
ALTER TABLE "journal_lines" RENAME CONSTRAINT "journal_lines_account_id_accounts_account_id_fk" TO "journal_lines_account_id_chart_of_accounts_account_id_fk";

ALTER TABLE "chart_of_accounts"
  ADD COLUMN "internal_key" varchar(80),
  ADD COLUMN "account_description" text;

ALTER TABLE "journal_lines"
  ADD COLUMN "account_serial" varchar(64);

CREATE UNIQUE INDEX "chart_of_accounts_internal_key_unique_idx" ON "chart_of_accounts" USING btree ("internal_key");

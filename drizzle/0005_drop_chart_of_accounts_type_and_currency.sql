DROP INDEX IF EXISTS "chart_of_accounts_internal_key_unique_idx";

ALTER TABLE "chart_of_accounts"
  DROP CONSTRAINT IF EXISTS "chart_of_accounts_account_type_check",
  DROP COLUMN IF EXISTS "account_type",
  DROP COLUMN IF EXISTS "currency";

CREATE UNIQUE INDEX "chart_of_accounts_internal_key_unique_idx" ON "chart_of_accounts" USING btree ("internal_key");

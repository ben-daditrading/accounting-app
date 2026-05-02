ALTER TABLE "transactions"
  ADD COLUMN "statement_ref" varchar(255);

ALTER TABLE "imports"."statement_batch_items"
  ADD COLUMN "posted_statement_ref" varchar(255);

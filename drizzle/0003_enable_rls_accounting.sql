ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE imports.receipt_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE imports.receipt_batch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_accounts" ON public.accounts
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_all_transaction_types" ON public.transaction_types
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_all_transactions" ON public.transactions
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_all_journal_lines" ON public.journal_lines
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_all_receipt_batches" ON imports.receipt_batches
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_all_receipt_batch_items" ON imports.receipt_batch_items
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

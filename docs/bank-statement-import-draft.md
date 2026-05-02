# Bank Statement Import Draft

Status: Draft
Branch: `feature/bank-statement-import`

## Summary
Build a bank statement batch import flow for the accounting app that mirrors the existing batch receipt import workflow, but parses bank statements into individual transaction candidates. Imported statement transactions should go through review, validation, duplicate detection, and submission to the accounting database. Later receipt uploads should be able to upgrade matching statement-backed entries instead of creating duplicates.

## Important schema baseline
This draft assumes the current schema baseline is already in place:
- `accounts` has been renamed to `chart_of_accounts`
- `chart_of_accounts.account_number` means chart account number / GIFI code
- `chart_of_accounts.internal_key` exists for app-level lookup and classification anchors
- `chart_of_accounts.account_type` and `chart_of_accounts.currency` no longer exist as stored columns
- `journal_lines.account_serial` exists and represents the source financial instrument identifier for a line

Examples of `account_serial` usage:
- bank account serial from a bank statement, such as `46-30610`
- card last4 such as `3764`
- loan or institution account suffix when relevant

That means the bank statement importer should classify into chart accounts using GIFI codes or `internal_key` mappings, while separately preserving instrument identity in `journal_lines.account_serial`.

## Goals
- Upload monthly bank statements, individually or in bulk.
- Parse each bank statement into statement metadata plus one candidate row per bank transaction.
- Reuse the receipt batch style review and approval workflow.
- Detect duplicates against existing transactions and prior statement imports.
- Submit approved rows into the accounting database with source provenance.
- Allow future receipt uploads to replace or upgrade matching statement-imported transactions when details align.

## Example input
For the provided January 2025 CIBC statement, importable statement rows would likely include:
- Jan 6 service charge, monthly fee, 50.00 withdrawal
- Jan 6 service charge, outgoing wire fee, 15.00 withdrawal
- Jan 6 misc payment to CIBC card products division, 2,300.97 withdrawal
- Jan 21 cheque 110, 20,000.00 withdrawal
- Jan 29 cheque 111, 10,000.00 withdrawal
- Jan 30 misc payment CMSA, 531.49 withdrawal
- Jan 31 self serve fee, 20.00 withdrawal
- Jan 31 balance fee waiver, 20.00 deposit
- Jan 31 paper statement fee, 5.00 withdrawal

Opening and closing balances should be captured for validation and reconciliation, but should not themselves become imported transactions.

## Functional behavior

### Upload model
- User uploads one PDF per month, or a zip containing monthly statements.
- Each uploaded statement becomes a statement batch.
- Each extracted line item becomes a statement batch item for review.

### Review workflow
Reuse the receipt batch review pattern:
- batch list
- per-item statuses
- duplicate warnings
- editable proposed transactions
- manual approve / keep for review / delete
- submit only when all unresolved items are handled

Statement items should additionally show:
- statement date range
- matched source instrument serial
- raw statement description
- debit or credit direction
- running balance
- source page and line index
- linked existing transaction or receipt candidate when relevant

### Validation

#### Statement-level validation
- opening balance + deposits - withdrawals = closing balance
- no duplicate line extraction within the same statement
- statement period identified
- source instrument serial identified when present

#### Line-level validation
- valid transaction date
- exactly one direction, debit or credit
- description extracted
- amount parsed
- running balance parsed when available
- transaction date belongs to statement period unless explicitly justified by bank formatting

### Duplicate detection
Check against existing transactions by:
- same date
- same absolute amount
- same currency
- similar description
- same `journal_lines.account_serial` when available

Check against prior statement imports by:
- same source instrument serial
- same statement line fingerprint
- same statement period and line identity
- same running balance after transaction when available

Recommended fingerprint components:
- source instrument serial from the statement
- posted date
- normalized description
- debit or credit direction
- amount
- resulting balance when available

### Receipt upgrade behavior
If a statement-imported transaction later receives a matching receipt upload:
- do not create a second transaction
- upgrade the existing transaction from statement-backed to receipt-backed
- replace weaker statement metadata with richer receipt metadata where appropriate
- only upgrade when amounts and key details align closely enough

Suggested matching inputs for upgrade:
- same amount
- same currency
- same date or within a small tolerance window
- similar description or merchant
- same `account_serial` when available
- transaction currently sourced from statement import and not already receipt-backed

Suggested upgrade actions:
- attach receipt reference to the existing transaction
- replace description and notes if receipt data is better
- optionally replace journal classification if receipt-derived data is more trustworthy
- preserve provenance and audit history of original statement source

## Architecture recommendation
Do not refactor the existing receipt import flow first. Build a parallel statement import pipeline that reuses its UX and review concepts while allowing statement-specific parsing and matching rules.

### Recommended approach
Create statement-specific import tables and add provenance to transactions.

#### Option A, recommended
Add parallel tables such as:
- `imports.statement_batches`
- `imports.statement_batch_items`

Add provenance-oriented fields to transactions, for example:
- `sourceKind` such as `manual`, `receipt`, `statement`, `statement_upgraded_by_receipt`
- `sourceImportBatchId`
- `sourceImportItemId`
- `sourceFingerprint`
- `statementBatchItemId` or equivalent provenance pointer
- `statementPeriodStart`
- `statementPeriodEnd`

Important note after the schema changes:
- do not add bank-account-specific transaction columns if the same information can live naturally on journal lines or statement import tables
- prefer preserving source instrument identity through `journal_lines.account_serial`
- treat bank account numbers, card last4 values, and loan serials as the same family of source-instrument identifiers

Pros:
- safer and less disruptive to the existing receipt import flow
- easier incremental delivery
- allows receipt and statement workflows to diverge where needed

#### Option B
Generalize receipt batch tables into generic import tables.

Pros:
- cleaner long-term import architecture

Cons:
- larger upfront refactor
- higher risk to the already working receipt batch flow

Recommendation: use Option A first, then consider later unification.

## Extraction pipeline
The statement flow should:
1. upload PDF or zip contents
2. extract full text from each statement
3. parse statement metadata
   - source instrument serial
   - date range
   - opening balance
   - closing balance
4. parse transaction table rows
5. create one candidate transaction per statement line
6. classify and propose journal lines
7. assign `account_serial` on relevant journal lines
8. run duplicate detection
9. surface review items for approval

For the current sample, the parser should handle:
- transaction table rows
- multi-line descriptions
- separate withdrawals and deposits columns
- running balance column
- header and footer noise
- exclusion of opening and closing balance lines from item creation

## Journal generation guidance
Statement imports should use more conservative defaults than receipt OCR.

Examples:
- bank fees map to bank fee expense accounts
- cheque payments likely default to suspense or review-required classification
- card payments to known institutions may map to liability or clearing accounts
- deposits, waivers, and reversals may map to contra-expense, revenue, receivable clearing, or review-required categories depending on accounting policy

Recommendation:
- default ambiguous entries to `needs_review`
- use known keyword rules only where confidence is high
- prefer suspense or clearing over aggressive guessing
- anchor mappings through GIFI-coded chart accounts and `internal_key`, not pseudo account numbers

### Practical implication of removed chart columns
Because `chart_of_accounts.account_type` and `chart_of_accounts.currency` are no longer stored columns:
- importer logic should not expect chart rows to carry intrinsic currency metadata
- importer logic should not depend on persisted account-type labels for classification decisions
- any needed account grouping should be derived from GIFI number ranges, `internal_key`, or explicit statement-import mapping rules

That makes the statement importer more rule-driven and less dependent on stored chart metadata, which is acceptable but should be reflected in helper functions and classification logic.

## UX recommendations
Each statement review row should show:
- date
- raw bank description
- withdrawal
- deposit
- running balance
- detected source instrument serial
- proposed transaction type
- proposed description
- duplicate candidates
- potential linked receipt candidate where applicable

Each batch header should show:
- statement period
- source instrument serial
- opening balance
- closing balance
- reconciliation status

## Revised implementation impact from recent schema changes
The recent database schema refactor changes a few implementation details in the original draft:

### 1. `account_serial` should be first-class in the statement importer
This is the biggest change.

Originally the draft referred to bank account number matching somewhat loosely. Now it should be explicit:
- statement-derived source instrument identifiers belong in `journal_lines.account_serial`
- duplicate detection should use `account_serial` where available
- receipt-upgrade matching should use `account_serial` where available
- statement parsing should preserve account serials even when the chart classification remains uncertain

### 2. Statement classification should target chart accounts, not source instruments
The importer should never confuse:
- `chart_of_accounts.account_number` as GIFI / chart code
with
- statement account number or card serial

So classification should look like:
- identify source instrument serial from the statement
- map transaction meaning to a chart account using GIFI rules and `internal_key`
- store the source serial separately in `journal_lines.account_serial`

### 3. No reliance on stored account currency or account type
Any prior plan that assumed chart rows would directly tell the importer whether an account is asset/liability or CAD/USD should be revised.

Instead:
- transaction and line currency still come from statement extraction and transaction payloads
- chart classification should be based on explicit mapping rules, GIFI ranges, or `internal_key`
- if certain logic needs “bank account”, “card liability”, “suspense”, or “receivable clearing”, those should be identified by curated `internal_key` or deterministic account-number rule sets

### 4. The original draft’s provenance suggestion should lean toward import tables plus journal metadata
Instead of adding a transaction-level `bankAccountNumber` field, prefer:
- statement batch metadata for statement-level identity
- statement batch item metadata for row-level identity and fingerprinting
- `journal_lines.account_serial` for the specific instrument identity attached to posted journal lines

That model fits the current schema better.

## Phased implementation

### Phase 1, MVP
- add statement batch tables
- add statement upload page
- parse one bank format, CIBC PDF
- create one review row per statement line
- capture statement instrument serial and propagate it to proposed journal lines
- implement basic duplicate detection using amount/date/description and `account_serial` where available
- submit approved rows to transactions
- store transaction provenance as statement import

### Phase 2
- add stronger line fingerprinting and re-upload protection
- add batch-level reconciliation checks
- improve account mapping and journal template defaults
- support zip uploads containing multiple monthly statements

### Phase 3
- add receipt-to-statement upgrade logic
- when receipt upload matches a statement-backed transaction, update instead of insert
- store audit trail of source replacement

### Phase 4
- extend parser architecture for additional bank formats
- consider later unification of receipt and statement import infrastructure

## Open questions
These still need decisions before implementation:
1. Which chart accounts and `internal_key` values should statement imports use for default mappings?
2. Should cheque rows always require review and default to suspense or clearing?
3. Should rows like `CIBC CARD PRODUCTS DIVISION` map automatically to a credit card liability payment flow?
4. How strict should receipt-upgrade matching be?
5. Should statement PDFs be stored in R2 and linked similarly to receipts?
6. Do you want statement import helper rules to derive account groups purely from GIFI ranges, or do you want curated `internal_key` anchors for the important operational accounts?

## Current recommendation
Proceed with this as a parallel statement import system modeled on receipt batch import, but with the revised schema assumptions above:
- chart accounts are GIFI-coded classification targets
- source instrument identifiers belong in `journal_lines.account_serial`
- statement import logic should rely on explicit mapping rules and `internal_key`, not removed chart metadata columns

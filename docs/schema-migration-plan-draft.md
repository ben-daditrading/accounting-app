# Schema Migration and Adaptation Plan Draft

Status: Draft
Branch: `feature/bank-statement-import`

## Summary
Refactor the accounting app schema before building bank statement import. The existing `accounts` table should be renamed to `chart_of_accounts`, with `account_number` explicitly representing the chart account number or Canadian GIFI code. The `journal_lines` table should gain a nullable `account_serial` field used to store the real-world financial instrument identifier associated with a line, such as a bank account number, card last 4 digits, or loan/account suffix.

This change should be implemented first, then the existing app flows should be adapted to the new schema and semantics, and only then should bank statement import be built on top.

Because the app is still in development and all current data is disposable test data, migrations may prioritize correctness and simplicity over live data preservation.

## Updated business semantics

### Chart of accounts
The current `accounts` table is conceptually a chart of accounts table and should be renamed accordingly.

Under the revised model:
- `chart_of_accounts.account_number` = chart account number / GIFI code
- `chart_of_accounts.account_name` = human-readable account name
- `chart_of_accounts.account_description` = longer descriptive text from the source CSV
- `chart_of_accounts.account_type` = accounting class such as asset, liability, equity, revenue, expense

Examples:
- `1002` = Bank Account
- `8715` = Bank charges
- `8716` = Credit card charges

### Account serial
`journal_lines.account_serial` should represent the source financial instrument identifier tied to the line, not only a bank account number.

Examples:
- bank statement line for CIBC chequing account: `46-30610`
- credit card purchase or payment: `3764`
- loan-related line: institution loan suffix or account identifier
- other institution-linked transaction source: serial, suffix, or last4-like identifier

Under the revised model:
- `journal_lines.account_id` = accounting bucket from the chart of accounts
- `journal_lines.account_serial` = specific real-world financial instrument identifier associated with that line

This field should be nullable because many manual entries or non-instrument-specific journal lines will not have one.

## Target schema

### Rename table
Rename:
- `accounts` -> `chart_of_accounts`

### `chart_of_accounts` target shape
Required or recommended columns:
- `account_id` serial primary key
- `account_number` varchar, chart account number / GIFI code
- `account_name` varchar, display name
- `account_description` text, nullable
- `account_type` varchar, constrained to asset/liability/equity/revenue/expense
- `currency` char(3), default `CAD`
- `is_active` boolean, default true
- `notes` text, nullable

### Recommended additional column
To avoid overloading `account_number` for internal workflow lookups, add:
- `internal_key` varchar, nullable or unique

Purpose:
- stable app-level mapping key for import logic and heuristics
- prevents the app from abusing GIFI codes as internal implementation identifiers

Examples of `internal_key` values:
- `BANK_ACCOUNT_CAD`
- `IMPORT_SUSPENSE`
- `VISA_3764`
- `BANK_CHARGES`
- `MEALS_ENTERTAINMENT`

Recommendation:
- if automation or classification logic needs a stable non-GIFI lookup key, add this now rather than later

### `journal_lines` target shape updates
Keep all existing fields and add:
- `account_serial` varchar, nullable

Suggested meaning:
- stores a bank account number, card last4, loan suffix, or similar source-instrument serial when known

## Migration plan

### Strategy
Because current data is test-only, use a development-first migration strategy:
- favor clarity and correctness
- allow destructive reset or reseed if that simplifies the migration
- do not over-engineer data preservation logic

### Schema migration tasks
1. Rename table `accounts` to `chart_of_accounts`
2. Rename related indexes and foreign key references if needed
3. Update `journal_lines.account_id` foreign key to reference `chart_of_accounts.account_id`
4. Add `chart_of_accounts.account_description`
5. Optionally add `chart_of_accounts.internal_key`
6. Add `journal_lines.account_serial`
7. Regenerate Drizzle schema snapshots and migration metadata

### Seed or import tasks
1. Import the provided CSV into `chart_of_accounts`
2. Populate:
   - `account_number`
   - `account_name`
   - `account_description`
3. Decide how to handle rows with blank names in the CSV
4. Seed any internal lookup keys if `internal_key` is added
5. Rebuild local test data as needed after schema reset

## Adaptation plan across the app

### 1. Database schema code
Update `src/lib/db/schema.ts` to:
- rename table definition from `accounts` to `chartOfAccounts`
- rename the underlying SQL table to `chart_of_accounts`
- add `accountDescription`
- optionally add `internalKey`
- add `accountSerial` to `journal_lines`
- update foreign key references

### 2. Server-side transaction queries
Update `src/lib/server/transactions.ts` to:
- query from `chart_of_accounts` instead of `accounts`
- continue returning account dropdown data to the UI
- include `accountSerial` in transaction creation and retrieval logic where appropriate
- ensure transaction line views expose the new field when useful

### 3. Validation layer
Update `src/lib/validation/transaction.ts` so each journal line can optionally include:
- `accountSerial?: string`

Keep this optional.

### 4. Transaction entry form
Update `src/components/transaction-entry-form.tsx` to:
- continue using chart of accounts for account selection
- display GIFI-based account numbers in dropdowns
- optionally support `accountSerial` input, though it may stay hidden in the normal manual flow at first

Recommendation:
- do not force manual users to fill `accountSerial`
- reserve it primarily for import-driven or instrument-aware transactions

### 5. Receipt batch import
Update `src/components/batch-receipt-import.tsx` and `src/lib/server/receipt-batches.ts` to:
- use chart of accounts naming and lookups
- support `accountSerial` in generated or edited journal lines when OCR finds card last4 or similar identifiers
- stop treating account numbers as generic internal labels if they now strictly represent GIFI codes

### 6. API layer
Review and adapt endpoints such as:
- `/api/accounts`
- transaction create/list endpoints
- receipt batch endpoints

The API route name can remain `/api/accounts` temporarily for UI stability, even if the underlying table is now `chart_of_accounts`.

Recommendation:
- defer API renaming unless there is a strong reason to change it now
- prioritize internal semantic correctness first

### 7. Transaction views and export
Update transaction display and export code so it can surface:
- chart account names as before
- optionally `accountSerial` when useful for debugging, matching, or future bank statement workflows

### 8. Legacy scripts
Review legacy scripts that currently insert or query `accounts` and use synthetic account numbers.

Likely impact:
- some scripts will need updates to use `chart_of_accounts`
- any script that assumes `account_number` is a custom internal label must be refactored
- some legacy scripts may be obsolete and can be retired instead of updated

## Risks and semantic issues to resolve

### Risk: overloading GIFI account numbers
Some previous logic appears to use `account_number` as an app-defined identifier, for example operational labels or pseudo-account numbers.

That model no longer fits well if `account_number` is now strictly a chart account number or GIFI code.

### Recommendation
If app logic needs stable internal mapping identifiers, add `internal_key` now.

Without `internal_key`, the app may end up relying on brittle account names or misusing GIFI codes for implementation details.

## Recommended migration sequence
1. Finalize target schema
2. Implement schema migration
3. Import or seed `chart_of_accounts` from the CSV
4. Refactor current app code to new schema names and meanings
5. Verify manual transaction entry still works
6. Verify receipt batch import still works
7. Then design and build bank statement import on top of the cleaned-up schema

## Relation to bank statement import
This schema refactor is a prerequisite for bank statement import.

Why:
- statement lines need a place to store source financial instrument identifiers
- chart account semantics must be distinct from bank/card/loan serials
- receipt imports and future statement imports both benefit from the same `account_serial` field
- import classification logic should target chart accounts, not raw institution account numbers

## Current recommendation
Proceed with a schema-first refactor using this model:
- rename `accounts` to `chart_of_accounts`
- preserve `account_number` as the chart/GIFI code
- add `account_description`
- add nullable `journal_lines.account_serial`
- strongly consider adding `chart_of_accounts.internal_key`

After that, adapt existing receipt and transaction flows before implementing bank statement import.

# Dadi Accounting Prototype

Private internal accounting app prototype for replacing the current spreadsheet with a proper relational workflow.

## Current Stack
- Next.js
- TypeScript
- Tailwind CSS
- Drizzle ORM
- Supabase Postgres (planned target)
- Cloudflare R2 (planned receipt storage)
- Docker + Cloudflare Tunnel (planned deployment)
- Supabase Auth for internal email/password access

## Conceptual Model
The current spreadsheet maps to these core concepts:
- `transactions`
- `transaction_source_lines`
- `journal_entries`
- `accounts`
- `receipts`
- `audit_log`

## Why `transaction_source_lines` exists
The source spreadsheet is not always one clean A-D row per logical transaction. Some transactions span multiple left-side rows before the journal side balances out. This helper table preserves that without polluting the journal entry structure.

## Scripts
```bash
npm run dev
npm run lint
npm run db:generate
npm run db:push
npm run db:studio
```

## Environment
Copy `.env.example` to `.env.local` and fill in the values.

## Current Status
- app scaffolded
- initial schema codified in `src/lib/db/schema.ts`
- transaction entry form posts to `/api/transactions` when `DATABASE_URL` is configured
- transaction list page can read live rows when `DATABASE_URL` is configured
- login page and Supabase session middleware are scaffolded
- receipt upload route to Cloudflare R2 is scaffolded
- deployment not wired yet

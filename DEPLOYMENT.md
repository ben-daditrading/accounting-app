# Deployment Plan

## Recommended Production Shape
- Run the Next.js app in Docker on a host you control.
- Keep the host closed to direct public inbound traffic.
- Publish the app through Cloudflare Tunnel.
- Point `accounting.daditrading.com` at that tunnel.
- Use Supabase Auth for simple in-app email/password login.
- Use Supabase Postgres for the database.
- Use Cloudflare R2 for receipt storage.
- Keep Cloudflare Access optional for later extra hardening rather than the main login path.

## Why this shape
- avoids exposing raw ports publicly
- gives the team a familiar email/password login inside the app
- reduces database ops burden compared with self-hosting Postgres
- keeps receipts in object storage instead of the database
- still leaves room to add Cloudflare Access later if needed

## Container
Build locally:
```bash
npm run build
docker build -t accounting-app .
```

Run locally:
```bash
docker run --rm -p 3000:3000 --env-file .env.local accounting-app
```

## Remaining deployment work
- create Supabase project
- apply Drizzle migrations
- create R2 bucket
- wire file upload route
- create Cloudflare Tunnel
- point `accounting.daditrading.com` to the tunnel
- create Supabase Auth users for the internal team
- set environment variables on the host

## Notes
For this app, Cloudflare Tunnel is preferred over opening host ports directly to the internet.

### 2026-04-30 RLS hardening note
- RLS was enabled on the accounting tables directly in Postgres using the SQL in `drizzle/0003_enable_rls_accounting.sql`.
- `drizzle-kit push` failed during schema introspection on the existing database, so the database change was applied manually rather than through Drizzle's normal push flow.
- Before relying on `npm run db:push` for future production changes, first resolve the Drizzle introspection failure or apply migrations through a reviewed manual SQL path.

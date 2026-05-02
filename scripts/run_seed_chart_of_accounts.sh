#!/usr/bin/env bash
set -euo pipefail
cd /root/.openclaw/workspace/accounting-app
set -a
source .env
set +a
node scripts/seed_chart_of_accounts.mjs /root/.openclaw/media/inbound/a57d1832-2fbc-489a-b486-b8e03ed4aaf9.csv

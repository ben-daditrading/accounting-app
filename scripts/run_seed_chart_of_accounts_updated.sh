#!/usr/bin/env bash
set -euo pipefail
cd /root/.openclaw/workspace/accounting-app
set -a
source .env
set +a
node scripts/seed_chart_of_accounts.mjs /root/.openclaw/media/inbound/1639df19-f06a-44f2-9784-3db42102a143.csv

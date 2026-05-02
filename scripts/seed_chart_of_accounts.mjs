import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }

  return rows;
}

function inferInternalKey(accountNumber, accountName) {
  const name = (accountName || "").trim().toUpperCase();
  if (accountNumber === "1002") return "BANK_ACCOUNT_CAD";
  if (accountNumber === "8715") return "BANK_CHARGES";
  if (accountNumber === "8716") return "CREDIT_CARD_CHARGES";
  if (name === "SALES REVENUE") return "SALES_REVENUE";
  return null;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  const csvPath = process.argv[2];
  if (!csvPath) throw new Error("Usage: node scripts/seed_chart_of_accounts.mjs <csv-path>");

  const text = fs.readFileSync(path.resolve(csvPath), "utf8").replace(/^\uFEFF/, "");
  const rows = parseCsv(text);
  const [header, ...data] = rows;
  if (!header || header.length < 3) throw new Error("CSV header not recognized");

  const sql = postgres(databaseUrl, { prepare: false });
  try {
    await sql.begin(async (tx) => {
      await tx`truncate table journal_lines restart identity cascade`;
      await tx`truncate table transactions restart identity cascade`;
      await tx`truncate table chart_of_accounts restart identity cascade`;

      const normalizedRows = new Map();
      for (const [index, cols] of data.entries()) {
        const [rawNumber = "", rawName = "", rawDescription = ""] = cols;
        const accountNumber = rawNumber.trim();
        const accountName = rawName.trim() || (accountNumber ? `GIFI ${accountNumber}` : rawDescription.trim().split(/\n+/)[0].trim() || "Unnamed account");
        const accountDescription = rawDescription.trim() || null;
        const internalKey = inferInternalKey(accountNumber, accountName);
        const fallbackNumber = `UNNUM-${String(index + 1).padStart(3, "0")}`;
        const resolvedAccountNumber = accountNumber || fallbackNumber;

        normalizedRows.set(resolvedAccountNumber, {
          accountNumber: resolvedAccountNumber,
          internalKey,
          accountName,
          accountDescription,
        });
      }

      for (const row of normalizedRows.values()) {
        await tx`
          insert into chart_of_accounts (
            account_number,
            internal_key,
            account_name,
            account_description,
            is_active,
            notes
          ) values (
            ${row.accountNumber},
            ${row.internalKey},
            ${row.accountName},
            ${row.accountDescription},
            true,
            null
          )
        `;
      }
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

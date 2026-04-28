import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getAuthorizedUser } from "@/lib/auth/access";
import { listTransactions } from "@/lib/server/transactions";
import {
  filterTransactions,
  normalizeSortDirection,
  normalizeTransactionSort,
  sortTransactions,
} from "@/lib/transactions-view";

export async function GET(request: Request) {
  try {
    const { user, allowed } = await getAuthorizedUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (!allowed) {
      return NextResponse.json({ error: "Only @daditrading.com accounts can access this app" }, { status: 403 });
    }

    const url = new URL(request.url);
    const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
    const search = url.searchParams.get("search") ?? "";
    const sort = normalizeTransactionSort(url.searchParams.get("sort") ?? undefined);
    const direction = normalizeSortDirection(url.searchParams.get("direction") ?? undefined);

    const result = await listTransactions();
    if (result.mode !== "database") {
      return NextResponse.json({ error: "Database not connected." }, { status: 503 });
    }

    const rows: ExportRow[] = [];
    for (const tx of sortTransactions(filterTransactions(result.items, search), sort, direction)) {
      if (tx.lines.length === 0) {
        rows.push({
          transactionId: tx.transactId,
          transactionDate: tx.transactDate,
          type: tx.typeName ?? "",
          description: tx.description,
          totalAmount: numericOrRaw(tx.totalAmount),
          transactionCurrency: tx.currency,
          createdAt: tx.createdAt ?? "",
          updatedAt: tx.updatedAt ?? "",
          receiptRef: tx.receiptRef ?? "",
          lineNumber: "",
          lineType: "",
          account: "",
          lineAmount: "",
          lineCurrency: "",
          lineMemo: "",
        });
        continue;
      }

      for (const line of tx.lines) {
        rows.push({
          transactionId: tx.transactId,
          transactionDate: tx.transactDate,
          type: tx.typeName ?? "",
          description: tx.description,
          totalAmount: numericOrRaw(tx.totalAmount),
          transactionCurrency: tx.currency,
          createdAt: tx.createdAt ?? "",
          updatedAt: tx.updatedAt ?? "",
          receiptRef: tx.receiptRef ?? "",
          lineNumber: line.lineNumber,
          lineType: line.drCr,
          account: line.accountName ?? "",
          lineAmount: numericOrRaw(line.amount),
          lineCurrency: line.currency,
          lineMemo: line.memo ?? "",
        });
      }
    }

    const filename = `transactions-export-${new Date().toISOString().slice(0, 10)}.${format}`;

    if (format === "xlsx") {
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Transactions");
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(worksheet);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Failed to export transactions", error);
    return NextResponse.json({ error: "Failed to export transactions" }, { status: 500 });
  }
}

type ExportRow = {
  transactionId: string;
  transactionDate: string;
  type: string;
  description: string;
  totalAmount: string | number;
  transactionCurrency: string;
  createdAt: string;
  updatedAt: string;
  receiptRef: string;
  lineNumber: string | number;
  lineType: string;
  account: string;
  lineAmount: string | number;
  lineCurrency: string;
  lineMemo: string;
};

function numericOrRaw(value: string | null) {
  if (value == null) return "";
  const parsed = Number(value);
  return Number.isNaN(parsed) ? value : parsed;
}

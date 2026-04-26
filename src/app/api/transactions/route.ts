import { NextResponse } from "next/server";

import { getAuthorizedUser } from "@/lib/auth/access";
import { createTransaction, listTransactions } from "@/lib/server/transactions";
import { transactionInputSchema } from "@/lib/validation/transaction";

export async function GET() {
  try {
    const { user, allowed } = await getAuthorizedUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (!allowed) {
      return NextResponse.json({ error: "Only @daditrading.com accounts can access this app" }, { status: 403 });
    }

    const result = await listTransactions();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to list transactions", error);
    return NextResponse.json({ error: "Failed to list transactions" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { user, allowed } = await getAuthorizedUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (!allowed) {
      return NextResponse.json({ error: "Only @daditrading.com accounts can access this app" }, { status: 403 });
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: "DATABASE_URL is not configured yet." },
        { status: 503 },
      );
    }

    const payload = await request.json();
    const parsed = transactionInputSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          issues: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const result = await createTransaction(parsed.data, user.email ?? "system");
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Failed to create transaction", error);
    return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
  }
}

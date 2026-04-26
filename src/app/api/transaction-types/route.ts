import { NextResponse } from "next/server";

import { getAuthorizedUser } from "@/lib/auth/access";
import { listTransactionTypes } from "@/lib/server/transactions";

export async function GET() {
  try {
    const { user, allowed } = await getAuthorizedUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (!allowed) {
      return NextResponse.json({ error: "Only @daditrading.com accounts can access this app" }, { status: 403 });
    }

    const types = await listTransactionTypes();
    return NextResponse.json(types);
  } catch (error) {
    console.error("Failed to list transaction types", error);
    return NextResponse.json({ error: "Failed to list transaction types" }, { status: 500 });
  }
}

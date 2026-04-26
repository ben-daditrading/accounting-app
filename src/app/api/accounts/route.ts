import { NextResponse } from "next/server";

import { getAuthorizedUser } from "@/lib/auth/access";
import { listAccounts } from "@/lib/server/transactions";

export async function GET() {
  try {
    const { user, allowed } = await getAuthorizedUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (!allowed) {
      return NextResponse.json({ error: "Only @daditrading.com accounts can access this app" }, { status: 403 });
    }

    const accounts = await listAccounts();
    return NextResponse.json(accounts);
  } catch (error) {
    console.error("Failed to list accounts", error);
    return NextResponse.json({ error: "Failed to list accounts" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { getAuthorizedUser } from "@/lib/auth/access";
import { submitStatementBatch } from "@/lib/server/statement-batches";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { user, allowed } = await getAuthorizedUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!allowed) return NextResponse.json({ error: "Only @daditrading.com accounts can access this app" }, { status: 403 });

    const { batchId } = await params;
    const result = await submitStatementBatch(batchId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to submit statement batch", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to submit statement batch" }, { status: 500 });
  }
}

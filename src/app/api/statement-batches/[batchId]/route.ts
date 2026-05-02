import { NextResponse } from "next/server";

import { getAuthorizedUser } from "@/lib/auth/access";
import { getStatementBatch } from "@/lib/server/statement-batches";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { user, allowed } = await getAuthorizedUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!allowed) return NextResponse.json({ error: "Only @daditrading.com accounts can access this app" }, { status: 403 });

    const { batchId } = await params;
    const batch = await getStatementBatch(batchId);
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    return NextResponse.json(batch);
  } catch (error) {
    console.error("Failed to fetch statement batch", error);
    return NextResponse.json({ error: "Failed to fetch statement batch" }, { status: 500 });
  }
}

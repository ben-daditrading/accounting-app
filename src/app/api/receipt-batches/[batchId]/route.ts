import { NextResponse } from "next/server";

import { getAuthorizedUser } from "@/lib/auth/access";
import { getReceiptBatch } from "@/lib/server/receipt-batches";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { user, allowed } = await getAuthorizedUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!allowed) return NextResponse.json({ error: "Only @daditrading.com accounts can access this app" }, { status: 403 });

    const { batchId } = await params;
    const batch = await getReceiptBatch(batchId);
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    return NextResponse.json(batch);
  } catch (error) {
    console.error("Failed to fetch receipt batch", error);
    return NextResponse.json({ error: "Failed to fetch receipt batch" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { getAuthorizedUser } from "@/lib/auth/access";
import { listReceiptBatchItems } from "@/lib/server/receipt-batches";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { user, allowed } = await getAuthorizedUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!allowed) return NextResponse.json({ error: "Only @daditrading.com accounts can access this app" }, { status: 403 });

    const { batchId } = await params;
    const items = await listReceiptBatchItems(batchId);
    return NextResponse.json(items);
  } catch (error) {
    console.error("Failed to list receipt batch items", error);
    return NextResponse.json({ error: "Failed to list receipt batch items" }, { status: 500 });
  }
}

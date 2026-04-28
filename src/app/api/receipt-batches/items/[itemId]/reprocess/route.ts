import { NextResponse } from "next/server";

import { getAuthorizedUser } from "@/lib/auth/access";
import { reprocessReceiptBatchItem } from "@/lib/server/receipt-batches";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const { user, allowed } = await getAuthorizedUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!allowed) return NextResponse.json({ error: "Only @daditrading.com accounts can access this app" }, { status: 403 });

    const { itemId } = await params;
    const item = await reprocessReceiptBatchItem(itemId);
    return NextResponse.json(item);
  } catch (error) {
    console.error("Failed to reprocess receipt batch item", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reprocess receipt batch item" },
      { status: 500 },
    );
  }
}

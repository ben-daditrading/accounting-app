import { NextResponse } from "next/server";

import { getAuthorizedUser } from "@/lib/auth/access";
import { startBatchProcessing } from "@/lib/server/receipt-batches";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { user, allowed } = await getAuthorizedUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!allowed) return NextResponse.json({ error: "Only @daditrading.com accounts can access this app" }, { status: 403 });

    const { batchId } = await params;
    startBatchProcessing(batchId);
    return NextResponse.json({ ok: true, status: "processing" });
  } catch (error) {
    console.error("Failed to start receipt batch processing", error);
    return NextResponse.json({ error: "Failed to start receipt batch processing" }, { status: 500 });
  }
}

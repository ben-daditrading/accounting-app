import { NextResponse } from "next/server";

import { getAuthorizedUser } from "@/lib/auth/access";
import { getReceiptBatchItemFile } from "@/lib/server/receipt-batches";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const { user, allowed } = await getAuthorizedUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!allowed) return NextResponse.json({ error: "Only @daditrading.com accounts can access this app" }, { status: 403 });

    const { itemId } = await params;
    const file = await getReceiptBatchItemFile(itemId);
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `inline; filename="${file.fileName.replace(/\"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Failed to fetch receipt batch file", error);
    return NextResponse.json({ error: "Failed to fetch receipt batch file" }, { status: 500 });
  }
}

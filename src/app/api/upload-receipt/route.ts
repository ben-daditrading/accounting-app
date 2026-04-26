import { NextResponse } from "next/server";

import { getAuthorizedUser } from "@/lib/auth/access";
import { isR2Configured, uploadReceiptToR2 } from "@/lib/r2/server";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(request: Request) {
  try {
    const { user, allowed } = await getAuthorizedUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (!allowed) {
      return NextResponse.json({ error: "Only @daditrading.com accounts can access this app" }, { status: 403 });
    }

    if (!isR2Configured()) {
      return NextResponse.json({ error: "R2 storage is not configured" }, { status: 503 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const transactionId = (formData.get("transactionId") as string) || "draft";

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    const result = await uploadReceiptToR2({
      transactionId,
      fileName: file.name,
      mimeType: file.type,
      bytes,
    });

    return NextResponse.json({
      objectKey: result.objectKey,
      fileName: file.name,
      url: `/api/receipts/${result.objectKey}`,
    });
  } catch (error) {
    console.error("Failed to upload receipt", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

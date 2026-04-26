import { NextResponse } from "next/server";

import { getAuthorizedUser } from "@/lib/auth/access";
import { uploadReceiptToR2, isR2Configured } from "@/lib/r2/server";
import { attachReceiptToTransaction } from "@/lib/server/transactions";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user, allowed } = await getAuthorizedUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (!allowed) {
      return NextResponse.json({ error: "Only @daditrading.com accounts can access this app" }, { status: 403 });
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: "DATABASE_URL is not configured yet." }, { status: 503 });
    }

    if (!isR2Configured()) {
      return NextResponse.json({ error: "R2 is not configured yet." }, { status: 503 });
    }

    const formData = await request.formData();
    const file = formData.get("receipt");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Receipt file is required." }, { status: 400 });
    }

    const { id: transactionId } = await context.params;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const upload = await uploadReceiptToR2({
      transactionId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes,
    });

    await attachReceiptToTransaction(
      {
        transactionId,
        bucket: upload.bucket,
        objectKey: upload.objectKey,
        fileName: file.name,
        mimeType: file.type,
        fileSizeBytes: file.size,
        checksumSha256: upload.checksumSha256,
      },
      user.email ?? "system",
    );

    return NextResponse.json({
      ok: true,
      publicUrl: upload.publicUrl,
      objectKey: upload.objectKey,
    });
  } catch (error) {
    console.error("Failed to upload receipt", error);
    return NextResponse.json({ error: "Failed to upload receipt" }, { status: 500 });
  }
}

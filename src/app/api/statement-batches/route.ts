import { NextResponse } from "next/server";

import { getAuthorizedUser } from "@/lib/auth/access";
import { createStatementBatch, listStatementBatches } from "@/lib/server/statement-batches";

export async function GET() {
  try {
    const { user, allowed } = await getAuthorizedUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!allowed) return NextResponse.json({ error: "Only @daditrading.com accounts can access this app" }, { status: 403 });

    const batches = await listStatementBatches();
    return NextResponse.json(batches);
  } catch (error) {
    console.error("Failed to list statement batches", error);
    return NextResponse.json({ error: "Failed to list statement batches" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { user, allowed } = await getAuthorizedUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!allowed) return NextResponse.json({ error: "Only @daditrading.com accounts can access this app" }, { status: 403 });

    const formData = await request.formData();
    const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    if (files.length === 0) return NextResponse.json({ error: "No files were uploaded" }, { status: 400 });

    const uploads = await Promise.all(files.map(async (file) => ({
      name: file.name,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })));

    const batch = await createStatementBatch({ files: uploads, createdBy: user.email ?? null });
    return NextResponse.json(batch, { status: 201 });
  } catch (error) {
    console.error("Failed to create statement batch", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create statement batch" }, { status: 500 });
  }
}

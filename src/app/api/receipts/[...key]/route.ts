import { NextResponse } from "next/server";

import { getAuthorizedUser } from "@/lib/auth/access";
import { isR2Configured, getReceiptFromR2 } from "@/lib/r2/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  try {
    const { user, allowed } = await getAuthorizedUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!isR2Configured()) {
      return NextResponse.json({ error: "R2 storage is not configured" }, { status: 503 });
    }

    const { key } = await params;
    const objectKey = key.join("/");

    const { body, contentType, contentLength } = await getReceiptFromR2(objectKey);

    if (!body) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Convert the readable stream to a web ReadableStream
    const webStream = body.transformToWebStream();

    return new Response(webStream, {
      headers: {
        "Content-Type": contentType,
        ...(contentLength ? { "Content-Length": String(contentLength) } : {}),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : "";
    if (name === "NoSuchKey") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    console.error("Failed to fetch receipt", error);
    return NextResponse.json({ error: "Failed to fetch file" }, { status: 500 });
  }
}

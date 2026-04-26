import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

export function isR2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

function getClient() {
  const accountId = getRequiredEnv("R2_ACCOUNT_ID");
  const accessKeyId = getRequiredEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = getRequiredEnv("R2_SECRET_ACCESS_KEY");

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

export async function uploadReceiptToR2(params: {
  transactionId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}) {
  const bucket = getRequiredEnv("R2_BUCKET");
  const client = getClient();
  const safeName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
  const objectKey = `receipts/${params.transactionId}/${Date.now()}-${safeName}`;
  const checksumSha256 = createHash("sha256").update(params.bytes).digest("hex");

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: params.bytes,
      ContentType: params.mimeType || "application/octet-stream",
    }),
  );

  return {
    bucket,
    objectKey,
    checksumSha256,
    publicUrl: process.env.R2_PUBLIC_BASE_URL
      ? `${process.env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${objectKey}`
      : null,
  };
}

export async function getReceiptFromR2(objectKey: string) {
  const bucket = getRequiredEnv("R2_BUCKET");
  const client = getClient();

  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    }),
  );

  return {
    body: response.Body,
    contentType: response.ContentType ?? "application/octet-stream",
    contentLength: response.ContentLength,
  };
}

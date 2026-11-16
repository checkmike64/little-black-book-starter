import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
  );
}

export function verifyFirefliesWebhook({
  rawBody,
  signature,
  secret,
}: {
  rawBody: string;
  signature: string | null;
  secret: string;
}) {
  if (!signature || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex")}`;
  return safeEqual(expected, signature);
}

export function verifyFathomWebhook({
  rawBody,
  webhookId,
  timestamp,
  signature,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000),
}: {
  rawBody: string;
  webhookId: string | null;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  nowSeconds?: number;
}) {
  if (!webhookId || !timestamp || !signature || !secret.startsWith("whsec_")) {
    return false;
  }
  const timestampNumber = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampNumber) || Math.abs(nowSeconds - timestampNumber) > 300) {
    return false;
  }
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(secret.slice("whsec_".length), "base64");
  } catch {
    return false;
  }
  if (secretBytes.length === 0) return false;
  const expected = createHmac("sha256", secretBytes)
    .update(`${webhookId}.${timestamp}.${rawBody}`, "utf8")
    .digest("base64");
  return signature.split(" ").some((candidate) => {
    const parts = candidate.split(",");
    return safeEqual(expected, parts.length > 1 ? parts[1] : parts[0]);
  });
}

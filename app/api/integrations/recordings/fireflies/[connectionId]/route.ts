import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  recordingConnectionSecret,
  recordWebhookReceipt,
} from "@/lib/integrations/recordings/ingest";
import { verifyFirefliesWebhook } from "@/lib/integrations/recordings/webhook-verification";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 1_000_000) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > 1_000_000) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  let resolved;
  try {
    resolved = await recordingConnectionSecret(connectionId);
  } catch {
    return NextResponse.json({ error: "Webhook intake is unavailable." }, { status: 503 });
  }
  if (!resolved || resolved.connection.provider !== "fireflies") {
    return new NextResponse(null, { status: 202 });
  }
  if (
    !resolved.connection.webhook_secret ||
    !verifyFirefliesWebhook({
      rawBody,
      signature: request.headers.get("x-hub-signature"),
      secret: resolved.connection.webhook_secret,
    })
  ) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }
  let payload: { event?: string; timestamp?: number; meeting_id?: string };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }
  if (
    !payload.meeting_id ||
    !payload.timestamp ||
    !["meeting.transcribed", "meeting.summarized"].includes(payload.event ?? "")
  ) {
    return NextResponse.json({ error: "Unsupported webhook event." }, { status: 400 });
  }
  const receipt = await recordWebhookReceipt({
    admin: resolved.admin,
    connection: resolved.connection,
    externalEventId: `fireflies:${payload.event}:${payload.meeting_id}:${payload.timestamp}`,
    externalArtifactId: payload.meeting_id,
    eventType: payload.event ?? "unknown",
    payloadSha256: createHash("sha256").update(rawBody).digest("hex"),
  });
  return NextResponse.json({ accepted: true, duplicate: receipt.duplicate }, { status: 202 });
}

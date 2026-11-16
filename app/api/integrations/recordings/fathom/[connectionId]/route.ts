import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { normalizeFathomRecordingId } from "@/lib/integrations/recordings/fathom";
import {
  recordingConnectionSecret,
  recordWebhookReceipt,
} from "@/lib/integrations/recordings/ingest";
import { verifyFathomWebhook } from "@/lib/integrations/recordings/webhook-verification";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 4_000_000) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > 4_000_000) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  let resolved;
  try {
    resolved = await recordingConnectionSecret(connectionId);
  } catch {
    return NextResponse.json({ error: "Webhook intake is unavailable." }, { status: 503 });
  }
  if (!resolved || resolved.connection.provider !== "fathom") {
    return new NextResponse(null, { status: 202 });
  }
  const webhookId = request.headers.get("webhook-id");
  if (
    !resolved.connection.webhook_secret ||
    !verifyFathomWebhook({
      rawBody,
      webhookId,
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
      secret: resolved.connection.webhook_secret,
    })
  ) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }
  const recordingId = normalizeFathomRecordingId(payload.recording_id);
  if (!recordingId) {
    return NextResponse.json({ error: "Invalid meeting artifact." }, { status: 400 });
  }
  const receipt = await recordWebhookReceipt({
    admin: resolved.admin,
    connection: resolved.connection,
    externalEventId: webhookId ?? createHash("sha256").update(rawBody).digest("hex"),
    externalArtifactId: recordingId,
    eventType: "newMeeting",
    payloadSha256: createHash("sha256").update(rawBody).digest("hex"),
  });
  return NextResponse.json({ accepted: true, duplicate: receipt.duplicate }, { status: 202 });
}

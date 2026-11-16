import { after, NextResponse } from "next/server";
import {
  acceptNotionWebhookEvent,
  processQueuedRecordingReceipts,
} from "@/lib/integrations/recordings/ingest";
import {
  parseNotionWebhookPayload,
  verifyNotionWebhookSetupSecret,
  verifyNotionWebhookSignature,
} from "@/lib/integrations/recordings/notion";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_WEBHOOK_BYTES = 256_000;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function setupCredential(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  return request.headers.get("x-notion-webhook-setup-secret")
    ?? new URL(request.url).searchParams.get("setup_secret");
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json({ error: "JSON is required." }, 415);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_WEBHOOK_BYTES) {
    return json({ error: "Payload is too large." }, 413);
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > MAX_WEBHOOK_BYTES) {
    return json({ error: "Payload is too large." }, 413);
  }
  const parsed = parseNotionWebhookPayload(rawBody);
  if (!parsed) return json({ error: "Invalid webhook payload." }, 400);

  if (parsed.kind === "verification") {
    const setupSecret = process.env.NOTION_WEBHOOK_SETUP_SECRET?.trim() ?? "";
    if (!setupSecret) return json({ error: "Webhook setup is unavailable." }, 503);
    if (!verifyNotionWebhookSetupSecret({
      provided: setupCredential(request),
      secret: setupSecret,
    })) {
      return json({ error: "Unauthorized." }, 401);
    }
    const admin = createSupabaseAdminClient();
    if (!admin) return json({ error: "Webhook setup is unavailable." }, 503);
    const { data: captured, error } = await admin.rpc(
      "lbb_capture_notion_webhook_token",
      { p_token: parsed.verificationToken },
    );
    if (error || captured !== true) {
      return json({ error: "Webhook verification token could not be stored." }, 503);
    }
    return json({ accepted: true });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return json({ error: "Webhook intake is unavailable." }, 503);
  let verificationToken = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN?.trim() ?? "";
  if (!verificationToken) {
    const { data, error } = await admin.rpc("lbb_notion_webhook_token");
    if (error) return json({ error: "Webhook intake is unavailable." }, 503);
    verificationToken = typeof data === "string" ? data.trim() : "";
  }
  if (!verificationToken) return json({ error: "Webhook intake is unavailable." }, 503);
  if (!verifyNotionWebhookSignature({
    rawBody,
    signature: request.headers.get("x-notion-signature"),
    secret: verificationToken,
  })) {
    return json({ error: "Invalid webhook signature." }, 401);
  }

  let receiptResult: Awaited<ReturnType<typeof acceptNotionWebhookEvent>>;
  try {
    receiptResult = await acceptNotionWebhookEvent({
      admin,
      event: parsed.event,
      rawBody,
    });
  } catch (caught) {
    console.error("notion_webhook_intake_failed", {
      error: caught instanceof Error ? caught.message.slice(0, 400) : "Unknown intake failure.",
    });
    return json({ error: "Webhook intake is temporarily unavailable." }, 503);
  }

  if (receiptResult.matchedConnections > 0) {
    after(async () => {
      try {
        const limit = Math.min(8, Math.max(1, receiptResult.accepted));
        for (let pass = 0; pass < 3; pass += 1) {
          const result = await processQueuedRecordingReceipts({ admin, limit });
          if (result.claimed === 0) break;
        }
      } catch (caught) {
        console.error("notion_webhook_after_failed", {
          error: caught instanceof Error ? caught.message.slice(0, 400) : "Unknown queue failure.",
        });
      }
    });
  }

  return json({
    accepted: true,
    matched_connections: receiptResult.matchedConnections,
    duplicate: receiptResult.accepted === 0 && receiptResult.duplicates > 0,
  });
}

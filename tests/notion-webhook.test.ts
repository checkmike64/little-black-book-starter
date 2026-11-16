import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Notion webhook intake is exact-public, durable before acknowledgment, and deferred after", () => {
  const proxy = readFileSync("proxy.ts", "utf8");
  const route = readFileSync(
    "app/api/integrations/notion/webhook/route.ts",
    "utf8",
  );
  const ingest = readFileSync("lib/integrations/recordings/ingest.ts", "utf8");

  assert.match(proxy, /pathname === "\/api\/integrations\/notion\/webhook"/);
  assert.doesNotMatch(proxy, /pathname\.startsWith\("\/api\/integrations\/notion\/"\)/);
  assert.match(route, /const rawBody = await request\.text\(\)/);
  assert.match(route, /request\.headers\.get\("x-notion-signature"\)/);
  assert.match(route, /NOTION_WEBHOOK_SETUP_SECRET/);
  assert.match(route, /NOTION_WEBHOOK_VERIFICATION_TOKEN/);
  assert.match(route, /lbb_capture_notion_webhook_token/);
  assert.match(route, /lbb_notion_webhook_token/);
  assert.match(route, /await acceptNotionWebhookEvent\(/);
  assert.match(route, /after\(async \(\) =>/);
  assert.match(route, /pass < 3/);
  assert.ok(route.indexOf("await acceptNotionWebhookEvent(") < route.indexOf("after(async () =>"));
  assert.match(ingest, /\.rpc\("lbb_enqueue_recording_receipt"/);
  assert.match(ingest, /externalEventId: event\.id/);
  assert.match(ingest, /\.eq\("metadata->>workspace_id", event\.workspaceId\)/);
});

test("Notion webhook signals reconcile blocks narrowly and pages through a bounded scan", () => {
  const ingest = readFileSync("lib/integrations/recordings/ingest.ts", "utf8");
  assert.match(ingest, /receipt\.event_type\.startsWith\("notion\.webhook:"\)/);
  assert.match(
    ingest,
    /artifactId: entityType === "block" \? receipt\.external_artifact_id : undefined/,
  );
  assert.match(ingest, /trigger: "webhook"/);
  assert.match(ingest, /pending_count:/);
  assert.match(ingest, /result_set_truncated:/);
  assert.match(ingest, /sync_cursor: latestObservation/);
  assert.match(ingest, /eventType: "daily\.reconcile"/);
  assert.match(ingest, /lbb_record_notion_sync_result/);
  assert.match(ingest, /last_imported_at/);
});

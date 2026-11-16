import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  fetchNotionArtifact,
  listRecentNotionArtifactIds,
  notionAuthorizationUrl,
  observeNotionArtifact,
  parseNotionWebhookPayload,
  scanRecentNotionArtifacts,
  verifyNotionWebhookSetupSecret,
  verifyNotionWebhookSignature,
} from "../lib/integrations/recordings/notion.js";

const originalFetch = globalThis.fetch;
const originalClientId = process.env.NOTION_OAUTH_CLIENT_ID;
const originalClientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.NOTION_OAUTH_CLIENT_ID = originalClientId;
  process.env.NOTION_OAUTH_CLIENT_SECRET = originalClientSecret;
});

test("builds a user-owned Notion OAuth request with CSRF state", () => {
  process.env.NOTION_OAUTH_CLIENT_ID = "client-id";
  process.env.NOTION_OAUTH_CLIENT_SECRET = "client-secret";
  const url = new URL(notionAuthorizationUrl({
    redirectUri: "https://book.example/api/integrations/notion/callback",
    state: "private-state",
  }));
  assert.equal(url.origin, "https://api.notion.com");
  assert.equal(url.pathname, "/v1/oauth/authorize");
  assert.equal(url.searchParams.get("owner"), "user");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "private-state");
});

test("queries only recent ready Notion meeting-note IDs", async () => {
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>)["Notion-Version"], "2026-03-11");
    return response({
      results: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          type: "meeting_notes",
          created_time: "2026-08-26T14:00:00.000Z",
          meeting_notes: { status: "notes_ready", title: [] },
        },
        {
          id: "22222222-2222-2222-2222-222222222222",
          type: "meeting_notes",
          created_time: "2026-08-26T15:00:00.000Z",
          last_edited_time: "2026-08-27T15:00:00.000Z",
          meeting_notes: { status: "transcription_in_progress", title: [] },
        },
        {
          id: "33333333-3333-3333-3333-333333333333",
          type: "meeting_notes",
          created_time: "2026-07-01T15:00:00.000Z",
          meeting_notes: { status: "notes_ready", title: [] },
        },
      ],
    });
  };
  const ids = await listRecentNotionArtifactIds({
    accessToken: "token",
    since: "2026-08-25T00:00:00.000Z",
  });
  assert.deepEqual(ids, ["11111111-1111-1111-1111-111111111111"]);

  const scan = await scanRecentNotionArtifacts({
    accessToken: "token",
    since: "2026-08-25T00:00:00.000Z",
  });
  assert.deepEqual(scan.readyArtifactIds, ["11111111-1111-1111-1111-111111111111"]);
  assert.deepEqual(scan.pendingArtifactIds, ["22222222-2222-2222-2222-222222222222"]);
  assert.equal(scan.observations[1]?.providerStatus, "transcription_in_progress");
});

test("observes one targeted Notion artifact without reading transcript children", async () => {
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    assert.match(String(input), /\/blocks\/pending-note$/);
    return response({
      id: "pending-note",
      type: "meeting_notes",
      created_time: "2026-08-28T12:00:00.000Z",
      last_edited_time: "2026-08-28T12:05:00.000Z",
      meeting_notes: { status: "transcription_in_progress" },
    });
  };
  const observation = await observeNotionArtifact({
    accessToken: "token",
    meetingNoteId: "pending-note",
  });
  assert.equal(calls, 1);
  assert.equal(observation?.readiness, "pending");
  assert.equal(observation?.lastEditedAt, "2026-08-28T12:05:00.000Z");
});

test("resolves a copied Notion meeting page to its direct meeting-notes child", async () => {
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}${url.search}`);
    if (url.pathname.endsWith("/blocks/meeting-page")) {
      return response({ id: "meeting-page", type: "child_page", has_children: true });
    }
    if (url.pathname.endsWith("/blocks/meeting-page/children")) {
      return response({
        results: [{
          id: "meeting-note-child",
          type: "meeting_notes",
          created_time: "2026-08-28T12:00:00.000Z",
          last_edited_time: "2026-08-28T12:31:00.000Z",
          meeting_notes: { status: "notes_ready" },
        }],
        has_more: false,
      });
    }
    throw new Error(`Unexpected Notion request: ${url.pathname}`);
  };
  const observation = await observeNotionArtifact({
    accessToken: "token",
    meetingNoteId: "meeting-page",
  });
  assert.equal(observation?.artifactId, "meeting-note-child");
  assert.equal(observation?.readiness, "ready");
  assert.deepEqual(calls, [
    "/v1/blocks/meeting-page",
    "/v1/blocks/meeting-page/children?page_size=100",
  ]);
});

test("fails closed when a copied Notion page has no unique complete meeting child", async () => {
  for (const children of [
    [],
    [
      { id: "note-1", type: "meeting_notes", meeting_notes: { status: "notes_ready" } },
      { id: "note-2", type: "meeting_notes", meeting_notes: { status: "notes_ready" } },
    ],
  ]) {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/children")
        ? response({ results: children, has_more: false })
        : response({ id: "meeting-page", type: "child_page", has_children: true });
    };
    assert.equal(await observeNotionArtifact({
      accessToken: "token",
      meetingNoteId: "meeting-page",
    }), null);
  }
});

test("fails closed when direct meeting children exceed the bounded lookup", async () => {
  let childPages = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith("/children")) {
      return response({ id: "meeting-page", type: "child_page", has_children: true });
    }
    childPages += 1;
    return response({
      results: Array.from({ length: 100 }, (_, index) => ({
        id: childPages === 1 && index === 0 ? "meeting-note-child" : `block-${childPages}-${index}`,
        type: childPages === 1 && index === 0 ? "meeting_notes" : "paragraph",
        meeting_notes: childPages === 1 && index === 0 ? { status: "notes_ready" } : undefined,
      })),
      has_more: true,
      next_cursor: `cursor-${childPages}`,
    });
  };
  assert.equal(await observeNotionArtifact({
    accessToken: "token",
    meetingNoteId: "meeting-page",
  }), null);
  assert.equal(childPages, 6);
});

test("verifies Notion HMACs over the exact raw request body", () => {
  const rawBody = '{"id":"event-1","type":"page.content_updated"}';
  const secret = "secret_verification_token";
  const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  assert.equal(verifyNotionWebhookSignature({ rawBody, signature, secret }), true);
  assert.equal(verifyNotionWebhookSignature({ rawBody: `${rawBody}\n`, signature, secret }), false);
  assert.equal(verifyNotionWebhookSignature({ rawBody, signature: "sha256=bad", secret }), false);
  assert.equal(verifyNotionWebhookSetupSecret({ provided: "setup", secret: "setup" }), true);
  assert.equal(verifyNotionWebhookSetupSecret({ provided: "wrong", secret: "setup" }), false);
});

test("parses guarded verification and version-stable Notion event envelopes", () => {
  assert.deepEqual(
    parseNotionWebhookPayload('{"verification_token":"secret_token"}'),
    { kind: "verification", verificationToken: "secret_token" },
  );
  const parsed = parseNotionWebhookPayload(JSON.stringify({
    id: "event-1",
    timestamp: "2026-08-29T12:00:00.000Z",
    workspace_id: "workspace-1",
    subscription_id: "subscription-1",
    integration_id: "integration-1",
    type: "page.content_updated",
    attempt_number: 2,
    entity: { id: "page-1", type: "page" },
    data: { parent: { id: "ignored-by-intake" } },
  }));
  assert.equal(parsed?.kind, "event");
  if (parsed?.kind === "event") {
    assert.equal(parsed.event.workspaceId, "workspace-1");
    assert.equal(parsed.event.entity.id, "page-1");
    assert.equal(parsed.event.attemptNumber, 2);
  }
  assert.equal(parseNotionWebhookPayload("not-json"), null);
});

test("normalizes Notion notes while discarding transcript text", async () => {
  const transcriptCanary = "PRIVATE TRANSCRIPT CANARY Ava asked for the Book walkthrough";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/blocks/note-1")) {
      return response({
        id: "note-1",
        type: "meeting_notes",
        created_time: "2026-08-26T14:00:00.000Z",
        meeting_notes: {
          status: "notes_ready",
          title: [{ plain_text: "Ava relationship review" }],
          children: {
            summary_block_id: "summary-1",
            notes_block_id: "notes-1",
            transcript_block_id: "transcript-1",
          },
          calendar_event: {
            start_time: "2026-08-26T14:00:00.000Z",
            end_time: "2026-08-26T14:30:00.000Z",
            attendees: ["notion-user-1", "notion-user-2"],
          },
        },
      });
    }
    if (url.pathname.endsWith("/blocks/summary-1/children")) {
      return response({ results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "Ava is reviewing the relationship OS." }] } }] });
    }
    if (url.pathname.endsWith("/blocks/notes-1/children")) {
      return response({ results: [{ type: "to_do", to_do: { rich_text: [{ plain_text: "Send Ava the concise walkthrough" }] } }] });
    }
    if (url.pathname.endsWith("/blocks/transcript-1/children")) {
      return response({ results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: transcriptCanary }] } }] });
    }
    throw new Error(`Unexpected Notion request: ${url.pathname}`);
  };
  const artifact = await fetchNotionArtifact({ accessToken: "token", meetingNoteId: "note-1" });
  assert.equal(artifact.provider, "notion");
  assert.equal(artifact.title, "Ava relationship review");
  assert.equal(artifact.durationSeconds, 1800);
  assert.equal(artifact.actionItems[0]?.text, "Send Ava the concise walkthrough");
  assert.match(artifact.transcriptSha256 ?? "", /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(artifact).includes(transcriptCanary), false);
  assert.equal(artifact.metadata.raw_transcript_stored, false);
});

test("Notion migration and UI preserve the owner-review privacy boundary", () => {
  const migration = readFileSync(
    "supabase/migrations/20260826204654_add_notion_meeting_notes_integration.sql",
    "utf8",
  );
  const page = readFileSync("app/(portal)/recordings/page.tsx", "utf8");
  const recordingsData = readFileSync("lib/recordings/data.ts", "utf8");
  const worker = readFileSync("app/api/automation/recordings/route.ts", "utf8");
  const oauthCallback = readFileSync(
    "app/api/integrations/notion/callback/route.ts",
    "utf8",
  );

  assert.match(migration, /provider in \('fireflies', 'fathom', 'google_meet', 'notion'\)/);
  assert.match(migration, /create table public\.notion_oauth_transactions/);
  assert.match(migration, /grant all on table public\.notion_oauth_transactions to service_role/);
  assert.match(migration, /vault\.create_secret/);
  assert.match(migration, /recording owner access required/);
  assert.match(migration, /'evidence_grade', 'proposal'/);
  assert.match(migration, /raw_transcript_stored', false/);
  assert.match(page, /Connect Notion/);
  assert.match(page, /provider === "notion" && !connected && context/);
  assert.match(page, /const operatorContext = await requireOperatorAccess\(\)/);
  assert.match(page, /getRecordingsData\(\{\s*context: operatorContext/);
  assert.match(page, /<h2 id="recording-timeline-heading">Meeting Inbox<\/h2>/);
  assert.match(page, /remain proposals until the recording owner confirms/);
  assert.match(page, /signing token remains encrypted in Supabase Vault and is not displayed/);
  assert.match(recordingsData, /adminMode && notionWebhookSetupWindowOpen/);
  assert.match(worker, /providers: \["notion"\]/);
  assert.match(oauthCallback, /lbb_consume_notion_oauth_transaction/);
  assert.match(oauthCallback, /lbb_save_notion_recording_connection/);
  assert.match(oauthCallback, /reconcileNotionArtifactReceipts\(\{\s*admin,\s*connectionId,\s*trigger: "manual",\s*\}\)/);
  assert.doesNotMatch(oauthCallback, /reconcileRecordingProviderReceipts/);
});

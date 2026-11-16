import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  INTRODUCTION_DRAFT_STALE_AFTER_MS,
  introductionDraftState,
} from "../lib/introduction-draft-state.js";

const now = Date.parse("2026-09-14T12:00:00.000Z");

test("introduction draft state preserves active, ready, failed, and stale states", () => {
  assert.equal(
    introductionDraftState({
      evidence: {
        draft_status: "queued",
        draft_request_id: "request-1",
        draft_requested_at: new Date(now - 5_000).toISOString(),
      },
      hasDraft: false,
      now,
    }).status,
    "queued",
  );
  assert.equal(
    introductionDraftState({
      evidence: { draft_status: "ready" },
      hasDraft: true,
      now,
    }).status,
    "ready",
  );
  assert.equal(
    introductionDraftState({
      evidence: { draft_status: "failed" },
      hasDraft: true,
      now,
    }).status,
    "failed",
  );
  assert.equal(
    introductionDraftState({
      evidence: {
        draft_status: "running",
        draft_request_id: "request-2",
        draft_started_at: new Date(now - INTRODUCTION_DRAFT_STALE_AFTER_MS - 1).toISOString(),
      },
      hasDraft: false,
      now,
    }).status,
    "stale",
  );
});

test("introduction actions persist a request before post-response generation", () => {
  const actions = readFileSync("app/(portal)/introductions/actions.ts", "utf8");
  const firstQueue = actions.indexOf("await queueIntroductionDraft({");
  const firstAfter = actions.indexOf("after(async () =>");

  assert.ok(firstQueue >= 0);
  assert.ok(firstAfter > firstQueue);
  assert.doesNotMatch(actions, /await generateAndStoreIntroductionDraft/);
  assert.match(actions, /Introduction saved\. Draft preparation started\./);
  assert.match(actions, /Draft update started\./);
});

test("a newer rewrite supersedes an older generation without stale writes", () => {
  const queue = readFileSync("lib/introduction-draft-queue.ts", "utf8");
  const drafts = readFileSync("lib/introduction-drafts.ts", "utf8");

  assert.match(queue, /draft_status: "queued"/);
  assert.match(queue, /\.eq\("draft_evidence->>draft_request_id", input\.requestId\)/);
  assert.match(queue, /\.eq\("draft_evidence->>draft_status", "queued"\)/);
  assert.match(queue, /\.eq\("draft_evidence->>draft_status", "running"\)/);
  assert.match(drafts, /\.eq\("draft_evidence->>draft_request_id", input\.requestId\)/);
  assert.match(drafts, /\.eq\("draft_evidence->>draft_status", "running"\)/);
  assert.match(pageSource(), /latestProposed\.draft_body && !draftIsActive/);
  const failureLog = queue.slice(
    queue.indexOf("} catch {"),
    queue.indexOf("await markDraftFailed"),
  );
  assert.doesNotMatch(failureLog, /introductionId|caught\.message/);
});

test("networking keeps the prior draft visible and bounds automatic refresh", () => {
  const page = readFileSync("app/(portal)/networking/page.tsx", "utf8");
  const refresh = readFileSync(
    "app/(portal)/networking/introduction-draft-refresh.tsx",
    "utf8",
  );
  const styles = readFileSync("app/globals.css", "utf8");

  assert.match(page, /The current draft will stay here until it is ready\./);
  assert.match(page, /The draft could not be prepared\./);
  assert.match(page, /Try draft again/);
  assert.match(refresh, /MAX_AUTOMATIC_REFRESHES = 20/);
  assert.match(refresh, /REFRESH_INTERVAL_MS = 2_500/);
  assert.match(refresh, /window\.clearInterval\(interval\)/);
  assert.match(refresh, /\/api\/introduction-drafts\//);
  assert.match(refresh, /terminalRefreshTimer\.current = window\.setTimeout/);
  assert.match(refresh, /window\.clearTimeout\(terminalRefreshTimer\.current\)/);
  assert.match(refresh, /activeRequest\.current\?\.abort\(\)/);
  assert.doesNotMatch(refresh, /setInterval[\s\S]*router\.refresh\(\)/);
  assert.match(page, /latestDraftState\?\.requestId/);
  assert.match(page, /export const maxDuration = 60/);
  assert.match(styles, /\.introduction-draft-refresh \.button,[\s\S]*min-height: 44px/);
});

test("draft status polling is private, minimal, and relationship-content free", () => {
  const route = readFileSync(
    "app/api/introduction-drafts/[id]/status/route.ts",
    "utf8",
  );

  assert.match(route, /createSupabaseServerClient/);
  assert.match(route, /\.from\("introductions"\)/);
  assert.match(route, /\.select\("draft_evidence, draft_subject, draft_body"\)/);
  assert.match(route, /Cache-Control": "private, no-store"/);
  assert.match(route, /state\.requestId === requestId \? state\.status : "superseded"/);
  assert.doesNotMatch(route, /draft_body:/);
});

function pageSource() {
  return readFileSync("app/(portal)/networking/page.tsx", "utf8");
}

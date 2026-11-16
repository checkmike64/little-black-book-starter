import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

describe("Claude interaction intake", () => {
  const route = readFileSync("app/api/claude/interactions/route.ts", "utf8");
  const atomicMigration = readFileSync(
    "supabase/migrations/20260823175442_make_interaction_intake_atomic.sql",
    "utf8",
  );

  test("records a delivery receipt without storing transcript content in telemetry", () => {
    assert.match(route, /interaction\.delivery_succeeded/);
    assert.match(route, /interaction\.delivery_failed/);
    assert.match(route, /interaction_delivered/);
    assert.match(route, /heartbeat: heartbeatRecorded \? "recorded" : "degraded"/);
    assert.match(route, /run_id: event\.runId/);
    assert.doesNotMatch(route, /metadata\s*=\s*\{[^}]*summary/s);
  });

  test("makes explicit requests searchable promises in the scheduled-run contract", () => {
    const setup = readFileSync("lib/claude-setup-package.ts", "utf8");
    const docs = readFileSync("docs/CLAUDE_INSTRUCTION_PACKAGE.md", "utf8");

    assert.match(setup, /send a Loom, share a copy, make an introduction, or follow up/);
    assert.match(setup, /heartbeat=recorded/);
    assert.match(docs, /requests to send a Loom, share a copy, make an introduction, or follow up/);
    assert.match(docs, /prose briefing is not delivery to the Book/);
    assert.match(setup, /exact requester's contact_id/);
    assert.match(docs, /exact requester's `contact_id`/);
    assert.match(route, /Each promise contact_id must be one of the interaction contacts/);
  });

  test("makes concurrent interaction retries atomic before child writes", () => {
    assert.match(
      atomicMigration,
      /on conflict \(tenant_id, idempotency_key\)[\s\S]*where idempotency_key is not null[\s\S]*do nothing[\s\S]*returning id into interaction_id/,
    );
    assert.match(atomicMigration, /if interaction_id is null then/);
    assert.match(atomicMigration, /raise exception 'Interaction could not be recorded\.'/);
    assert.ok(
      atomicMigration.indexOf("if interaction_id is null then") <
        atomicMigration.indexOf("insert into public.interaction_contacts"),
    );
    const interactionInsert = atomicMigration.slice(
      atomicMigration.indexOf("insert into public.interactions"),
      atomicMigration.indexOf("insert into public.interaction_contacts"),
    );
    assert.doesNotMatch(interactionInsert, /do update/i);
    assert.match(
      atomicMigration,
      /revoke execute on function public\.lbb_log_interaction\([\s\S]*from public, anon, authenticated/,
    );
    assert.match(
      atomicMigration,
      /grant execute on function public\.lbb_log_interaction\([\s\S]*to service_role/,
    );
  });
});

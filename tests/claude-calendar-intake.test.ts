import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { normalizedActiveMigrationSql } from "./migration-source.js";

const route = readFileSync("app/api/claude/calendar/route.ts", "utf8");
const migration = normalizedActiveMigrationSql;
const today = readFileSync("app/(portal)/dashboard/page.tsx", "utf8");
const handoff = readFileSync("docs/CLAUDE_INTELLIGENCE_HANDOFF.md", "utf8");

describe("Claude calendar intake", () => {
  test("keeps the gateway private, tenant-scoped, bounded, and retry-safe", () => {
    assert.match(route, /authenticateClaudeRequest/);
    assert.match(route, /tenantIdFrom\(body\.tenant_id\)/);
    assert.match(route, /maxBytes: 500_000/);
    assert.match(route, /events\.length > 50/);
    assert.match(route, /8 \* 86_400_000/);
    assert.match(route, /p_snapshot_id: snapshotId/);
    assert.match(route, /p_payload_hash:/);
  });

  test("stores snapshots privately and preserves owner decisions", () => {
    assert.match(migration, /app_private\.calendar_snapshot_receipts/);
    assert.match(
      migration,
      /alter table app_private\.calendar_snapshot_receipts enable row level security/,
    );
    assert.match(
      migration,
      /grant delete, insert, maintain, references, select, trigger, truncate, update on table app_private\.calendar_snapshot_receipts to postgres/,
    );
    assert.doesNotMatch(
      migration,
      /grant [^;]+ on table app_private\.calendar_snapshot_receipts to (?:anon|authenticated)/,
    );
    assert.match(migration, /auth\.role\(\) <> 'service_role'/);
    assert.match(
      migration,
      /provider = any \(array\['google_calendar'::text, 'claude_calendar'::text, 'google_gmail'::text\]\)/i,
    );
    assert.match(migration, /calendar_attendee_preferences/);
    assert.match(migration, /preference_decision = 'book'/);
    assert.match(migration, /preference_decision = 'want_to_know'/);
    assert.match(migration, /having count\(\*\) = 1/);
  });

  test("uses certain contact matches and advances freshness only for completed meetings", () => {
    assert.match(route, /contact_id: isValidUuid/);
    assert.match(migration, /c\.id = supplied_contact_id/);
    assert.match(migration, /lbb_log_interaction/);
    assert.match(migration, /<= p_generated_at/);
    assert.match(migration, /'claude_calendar'/);
    assert.match(migration, /matched_contact_ids,/);
    assert.match(migration, /\n\s*true,\n\s*'\[\]'::jsonb/);
  });

  test("keeps meeting context inside the broader Today workflow", () => {
    assert.doesNotMatch(today, /Connect Google Calendar|Reconnect calendar|Open calendar/);
    assert.doesNotMatch(today, /\/api\/integrations\/google/);
    assert.doesNotMatch(today, /Run the Claude calendar refresh/);
    assert.doesNotMatch(today, /syncCalendarNow/);
    assert.match(today, /id="upcoming-title">Coming up/);
    assert.match(today, /briefing\?\.whats_new/);
    assert.match(today, /briefing\?\.their_asks/);
    assert.match(today, /briefing\?\.opportunities/);
    assert.match(today, /Add to Book/);
    assert.match(today, /Want to Know/);
    assert.match(today, /name="purpose" required/);
    assert.match(today, /Not for the Book/);
    assert.doesNotMatch(today, /buildTodayAttention/);
    assert.doesNotMatch(today, /getNetworkingData/);
    assert.doesNotMatch(today, /getEngagementFeed/);
  });

  test("gives Claude the complete contract that powers Today", () => {
    assert.match(handoff, /POST \{LBB_APP_URL\}\/api\/claude\/calendar/);
    assert.match(handoff, /snapshot_id/);
    assert.match(handoff, /previous two days/);
    assert.match(handoff, /next two days/);
    assert.match(handoff, /Unknown attendees are intentional/);
    assert.match(handoff, /Future events never advance `last_spoke`/);
  });
});

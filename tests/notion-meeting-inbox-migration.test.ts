import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260830022430_notion_meeting_inbox.sql",
  "utf8",
);

describe("Notion meeting inbox database contract", () => {
  test("keeps webhook operational state service-only", () => {
    for (const table of ["notion_webhook_config", "notion_webhook_events"]) {
      assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
      assert.match(
        migration,
        new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`),
      );
      assert.match(migration, new RegExp(`grant all on table public\\.${table} to service_role`));
    }
    assert.match(migration, /vault\.create_secret/);
    assert.match(migration, /vault\.decrypted_secrets/);
    assert.match(migration, /lbb_capture_notion_webhook_token\(\s*p_token text/);
    assert.match(migration, /lbb_notion_webhook_token\(\)/);
    assert.doesNotMatch(migration, /lbb_save_notion_webhook_config/);
    assert.match(migration, /raw_payload_stored[^\n]+false/);
  });

  test("exposes exact owner-scoped recording sync telemetry", () => {
    for (const column of [
      "last_checked_at",
      "last_succeeded_at",
      "last_event_at",
      "last_imported_at",
      "checked_count",
      "ready_count",
      "pending_count",
      "enqueued_count",
      "trigger_source",
      "last_error",
    ]) {
      assert.match(migration, new RegExp(`\\b${column}\\b`));
    }
    assert.match(migration, /grant select on table public\.recording_sync_state to authenticated/);
    assert.match(migration, /on public\.recording_sync_state for select[\s\S]+owner_user_id = \(select auth\.uid\(\)\)/);
    assert.match(migration, /create or replace function public\.lbb_record_notion_sync_result/);
    assert.match(migration, /p_trigger_source not in \('scheduled', 'manual', 'webhook'\)/);
    assert.match(migration, /p_enqueued_count > p_ready_count/);
    assert.doesNotMatch(migration, /p_enqueued_count > p_pending_count/);
  });

  test("gives owners a read-only tenant-bound follow-up inbox", () => {
    assert.match(migration, /alter table public\.recording_followups enable row level security/);
    assert.match(migration, /grant select on table public\.recording_followups to authenticated/);
    assert.match(migration, /owner_user_id = \(select auth\.uid\(\)\)/);
    assert.match(migration, /has_tenant_role\(tenant_id, array\['owner'\]\)/);
    assert.doesNotMatch(
      migration,
      /grant (?:insert|update|delete)[^;]+recording_followups to authenticated/i,
    );
  });

  test("seeds and lifecycle-closes durable action-item follow-ups", () => {
    assert.match(migration, /create trigger sync_recording_followups_from_transcript/);
    assert.match(migration, /after insert or update of action_items, processing_status/);
    assert.match(migration, /jsonb_array_elements\(p_action_items\) with ordinality/);
    assert.match(migration, /on conflict \(transcript_id, source_item_index\) do update/);
    assert.match(migration, /p_processing_status in \('dismissed', 'purged'\)/);
    assert.match(migration, /select \* from public\.transcripts[\s\S]+jsonb_array_length\(action_items\) > 0/);
  });

  test("routes accepted follow-ups atomically and idempotently", () => {
    assert.match(migration, /create or replace function public\.lbb_route_recording_followup/);
    assert.match(migration, /for update;/);
    assert.match(migration, /member\.status = 'active'[\s\S]+member\.role = 'owner'/);
    assert.match(migration, /transcript_row\.processing_status <> 'ready'/);
    assert.match(
      migration,
      /'action', 'owner_promise', 'contact_promise', 'context', 'dismiss'/,
    );
    assert.match(migration, /then 'owner_owes_contact' else 'contact_owes_owner' end/);
    assert.match(migration, /an active contact is required for a promise/);
    assert.match(migration, /'duplicate', true/);
    assert.match(migration, /insert into public\.audit_log/);
    assert.match(
      migration,
      /revoke all on function public\.lbb_route_recording_followup[\s\S]+from public, anon, authenticated/,
    );
    assert.match(
      migration,
      /grant execute on function public\.lbb_route_recording_followup[\s\S]+to service_role/,
    );
  });
});

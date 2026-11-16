import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const activeDir = "supabase/migrations";
const canonicalCutoverPacket = [
  "20260822130430_canonical_production_baseline.sql",
  "20260822143000_canonical_tenant_settings_and_workflow_grants.sql",
  "20260823152625_recording_integrations.sql",
  "20260823172839_reconcile_hosted_schema_drift.sql",
  "20260823172945_remove_stale_membership_write_policies.sql",
  "20260823175442_make_interaction_intake_atomic.sql",
  "20260823193000_harden_default_privileges.sql",
  "20260823194000_revoke_global_default_function_execute.sql",
];
const expectedActive = [
  ...canonicalCutoverPacket,
  "20260825155748_validate_ai_generation_ledger_metadata.sql",
  "20260826204654_add_notion_meeting_notes_integration.sql",
  "20260829022219_enable_rls_on_calendar_snapshot_receipts.sql",
  "20260829024600_ghl_identity_and_reviews.sql",
  "20260830022430_notion_meeting_inbox.sql",
  "20260830034629_recording_item_review.sql",
  "20260902132214_simplify_recording_followup_resolution.sql",
  "20260902153722_streamline_meeting_processing.sql",
  "20260904015451_recording_baseline_intelligence.sql",
  "20260904025833_fix_recording_baseline_claim.sql",
  "20260904064420_grant_service_role_app_private_usage.sql",
  "20260904122042_atomic_production_check_evidence.sql",
  "20260904133601_operator_only_recordings.sql",
  "20260917025148_replay_safe_contact_creation.sql",
  "20260930190000_owner_selected_want_to_know_lanes.sql",
  "20260930193000_index_want_to_know_owner_selected_by.sql",
  "20261001000000_contact_enrichment_ai_ledger.sql",
  "20261001020000_relationship_introduction_feedback.sql",
  "20261001030000_harden_introduction_event_rpc.sql",
  "20261001040000_want_to_know_relationship_programs.sql",
  "20261001050000_pause_unconfirmed_want_to_know_programs.sql",
  "20261001173929_simplify_want_to_know_cadence_and_stages.sql",
  "20261005230000_expand_content_scan_platforms.sql",
];


test("uses one canonical baseline and thirty forward migrations", () => {
  const active = readdirSync(activeDir).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(active, expectedActive);

  const baseline = readFileSync(`${activeDir}/${expectedActive[0]}`, "utf8");
  assert.match(baseline, /Schema only: this file contains no application rows/);
  assert.doesNotMatch(baseline, /^\s*copy\s+/im);
  assert.doesNotMatch(baseline, /insert\s+into\s+(?:"?auth"?\.)?"?users"?/i);
  assert.doesNotMatch(baseline, /insert\s+into\s+(?:"?vault"?\.)?"?secrets"?/i);
  assert.doesNotMatch(baseline, /create\s+(?:user|role)\b|alter\s+role\b|owner\s+to\b/i);
  assert.match(baseline, /values \('transcripts', 'transcripts', false, null, null\)/);
  assert.match(baseline, /create policy "members read transcript objects"/);


});

test("future database objects fail closed for browser roles", () => {
  const hardening = readFileSync(
    `${activeDir}/20260823193000_harden_default_privileges.sql`,
    "utf8",
  ).toLowerCase();

  for (const owner of ["postgres"]) {
    for (const objectType of ["tables", "sequences"]) {
      assert.match(
        hardening,
        new RegExp(
          `alter default privileges for role ${owner} in schema public\\s+revoke all on ${objectType} from public, anon, authenticated`,
        ),
      );
    }
    assert.match(
      hardening,
      new RegExp(
        `alter default privileges for role ${owner} in schema public\\s+revoke execute on functions from public, anon, authenticated`,
      ),
    );
  }
  assert.doesNotMatch(hardening, /for role supabase_admin/);
  assert.match(hardening, /rejects any application[\s\S]*not owned by postgres/);

  const globalFunctionHardening = readFileSync(
    `${activeDir}/20260823194000_revoke_global_default_function_execute.sql`,
    "utf8",
  ).toLowerCase();
  assert.match(
    globalFunctionHardening,
    /alter default privileges for role postgres\s+revoke execute on functions from public, anon, authenticated/,
  );
  assert.doesNotMatch(globalFunctionHardening, /in schema/);
});


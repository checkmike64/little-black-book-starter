import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "supabase/migrations/20260917025148_replay_safe_contact_creation.sql";

test("contact creation replay ledger is private, tenant scoped, and service-role only", () => {
  const migration = readFileSync(migrationPath, "utf8");

  assert.match(migration, /create table app_private\.contact_creation_requests/i);
  assert.match(migration, /primary key \(tenant_id, request_key\)/i);
  assert.match(migration, /char_length\(request_key\) between 1 and 240/i);
  assert.match(migration, /payload_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(
    migration,
    /extensions\.digest\([\s\S]*jsonb_build_object\([\s\S]*'fields',[\s\S]*'source',[\s\S]*'extra',[\s\S]*'sha256'/i,
  );
  assert.match(migration, /for update;/i);
  assert.match(migration, /creation_request_key was already used with a different payload/i);
  assert.doesNotMatch(migration, /alter table public\.contacts[\s\S]*creation_request_key/i);
  assert.doesNotMatch(migration, /unique[\s\S]{0,80}\(email\)/i);
  assert.match(
    migration,
    /revoke all on table app_private\.contact_creation_requests from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.lbb_create_contact_once\([\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.lbb_create_contact_once\([\s\S]*to service_role/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.lbb_approve_new_contact_once\([\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.lbb_approve_new_contact_once\([\s\S]*to service_role/i,
  );
  assert.match(migration, /security invoker/gi);
  assert.match(migration, /member\.status = 'active'/i);
  assert.match(migration, /member\.role in \('owner', 'operator'\)/i);
  assert.match(migration, /Unsupported contact fields/i);
});

test("new-person approval locks and atomically links the proposal to one contact", () => {
  const migration = readFileSync(migrationPath, "utf8");

  assert.match(migration, /create or replace function public\.lbb_approve_new_contact_once/i);
  assert.match(
    migration,
    /from public\.pending_changes[\s\S]*where tenant_id = p_tenant_id[\s\S]*and id = p_pending_change_id[\s\S]*for update/i,
  );
  assert.match(migration, /v_change\.status not in \('pending', 'approved'\)/i);
  assert.match(migration, /'pending-change:' \|\| p_pending_change_id::text/i);
  assert.match(
    migration,
    /set status = 'approved',[\s\S]*contact_id = v_contact_id,[\s\S]*reviewed_by = p_actor_user_id/i,
  );
  assert.match(migration, /and status = 'pending'/i);
});

test("all supported new-contact surfaces use the replay-safe RPC helper", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const helper = readFileSync("lib/contact-creation.ts", "utf8");
  const manual = readFileSync("app/(portal)/contacts/new/actions.ts", "utf8");
  const manualPage = readFileSync("app/(portal)/contacts/new/page.tsx", "utf8");
  const calendar = readFileSync("app/(portal)/dashboard/actions.ts", "utf8");
  const changes = readFileSync("app/(portal)/changes/actions.ts", "utf8");

  assert.match(helper, /admin\.rpc\("lbb_create_contact_once"/);
  assert.match(helper, /admin\.rpc\("lbb_approve_new_contact_once"/);
  assert.match(manual, /createContactOnce/);
  assert.match(manual, /manual-intake:\$\{requestId\}/);
  assert.match(manualPage, /name="creation_request_id"/);
  assert.match(manualPage, /name="relationship_type"/);
  assert.match(calendar, /createContactOnce/);
  assert.match(calendar, /calendar-attendee:\$\{attendeeId\}:book/);
  assert.match(changes, /approveNewContactOnce/);
  assert.match(manual, /const arrayFields = \[[\s\S]*"relationship_type"/);
  assert.match(manual, /for \(const field of arrayFields\)[\s\S]*fields\[field\] = cleanArray/);
  assert.match(migration, /relationship_type text\[\]/);
  assert.doesNotMatch(
    changes.slice(changes.indexOf("if (isNewPersonChangeType"), changes.indexOf('if (change.change_type === "want_to_know_candidate")')),
    /\.from\("contacts"\)\s*\.insert\(/,
  );
});

test("Claude proposal intake and completion enforce source-job lineage", () => {
  const intake = readFileSync("app/api/claude/pending-changes/route.ts", "utf8");
  const completion = readFileSync("app/api/claude/jobs/[id]/complete/route.ts", "utf8");
  const instructions = readFileSync("lib/claude-enrichment.ts", "utf8");

  assert.match(intake, /source_job_id\?: string/);
  assert.match(intake, /sourceJob\.job_type !== "contact_enrichment"/);
  assert.match(intake, /sourceJob\.status !== "running"/);
  assert.match(intake, /sourcePayload\.contact_id !== contactId/);
  assert.match(intake, /source_job_id: sourceJob\.id/);
  assert.ok(
    intake.indexOf("delete trustedEvidence.source_job_id") <
      intake.indexOf('.from("jobs")'),
    "unvalidated evidence source_job_id must be stripped before optional validation",
  );
  assert.match(completion, /requiredFieldProposalLineageError/);
  assert.match(completion, /change_type, payload, status, created_at/);
  assert.match(completion, /attempts, created_at/);
  assert.match(completion, /jobCreatedAt: job\.created_at/);
  assert.match(instructions, /source_job_id: jobId/);
});

test("approval replay suppresses non-idempotent follow-up side effects", () => {
  const changes = readFileSync("app/(portal)/changes/actions.ts", "utf8");
  const guarded = changes.slice(
    changes.indexOf("if (!creation.approvalReplayed)"),
    changes.indexOf("revalidateReviewSurfaces(creation.contactId)"),
  );
  assert.match(guarded, /markWantToKnowGraduated/);
  assert.match(guarded, /pending_change\.new_contact_approved/);
});

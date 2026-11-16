import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { resolveAiTaskPolicy } from "../lib/ai/policy.js";
import {
  normalizeRecordingBaselineOutput,
  recordingBaselineEvidenceCorpus,
  recordingBaselineEvidenceSources,
  recordingBaselineFieldDefinitions,
  recordingBaselineFields,
  recordingBaselinePrompt,
  recordingBaselineResolvedActionItems,
  recordingBaselineSchema,
  type RecordingBaselineField,
} from "../lib/recordings/baseline.js";

const summary = [
  "Taylor leads Atlas Studio in Austin.",
  "Taylor offers executive coaching.",
  "Taylor's ideal referral is a founder preparing for a leadership transition.",
  "Taylor's website is https://atlas.example.com.",
].join(" ");

function fact(
  field: RecordingBaselineField | string,
  value: unknown,
  evidenceSummary: string,
  confidence = 0.95,
) {
  return {
    field,
    value,
    evidence_summary: evidenceSummary,
    confidence,
  };
}

describe("recording baseline intelligence", () => {
  test("uses the exact commercial baseline whitelist and compact definitions", () => {
    assert.deepEqual(recordingBaselineFields, [
      "company_name",
      "company_description",
      "role_title",
      "location",
      "time_zone",
      "phone",
      "website",
      "linkedin",
      "instagram",
      "facebook",
      "x_twitter",
      "youtube",
      "podcast_url",
      "current_asks",
      "wants_help_with",
      "services_offered",
      "ideal_referral",
    ]);
    assert.deepEqual(Object.keys(recordingBaselineFieldDefinitions), recordingBaselineFields);
    assert.match(recordingBaselineFieldDefinitions.company_name, /leads, founded, or owns/);
    assert.match(recordingBaselineFieldDefinitions.role_title, /^Array /);
    assert.match(recordingBaselineFieldDefinitions.location, /^Array /);
    assert.match(recordingBaselineFieldDefinitions.services_offered, /^Array /);
    assert.match(recordingBaselineFieldDefinitions.current_asks, /active requests or opportunities/);
    assert.match(recordingBaselineFieldDefinitions.wants_help_with, /Ongoing areas/);
    assert.match(recordingBaselineFieldDefinitions.ideal_referral, /best-fit clients, customers/);
  });

  test("publishes a bounded facts schema without changing the field allowlist", () => {
    assert.deepEqual(recordingBaselineSchema.required, ["facts"]);
    assert.equal(recordingBaselineSchema.additionalProperties, false);
    assert.equal(recordingBaselineSchema.properties.facts.maxItems, 8);
    assert.equal(recordingBaselineSchema.properties.facts.uniqueItems, true);
    const item = recordingBaselineSchema.properties.facts.items;
    assert.deepEqual(item.required, ["field", "value", "evidence_summary", "confidence"]);
    assert.equal(item.additionalProperties, false);
    assert.deepEqual(item.properties.field.enum, recordingBaselineFields);
    assert.equal(item.properties.confidence.minimum, 0.9);
    assert.equal(item.properties.confidence.maximum, 1);
    assert.deepEqual(
      item.properties.value.anyOf.map((variant) => variant.type),
      ["string", "array"],
    );
  });

  test("adapts grounded, typed, safe facts to the existing keyed RPC payload", () => {
    const normalized = normalizeRecordingBaselineOutput({
      facts: [
        fact(
          "company_name",
          "Atlas Studio",
          "Taylor leads Atlas Studio in Austin.",
          0.96,
        ),
        fact(
          "services_offered",
          ["executive coaching", "executive coaching"],
          "Taylor offers executive coaching.",
          0.94,
        ),
        fact(
          "website",
          "https://atlas.example.com",
          "Taylor's website is https://atlas.example.com.",
          0.91,
        ),
        fact("phone", "+1.512.555.0199", "Taylor leads Atlas Studio in Austin.", 0.99),
        fact(
          "ideal_referral",
          "Growth-stage founder",
          "Taylor's ideal referral is a founder preparing for a leadership transition.",
          0.69,
        ),
        fact(
          "recent_activity",
          "Should never pass the allowlist",
          "Taylor leads Atlas Studio in Austin.",
          0.99,
        ),
      ],
    }, summary);

    assert.deepEqual(normalized.suggestions.company_name, {
      value: "Atlas Studio",
      confidence: 0.96,
      evidence_summary: "Taylor leads Atlas Studio in Austin.",
    });
    assert.deepEqual(normalized.suggestions.services_offered?.value, ["executive coaching"]);
    assert.equal(normalized.suggestions.website?.value, "https://atlas.example.com/");
    assert.equal(normalized.suggestions.phone, undefined);
    assert.equal(normalized.suggestions.ideal_referral, undefined);
    assert.equal((normalized.suggestions as Record<string, unknown>).recent_activity, undefined);
  });

  test("rejects oversized outputs and every duplicated field deterministically", () => {
    const oversized = normalizeRecordingBaselineOutput({
      facts: Array.from({ length: 9 }, (_, index) =>
        fact(
          recordingBaselineFields[index]!,
          `Value ${index}`,
          "Taylor leads Atlas Studio in Austin.",
        )),
    }, summary);
    assert.deepEqual(oversized, { suggestions: {} });

    const duplicated = normalizeRecordingBaselineOutput({
      facts: [
        fact("company_name", "Atlas Studio", "Taylor leads Atlas Studio in Austin."),
        fact("company_name", "Atlas", "Taylor leads Atlas Studio in Austin."),
        fact("location", ["Austin"], "Taylor leads Atlas Studio in Austin."),
      ],
    }, summary);
    assert.equal(duplicated.suggestions.company_name, undefined);
    assert.deepEqual(duplicated.suggestions.location?.value, ["Austin"]);
  });

  test("enforces field-specific scalar and array output types", () => {
    const normalized = normalizeRecordingBaselineOutput({
      facts: [
        fact("company_name", ["Atlas Studio"], "Taylor leads Atlas Studio in Austin."),
        fact("role_title", "Founder", "Taylor leads Atlas Studio in Austin."),
        fact("location", ["Austin"], "Taylor leads Atlas Studio in Austin."),
        fact("services_offered", ["executive coaching"], "Taylor offers executive coaching."),
      ],
    }, summary);
    assert.equal(normalized.suggestions.company_name, undefined);
    assert.equal(normalized.suggestions.role_title, undefined);
    assert.deepEqual(normalized.suggestions.location?.value, ["Austin"]);
    assert.deepEqual(normalized.suggestions.services_offered?.value, ["executive coaching"]);
  });

  test("accepts confidence at 0.90 and rejects lower confidence", () => {
    const normalized = normalizeRecordingBaselineOutput({
      facts: [
        fact("company_name", "Atlas Studio", "Taylor leads Atlas Studio in Austin.", 0.899),
        fact("location", ["Austin"], "Taylor leads Atlas Studio in Austin.", 0.9),
      ],
    }, summary);
    assert.equal(normalized.suggestions.company_name, undefined);
    assert.deepEqual(normalized.suggestions.location?.value, ["Austin"]);
  });

  test("rejects paraphrased evidence that is not a literal source substring", () => {
    const normalized = normalizeRecordingBaselineOutput({
      facts: [
        fact("company_name", "Atlas Studio", "Taylor is the CEO of Atlas Studio.", 0.99),
      ],
    }, summary);
    assert.deepEqual(normalized, { suggestions: {} });
  });

  test("normalizes whitespace while keeping evidence grounded", () => {
    const normalized = normalizeRecordingBaselineOutput({
      facts: [
        fact("company_name", "Atlas Studio", "Taylor leads Atlas Studio.", 0.99),
      ],
    }, "Taylor  leads Atlas Studio.");
    assert.deepEqual(normalized.suggestions.company_name, {
      value: "Atlas Studio",
      confidence: 0.99,
      evidence_summary: "Taylor leads Atlas Studio.",
    });
  });

  test("accepts item-only evidence from a resolved contact-scoped follow-up", () => {
    const evidence = "Taylor asked for introductions to healthcare founders.";
    const actionItems = recordingBaselineResolvedActionItems([evidence]);
    const corpus = recordingBaselineEvidenceCorpus(summary, actionItems);
    const normalized = normalizeRecordingBaselineOutput({
      facts: [
        fact("current_asks", "Introductions to healthcare founders", evidence, 0.96),
      ],
    }, corpus);

    assert.deepEqual(actionItems, [evidence]);
    assert.equal(
      normalized.suggestions.current_asks?.value,
      "Introductions to healthcare founders",
    );
  });

  test("does not admit declined or malformed follow-up evidence", () => {
    const declinedEvidence = "Taylor wants introductions to private-equity buyers.";
    const actionItems = recordingBaselineResolvedActionItems([
      "Taylor will send the owner a service overview.",
      { status: "declined", followup_text: declinedEvidence },
    ]);
    const corpus = recordingBaselineEvidenceCorpus(summary, actionItems);
    const normalized = normalizeRecordingBaselineOutput({
      facts: [
        fact("current_asks", "Introductions to private-equity buyers", declinedEvidence, 0.98),
      ],
    }, corpus);

    assert.equal(corpus.includes(declinedEvidence), false);
    assert.equal(normalized.suggestions.current_asks, undefined);
  });

  test("requires one complete source but accepts evidence repeated across sources", () => {
    const crossSource = recordingBaselineEvidenceCorpus("Taylor serves", [
      "healthcare founders.",
    ]);
    const rejected = normalizeRecordingBaselineOutput({
      facts: [
        fact(
          "ideal_referral",
          "Healthcare founders",
          "Taylor serves healthcare founders.",
          0.98,
        ),
      ],
    }, crossSource);
    assert.equal(rejected.suggestions.ideal_referral, undefined);

    const repeated = "Taylor serves healthcare founders.";
    const accepted = normalizeRecordingBaselineOutput({
      facts: [fact("ideal_referral", "Healthcare founders", repeated, 0.98)],
    }, recordingBaselineEvidenceCorpus(repeated, [repeated]));
    assert.equal(accepted.suggestions.ideal_referral?.value, "Healthcare founders");
  });

  test("accepts only the same bounded phone syntax enforced by the database", () => {
    const evidenceText = "Taylor's phone is +1 (512) 555-0199.";
    const accepted = normalizeRecordingBaselineOutput({
      facts: [fact("phone", "+1 (512) 555-0199", evidenceText)],
    }, evidenceText);
    assert.equal(accepted.suggestions.phone?.value, "+1 (512) 555-0199");

    const tooLong = normalizeRecordingBaselineOutput({
      facts: [fact("phone", "+12 345 678 901 234 56", evidenceText)],
    }, evidenceText);
    assert.equal(tooLong.suggestions.phone, undefined);
  });

  test("builds a minimal single-contact prompt with only definitions and evidence", () => {
    const evidenceSources = recordingBaselineEvidenceSources(summary, [
      "Taylor asked for introductions to healthcare founders.",
    ]);
    const prompt = recordingBaselinePrompt({
      contact_display_name: "Taylor",
      evidence_sources: evidenceSources,
    });
    const body = JSON.parse(prompt.prompt) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), [
      "contact_display_name",
      "field_definitions",
      "evidence_sources",
    ]);
    assert.equal(body.contact_display_name, "Taylor");
    assert.deepEqual(body.field_definitions, recordingBaselineFieldDefinitions);
    assert.deepEqual(body.evidence_sources, evidenceSources);
    for (const omitted of [
      "contact_snapshot",
      "current",
      "contact_id",
      "tenant_id",
      "user_id",
      "meeting_title",
      "occurred_at",
      "is_first_confirmed_meeting",
    ]) {
      assert.equal(Object.hasOwn(body, omitted), false);
    }
    assert.doesNotMatch(prompt.prompt, /private_notes|relationship_strength/);
  });

  test("uses the v2 policy with a 2,000-token output cap and unchanged routing", () => {
    const policy = resolveAiTaskPolicy("recording_baseline", { env: {} });
    assert.equal(policy.feature, "recordings");
    assert.equal(policy.promptVersion, "recording_baseline_v2");
    assert.equal(policy.primaryModel, "anthropic/claude-sonnet-4.6");
    assert.deepEqual(policy.fallbackModels, ["openai/gpt-5.4"]);
    assert.equal(policy.maxOutputTokens, 2_000);
    assert.equal(policy.timeoutMs, 120_000);
    assert.equal(
      resolveAiTaskPolicy("recording_baseline", {
        env: { LBB_AI_RECORDING_BASELINE_TIMEOUT_MS: "45000" },
      }).timeoutMs,
      45_000,
    );
    assert.equal(resolveAiTaskPolicy("ask_answer", { env: {} }).timeoutMs, 30_000);
    const ledger = readFileSync("lib/ai/ledger.ts", "utf8");
    assert.match(ledger, /content_recorded: false/);
  });

  test("attributes audit context to the actual claimant actor without putting identifiers in the prompt", () => {
    const worker = readFileSync("lib/recordings/baseline-worker.ts", "utf8");
    const promptInput = worker.match(
      /const prompt = recordingBaselinePrompt\(\{([\s\S]*?)\n  \}\);/,
    )?.[1] ?? "";
    assert.match(promptInput, /contact_display_name:/);
    assert.match(promptInput, /evidence_sources: evidenceSources/);
    assert.doesNotMatch(
      promptInput,
      /job\.tenant_id|job\.owner_user_id|job\.contact_id|job\.meeting_title|job\.interaction_occurred_at|is_first_confirmed_meeting|contact_snapshot:/,
    );
    assert.match(worker, /tenantId: job\.tenant_id/);
    assert.match(worker, /userId: job\.actor_user_id/);
    assert.match(worker, /promptVersion: "recording_baseline_v2"/);
  });

  test("adapts v2 output to the unchanged atomic database contract", () => {
    const worker = readFileSync("lib/recordings/baseline-worker.ts", "utf8");
    const migration = readFileSync(
      "supabase/migrations/20260904015451_recording_baseline_intelligence.sql",
      "utf8",
    );
    assert.match(worker, /generateStructuredAi<RecordingBaselineModelOutput>/);
    assert.match(worker, /normalizeRecordingBaselineOutput\([\s\S]*generated\.output/);
    assert.match(worker, /p_suggestions: normalized\.suggestions/);
    assert.match(
      migration,
      /create or replace function public\.lbb_apply_recording_baseline\([\s\S]*p_suggestions jsonb/,
    );
  });

  test("keeps leased processing in the five-minute recordings cron", () => {
    const worker = readFileSync("lib/recordings/baseline-worker.ts", "utf8");
    const cron = readFileSync("app/api/automation/recordings/route.ts", "utf8");
    assert.match(worker, /lbb_claim_next_recording_baseline_job/);
    assert.match(worker, /lbb_apply_recording_baseline/);
    assert.match(worker, /lbb_fail_recording_baseline_job/);
    assert.match(worker, /lbb_apply_operator_recording_baseline/);
    assert.match(worker, /lbb_fail_operator_recording_baseline_job/);
    assert.match(worker, /job\.job_type === "recording_baseline_operator"/);
    assert.match(worker, /task: "recording_baseline"/);
    assert.match(worker, /contactId: job\.contact_id/);
    assert.match(worker, /recordingBaselineResolvedActionItems\(job\.meeting_action_items\)/);
    assert.match(worker, /recordingBaselineEvidenceSources\(/);
    assert.match(cron, /processQueuedRecordingBaselines/);
    assert.match(cron, /baselineClaimCutoffMs = 90_000/);
    assert.match(cron, /elapsedBeforeBaselineMs <= baselineClaimCutoffMs/);
    assert.match(cron, /processQueuedRecordingBaselines\(\{ admin \}\)/);
    assert.match(cron, /export const maxDuration = 240/);
  });

  test("persists confirmed meeting people before decisions and repairs late links", () => {
    const meetingContacts = readFileSync("lib/recordings/meeting-contacts.ts", "utf8");
    const recordingActions = readFileSync("app/(portal)/recordings/actions.ts", "utf8");
    const dashboardActions = readFileSync("app/(portal)/dashboard/actions.ts", "utf8");

    assert.match(meetingContacts, /lbb_confirm_meeting_contacts/);
    assert.match(meetingContacts, /p_expected_transcript_updated_at: expectedTranscriptUpdatedAt/);
    assert.match(recordingActions, /export async function confirmRecordingPeople/);
    assert.match(recordingActions, /Number\.isNaN\(Date\.parse\(submittedUpdatedAt\)\)/);
    assert.match(recordingActions, /p_meeting_contact_ids: parsed\.value\.meetingContactIds/);
    assert.match(dashboardActions, /\.eq\("processing_status", "ready"\)/);
    assert.match(dashboardActions, /confirmMeetingContacts\(\{/);
    assert.match(dashboardActions, /const candidateIds = Array\.from\(new Set\(\[\.\.\.confirmed, contactId\]\)\)/);
    assert.match(dashboardActions, /\.is\("archived_at", null\)/);
  });
});

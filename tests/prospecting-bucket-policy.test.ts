import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  defaultProspectingBuckets,
  formatProspectingBucketLines,
  getProspectingBucketMap,
  normalizeProspectingBuckets,
  parseProspectingBucketLines,
  validateProspectingCandidatePolicy,
} from "../lib/prospecting-buckets.js";
import { buildBucketResearchPrompt } from "../lib/prospecting-workflow.js";

describe("governed prospecting bucket policy", () => {
  test("does not activate templates or merge them into client settings", () => {
    assert.equal(defaultProspectingBuckets.every((bucket) => bucket.enabled === false), true);
    assert.deepEqual(getProspectingBucketMap({ prospecting: { buckets: [] } }), {});
  });

  test("normalizes the hidden policy needed for a configured bucket", () => {
    const [bucket] = normalizeProspectingBuckets([
      {
        name: "Founder prospects",
        goal: "Build trust before an offer.",
        look_for: "A real operating need.",
        intensity: "High",
        lane: "client",
        policy: {
          cadence_days: 10,
          qualifying_signals: ["hiring", "launch"],
          recommended_actions: ["offer_value"],
          allowed_sources: ["linkedin", "transcript", "unknown"],
          voice_instruction: "Direct and warm.",
          evidence_requirement: "One current source.",
          minimum_evidence_sources: 1,
          approval: "owner",
          success_definition: "A useful conversation starts.",
        },
      },
    ]);

    assert.equal(bucket.enabled, true);
    assert.equal(bucket.policy?.cadence_days, 10);
    assert.deepEqual(bucket.policy?.allowed_sources, ["linkedin", "transcript"]);
    assert.equal(bucket.policy?.approval, "owner");
    assert.equal(bucket.policy?.minimum_evidence_sources, 1);
  });

  test("round-trips structured operator line configuration", () => {
    const configured = parseProspectingBucketLines(
      "Founder prospects | Build trust | hiring or launch | High | client | 10 | hiring, launch | offer_value, make_offer | linkedin, transcript | direct and warm | one current source | owner | useful conversation",
    );
    const reparsed = parseProspectingBucketLines(formatProspectingBucketLines(configured));
    assert.deepEqual(reparsed, configured);
  });

  test("puts every hidden bucket control into the operational research contract", () => {
    const [bucket] = normalizeProspectingBuckets([
      {
        name: "Founder prospects",
        goal: "Build trust before an offer.",
        look_for: "A real operating need.",
        intensity: "High",
        lane: "client",
        policy: {
          cadence_days: 10,
          qualifying_signals: ["hiring", "launch"],
          recommended_actions: ["offer_value"],
          allowed_sources: ["linkedin", "transcript"],
          voice_instruction: "Direct and warm.",
          evidence_requirement: "One current source.",
          approval: "owner",
          success_definition: "A useful conversation starts.",
        },
      },
    ]);
    const prompt = buildBucketResearchPrompt(bucket);

    assert.match(prompt, /wait 10 days/i);
    assert.match(prompt, /hiring, launch/i);
    assert.match(prompt, /offer_value/i);
    assert.match(prompt, /linkedin, transcript/i);
    assert.match(prompt, /Direct and warm/i);
    assert.match(prompt, /One current source/i);
    assert.match(prompt, /Required approval: owner/i);
    assert.match(prompt, /A useful conversation starts/i);
    assert.match(prompt, /Reject a candidate or action that violates/i);
  });

  test("rejects unconfigured buckets, disallowed sources, signals, actions, and reviewers", () => {
    const buckets = normalizeProspectingBuckets([
      {
        name: "Founder prospects",
        policy: {
          qualifying_signals: ["hiring"],
          recommended_actions: ["offer_value"],
          allowed_sources: ["linkedin"],
          approval: "owner",
        },
      },
    ]);
    const base = {
      candidate: {
        full_name: "Avery Rhodes",
        bucket: "Founder prospects",
        source_type: "linkedin",
        recommended_action: "offer_value",
        qualifying_signals: ["hiring"],
      },
      evidence: {
        source_summary: "A current public hiring post.",
        source_ref: "https://www.linkedin.com/posts/current-hiring-post",
      },
    };
    const settings = { prospecting: { buckets } };

    assert.equal(validateProspectingCandidatePolicy({ settings, payload: base }).ok, true);
    assert.equal(
      validateProspectingCandidatePolicy({
        settings,
        payload: { ...base, candidate: { ...base.candidate, bucket: "Hidden play" } },
      }).ok,
      false,
    );
    assert.equal(
      validateProspectingCandidatePolicy({
        settings,
        payload: { ...base, candidate: { ...base.candidate, source_type: "email" } },
      }).ok,
      false,
    );
    assert.equal(
      validateProspectingCandidatePolicy({ settings, payload: base, reviewerRole: "operator" }).ok,
      false,
    );
    assert.equal(
      validateProspectingCandidatePolicy({ settings, payload: base, reviewerRole: "owner" }).ok,
      true,
    );

    const strictSettings = {
      prospecting: {
        buckets: normalizeProspectingBuckets([
          {
            name: "Founder prospects",
            policy: {
              cadence_days: 30,
              qualifying_signals: ["hiring"],
              recommended_actions: ["offer_value"],
              allowed_sources: ["linkedin"],
              evidence_requirement: "Two independent current sources.",
              minimum_evidence_sources: 2,
              approval: "owner",
            },
          },
        ]),
      },
    };
    assert.equal(
      validateProspectingCandidatePolicy({
        settings: strictSettings,
        payload: {
          ...base,
          candidate: { ...base.candidate, last_touch: new Date().toISOString() },
          evidence: { ...base.evidence, source_refs: [base.evidence.source_ref] },
        },
      }).ok,
      false,
    );
    assert.equal(
      validateProspectingCandidatePolicy({
        settings: strictSettings,
        payload: {
          ...base,
          candidate: {
            ...base.candidate,
            last_touch: "2026-08-01T00:00:00Z",
            qualifying_signal_observed_at: "2026-08-22T00:00:00Z",
          },
          evidence: {
            ...base.evidence,
            source_refs: [
              base.evidence.source_ref,
              "transcript:verified-second-source",
            ],
          },
        },
      }).ok,
      true,
    );
  });
});

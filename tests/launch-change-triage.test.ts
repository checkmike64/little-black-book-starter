import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildLaunchChangeTriage,
  type LaunchTriageChange,
} from "../lib/launch-change-triage.js";

function change(
  id: string,
  overrides: Partial<LaunchTriageChange> = {},
): LaunchTriageChange {
  return {
    id,
    contact_id: id,
    contact: { full_name: `Person ${id}`, company_name: null },
    change_type: "contact_enrichment",
    summary: "Propose relationship type",
    payload: {
      fields: { relationship_type: ["Peer"] },
      confidence: "low",
      evidence: {
        verified_with_owner: false,
        verification_summary: "Existing context stores how we met as Mastermind.",
      },
    },
    risk_level: "high",
    source: "quality_cleanup_followup",
    created_at: "2026-07-22T12:00:00.000Z",
    replaces_pending_change_id: null,
    replaced_by_pending_change_id: null,
    superseded_at: null,
    ...overrides,
  };
}

describe("launch change triage", () => {
  test("separates dry runs, repeated judgments, and individual proposals", () => {
    const dryRun = change("dry", {
      payload: { fields: { one_line_summary: "Existing summary" }, dry_run: true },
      source: "ops_enrichment_dry_run",
    });
    const peerA = change("peer-a");
    const peerB = change("peer-b");
    const individual = change("individual", {
      payload: {
        fields: { relationship_type: ["Referral Partner", "Peer"] },
        confidence: "medium",
      },
    });

    const triage = buildLaunchChangeTriage([dryRun, peerA, peerB, individual]);

    assert.deepEqual(triage.testArtifacts.map((row) => row.id), ["dry"]);
    assert.equal(triage.cohorts.length, 1);
    assert.deepEqual(triage.cohorts[0].rows.map((row) => row.id), ["peer-a", "peer-b"]);
    assert.equal(triage.cohorts[0].proposedValue, "Peer");
    assert.deepEqual(triage.individualRows.map((row) => row.id), ["individual"]);
  });

  test("does not cohort owner-verified or one-off judgments", () => {
    const verified = change("verified", {
      payload: {
        fields: { relationship_type: ["Peer"] },
        confidence: "low",
        evidence: { verified_with_owner: true },
      },
    });

    const triage = buildLaunchChangeTriage([verified, change("one-off")]);

    assert.equal(triage.cohorts.length, 0);
    assert.deepEqual(triage.individualRows.map((row) => row.id), ["verified", "one-off"]);
  });
});

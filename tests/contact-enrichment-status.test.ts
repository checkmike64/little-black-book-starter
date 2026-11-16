import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contactEnrichmentStatus } from "../lib/contact-enrichment-status.js";

describe("contact enrichment status", () => {
  test("prioritizes active research over earlier results", () => {
    assert.deepEqual(
      contactEnrichmentStatus({
        activeJob: { status: "running" },
        latestJob: { status: "succeeded" },
        pendingChangeCount: 2,
        unresolvedGapCount: 1,
      }),
      {
        label: "Researching",
        detail: "Claude is checking source context and public profiles.",
        tone: "hot",
      },
    );
  });

  test("points completed research with suggestions to Changes", () => {
    assert.deepEqual(
      contactEnrichmentStatus({
        activeJob: null,
        latestJob: { status: "succeeded" },
        pendingChangeCount: 1,
        unresolvedGapCount: 1,
      }),
      {
        label: "Review ready",
        detail: "1 suggested update is waiting in Changes.",
        tone: "gold",
      },
    );
  });

  test("uses a plain idle state when research has not run", () => {
    assert.equal(
      contactEnrichmentStatus({
        activeJob: null,
        latestJob: null,
        pendingChangeCount: 0,
        unresolvedGapCount: 2,
      }).label,
      "Not searched",
    );
  });

  test("does not call incomplete research complete", () => {
    assert.deepEqual(
      contactEnrichmentStatus({
        activeJob: null,
        latestJob: { status: "succeeded" },
        pendingChangeCount: 0,
        unresolvedGapCount: 1,
      }),
      {
        label: "More research needed",
        detail: "The last search finished, but public profile details are still missing.",
        tone: "warn",
      },
    );
  });

  test("calls research complete only when required profile groups are filled", () => {
    assert.equal(
      contactEnrichmentStatus({
        activeJob: null,
        latestJob: { status: "succeeded" },
        pendingChangeCount: 0,
        unresolvedGapCount: 0,
      }).label,
      "Research complete",
    );
  });
});

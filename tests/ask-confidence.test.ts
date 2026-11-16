import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildAskConfidence } from "../lib/ask-confidence.js";

const deepSources = {
  contacts: 50,
  interactions: 15,
  promises: 4,
  changes: 3,
  jobs: 2,
  connections: 8,
};

const thinSources = {
  contacts: 8,
  interactions: 1,
  promises: 0,
  changes: 0,
  jobs: 0,
  connections: 0,
};

describe("ask confidence", () => {
  test("flags empty Ask results as not confident", () => {
    const confidence = buildAskConfidence({
      activeJobCount: 0,
      evidenceCount: 0,
      mode: "search",
      pendingChangeCount: 0,
      resultCount: 0,
      sourceCounts: deepSources,
      topScore: 0,
    });

    assert.equal(confidence.label, "No confident answer");
    assert.equal(confidence.tone, "warn");
  });

  test("requires verification when pending changes may alter the answer", () => {
    const confidence = buildAskConfidence({
      activeJobCount: 0,
      evidenceCount: 3,
      mode: "referrals",
      pendingChangeCount: 2,
      resultCount: 4,
      sourceCounts: deepSources,
      topScore: 96,
    });

    assert.equal(confidence.label, "Verify before acting");
    assert.equal(confidence.tone, "warn");
    assert.ok(confidence.reasons.some((reason) => reason.includes("pending change")));
  });

  test("marks low-evidence results as usable but thin", () => {
    const confidence = buildAskConfidence({
      activeJobCount: 0,
      evidenceCount: 1,
      mode: "search",
      pendingChangeCount: 0,
      resultCount: 2,
      sourceCounts: thinSources,
      topScore: 44,
    });

    assert.equal(confidence.label, "Usable but thin");
    assert.equal(confidence.tone, "neutral");
  });

  test("marks grounded mode-specific results ready to inspect", () => {
    const confidence = buildAskConfidence({
      activeJobCount: 0,
      evidenceCount: 6,
      mode: "podcasts",
      pendingChangeCount: 0,
      resultCount: 5,
      sourceCounts: deepSources,
      topScore: 90,
    });

    assert.equal(confidence.label, "Ready to inspect");
    assert.equal(confidence.tone, "ok");
    assert.ok(
      confidence.reasons.includes("mode-specific fit matched stored context"),
    );
  });
});

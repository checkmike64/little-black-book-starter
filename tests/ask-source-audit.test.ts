import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildAskSourceAudit } from "../lib/ask-source-audit.js";

const sourceCounts = {
  contacts: 20,
  interactions: 12,
  promises: 2,
  changes: 0,
  jobs: 1,
  connections: 4,
};

describe("ask source audit", () => {
  test("marks relationship evidence-backed answers ok", () => {
    const audit = buildAskSourceAudit({
      evidence: ["interaction", "connection"],
      sourceCounts,
    });

    assert.equal(audit.label, "Evidence-backed");
    assert.equal(audit.tone, "ok");
    assert.equal(audit.evidenceTypeCounts.interaction, 1);
    assert.equal(audit.evidenceTypeCounts.connection, 1);
  });

  test("flags pending review and Claude output as review-dependent", () => {
    const audit = buildAskSourceAudit({
      evidence: ["change", "command"],
      sourceCounts,
    });

    assert.equal(audit.label, "Review-dependent");
    assert.equal(audit.tone, "warn");
    assert.match(audit.recommendation, /pending changes or Claude outputs/);
  });

  test("treats contact-only answers as shortlist material", () => {
    const audit = buildAskSourceAudit({
      evidence: [],
      sourceCounts: {
        contacts: 4,
        interactions: 0,
        promises: 0,
        changes: 0,
        jobs: 0,
        connections: 0,
      },
    });

    assert.equal(audit.label, "Contact-field match");
    assert.equal(audit.tone, "neutral");
    assert.ok(audit.gaps.includes("no source-grounded evidence matched this query"));
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildClientHandoffEvidencePack,
  formatClientHandoffEvidencePack,
  type ClientHandoffEvidenceInput,
} from "../lib/client-handoff-evidence.js";

function input(overrides: Partial<ClientHandoffEvidenceInput> = {}) {
  return {
    tenantName: "Moll Group",
    generatedAt: "2026-07-20T12:00:00.000Z",
    launchStatus: "Ready",
    launchCompleted: 13,
    launchTotal: 13,
    installStage: "ready",
    installStageDetail: "Launch evidence is complete.",
    actionSummary: "Launch evidence is complete.",
    nextActions: [],
    nextSprints: [],
    claudeFirstJobs: [],
    moduleProof: [],
    enabledModules: ["Ask", "Networking", "Want to Know"],
    hiddenModules: ["Engagement"],
    contactCount: 88,
    qualityAverage: 92,
    weakRecordCount: 0,
    highValueWeakCount: 0,
    pendingReviewCount: 0,
    commandJobCount: 4,
    askRunCount: 3,
    askRunUndecidedCount: 0,
    rehearsalJobStatus: "succeeded",
    rehearsalActionStatus: "done",
    launchNotes: "Owner sees the finished Book first.",
    ...overrides,
  };
}

describe("client handoff evidence", () => {
  test("marks complete clean evidence ready for owner", () => {
    const pack = buildClientHandoffEvidencePack(input());

    assert.equal(pack.readyForOwner, true);
    assert.equal(pack.riskLevel, "low");
  });

  test("keeps pending review and undecided Ask runs high risk", () => {
    const pack = buildClientHandoffEvidencePack(
      input({
        launchCompleted: 11,
        pendingReviewCount: 2,
        askRunUndecidedCount: 1,
      }),
    );

    assert.equal(pack.readyForOwner, false);
    assert.equal(pack.riskLevel, "high");
    assert.match(pack.riskSummary, /pending review/);
    assert.match(pack.riskSummary, /undecided saved Ask run/);
  });

  test("formats a copyable operator packet", () => {
    const pack = buildClientHandoffEvidencePack(
      input({
        nextActions: [
          {
            label: "Clear proposed changes",
            detail: "Two proposed changes need review.",
            href: "/changes",
            lane: "fix_now",
          },
        ],
        nextSprints: [
          {
            label: "Run one real Ask query",
            detail: "Use a week-one owner question.",
            href: "/ask",
            lane: "proof",
          },
        ],
        claudeFirstJobs: [
          {
            label: "Seed each prospecting bucket",
            detail: "Add one verified candidate per bucket.",
            href: "/want-to-know",
          },
        ],
        moduleProof: [
          {
            label: "Ask",
            detail: "One Ask run is saved with a decision.",
            status: "pass",
            href: "/ask",
          },
        ],
      }),
    );
    const text = formatClientHandoffEvidencePack(pack);

    assert.match(text, /Little Black Book handoff evidence: Moll Group/);
    assert.match(text, /Enabled modules:/);
    assert.match(text, /Install stage: ready/);
    assert.match(text, /1\. Clear proposed changes \[fix_now\]/);
    assert.match(text, /Next install sprints:/);
    assert.match(text, /1\. Run one real Ask query \[proof\]/);
    assert.match(text, /Claude first jobs:/);
    assert.match(text, /1\. Seed each prospecting bucket/);
    assert.match(text, /Module proof:/);
    assert.match(text, /1\. Ask - pass: One Ask run is saved with a decision/);
    assert.match(text, /Owner sees the finished Book first/);
  });
});

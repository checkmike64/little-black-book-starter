import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  bucketOperatingHealth,
  bucketOperatingRows,
  buildBucketOperatingPrompt,
  buildProspectingBucketSetupRows,
  type ProspectingOpsCandidate,
} from "../lib/prospecting-ops.js";

const bucketMap = {
  "Podcast hosts": {
    name: "Podcast hosts",
    goal: "Earn the right to pitch a useful guest angle.",
    look_for: "Audience overlap and recent episode gaps.",
    intensity: "Medium" as const,
    lane: "podcast",
  },
  "Acquisition targets": {
    name: "Acquisition targets",
    goal: "Research fit before direct outreach.",
    look_for: "Succession, ownership, and warm-path signals.",
    intensity: "High" as const,
    lane: "M&A",
  },
};

function candidate(
  overrides: Partial<ProspectingOpsCandidate>,
): ProspectingOpsCandidate {
  return {
    id: "candidate-1",
    full_name: "Avery Rhodes",
    bucket: "Podcast hosts",
    lane: "podcast",
    stage: "watching",
    company: "Signal Media",
    source: "research",
    why: "Audience overlaps with owner expertise.",
    linkedin: null,
    dossier: null,
    engagement_count: 0,
    last_touch: null,
    priority: 20,
    action: "Research fit.",
    intensity: "Medium",
    staleDays: null,
    ...overrides,
  };
}

describe("prospecting ops", () => {
  test("prioritizes owner decisions above other bucket pressure", () => {
    const health = bucketOperatingHealth({
      activeCount: 3,
      readyCount: 1,
      staleCount: 1,
      warmingCount: 1,
    });

    assert.equal(health.status, "owner_decision");
    assert.equal(health.tone, "hot");
  });

  test("marks empty configured buckets as seedable", () => {
    const rows = bucketOperatingRows([], bucketMap);
    const acquisition = rows.find((row) => row.bucket === "Acquisition targets");

    assert.equal(acquisition?.health.status, "seed");
    assert.match(acquisition?.health.nextAction ?? "", /Book's goal/i);
  });

  test("keeps bucket health bucket-agnostic", () => {
    const rows = bucketOperatingRows(
      [
        candidate({ bucket: "Podcast hosts", stage: "warming", staleDays: 5 }),
        candidate({
          id: "candidate-2",
          full_name: "Morgan Lee",
          bucket: "Acquisition targets",
          lane: "M&A",
          stage: "watching",
          staleDays: 30,
          intensity: "High",
        }),
      ],
      bucketMap,
    );

    assert.equal(rows.find((row) => row.bucket === "Podcast hosts")?.health.status, "warm");
    assert.equal(rows.find((row) => row.bucket === "Acquisition targets")?.health.status, "stale");
  });

  test("adds health and next action to bucket prompts", () => {
    const prompt = buildBucketOperatingPrompt({
      bucket: "Podcast hosts",
      candidates: [candidate({ stage: "ready" })],
      config: bucketMap["Podcast hosts"],
    });

    assert.match(prompt, /Current bucket health: Owner decision/);
    assert.match(prompt, /Next action:/);
    assert.match(prompt, /Do not create Book contacts directly/);
  });

  test("builds custom bucket setup rows ahead of defaults", () => {
    const rows = bucketOperatingRows(
      [
        candidate({
          bucket: "Investor targets",
          lane: "investor",
          stage: "watching",
        }),
      ],
      {
        ...bucketMap,
        "Investor targets": {
          name: "Investor targets",
          goal: "Research thesis fit before asking for capital attention.",
          look_for: "Portfolio fit and warm-path signals.",
          intensity: "Low" as const,
          lane: "investor",
        },
      },
    );

    const setupRows = buildProspectingBucketSetupRows({
      rows,
      customBucketNames: ["Investor targets"],
      pendingProposalBuckets: ["Acquisition targets"],
    });

    assert.equal(setupRows[0]?.bucket, "Investor targets");
    assert.equal(setupRows[0]?.source, "client");
    assert.equal(setupRows[0]?.status, "configured");
    assert.equal(
      setupRows.find((row) => row.bucket === "Acquisition targets")?.status,
      "pending_review",
    );
  });

  test("flags custom buckets that still need source criteria", () => {
    const rows = bucketOperatingRows([], {
      "Strategic partners": {
        name: "Strategic partners",
        goal: "",
        look_for: "",
        intensity: "Low" as const,
        lane: "partner",
      },
    });

    const setupRows = buildProspectingBucketSetupRows({
      rows,
      customBucketNames: ["Strategic partners"],
      pendingProposalBuckets: [],
    });

    assert.equal(setupRows[0]?.status, "needs_config");
    assert.match(setupRows[0]?.action ?? "", /Capture the bucket goal/);
  });
});

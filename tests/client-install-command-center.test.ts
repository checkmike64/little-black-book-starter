import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildClientInstallCommandCenter,
  type ClientInstallCommandCenterInput,
} from "../lib/client-install-command-center.js";

function input(
  overrides: Partial<ClientInstallCommandCenterInput> = {},
): ClientInstallCommandCenterInput {
  return {
    tenantName: "Example Client",
    contactCount: 30,
    enabledModules: ["Ask", "Want to Know", "Networking"],
    prospectingBucketCount: 2,
    highValueWeakCount: 0,
    pendingReviewCount: 0,
    askRunCount: 1,
    askRunUndecidedCount: 0,
    commandJobCount: 1,
    rehearsalComplete: true,
    launchReady: false,
    launchNotesReady: true,
    deploymentReady: true,
    productionSignoffReady: true,
    operatorQuestions: [],
    launchNextActions: [],
    moduleProofItems: [
      {
        key: "module-ask",
        label: "Ask module is proven",
        detail: "One Ask run is saved with a decision.",
        status: "pass",
        href: "/ask",
      },
      {
        key: "module-want-to-know",
        label: "Want to Know module is proven",
        detail: "Seed one bucketed candidate.",
        status: "action",
        href: "/want-to-know",
      },
    ],
    ...overrides,
  };
}

describe("client install command center", () => {
  test("starts in configure mode when critical setup or first data is missing", () => {
    const center = buildClientInstallCommandCenter(
      input({
        contactCount: 0,
        enabledModules: [],
        operatorQuestions: [
          {
            key: "network-thesis",
            question: "What is the client trying to make happen?",
            why: "The install needs a thesis.",
            href: "/intake",
            priority: "critical",
          },
        ],
      }),
    );

    assert.equal(center.stage, "configure");
    assert.equal(center.tiles[0]?.tone, "warn");
    assert.ok(center.sprints.some((sprint) => sprint.href === "/intake"));
    assert.ok(center.claudeFirstJobs.some((job) => job.label === "Import first relationship set"));
  });

  test("prioritizes review mode before proof when trust-sensitive cleanup is open", () => {
    const center = buildClientInstallCommandCenter(
      input({
        highValueWeakCount: 2,
        pendingReviewCount: 4,
        askRunUndecidedCount: 1,
      }),
    );

    assert.equal(center.stage, "review");
    assert.ok(center.sprints.some((sprint) => sprint.href === "/quality"));
    assert.ok(center.sprints.some((sprint) => sprint.href === "/changes"));
    assert.ok(center.claudeFirstJobs.some((job) => job.href === "/quality"));
  });

  test("moves to proof mode when configuration is present but operating loops are unproven", () => {
    const center = buildClientInstallCommandCenter(
      input({
        askRunCount: 0,
        commandJobCount: 0,
        rehearsalComplete: false,
      }),
    );

    assert.equal(center.stage, "prove");
    assert.ok(center.sprints.some((sprint) => sprint.label === "Run one real Ask query"));
    assert.ok(center.sprints.some((sprint) => sprint.label === "Run one Claude command job"));
    assert.ok(center.claudeFirstJobs.some((job) => job.href === "/want-to-know"));
  });

  test("surfaces module-level proof for enabled workflow verification", () => {
    const center = buildClientInstallCommandCenter(input());

    assert.deepEqual(
      center.moduleProof.map((item) => [item.label, item.status, item.href]),
      [
        ["Ask", "pass", "/ask"],
        ["Want to Know", "action", "/want-to-know"],
      ],
    );
    assert.equal(center.tiles.find((tile) => tile.label === "Module proof")?.value, "1/2");
  });

  test("moves to ready mode when launch evidence is complete", () => {
    const center = buildClientInstallCommandCenter(input({ launchReady: true }));

    assert.equal(center.stage, "ready");
    assert.match(center.title, /ready for owner handoff/);
    assert.equal(center.tiles[2]?.value, "3/3");
  });
});

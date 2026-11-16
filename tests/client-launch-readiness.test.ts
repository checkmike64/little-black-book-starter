import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildClientLaunchChecklist,
  buildLaunchActionPlan,
  type LaunchEvidence,
} from "../lib/client-launch-readiness.js";

function evidence(overrides: Partial<LaunchEvidence> = {}): LaunchEvidence {
  return {
    deploymentReady: true,
    deploymentBlockingCount: 0,
    tenantReady: true,
    contactCount: 42,
    qualityAverage: 91,
    weakRecordCount: 0,
    highValueWeakCount: 0,
    installPlanPercent: 100,
    installPlanBlocked: 0,
    enabledModuleCount: 5,
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
        detail: "One candidate is available.",
        status: "pass",
        href: "/want-to-know",
      },
      {
        key: "module-engagement",
        label: "Engagement module is proven",
        detail: "One command output exists.",
        status: "pass",
        href: "/engagement",
      },
      {
        key: "module-networking",
        label: "Networking module is proven",
        detail: "One relationship action exists.",
        status: "pass",
        href: "/networking",
      },
      {
        key: "module-changes",
        label: "Changes workflow is proven",
        detail: "One proposed profile update is ready for review.",
        status: "pass",
        href: "/changes",
      },
    ],
    acceptanceReady: true,
    acceptanceCompleted: 9,
    acceptanceTotal: 9,
    acceptanceNextAction: {
      key: "done",
      label: "Acceptance complete",
      detail: "Everything is ready.",
      status: "pass",
      href: "/ops",
    },
    pendingReviewCount: 0,
    reviewQueueComplete: true,
    commandJobCount: 2,
    rehearsalJobSucceeded: true,
    rehearsalActionClosed: true,
    askRunCount: 1,
    askRunUndecidedCount: 0,
    launchNotesReady: true,
    noindexReady: true,
    ...overrides,
  };
}

describe("client launch readiness", () => {
  test("marks the install ready when every launch signal passes", () => {
    const checklist = buildClientLaunchChecklist(evidence());

    assert.equal(checklist.ready, true);
    assert.equal(checklist.statusLabel, "Ready");
    assert.equal(checklist.completed, checklist.total);
    assert.equal(checklist.actionCount, 0);
    assert.equal(checklist.waitingCount, 0);
  });

  test("keeps rehearsal waiting until command output evidence exists", () => {
    const checklist = buildClientLaunchChecklist(
      evidence({
        commandJobCount: 0,
        rehearsalJobSucceeded: false,
        rehearsalActionClosed: false,
      }),
    );

    const commandOutput = checklist.items.find(
      (item) => item.key === "command-output",
    );
    const rehearsal = checklist.items.find((item) => item.key === "rehearsal");

    assert.equal(checklist.ready, false);
    assert.equal(commandOutput?.status, "action");
    assert.equal(rehearsal?.status, "waiting");
    assert.equal(checklist.nextAction.key, "command-output");
  });

  test("surfaces review queue pressure before handoff", () => {
    const checklist = buildClientLaunchChecklist(
      evidence({
        pendingReviewCount: 3,
      }),
    );

    const review = checklist.items.find((item) => item.key === "review-pressure");

    assert.equal(checklist.ready, false);
    assert.equal(review?.status, "action");
    assert.match(review?.detail ?? "", /3 pending changes/);
  });

  test("does not call the review queue clear when the observation is incomplete", () => {
    const checklist = buildClientLaunchChecklist(
      evidence({
        pendingReviewCount: 0,
        reviewQueueComplete: false,
      }),
    );

    const review = checklist.items.find((item) => item.key === "review-pressure");

    assert.equal(checklist.ready, false);
    assert.equal(review?.status, "waiting");
    assert.match(review?.detail ?? "", /could not be reconciled/);
  });

  test("blocks launch when high-value relationship records have gaps", () => {
    const checklist = buildClientLaunchChecklist(
      evidence({
        qualityAverage: 82,
        weakRecordCount: 4,
        highValueWeakCount: 2,
      }),
    );

    const quality = checklist.items.find((item) => item.key === "data-quality");

    assert.equal(checklist.ready, false);
    assert.equal(quality?.status, "action");
    assert.match(quality?.detail ?? "", /2 high-value records/);
  });

  test("blocks launch when saved Ask runs have no decision", () => {
    const checklist = buildClientLaunchChecklist(
      evidence({
        askRunCount: 3,
        askRunUndecidedCount: 2,
      }),
    );

    const ask = checklist.items.find((item) => item.key === "ask");

    assert.equal(checklist.ready, false);
    assert.equal(ask?.status, "action");
    assert.equal(ask?.href, "/ask?saved=needs_decision");
    assert.match(ask?.detail ?? "", /2 saved Ask runs/);
  });

  test("blocks launch when an enabled module still needs proof", () => {
    const checklist = buildClientLaunchChecklist(
      evidence({
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
      }),
    );

    const moduleProof = checklist.items.find(
      (item) => item.key === "module-proof",
    );

    assert.equal(checklist.ready, false);
    assert.equal(moduleProof?.status, "action");
    assert.equal(moduleProof?.href, "/want-to-know");
    assert.match(moduleProof?.detail ?? "", /1\/2 enabled workflow proof/);
    assert.match(moduleProof?.detail ?? "", /Want to Know module/);
  });

  test("waits on module proof until owner-facing modules are selected", () => {
    const checklist = buildClientLaunchChecklist(
      evidence({
        enabledModuleCount: 0,
        moduleProofItems: [],
      }),
    );

    const modules = checklist.items.find((item) => item.key === "modules");
    const moduleProof = checklist.items.find(
      (item) => item.key === "module-proof",
    );

    assert.equal(checklist.ready, false);
    assert.equal(modules?.status, "action");
    assert.equal(moduleProof?.status, "waiting");
  });

  test("blocks launch until production privacy signoff is confirmed", () => {
    const checklist = buildClientLaunchChecklist(
      evidence({
        noindexReady: false,
      }),
    );

    const privacy = checklist.items.find((item) => item.key === "privacy");

    assert.equal(checklist.ready, false);
    assert.equal(privacy?.status, "action");
    assert.equal(privacy?.href, "/deployment");
    assert.match(privacy?.detail ?? "", /production signoff/);
  });

  test("builds a ranked launch action plan from non-passing checklist items", () => {
    const checklist = buildClientLaunchChecklist(
      evidence({
        deploymentReady: false,
        deploymentBlockingCount: 2,
        pendingReviewCount: 4,
        launchNotesReady: false,
      }),
    );
    const plan = buildLaunchActionPlan(checklist.items);

    assert.equal(plan.fixNow.length, 3);
    assert.equal(plan.waiting.length, 0);
    assert.equal(plan.next[0]?.key, "deployment");
    assert.match(plan.summary, /3 fix-now items/);
  });

  test("keeps waiting launch actions below actionable blockers", () => {
    const checklist = buildClientLaunchChecklist(
      evidence({
        commandJobCount: 0,
        rehearsalJobSucceeded: false,
        rehearsalActionClosed: false,
        askRunCount: 0,
      }),
    );
    const plan = buildLaunchActionPlan(checklist.items);

    assert.equal(plan.next[0]?.key, "command-output");
    assert.equal(plan.waiting[0]?.key, "rehearsal");
  });
});

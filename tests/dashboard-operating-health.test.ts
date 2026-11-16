import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildDashboardOperatingHealth } from "../lib/dashboard-operating-health.js";

function input(overrides = {}) {
  return {
    setupMode: false,
    deploymentReady: true,
    hasTenantContext: true,
    intakePercent: 100,
    contactCount: 50,
    enabledModuleCount: 5,
    pendingChangeCount: 0,
    duePromiseCount: 0,
    queuedJobCount: 0,
    askRunUndecidedCount: 0,
    untrackedCommandOutputs: 0,
    hotRelationshipActions: 0,
    staleUsefulContacts: 0,
    ...overrides,
  };
}

describe("dashboard operating health", () => {
  test("marks a fully settled operating day healthy", () => {
    const health = buildDashboardOperatingHealth(input());

    assert.equal(health.statusLabel, "Healthy");
    assert.equal(health.actionCount, 0);
    assert.equal(health.waitingCount, 0);
    assert.equal(health.completed, health.total);
    assert.equal(health.score, 100);
  });

  test("prioritizes privacy and production wiring before operating cleanup", () => {
    const health = buildDashboardOperatingHealth(
      input({
        setupMode: true,
        deploymentReady: false,
        hasTenantContext: false,
        pendingChangeCount: 4,
        duePromiseCount: 2,
      }),
    );

    assert.equal(health.statusLabel, "Needs attention");
    assert.equal(health.nextAction.key, "production");
    assert.equal(health.items.find((item) => item.key === "tenant")?.status, "action");
  });

  test("waits on downstream workflows until relationship data exists", () => {
    const health = buildDashboardOperatingHealth(
      input({
        contactCount: 0,
        duePromiseCount: 0,
        untrackedCommandOutputs: 0,
        askRunUndecidedCount: 0,
      }),
    );

    assert.equal(health.items.find((item) => item.key === "relationship-data")?.status, "action");
    assert.equal(health.items.find((item) => item.key === "promise-pressure")?.status, "waiting");
    assert.equal(health.items.find((item) => item.key === "ask-decisions")?.status, "waiting");
  });

  test("surfaces closed-loop pressure from Ask and command outputs", () => {
    const health = buildDashboardOperatingHealth(
      input({
        askRunUndecidedCount: 3,
        untrackedCommandOutputs: 2,
      }),
    );

    assert.equal(health.actionCount, 2);
    assert.equal(health.items.find((item) => item.key === "ask-decisions")?.href, "/ask?saved=needs_decision");
    assert.equal(health.items.find((item) => item.key === "command-output")?.status, "action");
  });
});

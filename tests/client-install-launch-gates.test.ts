import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildClientInstallLaunchGates,
  type ClientInstallLaunchGateInput,
} from "../lib/client-install-launch-gates.js";

function input(
  overrides: Partial<ClientInstallLaunchGateInput> = {},
): ClientInstallLaunchGateInput {
  return {
    deploymentReady: true,
    deploymentBlockingCount: 0,
    productionSignoffReady: true,
    productionSignoffMissing: 0,
    installPlanPercent: 100,
    installPlanBlocked: 0,
    missingSetupCount: 0,
    enabledModuleCount: 5,
    claudeTokenReady: true,
    claudeSetupReady: true,
    liveSmokeReady: true,
    ownerSmokeReady: true,
    ...overrides,
  };
}

describe("client install launch gates", () => {
  test("marks the client install clear when all gates pass", () => {
    const gates = buildClientInstallLaunchGates(input());

    assert.equal(gates.ready, true);
    assert.equal(gates.pass, gates.total);
    assert.equal(gates.action, 0);
    assert.match(gates.summary, /clear/);
  });

  test("prioritizes deployment blockers before dependent signoff work", () => {
    const gates = buildClientInstallLaunchGates(
      input({
        deploymentReady: false,
        deploymentBlockingCount: 2,
        productionSignoffReady: false,
        productionSignoffMissing: 3,
      }),
    );
    const deployment = gates.gates.find((gate) => gate.key === "deployment");
    const signoff = gates.gates.find(
      (gate) => gate.key === "production-signoff",
    );

    assert.equal(gates.ready, false);
    assert.equal(gates.next?.key, "deployment");
    assert.equal(deployment?.status, "action");
    assert.equal(signoff?.status, "waiting");
  });

  test("flags missing concierge setup separately from module fit", () => {
    const gates = buildClientInstallLaunchGates(
      input({
        installPlanPercent: 66,
        missingSetupCount: 2,
        enabledModuleCount: 0,
      }),
    );
    const setup = gates.gates.find((gate) => gate.key === "install-plan");
    const modules = gates.gates.find((gate) => gate.key === "modules");

    assert.equal(setup?.status, "action");
    assert.equal(modules?.status, "action");
    assert.match(setup?.detail ?? "", /2 setup items/);
    assert.match(modules?.detail ?? "", /Enable only the workflows/);
  });

  test("keeps Claude setup waiting until deployment inputs are ready", () => {
    const gates = buildClientInstallLaunchGates(
      input({
        deploymentReady: false,
        deploymentBlockingCount: 1,
        claudeTokenReady: false,
        claudeSetupReady: true,
      }),
    );
    const claude = gates.gates.find((gate) => gate.key === "claude");

    assert.equal(claude?.status, "waiting");
    assert.equal(claude?.href, "/claude-setup");
  });
});

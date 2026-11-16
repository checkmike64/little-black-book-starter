import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  productionCheckEvidence,
  productionCheckItems,
  type ProductionCheckKey,
} from "../lib/deployment-readiness.js";
import {
  buildClientInstallLaunchGates,
  type ClientInstallLaunchGateInput,
} from "../lib/client-install-launch-gates.js";

const commercialCheckKeys = [
  "commercial_agreement_signed",
  "billing_owner_and_collection_ready",
  "support_contact_and_process_ready",
  "backup_and_restore_proven",
  "retention_and_offboarding_ready",
  "owner_acceptance_recorded",
] as const satisfies readonly ProductionCheckKey[];

function launchInput(
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

function confirmedCheck() {
  return {
    confirmed: true,
    confirmed_at: "2026-08-28T12:00:00.000Z",
    confirmed_by: "operator@example.com",
    evidence_ref: "packet-2026-08-28/check",
  };
}

describe("first-cohort commercial production checks", () => {
  test("registers every required commercial and operational confirmation", () => {
    assert.deepEqual(
      productionCheckItems
        .map((item) => item.key)
        .filter((key) => commercialCheckKeys.includes(key as (typeof commercialCheckKeys)[number])),
      commercialCheckKeys,
    );
  });

  test("fails closed when only the original technical checks are confirmed", () => {
    const commercialKeySet = new Set<ProductionCheckKey>(commercialCheckKeys);
    const technicalChecks = productionCheckItems.filter(
      (item) => !commercialKeySet.has(item.key),
    );
    const evidence = productionCheckEvidence({
      delivery: {
        production_checks: Object.fromEntries(
          technicalChecks.map((item) => [item.key, confirmedCheck()]),
        ),
      },
    });
    const gates = buildClientInstallLaunchGates(
      launchInput({
        productionSignoffReady: evidence.ready,
        productionSignoffMissing: evidence.missing,
      }),
    );
    const productionSignoff = gates.gates.find(
      (gate) => gate.key === "production-signoff",
    );

    assert.equal(evidence.ready, false);
    assert.equal(evidence.missing, commercialCheckKeys.length);
    assert.equal(gates.ready, false);
    assert.equal(productionSignoff?.status, "action");
    assert.match(
      productionSignoff?.detail ?? "",
      new RegExp(`${commercialCheckKeys.length} production signoff items`),
    );
  });

  test("clears commercial signoff only after every check is confirmed", () => {
    const evidence = productionCheckEvidence({
      delivery: {
        production_checks: Object.fromEntries(
          productionCheckItems.map((item) => [item.key, confirmedCheck()]),
        ),
      },
    });
    const gates = buildClientInstallLaunchGates(
      launchInput({
        productionSignoffReady: evidence.ready,
        productionSignoffMissing: evidence.missing,
      }),
    );

    assert.equal(evidence.ready, true);
    assert.equal(evidence.missing, 0);
    assert.equal(gates.ready, true);
  });
});

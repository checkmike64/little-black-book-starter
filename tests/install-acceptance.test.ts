import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildInstallAcceptanceSummary } from "../lib/install-acceptance.js";

const baseInput = {
  contactCount: 3,
  jobs: [],
  changes: [],
  audit: [],
  provenance: [],
};

describe("install acceptance", () => {
  test("does not require module proof when enabled modules are omitted", () => {
    const acceptance = buildInstallAcceptanceSummary(baseInput);

    assert.equal(
      acceptance.items.some((item) => item.key.startsWith("module-")),
      false,
    );
  });

  test("adds proof checks only for enabled modules", () => {
    const acceptance = buildInstallAcceptanceSummary({
      ...baseInput,
      moduleProof: {
        enabledModules: ["ask", "want_to_know"],
        askRunCount: 1,
        askRunUndecidedCount: 0,
        wantToKnowCount: 1,
      },
    });

    const moduleItems = acceptance.items.filter((item) =>
      item.key.startsWith("module-"),
    );

    assert.deepEqual(
      moduleItems.map((item) => item.key),
      ["module-ask", "module-want-to-know"],
    );
    assert.equal(moduleItems.every((item) => item.status === "pass"), true);
  });

  test("keeps enabled workflow checks actionable until proof exists", () => {
    const acceptance = buildInstallAcceptanceSummary({
      ...baseInput,
      moduleProof: {
        enabledModules: ["ask", "engagement", "networking"],
        askRunCount: 1,
        askRunUndecidedCount: 1,
        commandJobCount: 0,
        relationshipActionCount: 0,
      },
    });

    const ask = acceptance.items.find((item) => item.key === "module-ask");
    const engagement = acceptance.items.find(
      (item) => item.key === "module-engagement",
    );
    const networking = acceptance.items.find(
      (item) => item.key === "module-networking",
    );

    assert.equal(ask?.status, "action");
    assert.equal(ask?.href, "/ask?saved=needs_decision");
    assert.equal(engagement?.status, "action");
    assert.equal(networking?.status, "action");
    assert.equal(acceptance.ready, false);
  });
});

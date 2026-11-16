import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildOwnerLaunchPreview,
  type OwnerLaunchPreviewInput,
} from "../lib/owner-launch-preview.js";
import { isOwnerForbiddenHref } from "../runtime/owner-route-policy.js";

function input(overrides: Partial<OwnerLaunchPreviewInput> = {}) {
  return {
    tenantName: "Moll Group",
    enabledModules: ["ask", "networking", "want_to_know"],
    contactCount: 88,
    pendingReviewCount: 0,
    openActionCount: 6,
    openPromiseCount: 3,
    askRunCount: 4,
    askRunUndecidedCount: 0,
    launchStatus: "Ready",
    launchCompleted: 13,
    launchTotal: 13,
    ...overrides,
  } satisfies OwnerLaunchPreviewInput;
}

describe("owner launch preview", () => {
  test("builds owner-visible navigation without operator tools", () => {
    const preview = buildOwnerLaunchPreview(input());
    const labels = preview.ownerNav.map((item) => item.label);

    assert.deepEqual(labels, [
      "Today",
      "My Book",
      "Networking",
      "Want to Know",
      "Next Moves",
      "Promises",
      "Changes",
    ]);
    assert.ok(preview.hiddenOperatorTools.includes("Ops"));
    assert.ok(!labels.includes("Ops"));
    assert.ok(!labels.includes("Launch"));
  });

  test("hides Promises when networking is disabled", () => {
    const preview = buildOwnerLaunchPreview(
      input({ enabledModules: ["ask"] }),
    );

    assert.ok(!preview.ownerNav.some((item) => item.label === "Promises"));
  });

  test("collects only owner-safe links for surface audit", () => {
    const preview = buildOwnerLaunchPreview(input());

    assert.deepEqual(preview.ownerHrefs, [
      "/dashboard",
      "/contacts",
      "/networking",
      "/want-to-know",
      "/movement",
      "/promises",
      "/changes",
      "/ask",
    ]);
    assert.ok(!preview.ownerHrefs.some((href) => href.startsWith("/ops")));
    assert.ok(!preview.ownerHrefs.some((href) => href.startsWith("/launch")));
  });

  test("renders raw owner walkthrough links without operator routes", () => {
    for (const preview of [
      buildOwnerLaunchPreview(input()),
      buildOwnerLaunchPreview(
        input({
          askRunCount: 0,
          contactCount: 0,
          launchCompleted: 2,
          launchTotal: 13,
          pendingReviewCount: 3,
        }),
      ),
    ]) {
      const rawHrefs = [
        ...preview.ownerNav.map((item) => item.href),
        ...preview.firstUseActions.map((action) => action.href),
        ...preview.demoSteps.map((step) => step.href),
        ...preview.ownerHrefs,
      ];

      assert.deepEqual(rawHrefs.filter(isOwnerForbiddenHref), []);
    }
  });

  test("keeps owner-safe links when setup still needs work", () => {
    const preview = buildOwnerLaunchPreview(
      input({
        contactCount: 0,
        launchCompleted: 4,
        launchTotal: 13,
        pendingReviewCount: 2,
      }),
    );

    assert.ok(preview.ownerHrefs.includes("/contacts"));
    assert.ok(preview.ownerHrefs.includes("/changes"));
    assert.ok(!preview.ownerHrefs.includes("/contacts/new"));
    assert.ok(!preview.ownerHrefs.includes("/intake"));
  });

  test("keeps preview in review state when owner decisions remain", () => {
    const preview = buildOwnerLaunchPreview(
      input({
        pendingReviewCount: 2,
        askRunUndecidedCount: 1,
      }),
    );

    assert.equal(preview.ready, false);
    assert.deepEqual(
      preview.firstUseActions
        .filter((action) => action.tone === "review")
        .map((action) => action.label),
      ["Approve proposed updates", "Ask the Book"],
    );
  });

  test("builds a concrete owner demo path", () => {
    const preview = buildOwnerLaunchPreview(input({ openActionCount: 0 }));

    assert.deepEqual(
      preview.demoSteps.map((step) => [step.step, step.label, step.href]),
      [
        [1, "Start on Today", "/dashboard"],
        [2, "Review one relationship", "/contacts"],
        [3, "Ask a week-one question", "/ask"],
        [4, "Confirm review queue is clear", "/changes"],
        [5, "Show the prospecting bucket", "/want-to-know"],
        [6, "Review open promises", "/promises"],
      ],
    );
    assert.equal(preview.demoSteps.at(-1)?.status, "action");
  });
});

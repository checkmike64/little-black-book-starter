import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const source = readFileSync(
  "app/(portal)/movement/relationship-action-status-controls.tsx",
  "utf8",
);

describe("relationship action status controls", () => {
  test("keeps action labels explicit for owner workflow controls", () => {
    for (const label of ["Mark done", "Defer", "Skip", "Reopen"]) {
      assert.equal(source.includes(label), true, label);
    }
  });

  test("requires clear reasons for deferred and skipped relationship moves", () => {
    assert.equal(
      source.includes("What should happen before this comes back?"),
      true,
    );
    assert.equal(source.includes("Why is this no longer worth doing?"), true);
    assert.equal(source.includes("required"), true);
  });
});

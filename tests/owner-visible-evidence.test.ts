import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ownerVisibleEvidence } from "../lib/owner-visible-evidence.js";

describe("owner visible evidence", () => {
  const rows = [
    { type: "interaction", label: "Call" },
    { type: "command", label: "Claude command" },
    { type: "job", label: "Claude job" },
    { type: "change", label: "Pending change" },
  ];

  test("hides Claude jobs and commands in normal owner mode", () => {
    const visible = ownerVisibleEvidence(rows, false);

    assert.deepEqual(
      visible.map((row) => row.type),
      ["interaction", "change"],
    );
  });

  test("keeps operator evidence visible in admin mode", () => {
    const visible = ownerVisibleEvidence(rows, true);

    assert.deepEqual(
      visible.map((row) => row.type),
      ["interaction", "command", "job", "change"],
    );
  });
});

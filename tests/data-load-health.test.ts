import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildDataLoadHealth } from "../lib/data-load-health.js";

describe("data load health", () => {
  test("stays quiet when every query succeeds", () => {
    const health = buildDataLoadHealth("Scoreboard", [
      { key: "contacts", label: "contacts" },
      { key: "promises", label: "promises" },
    ]);

    assert.equal(health.hasFailures, false);
    assert.equal(health.isBlocked, false);
    assert.equal(health.notice, null);
  });

  test("summarizes partial failures without blocking the whole surface", () => {
    const health = buildDataLoadHealth("Today", [
      { key: "contacts", label: "contacts" },
      { key: "promises", label: "promises", error: new Error("RLS") },
      { key: "jobs", label: "Claude jobs", error: "timeout" },
    ]);

    assert.equal(health.hasFailures, true);
    assert.equal(health.isBlocked, false);
    assert.deepEqual(
      health.failed.map((item) => item.key),
      ["promises", "jobs"],
    );
    assert.match(health.notice ?? "", /partially loaded/);
    assert.match(health.notice ?? "", /promises/);
    assert.match(health.notice ?? "", /Claude jobs/);
    assert.match(health.notice ?? "", /not treated as clear/);
  });

  test("marks core query failures as blocking", () => {
    const health = buildDataLoadHealth("Scoreboard", [
      {
        key: "contacts",
        label: "contacts",
        error: new Error("unavailable"),
        blocksSurface: true,
      },
      { key: "promises", label: "promises" },
    ]);

    assert.equal(health.hasFailures, true);
    assert.equal(health.isBlocked, true);
    assert.deepEqual(health.blocking, [{ key: "contacts", label: "contacts" }]);
    assert.match(health.notice ?? "", /core data/);
  });
});

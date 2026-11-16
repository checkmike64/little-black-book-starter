import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Book membership invariant", () => {
  const setup = readFileSync("lib/claude-setup-package.ts", "utf8");
  const prospecting = readFileSync("lib/prospecting-workflow.ts", "utf8");
  const quality = readFileSync("app/(portal)/quality/page.tsx", "utf8");

  it("keeps sparse existing relationships in the Book", () => {
    assert.match(setup, /every existing Book record as a person the owner knows/i);
    assert.match(setup, /never a reason to move the person into Want to Know/i);
    assert.match(quality, /Book membership is authoritative/i);
  });

  it("requires explicit prospecting intent for Want to Know", () => {
    assert.match(prospecting, /owner has already placed in Want to Know/i);
    assert.match(prospecting, /Do not discover, propose, or add new Want to Know candidates/i);
    assert.match(prospecting, /Do not infer prospecting intent from calendar attendance/i);
    assert.match(prospecting, /Never move or duplicate an existing Book contact/i);
  });
});

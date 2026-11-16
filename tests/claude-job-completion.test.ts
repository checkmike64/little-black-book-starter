import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pendingChangeWithWrongJobContact } from "../lib/claude-job-completion.js";

describe("Claude job completion validation", () => {
  test("rejects tenant-level pending changes for contact-specific jobs", () => {
    const wrong = pendingChangeWithWrongJobContact(
      [{ id: "change-1", contact_id: null }],
      "contact-1",
    );

    assert.equal(wrong?.id, "change-1");
  });

  test("accepts only pending changes linked to the expected contact", () => {
    assert.equal(
      pendingChangeWithWrongJobContact(
        [{ id: "change-1", contact_id: "contact-1" }],
        "contact-1",
      ),
      null,
    );
  });

  test("does not apply contact matching to tenant-level jobs", () => {
    assert.equal(
      pendingChangeWithWrongJobContact(
        [{ id: "change-1", contact_id: null }],
        null,
      ),
      null,
    );
  });
});

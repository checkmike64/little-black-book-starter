import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findDuplicateOpenRelationshipAction } from "../lib/relationship-action-dedupe.js";

describe("relationship action duplicate detection", () => {
  test("matches open actions by normalized title and type", () => {
    const duplicate = findDuplicateOpenRelationshipAction(
      [
        {
          id: "action-1",
          title: "  Follow   up with Alicia ",
          action_type: "follow_up",
          status: "open",
        },
      ],
      { actionType: "follow_up", title: "follow up with alicia" },
    );

    assert.equal(duplicate?.id, "action-1");
  });

  test("ignores closed actions and different action types", () => {
    const duplicate = findDuplicateOpenRelationshipAction(
      [
        {
          id: "action-1",
          title: "Send intro",
          action_type: "introduction",
          status: "done",
        },
        {
          id: "action-2",
          title: "Send intro",
          action_type: "follow_up",
          status: "open",
        },
      ],
      { actionType: "introduction", title: "Send intro" },
    );

    assert.equal(duplicate, null);
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  commandOutputDismissal,
  isCommandOutputDismissed,
} from "../lib/command-output-dismissal.js";

describe("command output dismissal", () => {
  test("recognizes dismissed command output metadata", () => {
    const dismissal = commandOutputDismissal({
      command_output_dismissed_at: "2026-07-20T12:00:00.000Z",
      command_output_dismissed_by: "user-1",
      command_output_dismissed_reason: "Reviewed; no action needed.",
    });

    assert.deepEqual(dismissal, {
      dismissedAt: "2026-07-20T12:00:00.000Z",
      dismissedBy: "user-1",
      reason: "Reviewed; no action needed.",
    });
  });

  test("ignores missing dismissal metadata", () => {
    assert.equal(commandOutputDismissal({ command_output: "Useful draft." }), null);
    assert.equal(isCommandOutputDismissed({ command_output: "Useful draft." }), false);
  });
});

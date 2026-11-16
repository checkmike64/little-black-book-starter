import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildMovementSourceLanes,
  buildMovementSourceMix,
  isAskCreatedAction,
  isClaudeCreatedAction,
  movementActionSourceLabel,
  type MovementSourceAction,
} from "../lib/movement-source-mix.js";

function action(overrides: Partial<MovementSourceAction>): MovementSourceAction {
  return {
    action_type: "follow_up",
    source: "manual",
    status: "open",
    ...overrides,
  };
}

describe("movement source mix", () => {
  test("classifies Ask and Claude-created actions from source or metadata", () => {
    assert.equal(isAskCreatedAction(action({ source: "ask_run_decision" })), true);
    assert.equal(
      isAskCreatedAction(action({ metadata: { ask_run_id: "ask-1" }, source: null })),
      true,
    );
    assert.equal(isClaudeCreatedAction(action({ source: "claude_command_output" })), true);
    assert.equal(
      isClaudeCreatedAction(action({ metadata: { job_id: "job-1" }, source: null })),
      true,
    );
  });

  test("summarizes only open movement by source lane", () => {
    const mix = buildMovementSourceMix([
      action({ source: "ask_run_decision" }),
      action({ source: "claude_command_output" }),
      action({ action_type: "owner_verification", source: "manual" }),
      action({ source: "dashboard_priority" }),
      action({ source: "claude_command_output", status: "done" }),
    ]);

    assert.deepEqual(
      {
        ask: mix.ask,
        claude: mix.claude,
        generated: mix.generated,
        manual: mix.manual,
        open: mix.open,
        ownerVerification: mix.ownerVerification,
        primaryHref: mix.primary.href,
      },
      {
        ask: 1,
        claude: 1,
        generated: 2,
        manual: 2,
        open: 4,
        ownerVerification: 1,
        primaryHref: "/movement?view=from_ask",
      },
    );
  });

  test("keeps Dashboard-created actions out of Ask and Claude labels", () => {
    const cue = movementActionSourceLabel(action({ source: "dashboard_priority" }));

    assert.equal(cue.label, "From Today");
    assert.equal(cue.href, "/movement?view=active");
    assert.equal(buildMovementSourceMix([action({ source: "dashboard_priority" })]).manual, 1);
  });

  test("builds reusable source lanes for owner surfaces", () => {
    const lanes = buildMovementSourceLanes(
      buildMovementSourceMix([
        action({ source: "ask_run_decision" }),
        action({ source: "claude_command_output" }),
        action({ action_type: "owner_verification" }),
      ]),
    );

    assert.deepEqual(
      lanes.map((lane) => [lane.label, lane.href, lane.value]),
      [
        ["Saved", "/movement?view=from_ask", 1],
        ["Suggested", "/movement?view=from_claude", 1],
        ["Added by you", "/movement?view=active", 1],
        ["Verify", "/movement?view=high", 1],
      ],
    );
  });
});

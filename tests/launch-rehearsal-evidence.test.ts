import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  hasClosedLaunchRehearsalAction,
  hasSucceededLaunchRehearsalJob,
  isClosedLaunchRehearsalAction,
  isLaunchRehearsalJob,
} from "../lib/launch-rehearsal-evidence.js";

describe("launch rehearsal evidence", () => {
  test("detects rehearsal jobs from payload or completion result", () => {
    assert.equal(
      isLaunchRehearsalJob({
        status: "queued",
        payload: { trigger: "ops_launch_rehearsal" },
        result: {},
      }),
      true,
    );
    assert.equal(
      isLaunchRehearsalJob({
        status: "succeeded",
        payload: {},
        result: { ops_launch_rehearsal: true },
      }),
      true,
    );
    assert.equal(
      isLaunchRehearsalJob({
        status: "succeeded",
        payload: { source: "ordinary_command" },
        result: {},
      }),
      false,
    );
  });

  test("requires a succeeded rehearsal job for job evidence", () => {
    assert.equal(
      hasSucceededLaunchRehearsalJob([
        {
          status: "running",
          payload: { source: "ops_launch_rehearsal" },
          result: {},
        },
      ]),
      false,
    );
    assert.equal(
      hasSucceededLaunchRehearsalJob([
        {
          status: "succeeded",
          payload: { source: "ops_launch_rehearsal" },
          result: {},
        },
      ]),
      true,
    );
  });

  test("requires closed rehearsal action evidence, not any relationship action", () => {
    assert.equal(
      isClosedLaunchRehearsalAction({
        status: "done",
        source: "manual",
        metadata: {},
      }),
      false,
    );
    assert.equal(
      isClosedLaunchRehearsalAction({
        status: "open",
        source: "ops_launch_rehearsal",
        metadata: { rehearsal: true },
      }),
      false,
    );
    assert.equal(
      hasClosedLaunchRehearsalAction([
        {
          status: "done",
          source: null,
          metadata: { closed_from: "ops_launch_rehearsal" },
        },
      ]),
      true,
    );
  });
});

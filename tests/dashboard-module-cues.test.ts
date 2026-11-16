import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  moduleOperatingCue,
  type DashboardModuleCueInput,
} from "../lib/dashboard-module-cues.js";
import type { ModuleKey } from "../lib/modules.js";

function input(key: ModuleKey, overrides: Partial<DashboardModuleCueInput> = {}) {
  return {
    contactCount: 88,
    contextReadiness: 64,
    duePromiseCount: 0,
    key,
    openPromiseCount: 0,
    pendingChangeCount: 6,
    queuedJobCount: 1,
    recentInteractionCount: 0,
    staleUsefulContacts: 2,
    ...overrides,
  } satisfies DashboardModuleCueInput;
}

describe("dashboard module cues", () => {
  test("keeps Ask pressure owner-facing when context is thin", () => {
    const cue = moduleOperatingCue(input("ask"));

    assert.equal(
      cue.pressure,
      "Some relationship context is still thin; verify judgment before acting.",
    );
    assert.doesNotMatch(cue.pressure, /operator|admin|intake|setup|claude/i);
  });

  test("keeps every owner module cue free of setup-heavy language", () => {
    const setupHeavy = /\b(operator|admin|intake|setup|deployment|ops|quality)\b/i;
    const keys: ModuleKey[] = [
      "ask",
      "networking",
      "engagement",
      "want_to_know",
    ];

    for (const key of keys) {
      const cue = moduleOperatingCue(input(key));
      const copy = `${cue.metric} ${cue.next} ${cue.pressure}`;

      assert.doesNotMatch(copy, setupHeavy, key);
    }
  });
});

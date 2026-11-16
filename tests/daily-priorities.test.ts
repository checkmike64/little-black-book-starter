import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildDailyPriorities,
  dailyPrioritySummary,
  promiseIdFromPriorityKey,
  type DailyCommandJob,
  type DailyRelationshipAction,
} from "../lib/daily-priorities.js";

function commandJob(
  overrides: Partial<DailyCommandJob> = {},
): DailyCommandJob {
  return {
    id: "job-1",
    job_type: "contact_command",
    status: "succeeded",
    created_at: "2026-07-20T12:00:00.000Z",
    payload: {
      contact_id: "contact-1",
      command_focus: {
        intent: "verify_referral_lane",
        label: "Verify referral lane",
      },
    },
    result: {
      command_output: "Referral lane looks promising but owner should confirm trust.",
      verification_summary: "Owner should verify before outreach.",
    },
    trackedAction: null,
    ...overrides,
  };
}

function relationshipAction(
  overrides: Partial<DailyRelationshipAction> = {},
): DailyRelationshipAction {
  return {
    id: "action-1",
    title: "Draft warm outreach",
    action_type: "follow_up",
    status: "open",
    priority: "low",
    due_on: null,
    metadata: {},
    source: "manual",
    contacts: { id: "contact-1", full_name: "Alicia Stone" },
    ...overrides,
  };
}

describe("daily priorities", () => {
  test("recognizes a stored promise priority without creating a second action", () => {
    assert.equal(promiseIdFromPriorityKey("promise:promise-1"), "promise-1");
    assert.equal(promiseIdFromPriorityKey("relationship_action:action-1"), null);
  });

  test("routes promise pressure to the contact and promise lane", () => {
    const priorities = buildDailyPriorities({
      contacts: [],
      openPromises: [
        {
          id: "promise-1",
          promise_text: "Send the founder list",
          direction: "owner_owes_contact",
          due_on: "2026-01-01",
          contacts: {
            id: "contact-1",
            full_name: "Alicia Stone",
          },
        },
      ],
      pendingChanges: [],
      activeJobs: [],
      relationshipActions: [],
      commandJobs: [],
    });

    assert.equal(priorities[0].key, "promise:promise-1");
    assert.equal(priorities[0].href, "/contacts/contact-1");
    assert.equal(priorities[0].action, "Close promise");
    assert.equal(priorities[0].secondaryHref, "/promises?filter=owner");
    assert.equal(priorities[0].secondaryAction, "Promise lane");
  });

  test("promotes untracked completed command outputs into the priority queue", () => {
    const priorities = buildDailyPriorities({
      contacts: [],
      openPromises: [],
      pendingChanges: [],
      activeJobs: [],
      relationshipActions: [],
      commandJobs: [commandJob()],
    });

    assert.equal(priorities[0].key, "command_output:job-1");
    assert.equal(priorities[0].href, "/ops/jobs/job-1");
    assert.equal(priorities[0].action, "Capture move");
    assert.equal(priorities[0].suggestedActionType, "referral");
    assert.equal(priorities[0].suggestedPriority, "high");
  });

  test("ignores command outputs that are already tracked as actions", () => {
    const priorities = buildDailyPriorities({
      contacts: [],
      openPromises: [],
      pendingChanges: [],
      activeJobs: [],
      relationshipActions: [],
      commandJobs: [
        commandJob({
          trackedAction: {
            id: "action-1",
            status: "open",
          },
        }),
      ],
    });

    assert.equal(priorities[0].key, "empty:ask");
  });

  test("ignores command outputs that were intentionally dismissed", () => {
    const priorities = buildDailyPriorities({
      contacts: [],
      openPromises: [],
      pendingChanges: [],
      activeJobs: [],
      relationshipActions: [],
      commandJobs: [
        commandJob({
          result: {
            command_output: "Useful context, but no relationship action needed.",
            command_output_dismissed_at: "2026-07-20T12:00:00.000Z",
            command_output_dismissed_reason: "Reviewed; no action needed.",
          },
        }),
      ],
    });

    assert.equal(priorities[0].key, "empty:ask");
  });

  test("counts untracked command output pressure in the daily summary", () => {
    const summary = dailyPrioritySummary({
      contacts: [],
      openPromises: [],
      pendingChanges: [],
      activeJobs: [],
      relationshipActions: [],
      commandJobs: [
        commandJob(),
        commandJob({
          id: "job-2",
          trackedAction: {
            id: "action-2",
            status: "open",
          },
        }),
      ],
    });

    assert.equal(summary.untrackedCommandOutputs, 1);
  });

  test("explains metadata-backed Claude relationship actions as generated moves", () => {
    const priorities = buildDailyPriorities({
      contacts: [],
      openPromises: [],
      pendingChanges: [],
      activeJobs: [],
      relationshipActions: [
        relationshipAction({ metadata: { command_label: "Draft warm outreach" } }),
      ],
      commandJobs: [],
    });

    assert.equal(priorities[0].key, "relationship_action:action-1");
    assert.match(priorities[0].reason, /Claude turned context/);
  });
});

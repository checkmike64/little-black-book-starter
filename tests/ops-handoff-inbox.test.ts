import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildOpsHandoffInbox,
  type OpsHandoffInboxJob,
} from "../lib/ops-handoff-inbox.js";

function job(overrides: Partial<OpsHandoffInboxJob> = {}): OpsHandoffInboxJob {
  return {
    id: "job-1",
    job_type: "contact_enrichment",
    status: "succeeded",
    attempts: 1,
    payload: {
      contact_id: "contact-1",
    },
    result: {},
    run_after: "2026-07-20T12:00:00.000Z",
    created_at: "2026-07-20T12:00:00.000Z",
    commandActionCount: 0,
    ...overrides,
  };
}

describe("ops handoff inbox", () => {
  test("puts queued and running jobs in the return lane", () => {
    const inbox = buildOpsHandoffInbox({
      jobs: [
        job({ id: "queued-job", status: "queued" }),
        job({ id: "running-job", status: "running" }),
      ],
      pendingChanges: [],
    });

    assert.equal(inbox.counts.needs_return, 2);
    assert.equal(inbox.lanes[0].items[0].lane, "needs_return");
  });

  test("puts completed jobs with linked open proposals in review", () => {
    const inbox = buildOpsHandoffInbox({
      jobs: [
        job({
          result: {
            created_pending_change_ids: ["change-1"],
          },
        }),
      ],
      pendingChanges: [
        {
          id: "change-1",
          summary: "Review a proposed update.",
          risk_level: "high",
        },
      ],
    });

    assert.equal(inbox.counts.needs_review, 1);
    assert.equal(inbox.nextItem?.actionLabel, "Review changes");
  });

  test("puts untracked command output in capture", () => {
    const inbox = buildOpsHandoffInbox({
      jobs: [
        job({
          payload: {
            contact_id: "contact-1",
            command_focus: {
              label: "Draft outreach",
              intent: "draft_outreach",
            },
          },
          result: {
            command_output: "Send this warm note.",
          },
        }),
      ],
      pendingChanges: [],
    });

    assert.equal(inbox.counts.needs_capture, 1);
    assert.equal(inbox.nextItem?.href, "/ops/jobs/job-1#track-action");
  });

  test("treats dismissed command output as closed", () => {
    const inbox = buildOpsHandoffInbox({
      jobs: [
        job({
          payload: {
            command_focus: {
              label: "Draft outreach",
            },
          },
          result: {
            command_output: "No movement needed.",
            command_output_dismissed_at: "2026-07-20T13:00:00.000Z",
          },
        }),
      ],
      pendingChanges: [],
    });

    assert.equal(inbox.counts.needs_capture, 0);
    assert.equal(inbox.counts.closed, 1);
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildJobOutcome } from "../lib/job-outcome.js";

const base = {
  jobId: "job-1",
  jobStatus: "succeeded",
  hasCommand: false,
  hasCommandOutput: false,
  pendingChangeCount: 0,
  openPendingChangeCount: 0,
  interactionCount: 0,
  commandActionCount: 0,
};

describe("job outcome", () => {
  test("routes running jobs back to the handoff", () => {
    const outcome = buildJobOutcome({
      ...base,
      jobStatus: "running",
    });

    assert.equal(outcome.title, "Awaiting Claude return");
    assert.equal(outcome.primaryHref, "/ops/jobs/job-1/handoff");
    assert.equal(outcome.tone, "hot");
  });

  test("prioritizes pending review before movement capture", () => {
    const outcome = buildJobOutcome({
      ...base,
      hasCommand: true,
      hasCommandOutput: true,
      pendingChangeCount: 2,
      openPendingChangeCount: 1,
      recommendedActionTitle: "Send the warm note.",
    });

    assert.equal(outcome.title, "Review proposed changes");
    assert.equal(outcome.primaryHref, "/changes");
    assert.equal(outcome.tone, "warn");
  });

  test("asks operators to capture untracked command output", () => {
    const outcome = buildJobOutcome({
      ...base,
      hasCommand: true,
      hasCommandOutput: true,
      contactId: "contact-1",
      recommendedActionTitle: "Send the warm note.",
    });

    assert.equal(outcome.title, "Send the warm note.");
    assert.equal(outcome.primaryHref, "#track-action");
    assert.equal(outcome.secondaryHref, "/contacts/contact-1");
  });

  test("treats dismissed command output as intentionally closed", () => {
    const outcome = buildJobOutcome({
      ...base,
      hasCommand: true,
      hasCommandOutput: true,
      commandOutputDismissed: true,
      commandOutputDismissedReason: "Reviewed during prep; no follow-up required.",
      contactId: "contact-1",
    });

    assert.equal(outcome.title, "No action needed");
    assert.equal(outcome.detail, "Reviewed during prep; no follow-up required.");
    assert.equal(outcome.primaryHref, "/contacts/contact-1");
    assert.equal(outcome.tone, "cool");
  });

  test("recognizes command outputs that already have movement", () => {
    const outcome = buildJobOutcome({
      ...base,
      hasCommand: true,
      hasCommandOutput: true,
      commandActionCount: 1,
      contactId: "contact-1",
    });

    assert.equal(outcome.title, "Movement captured");
    assert.equal(outcome.primaryHref, "/contacts/contact-1");
    assert.equal(outcome.secondaryHref, "/movement");
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildPreinstallReview,
  hasEmbeddedEnrichmentSource,
  type PreinstallPendingChange,
} from "../lib/preinstall-review.js";

const contacts = [
  {
    id: "existing",
    full_name: "Alicia Stone",
    email: "alicia@example.com",
  },
];

function change(
  id: string,
  changeType: string,
  candidate: Record<string, unknown>,
): PreinstallPendingChange {
  return {
    id,
    change_type: changeType,
    summary: `Review ${id}`,
    payload: { candidate },
    source: "claude",
    created_at: "2026-09-12T12:00:00.000Z",
  };
}

describe("pre-install review", () => {
  test("separates exact identity matches from human identity decisions", () => {
    const review = buildPreinstallReview({
      contacts,
      changes: [
        change("exact", "contact_candidate", {
          full_name: "ALICIA STONE",
          email: "ALICIA@EXAMPLE.COM",
        }),
        change("name-only", "contact_candidate", {
          full_name: "Alicia Stone",
        }),
        change("prospect", "want_to_know_candidate", {
          full_name: "Future Person",
        }),
      ],
      jobs: [],
    });

    assert.deepEqual(review.exactCandidates.map((item) => item.change.id), ["exact"]);
    assert.deepEqual(
      review.identityReview.map((item) => [item.change.id, item.proposedName]),
      [
        ["name-only", "Alicia Stone"],
        ["prospect", "Future Person"],
      ],
    );
  });

  test("treats labels and verification instructions as insufficient source material", () => {
    assert.equal(
      hasEmbeddedEnrichmentSource({
        source: "calendar_briefing",
        trigger: "calendar_review",
        verification: "Owner verification required before judgment.",
      }),
      false,
    );
    assert.equal(
      hasEmbeddedEnrichmentSource({
        source_context: "Approved meeting notes containing the factual source context.",
      }),
      true,
    );
  });

  test("shows only due production jobs and marks missing-source jobs fail closed", () => {
    const review = buildPreinstallReview({
      contacts,
      changes: [],
      now: Date.parse("2026-09-12T12:00:00.000Z"),
      jobs: [
        {
          id: "due",
          status: "queued",
          attempts: 0,
          run_after: "2026-09-12T11:00:00.000Z",
          payload: { source: "calendar_briefing" },
        },
        {
          id: "future",
          status: "queued",
          attempts: 0,
          run_after: "2026-09-13T11:00:00.000Z",
          payload: { source_context: "Approved source material that is long enough." },
        },
      ],
    });

    assert.deepEqual(review.dueJobs.map((job) => job.id), ["due"]);
    assert.deepEqual(review.sourceBlockedJobs.map((job) => job.id), ["due"]);
  });
});

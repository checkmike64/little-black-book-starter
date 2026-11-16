import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  changeApprovalLabel,
  changeCardIdentity,
  changeRecommendationLines,
} from "../lib/change-card-presentation.js";
import { contactDuplicateInputFromPayload } from "../lib/contact-duplicate-detection.js";
import {
  pendingChangePayloadBody,
  pendingChangeSupportedFieldNames,
} from "../lib/pending-change-inspection.js";
import { reviewPosture } from "../lib/pending-change-review.js";
import { pendingChangeNeedsDetailedReview } from "../lib/pending-change-risk.js";
import { isNewPersonChangeType } from "../lib/pending-change-types.js";
import { reviewQueueLane, type ReviewQueueRow } from "../lib/review-queue-observation.js";

const legacyCandidate = {
  change_type: "contact_candidate",
  payload: {
    candidate: {
      full_name: "Example Person",
      company: "Example Company",
      email: "person@example.com",
      role_title: "Founder",
      linkedin: null,
    },
    duplicate_check: "Compare against the current Book.",
    recommendation: "Review this person.",
    why: "Legacy generated rationale.",
  },
  risk_level: "low",
};

describe("legacy pending-change compatibility", () => {
  test("normalizes only the allowlisted contact candidate fields", () => {
    assert.equal(isNewPersonChangeType("contact_candidate"), true);
    assert.deepEqual(pendingChangePayloadBody(legacyCandidate), {
      full_name: "Example Person",
      company_name: "Example Company",
      email: "person@example.com",
      role_title: ["Founder"],
    });
    assert.deepEqual(pendingChangeSupportedFieldNames(legacyCandidate), [
      "full_name",
      "company_name",
      "email",
      "role_title",
    ]);
  });

  test("routes legacy candidates through detailed duplicate review", () => {
    assert.equal(pendingChangeNeedsDetailedReview(legacyCandidate), true);
    assert.equal(
      reviewPosture(
        {
          ...legacyCandidate,
          contact_id: null,
          created_at: "2026-09-10T12:00:00.000Z",
          source: "claude_daily_briefing",
        },
        {
          detailedReview: true,
          duplicateCount: 0,
          supportedFieldCount: 4,
          unsupportedKeyCount: 0,
        },
      ).key,
      "duplicate_check",
    );
    assert.equal(
      reviewQueueLane({
        ...legacyCandidate,
        id: "11111111-1111-4111-8111-111111111111",
        contact_id: null,
        source: "claude_daily_briefing",
        created_at: "2026-09-10T12:00:00.000Z",
        replaces_pending_change_id: null,
        replaced_by_pending_change_id: null,
        superseded_at: null,
      } satisfies ReviewQueueRow),
      "new_person",
    );
  });

  test("presents factual candidate fields without legacy rationale copy", () => {
    const presentation = {
      ...legacyCandidate,
      summary: "Review a possible new person.",
      source: "claude_daily_briefing",
    };
    assert.deepEqual(changeCardIdentity(presentation), {
      name: "Example Person",
      company: "Example Company",
    });
    assert.deepEqual(changeRecommendationLines(presentation), [
      "Add Example Person to your Book.",
    ]);
    assert.equal(changeApprovalLabel(presentation), "Add to Book");
  });

  test("keeps unsupported-only legacy updates out of approval", () => {
    const posture = reviewPosture(
      {
        change_type: "field_update",
        contact_id: "11111111-1111-4111-8111-111111111111",
        created_at: "2026-09-10T12:00:00.000Z",
        payload: {
          field: "extra.alt_emails",
          proposed_value: "person@example.com",
        },
        risk_level: "low",
      },
      {
        detailedReview: false,
        duplicateCount: 0,
        supportedFieldCount: 0,
        unsupportedKeyCount: 1,
      },
    );

    assert.equal(posture.key, "operator_repair");
    assert.equal(posture.canApprove, false);
  });

  test("uses candidate identity for live duplicate matching", () => {
    assert.deepEqual(contactDuplicateInputFromPayload(legacyCandidate.payload), {
      full_name: "Example Person",
      email: "person@example.com",
      phone: null,
      company_name: "Example Company",
      role_title: null,
      linkedin: null,
      website: null,
      relationship_type: null,
      one_line_summary: null,
    });
  });

  test("keeps approval and merge behind the current new-person workflow", () => {
    const actions = readFileSync("app/(portal)/changes/actions.ts", "utf8");
    const listPage = readFileSync("app/(portal)/changes/page.tsx", "utf8");
    const detailPage = readFileSync("app/(portal)/changes/[id]/page.tsx", "utf8");

    assert.match(actions, /if \(isNewPersonChangeType\(change\.change_type\)\)/);
    assert.match(actions, /if \(!isNewPersonChangeType\(change\.change_type\)\)/);
    assert.match(actions, /normalizeNewContact\(change\.payload, change\.change_type\)/);
    assert.match(listPage, /isNewPersonChangeType\(row\.change_type\)/);
    assert.match(detailPage, /findDuplicateCandidates\([\s\S]*contactDuplicateInputFromPayload/);
    assert.match(detailPage, /isNewPersonChangeType\(change\.change_type\)/);
    assert.match(
      detailPage,
      /This legacy field cannot be written safely\. Decline it or save a correction below\./,
    );
  });
});

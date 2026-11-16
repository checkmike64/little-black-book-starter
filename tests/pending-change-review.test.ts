import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isQualityCleanupChange,
  ownerContextStatus,
  qualityCleanupApprovalBlockingFields,
  qualityCleanupDetails,
  replacementPendingChangeId,
  replacementStatus,
  reviewLane,
  reviewPosture,
  reviewPriority,
  type PendingChangeReviewInput,
} from "../lib/pending-change-review.js";

const baseChange: PendingChangeReviewInput = {
  change_type: "contact_enrichment",
  contact_id: "contact-1",
  created_at: "2026-07-20T12:00:00.000Z",
  payload: {
    fields: {
      company_name: "Acme Partners",
    },
  },
  risk_level: "low",
  source: "contact_enrichment_job",
};

const lowSignals = {
  detailedReview: false,
  duplicateCount: 0,
  supportedFieldCount: 1,
  unsupportedKeyCount: 0,
};

describe("pending change review lanes", () => {
  test("only blocks proposed fields that still need owner context", () => {
    assert.deepEqual(
      qualityCleanupApprovalBlockingFields({
        fields: { relationship_type: ["Peer"] },
        quality_cleanup: {
          blocked_fields: [
            "role or company",
            "trust tier",
            "why stay in touch",
          ],
        },
      }),
      [],
    );

    assert.deepEqual(
      qualityCleanupApprovalBlockingFields({
        fields: { relationship_strength: "Warm" },
        quality_cleanup: {
          blocked_fields: ["relationship_strength", "ideal_referral"],
        },
      }),
      ["relationship_strength"],
    );
  });

  test("recognizes and summarizes quality cleanup proposals", () => {
    const change: PendingChangeReviewInput = {
      ...baseChange,
      source: "quality_cleanup_job",
      payload: {
        fields: {
          trust_level: "high",
        },
        quality_cleanup: {
          job_id: "12345678-1234-4234-9234-123456789abc",
          proposed_field: "trust_level",
          proposed_field_label: "trust level",
          field_needs_owner_verification: true,
          missing_fields_reviewed: ["trust_level", "why_stay_in_touch"],
          left_blank: ["podcast_fit: no evidence"],
          blocked_fields: [],
        },
      },
    };

    const cleanup = qualityCleanupDetails(change.payload);

    assert.equal(isQualityCleanupChange(change), true);
    assert.equal(cleanup.jobId, "12345678-1234-4234-9234-123456789abc");
    assert.equal(cleanup.proposedFieldLabel, "trust level");
    assert.deepEqual(cleanup.missingFieldsReviewed, [
      "trust_level",
      "why_stay_in_touch",
    ]);
    assert.equal(cleanup.fieldNeedsOwnerVerification, true);
    assert.equal(
      reviewLane(change, { detailedReview: true }),
      "Quality cleanup review",
    );
  });

  test("routes blocked cleanup to owner context before normal review", () => {
    const change: PendingChangeReviewInput = {
      ...baseChange,
      source: "quality_cleanup_job",
      payload: {
        fields: {},
        quality_cleanup: {
          blocked_fields: ["relationship_strength", "ideal_referral"],
        },
      },
    };

    assert.equal(
      reviewLane(change, { detailedReview: false }),
      "Needs owner context",
    );
  });

  test("prioritizes actionable cleanup above ordinary low-risk proposals", () => {
    const cleanupChange: PendingChangeReviewInput = {
      ...baseChange,
      source: "quality_cleanup_job",
      payload: {
        fields: {
          company_name: "Acme Partners",
        },
        quality_cleanup: {
          proposed_field: "company_name",
          blocked_fields: [],
        },
      },
    };

    assert.ok(
      reviewPriority(cleanupChange, lowSignals, Date.parse("2026-07-20T13:00:00.000Z")) >
        reviewPriority(baseChange, lowSignals, Date.parse("2026-07-20T13:00:00.000Z")),
    );
  });

  test("honors owner-context and replacement metadata", () => {
    const change: PendingChangeReviewInput = {
      ...baseChange,
      payload: {
        ...baseChange.payload,
        owner_context: {
          status: "answered",
        },
        replacement: {
          status: "replaced",
          replacement_pending_change_id: "replacement-1",
        },
      },
    };

    assert.equal(ownerContextStatus(change), "answered");
    assert.equal(replacementStatus(change), "replaced");
    assert.equal(replacementPendingChangeId(change), "replacement-1");
  });

  test("blocks approval posture until owner context is attached", () => {
    const change: PendingChangeReviewInput = {
      ...baseChange,
      payload: {
        fields: {
          relationship_strength: "Warm",
        },
        quality_cleanup: {
          blocked_fields: ["relationship_strength", "ideal_referral"],
        },
      },
      risk_level: "high",
    };

    const posture = reviewPosture(change, {
      ...lowSignals,
      detailedReview: true,
      supportedFieldCount: 1,
    });

    assert.equal(posture.key, "owner_context_needed");
    assert.equal(posture.canApprove, false);
    assert.match(posture.detail, /relationship_strength/);
  });

  test("allows one-by-one review posture after owner context is attached", () => {
    const change: PendingChangeReviewInput = {
      ...baseChange,
      payload: {
        fields: {
          relationship_strength: "Warm",
        },
        owner_context: {
          status: "answered",
        },
        quality_cleanup: {
          blocked_fields: ["relationship_strength"],
        },
      },
      risk_level: "high",
    };

    const posture = reviewPosture(change, {
      ...lowSignals,
      detailedReview: true,
      supportedFieldCount: 1,
    });

    assert.equal(posture.key, "owner_context_attached");
    assert.equal(posture.canApprove, true);
  });

  test("keeps revision-queued proposals out of approval posture", () => {
    const change: PendingChangeReviewInput = {
      ...baseChange,
      payload: {
        fields: {
          relationship_strength: "Warm",
        },
        owner_context: {
          status: "revision_queued",
        },
        quality_cleanup: {
          blocked_fields: ["relationship_strength"],
        },
      },
      risk_level: "high",
    };

    const posture = reviewPosture(change, {
      ...lowSignals,
      detailedReview: true,
      supportedFieldCount: 1,
    });

    assert.equal(posture.key, "revision_queued");
    assert.equal(posture.canApprove, false);
  });

  test("keeps new-contact proposals in duplicate-check posture", () => {
    const change: PendingChangeReviewInput = {
      ...baseChange,
      change_type: "new_contact",
      contact_id: null,
      payload: {
        contact: {
          full_name: "Alicia Stone",
        },
        duplicate_candidates: [
          {
            full_name: "Alicia Stone",
          },
        ],
      },
      risk_level: "high",
    };

    const posture = reviewPosture(change, {
      ...lowSignals,
      detailedReview: true,
      duplicateCount: 1,
      supportedFieldCount: 1,
    });

    assert.equal(posture.key, "duplicate_check");
    assert.equal(posture.canApprove, true);
    assert.match(posture.detail, /1 possible duplicate/);
  });
});

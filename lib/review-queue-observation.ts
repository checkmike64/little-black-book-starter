import {
  duplicateCandidates,
  pendingChangeSupportedFieldNames,
  pendingChangeUnsupportedKeys,
} from "./pending-change-inspection.ts";
import { pendingChangeNeedsDetailedReview } from "./pending-change-risk.ts";
import {
  replacementStatus,
  reviewPosture,
} from "./pending-change-review.ts";
import { isNewPersonChangeType } from "./pending-change-types.ts";

export type ReviewQueueLaneKey =
  | "ready"
  | "detailed"
  | "new_person"
  | "needs_context"
  | "waiting_revision"
  | "unsupported"
  | "controlled_test"
  | "replaced";

export type ReviewQueueRow = {
  id: string;
  contact_id: string | null;
  change_type: string;
  payload: Record<string, unknown>;
  risk_level: string | null;
  source: string | null;
  created_at: string;
  replaces_pending_change_id: string | null;
  replaced_by_pending_change_id: string | null;
  superseded_at: string | null;
};

export type ReviewQueueLane = {
  key: ReviewQueueLaneKey;
  label: string;
  detail: string;
  count: number;
  blocking: boolean;
  href: string;
};

const laneOrder: ReviewQueueLaneKey[] = [
  "unsupported",
  "needs_context",
  "waiting_revision",
  "detailed",
  "new_person",
  "ready",
  "controlled_test",
  "replaced",
];

const laneCopy: Record<
  ReviewQueueLaneKey,
  Pick<ReviewQueueLane, "label" | "detail" | "blocking">
> = {
  ready: {
    label: "Ready for review",
    detail: "Low-risk, contact-linked proposals that can be decided from Changes.",
    blocking: true,
  },
  detailed: {
    label: "Detailed review",
    detail: "Judgment-heavy fields and meeting actions that require one-by-one review.",
    blocking: true,
  },
  new_person: {
    label: "New person review",
    detail: "New Book or Want to Know candidates that require identity and duplicate review.",
    blocking: true,
  },
  needs_context: {
    label: "Needs owner context",
    detail: "Proposals that cannot be approved until the owner supplies missing context.",
    blocking: true,
  },
  waiting_revision: {
    label: "Waiting for Claude",
    detail: "Owner context is recorded and a revised proposal is still pending.",
    blocking: true,
  },
  unsupported: {
    label: "Operator repair",
    detail: "Pending records that do not map safely to a current review action.",
    blocking: true,
  },
  controlled_test: {
    label: "Controlled tests",
    detail: "Dry-run and acceptance artifacts excluded from the client handoff backlog.",
    blocking: false,
  },
  replaced: {
    label: "Replaced proposals",
    detail: "Superseded records excluded from the active handoff backlog.",
    blocking: false,
  },
};

function isControlledTest(row: ReviewQueueRow) {
  return (
    row.payload.dry_run === true ||
    row.payload.test_mode === true ||
    row.source === "ops_enrichment_dry_run" ||
    row.source === "ops_acceptance_low_risk" ||
    row.source === "ops_prospecting_test" ||
    row.source?.includes("dry_run") === true
  );
}

function signals(row: ReviewQueueRow) {
  return {
    detailedReview: pendingChangeNeedsDetailedReview(row),
    duplicateCount: duplicateCandidates(row.payload).length,
    supportedFieldCount: pendingChangeSupportedFieldNames(row).length,
    unsupportedKeyCount: pendingChangeUnsupportedKeys(row).length,
  };
}

export function reviewQueueLane(row: ReviewQueueRow): ReviewQueueLaneKey {
  if (replacementStatus(row) === "replaced") return "replaced";
  if (isControlledTest(row)) return "controlled_test";

  const rowSignals = signals(row);
  const posture = reviewPosture(row, rowSignals);

  if (
    posture.key === "owner_context_needed" ||
    posture.key === "owner_context_requested"
  ) {
    return "needs_context";
  }
  if (posture.key === "revision_queued") return "waiting_revision";
  if (isNewPersonChangeType(row.change_type) || row.change_type === "want_to_know_candidate") {
    return "new_person";
  }
  if (
    row.source === "recording_operator" &&
    row.change_type === "recording_action"
  ) {
    return "detailed";
  }
  if (!posture.canApprove || rowSignals.supportedFieldCount === 0) {
    return "unsupported";
  }
  if (rowSignals.detailedReview) return "detailed";
  return "ready";
}

export function buildReviewQueueObservation({
  rows,
  exactCount,
  error,
}: {
  rows: ReviewQueueRow[];
  exactCount: number | null;
  error?: unknown;
}) {
  const countValid =
    Number.isSafeInteger(exactCount) &&
    (exactCount ?? -1) >= 0 &&
    exactCount === rows.length;
  const ids = rows.map((row) => row.id);
  const rowsValid =
    ids.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(ids).size === ids.length &&
    rows.every((row) => Number.isFinite(Date.parse(row.created_at)));

  if (error || !countValid || !rowsValid) {
    return {
      state: "incomplete" as const,
      reason: error
        ? "The pending review query failed."
        : "The pending review count and returned records could not be reconciled.",
      totalCount: null,
      actionableCount: null,
      excludedCount: null,
      oldestActionableAt: null,
      lanes: laneOrder.map((key) => ({
        key,
        ...laneCopy[key],
        count: 0,
        href: "/changes",
      })),
    };
  }

  const grouped = new Map<ReviewQueueLaneKey, ReviewQueueRow[]>();
  for (const row of rows) {
    const key = reviewQueueLane(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  const lanes = laneOrder.map((key) => {
    const laneRows = grouped.get(key) ?? [];
    return {
      key,
      ...laneCopy[key],
      count: laneRows.length,
      href:
        laneCopy[key].blocking && laneRows[0]
          ? `/changes/${laneRows[0].id}`
          : "/changes",
    };
  });
  const actionableRows = lanes
    .filter((lane) => lane.blocking)
    .flatMap((lane) => grouped.get(lane.key) ?? []);
  const oldestActionableAt = actionableRows
    .map((row) => row.created_at)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;

  return {
    state: "complete" as const,
    reason: null,
    totalCount: exactCount,
    actionableCount: actionableRows.length,
    excludedCount: rows.length - actionableRows.length,
    oldestActionableAt,
    lanes,
  };
}

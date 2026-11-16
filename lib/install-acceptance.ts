import type { ModuleKey } from "./modules.js";

export type AcceptanceJob = {
  id: string;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
};

export type AcceptanceChange = {
  id: string;
  status: string;
  change_type: string;
  risk_level: string | null;
  source: string | null;
  contact_id: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type AcceptanceAudit = {
  action: string;
  actor_type: string;
  table_name: string | null;
  record_id: string | null;
  metadata: Record<string, unknown>;
};

export type AcceptanceProvenance = {
  field_name: string;
  source_type: string;
  source_ref: string | null;
  metadata: Record<string, unknown>;
};

export type AcceptanceItem = {
  key: string;
  label: string;
  detail: string;
  status: "pass" | "action" | "waiting";
  href: string;
};

export type ModuleProofInput = {
  enabledModules?: ModuleKey[];
  askRunCount?: number;
  askRunUndecidedCount?: number;
  commandJobCount?: number;
  relationshipActionCount?: number;
  wantToKnowCount?: number;
};

const highRiskSource = "ops_enrichment_dry_run";
const lowRiskSource = "ops_acceptance_low_risk";
const prospectingSource = "ops_prospecting_test";

function metadataId(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function hasCompletedTestJob(job: AcceptanceJob) {
  return (
    job.payload.test_mode === true &&
    job.status === "succeeded" &&
    typeof job.result.completed_at === "string"
  );
}

function hasClaimedTestJob(job: AcceptanceJob) {
  return (
    job.payload.test_mode === true &&
    (job.attempts > 0 ||
      job.status === "running" ||
      hasCompletedTestJob(job) ||
      typeof job.result.claimed_at === "string")
  );
}

function statusFrom(passed: boolean, hasPrerequisite = true) {
  if (passed) return "pass";
  return hasPrerequisite ? "action" : "waiting";
}

function moduleProofItems({
  contactCount,
  prospectingReady,
  moduleProof,
}: {
  contactCount: number;
  prospectingReady: boolean;
  moduleProof?: ModuleProofInput;
}): AcceptanceItem[] {
  const enabledModules = moduleProof?.enabledModules ?? [];
  if (enabledModules.length === 0) return [];

  return enabledModules.map((key) => {
    if (key === "ask") {
      const askRunCount = moduleProof?.askRunCount ?? 0;
      const undecided = moduleProof?.askRunUndecidedCount ?? 0;
      const passed = askRunCount > 0 && undecided === 0;

      return {
        key: "module-ask",
        label: "Ask module is proven",
        detail: passed
          ? `${askRunCount} Ask run${askRunCount === 1 ? "" : "s"} saved with decisions.`
          : askRunCount > 0
            ? `${undecided} Ask run${undecided === 1 ? "" : "s"} need a follow-up or no-action decision.`
            : "Run one representative Ask query and save its decision before handoff.",
        status: statusFrom(passed, contactCount > 0),
        href: undecided > 0 ? "/ask?saved=needs_decision" : "/ask",
      } satisfies AcceptanceItem;
    }

    if (key === "want_to_know") {
      const wantToKnowCount = moduleProof?.wantToKnowCount ?? 0;
      const passed = prospectingReady || wantToKnowCount > 0;

      return {
        key: "module-want-to-know",
        label: "Want to Know module is proven",
        detail: passed
          ? `${wantToKnowCount} Want to Know candidate${wantToKnowCount === 1 ? "" : "s"} are available or a prospecting review was approved.`
          : "Approve or seed one bucketed Want to Know candidate for the client's prospecting goal.",
        status: statusFrom(passed, contactCount > 0),
        href: "/want-to-know",
      } satisfies AcceptanceItem;
    }

    if (key === "engagement") {
      const commandJobCount = moduleProof?.commandJobCount ?? 0;

      return {
        key: "module-engagement",
        label: "Engagement module is proven",
        detail:
          commandJobCount > 0
            ? `${commandJobCount} completed command output${commandJobCount === 1 ? "" : "s"} can feed outreach or follow-up recommendations.`
            : "Run one command-output job so engagement recommendations have Claude-backed evidence.",
        status: statusFrom(commandJobCount > 0, contactCount > 0),
        href: "/engagement",
      } satisfies AcceptanceItem;
    }

    const relationshipActionCount = moduleProof?.relationshipActionCount ?? 0;
    return {
      key: "module-networking",
      label: "Networking module is proven",
      detail:
        relationshipActionCount > 0
          ? `${relationshipActionCount} relationship action${relationshipActionCount === 1 ? "" : "s"} exist for follow-through, intros, or useful next moves.`
          : "Create or close one relationship action so networking movement is visible.",
      status: statusFrom(relationshipActionCount > 0, contactCount > 0),
      href: "/networking",
    } satisfies AcceptanceItem;
  });
}

export function buildInstallAcceptanceSummary({
  contactCount,
  jobs,
  changes,
  audit,
  provenance,
  moduleProof,
}: {
  contactCount: number;
  jobs: AcceptanceJob[];
  changes: AcceptanceChange[];
  audit: AcceptanceAudit[];
  provenance: AcceptanceProvenance[];
  moduleProof?: ModuleProofInput;
}) {
  const highRiskChange = changes.find(
    (change) => change.source === highRiskSource && change.risk_level === "high",
  );
  const lowRiskChanges = changes.filter(
    (change) => change.source === lowRiskSource && change.risk_level !== "high",
  );
  const lowRiskPending = lowRiskChanges.find((change) => change.status === "pending");
  const lowRiskApproved = lowRiskChanges.find(
    (change) => change.status === "approved" && change.reviewed_at,
  );
  const lowRiskApprovedId = lowRiskApproved?.id ?? null;
  const approvalAudit = lowRiskApprovedId
    ? audit.find(
        (row) =>
          row.action === "pending_change.approved" &&
          row.record_id === lowRiskApprovedId,
      )
    : null;
  const lowRiskProvenance = lowRiskApprovedId
    ? provenance.find(
        (row) => metadataId(row.metadata, "pending_change_id") === lowRiskApprovedId,
      )
    : null;
  const followUpJob = lowRiskApprovedId
    ? jobs.find(
        (job) => metadataId(job.payload, "pending_change_id") === lowRiskApprovedId,
      )
    : null;
  const prospectingChanges = changes.filter(
    (change) => change.source === prospectingSource,
  );
  const prospectingPending = prospectingChanges.find(
    (change) => change.status === "pending",
  );
  const prospectingApproved = prospectingChanges.find(
    (change) => change.status === "approved" && change.reviewed_at,
  );
  const prospectingAudit = prospectingApproved
    ? audit.find(
        (row) =>
          row.action === "pending_change.want_to_know_candidate_approved" &&
          row.record_id === prospectingApproved.id,
      )
    : null;

  const items: AcceptanceItem[] = [
    {
      key: "contacts",
      label: "Client data is present",
      detail:
        contactCount > 0
          ? `${contactCount} contact${contactCount === 1 ? "" : "s"} are available for acceptance testing.`
          : "Import or seed at least one contact before running the acceptance loop.",
      status: statusFrom(contactCount > 0),
      href: "/contacts",
    },
    {
      key: "test-job-created",
      label: "Claude test job exists",
      detail: jobs.some((job) => job.payload.test_mode === true)
        ? "A test-mode enrichment job has been created through Ops."
        : "Create a test enrichment job from the Claude loop test panel.",
      status: statusFrom(jobs.some((job) => job.payload.test_mode === true), contactCount > 0),
      href: "/ops",
    },
    {
      key: "test-job-claimed",
      label: "Claude claim endpoint works",
      detail: jobs.some(hasClaimedTestJob)
        ? "A test job has been claimed through the Claude jobs endpoint."
        : "Claim the next test job to verify the private Claude gateway.",
      status: statusFrom(
        jobs.some(hasClaimedTestJob),
        jobs.some((job) => job.payload.test_mode === true),
      ),
      href: "/ops",
    },
    {
      key: "test-job-completed",
      label: "Claude completion endpoint works",
      detail: jobs.some(hasCompletedTestJob)
        ? "A test job has completed through the Claude completion endpoint."
        : "Complete a running test job or create a dry-run proposal to close the loop.",
      status: statusFrom(jobs.some(hasCompletedTestJob), jobs.some(hasClaimedTestJob)),
      href: "/ops",
    },
    {
      key: "high-risk-review",
      label: "Detailed review lane is exercised",
      detail: highRiskChange
        ? "A high-risk dry-run proposal exists and is routed to detailed review."
        : "Submit a dry-run proposal from a running test job to verify the high-risk lane.",
      status: statusFrom(Boolean(highRiskChange), jobs.some(hasClaimedTestJob)),
      href: highRiskChange ? `/changes/${highRiskChange.id}` : "/ops",
    },
    {
      key: "low-risk-review",
      label: "Low-risk approval lane is exercised",
      detail: lowRiskApproved
        ? "A low-risk acceptance proposal has been approved."
        : lowRiskPending
          ? "A low-risk acceptance proposal is waiting for quick approval."
          : "Create a low-risk acceptance proposal, then approve it from Changes.",
      status: statusFrom(Boolean(lowRiskApproved), contactCount > 0),
      href: lowRiskPending ? `/changes/${lowRiskPending.id}` : "/changes",
    },
    {
      key: "audit-provenance",
      label: "Approval leaves audit and provenance",
      detail:
        approvalAudit && lowRiskProvenance
          ? `Approval audit and field provenance are recorded for ${lowRiskProvenance.field_name}.`
          : "Approve the low-risk acceptance proposal to prove field provenance and audit history.",
      status: statusFrom(Boolean(approvalAudit && lowRiskProvenance), Boolean(lowRiskApproved)),
      href: lowRiskApproved ? `/changes/${lowRiskApproved.id}` : "/changes",
    },
    {
      key: "prospecting-review",
      label: "Prospecting candidate review works",
      detail: prospectingAudit
        ? "A reviewed prospecting candidate has been approved into Want to Know."
        : prospectingPending
          ? "A prospecting candidate test is waiting for detailed review."
          : "Create a prospecting proposal from Ops, then approve it from Changes.",
      status: statusFrom(Boolean(prospectingAudit), contactCount > 0),
      href: prospectingPending
        ? `/changes/${prospectingPending.id}`
        : prospectingApproved
          ? "/want-to-know"
          : "/ops",
    },
    {
      key: "post-approval-enrichment",
      label: "Post-approval enrichment queues",
      detail: followUpJob
        ? "Approving an enrichment proposal queued the follow-up enrichment job."
        : "Approve a low-risk contact enrichment proposal to confirm the follow-up queue.",
      status: statusFrom(Boolean(followUpJob), Boolean(lowRiskApproved)),
      href: followUpJob ? `/ops/jobs/${followUpJob.id}` : "/ops",
    },
    ...moduleProofItems({
      contactCount,
      prospectingReady: Boolean(prospectingAudit),
      moduleProof,
    }),
  ];

  const completed = items.filter((item) => item.status === "pass").length;
  const nextAction =
    items.find((item) => item.status === "action") ??
    items.find((item) => item.status === "waiting") ??
    items[items.length - 1];

  return {
    completed,
    total: items.length,
    ready: completed === items.length,
    items,
    nextAction,
  };
}

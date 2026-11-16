export type ClaudeImportJob = {
  id: string;
  status: string;
  result: Record<string, unknown> | null;
  created_at: string;
};

export type ClaudeImportPendingChange = {
  id: string;
  status: string;
  change_type: string;
  risk_level: string | null;
  source: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export type ClaudeImportAuditRow = {
  actor_type: string;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type ClaudeImportProvenanceRow = {
  field_name: string;
  source_type: string;
  source_ref: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type ClaudeImportInteraction = {
  id: string;
  source: string | null;
  source_ref: string | null;
  created_at: string;
};

export type ClaudeImportReceiptInput = {
  jobs: ClaudeImportJob[];
  pendingChanges: ClaudeImportPendingChange[];
  audit: ClaudeImportAuditRow[];
  provenance: ClaudeImportProvenanceRow[];
  interactions: ClaudeImportInteraction[];
};

export type ClaudeImportReceiptAction = {
  label: string;
  detail: string;
  href: string;
  priority: "critical" | "important" | "useful";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function payloadRequiresVerification(payload: Record<string, unknown> | null) {
  if (!payload) return false;

  const verification = payload.verification;
  if (isRecord(verification) && verification.required === true) return true;

  const evidence = payload.evidence;
  if (isRecord(evidence) && evidence.verified_with_owner === false) return true;

  const ownerContext = payload.owner_context;
  return isRecord(ownerContext) && ownerContext.status === "requested";
}

function hasDuplicateSignal(row: ClaudeImportAuditRow) {
  return row.metadata?.duplicate === true || /duplicate/i.test(row.action);
}

function newestDate(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

function buildActions({
  completedJobCount,
  pendingReviewCount,
  ownerVerificationCount,
  provenanceCount,
  interactionCount,
}: {
  completedJobCount: number;
  pendingReviewCount: number;
  ownerVerificationCount: number;
  provenanceCount: number;
  interactionCount: number;
}): ClaudeImportReceiptAction[] {
  const actions: ClaudeImportReceiptAction[] = [];

  if (completedJobCount === 0 && interactionCount === 0) {
    actions.push({
      label: "Run the first Claude operating pass",
      detail:
        "Claim and complete one real job or log one transcript-backed interaction before scaling the import.",
      href: "/ops",
      priority: "critical",
    });
  }

  if (pendingReviewCount > 0) {
    actions.push({
      label: "Review Claude proposals",
      detail: `${pendingReviewCount} pending change${
        pendingReviewCount === 1 ? "" : "s"
      } need approval, edits, dismissal, or owner context.`,
      href: "/changes",
      priority: "important",
    });
  }

  if (ownerVerificationCount > 0) {
    actions.push({
      label: "Ask owner verification questions",
      detail: `${ownerVerificationCount} proposal${
        ownerVerificationCount === 1 ? "" : "s"
      } include owner-verification requirements before trust-sensitive use.`,
      href: "/changes",
      priority: "important",
    });
  }

  if (provenanceCount === 0 && pendingReviewCount > 0) {
    actions.push({
      label: "Approve one safe proposal",
      detail:
        "Approve a low-risk, source-backed proposal to prove field provenance and audit history.",
      href: "/changes",
      priority: "useful",
    });
  }

  return actions.slice(0, 4);
}

export function buildClaudeImportReceipt(input: ClaudeImportReceiptInput) {
  const completedJobCount = input.jobs.filter(
    (job) => job.status === "succeeded",
  ).length;
  const pendingReviewCount = input.pendingChanges.filter(
    (change) => change.status === "pending",
  ).length;
  const ownerVerificationCount = input.pendingChanges.filter((change) =>
    payloadRequiresVerification(change.payload),
  ).length;
  const highRiskPendingCount = input.pendingChanges.filter(
    (change) => change.status === "pending" && change.risk_level === "high",
  ).length;
  const claudeAuditCount = input.audit.filter(
    (row) => row.actor_type === "claude",
  ).length;
  const duplicateSignalCount = input.audit.filter(hasDuplicateSignal).length;
  const provenanceCount = input.provenance.length;
  const interactionCount = input.interactions.length;
  const latestActivityAt = newestDate([
    ...input.jobs.map((job) => job.created_at),
    ...input.pendingChanges.map((change) => change.created_at),
    ...input.audit.map((row) => row.created_at),
    ...input.provenance.map((row) => row.created_at),
    ...input.interactions.map((row) => row.created_at),
  ]);
  const evidenceCount =
    completedJobCount +
    pendingReviewCount +
    claudeAuditCount +
    provenanceCount +
    interactionCount;
  const status =
    evidenceCount === 0
      ? "waiting"
      : pendingReviewCount > 0 || ownerVerificationCount > 0
        ? "review"
        : "recorded";

  return {
    status,
    latestActivityAt,
    completedJobCount,
    pendingReviewCount,
    ownerVerificationCount,
    highRiskPendingCount,
    claudeAuditCount,
    duplicateSignalCount,
    provenanceCount,
    interactionCount,
    actions: buildActions({
      completedJobCount,
      pendingReviewCount,
      ownerVerificationCount,
      provenanceCount,
      interactionCount,
    }),
  };
}

export type OpsCommandJob = {
  id: string;
  job_type: string;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  run_after: string;
  created_at: string;
};

export type OpsCommandPending = {
  id: string;
  change_type: string;
  risk_level: string | null;
  source: string | null;
  created_at: string;
};

export type OpsCommandAcceptance = {
  completed: number;
  total: number;
  ready: boolean;
  nextAction: {
    label: string;
    detail: string;
    href: string;
  };
  items: Array<{
    key: string;
    label: string;
    status: "pass" | "action" | "waiting";
    href: string;
  }>;
};

export type OpsCommandRisk = {
  warningCount: number;
  nextAction: {
    label: string;
    detail: string;
    href: string;
  };
};

export type OpsCommandPipeline = {
  activeProductionJobs: OpsCommandJob[];
  blockedJobs: OpsCommandJob[];
  highRiskPending: OpsCommandPending[];
  productionJobs: OpsCommandJob[];
  nextAction: {
    label: string;
    detail: string;
    href: string;
  };
};

export type OpsCommandMetric = {
  label: string;
  value: string;
  detail: string;
  tone: "ok" | "warn" | "neutral";
};

export type OpsCommandPhase = {
  label: string;
  detail: string;
  status: "ready" | "action" | "waiting";
  href: string;
};

function percentage(done: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

function acceptanceItem(
  acceptance: OpsCommandAcceptance,
  key: string,
): OpsCommandAcceptance["items"][number] | null {
  return acceptance.items.find((item) => item.key === key) ?? null;
}

function phaseStatus(passed: boolean, canAct = true): OpsCommandPhase["status"] {
  if (passed) return "ready";
  return canAct ? "action" : "waiting";
}

function pendingTone(count: number) {
  if (count >= 10) return "warn";
  if (count > 0) return "neutral";
  return "ok";
}

export function buildOpsCommandCenter({
  contactCount,
  jobs,
  pending,
  acceptance,
  pipeline,
  risk,
}: {
  contactCount: number;
  jobs: OpsCommandJob[];
  pending: OpsCommandPending[];
  acceptance: OpsCommandAcceptance;
  pipeline: OpsCommandPipeline;
  risk: OpsCommandRisk;
}) {
  const activeJobs = jobs.filter((job) =>
    ["queued", "running"].includes(job.status),
  );
  const activeTestJobs = activeJobs.filter((job) => job.payload.test_mode === true);
  const activeProductionJobs = activeJobs.filter(
    (job) => job.payload.test_mode !== true,
  );
  const failedJobs = jobs.filter((job) => job.status === "failed");
  const highRiskPending = pending.filter((change) => change.risk_level === "high");
  const acceptancePercent = percentage(acceptance.completed, acceptance.total);

  let status = "Ready";
  let tone: "ok" | "warn" | "neutral" = "ok";
  let headline = "Claude loop is ready for operator-led work";
  let detail =
    "The command center sees no blocking risk. Use the next Claude move when you want to import, enrich, or verify more relationship data.";
  let href = pipeline.nextAction.href;
  let actionLabel = pipeline.nextAction.label;

  if (risk.warningCount > 0) {
    status = "Review";
    tone = "warn";
    headline = risk.nextAction.label;
    detail = risk.nextAction.detail;
    href = risk.nextAction.href;
    actionLabel = "Open risk item";
  } else if (!acceptance.ready) {
    status = "Setup";
    tone = "neutral";
    headline = acceptance.nextAction.label;
    detail = acceptance.nextAction.detail;
    href = acceptance.nextAction.href;
    actionLabel = "Open acceptance step";
  } else if (activeProductionJobs.length > 0) {
    status = "Active";
    tone = "neutral";
    headline = pipeline.nextAction.label;
    detail = pipeline.nextAction.detail;
    href = pipeline.nextAction.href;
    actionLabel = "Open active work";
  } else if (pending.length > 0) {
    status = "Review";
    tone = "neutral";
    headline = "Clear the review queue";
    detail =
      "Pending changes are waiting for owner or operator approval before more judgment-heavy data should be trusted.";
    href = "/changes";
    actionLabel = "Open Changes";
  }

  const gatewayClaimed = acceptanceItem(acceptance, "test-job-claimed");
  const gatewayCompleted = acceptanceItem(acceptance, "test-job-completed");
  const highRiskLane = acceptanceItem(acceptance, "high-risk-review");
  const lowRiskLane = acceptanceItem(acceptance, "low-risk-review");
  const auditProvenance = acceptanceItem(acceptance, "audit-provenance");

  const phases: OpsCommandPhase[] = [
    {
      label: "Data present",
      detail:
        contactCount > 0
          ? `${contactCount} contact${contactCount === 1 ? "" : "s"} available for Claude work.`
          : "Import or seed the first contact set before running Claude work.",
      status: phaseStatus(contactCount > 0),
      href: "/contacts",
    },
    {
      label: "Claude gateway",
      detail:
        gatewayClaimed?.status === "pass" && gatewayCompleted?.status === "pass"
          ? "Claim and completion endpoints have both been exercised."
          : "Run the test job claim and completion flow before trusting production imports.",
      status: phaseStatus(
        gatewayClaimed?.status === "pass" && gatewayCompleted?.status === "pass",
        contactCount > 0,
      ),
      href: gatewayCompleted?.href ?? "/ops",
    },
    {
      label: "Review lanes",
      detail:
        highRiskLane?.status === "pass" && lowRiskLane?.status === "pass"
          ? "High-risk and low-risk proposal paths are both proven."
          : "Exercise both review lanes so owner-verification behavior is predictable.",
      status: phaseStatus(
        highRiskLane?.status === "pass" && lowRiskLane?.status === "pass",
        gatewayClaimed?.status === "pass",
      ),
      href: highRiskLane?.status === "pass" ? (lowRiskLane?.href ?? "/changes") : (highRiskLane?.href ?? "/ops"),
    },
    {
      label: "Audit trail",
      detail:
        auditProvenance?.status === "pass"
          ? "Approval audit and field provenance are being recorded."
          : "Approve a safe proposal to verify audit and provenance before handoff.",
      status: phaseStatus(
        auditProvenance?.status === "pass",
        lowRiskLane?.status === "pass",
      ),
      href: auditProvenance?.href ?? "/changes",
    },
    {
      label: "Production flow",
      detail:
        pipeline.productionJobs.length > 0
          ? `${pipeline.productionJobs.length} production enrichment job${
              pipeline.productionJobs.length === 1 ? "" : "s"
            } visible.`
          : "No production enrichment work has been run yet.",
      status: phaseStatus(
        pipeline.productionJobs.length > 0 || acceptance.ready,
        acceptance.ready,
      ),
      href: pipeline.nextAction.href,
    },
  ];

  const metrics: OpsCommandMetric[] = [
    {
      label: "Acceptance",
      value: `${acceptancePercent}%`,
      detail: `${acceptance.completed}/${acceptance.total} launch checks passed.`,
      tone: acceptance.ready ? "ok" : "neutral",
    },
    {
      label: "Active Claude work",
      value: String(activeJobs.length),
      detail: `${activeProductionJobs.length} production · ${activeTestJobs.length} test.`,
      tone: activeJobs.length > 8 ? "warn" : "neutral",
    },
    {
      label: "Review pressure",
      value: String(pending.length),
      detail: `${highRiskPending.length} high-risk proposal${
        highRiskPending.length === 1 ? "" : "s"
      } waiting.`,
      tone: highRiskPending.length > 0 ? "warn" : pendingTone(pending.length),
    },
    {
      label: "Blocked jobs",
      value: String(failedJobs.length),
      detail: `${pipeline.blockedJobs.length} production blocker${
        pipeline.blockedJobs.length === 1 ? "" : "s"
      } visible.`,
      tone: failedJobs.length > 0 ? "warn" : "ok",
    },
  ];

  const runbook = [
    {
      label: "Claim",
      detail: "Have Claude claim the next queued job through the private job endpoint.",
      href: "/claude-setup",
    },
    {
      label: "Work",
      detail: "Claude uses the contact context and owner rules, then proposes structured updates.",
      href: activeJobs[0] ? `/ops/jobs/${activeJobs[0].id}/handoff` : "/ops",
    },
    {
      label: "Return",
      detail: "Paste the result into the job handoff so the app records audit and usage.",
      href: activeJobs[0] ? `/ops/jobs/${activeJobs[0].id}/handoff` : "/ops",
    },
    {
      label: "Verify",
      detail: "Review judgment-heavy changes before they become durable relationship data.",
      href: "/changes",
    },
  ];

  return {
    status,
    tone,
    headline,
    detail,
    href,
    actionLabel,
    metrics,
    phases,
    runbook,
  };
}

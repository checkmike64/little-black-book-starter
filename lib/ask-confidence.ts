export type AskConfidenceInput = {
  activeJobCount: number;
  evidenceCount: number;
  mode: string;
  pendingChangeCount: number;
  resultCount: number;
  sourceCounts: {
    changes: number;
    connections: number;
    contacts: number;
    interactions: number;
    jobs: number;
    promises: number;
    transcripts?: number;
    actions?: number;
    provenance?: number;
  };
  topScore: number;
};

export type AskConfidence = {
  label: string;
  tone: "ok" | "warn" | "neutral";
  recommendation: string;
  reasons: string[];
};

function groundedSourceCount(sourceCounts: AskConfidenceInput["sourceCounts"]) {
  return (
    sourceCounts.interactions +
    sourceCounts.promises +
    sourceCounts.changes +
    sourceCounts.jobs +
    sourceCounts.connections
    + (sourceCounts.transcripts ?? 0)
    + (sourceCounts.actions ?? 0)
    + (sourceCounts.provenance ?? 0)
  );
}

export function buildAskConfidence({
  activeJobCount,
  evidenceCount,
  mode,
  pendingChangeCount,
  resultCount,
  sourceCounts,
  topScore,
}: AskConfidenceInput): AskConfidence {
  const grounded = groundedSourceCount(sourceCounts);
  const reasons: string[] = [];

  if (resultCount === 0 && evidenceCount === 0) {
    return {
      label: "No confident answer",
      tone: "warn",
      recommendation:
        "Refine the query, choose a mode, or add source-backed relationship context before acting.",
      reasons: ["No matched people or supporting evidence were found."],
    };
  }

  if (resultCount > 0) {
    reasons.push(`${resultCount} matched people`);
  }

  if (evidenceCount > 0) {
    reasons.push(`${evidenceCount} supporting evidence item${evidenceCount === 1 ? "" : "s"}`);
  }

  if (grounded < 8) {
    reasons.push("source context is still thin");
  } else if (grounded >= 25) {
    reasons.push("source context is deep");
  } else {
    reasons.push("source context is usable");
  }

  if (pendingChangeCount > 0) {
    reasons.push(`${pendingChangeCount} pending change${pendingChangeCount === 1 ? "" : "s"} may affect the answer`);
  }

  if (activeJobCount > 0) {
    reasons.push(`${activeJobCount} active Claude job${activeJobCount === 1 ? "" : "s"} may still update context`);
  }

  if (pendingChangeCount > 0 || activeJobCount > 0) {
    return {
      label: "Verify before acting",
      tone: "warn",
      recommendation:
        "Resolve pending changes or active Claude jobs before relying on this answer for outreach or referrals.",
      reasons,
    };
  }

  if (grounded < 8 || topScore < 50) {
    return {
      label: "Usable but thin",
      tone: "neutral",
      recommendation:
        "Use this as a shortlist, then inspect the profile and source context before outreach.",
      reasons,
    };
  }

  if (["referrals", "podcasts", "investors", "ma"].includes(mode)) {
    reasons.push("mode-specific fit matched stored context");
  }

  return {
    label: "Ready to inspect",
    tone: "ok",
    recommendation:
      "Open the top profile and confirm judgment fields before taking action.",
    reasons,
  };
}

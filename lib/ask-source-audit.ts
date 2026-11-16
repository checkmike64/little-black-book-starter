export type AskSourceCounts = {
  contacts: number;
  interactions: number;
  promises: number;
  changes: number;
  jobs: number;
  connections: number;
  transcripts?: number;
  actions?: number;
  provenance?: number;
};

export type AskEvidenceType =
  | "interaction"
  | "transcript"
  | "promise"
  | "action"
  | "provenance"
  | "change"
  | "job"
  | "command"
  | "connection";

export type AskSourceAudit = {
  label: string;
  tone: "ok" | "warn" | "neutral";
  groundedCount: number;
  evidenceTypeCounts: Record<AskEvidenceType, number>;
  strengths: string[];
  gaps: string[];
  recommendation: string;
};

const evidenceTypes: AskEvidenceType[] = [
  "interaction",
  "transcript",
  "promise",
  "action",
  "provenance",
  "change",
  "job",
  "command",
  "connection",
];

function groundedCount(sourceCounts: AskSourceCounts) {
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

export function buildAskSourceAudit({
  evidence,
  sourceCounts,
}: {
  evidence: AskEvidenceType[];
  sourceCounts: AskSourceCounts;
}): AskSourceAudit {
  const typeCounts = evidenceTypes.reduce(
    (accumulator, type) => {
      accumulator[type] = evidence.filter((item) => item === type).length;
      return accumulator;
    },
    {} as Record<AskEvidenceType, number>,
  );
  const grounded = groundedCount(sourceCounts);
  const strengths: string[] = [];
  const gaps: string[] = [];

  if (sourceCounts.contacts > 0) strengths.push(`${sourceCounts.contacts} contacts visible`);
  if (sourceCounts.interactions > 0) strengths.push("interaction history is searchable");
  if ((sourceCounts.transcripts ?? 0) > 0) strengths.push("distilled transcripts are searchable");
  if (sourceCounts.promises > 0) strengths.push("open promises are searchable");
  if ((sourceCounts.actions ?? 0) > 0) strengths.push("tracked follow-ups are searchable");
  if ((sourceCounts.provenance ?? 0) > 0) strengths.push("correspondence-derived evidence is searchable");
  if (sourceCounts.connections > 0) strengths.push("warm-path evidence is searchable");
  if (typeCounts.command > 0) strengths.push("Claude command output matched");
  if (typeCounts.change > 0) strengths.push("pending review context matched");

  if (sourceCounts.contacts === 0) gaps.push("no contacts visible");
  if (sourceCounts.interactions === 0) gaps.push("no interaction history visible");
  if ((sourceCounts.transcripts ?? 0) === 0) gaps.push("no distilled transcripts visible");
  if (sourceCounts.promises === 0) gaps.push("no open promises visible");
  if (sourceCounts.connections === 0) gaps.push("no warm paths visible");
  if (grounded < 8) gaps.push("source context is still thin");
  if (evidence.length === 0) gaps.push("no source-grounded evidence matched this query");

  if (typeCounts.change > 0 || typeCounts.job > 0 || typeCounts.command > 0) {
    return {
      label: "Review-dependent",
      tone: "warn",
      groundedCount: grounded,
      evidenceTypeCounts: typeCounts,
      strengths,
      gaps,
      recommendation:
        "Inspect matching pending changes or Claude outputs before acting on this Ask result.",
    };
  }

  if (evidence.length > 0 && grounded >= 8) {
    return {
      label: "Evidence-backed",
      tone: "ok",
      groundedCount: grounded,
      evidenceTypeCounts: typeCounts,
      strengths,
      gaps,
      recommendation:
        "This Ask run has supporting relationship evidence; inspect the top profile before taking action.",
    };
  }

  return {
    label: "Contact-field match",
    tone: "neutral",
    groundedCount: grounded,
    evidenceTypeCounts: typeCounts,
    strengths,
    gaps,
    recommendation:
      "Treat this as a shortlist until interactions, promises, warm paths, or Claude evidence support it.",
  };
}

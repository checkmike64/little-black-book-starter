export type ContactEnrichmentStatusInput = {
  status: string;
  updated_at?: string;
} | null;

export function contactEnrichmentStatus({
  activeJob,
  latestJob,
  pendingChangeCount,
  unresolvedGapCount,
}: {
  activeJob: ContactEnrichmentStatusInput;
  latestJob: ContactEnrichmentStatusInput;
  pendingChangeCount: number;
  unresolvedGapCount: number;
}) {
  if (activeJob?.status === "running") {
    return {
      label: "Researching",
      detail: "Claude is checking source context and public profiles.",
      tone: "hot" as const,
    };
  }

  if (activeJob) {
    return {
      label: "Queued",
      detail: "Profile research is waiting for Claude.",
      tone: "gold" as const,
    };
  }

  if (pendingChangeCount > 0) {
    return {
      label: "Review ready",
      detail: `${pendingChangeCount} suggested update${pendingChangeCount === 1 ? " is" : "s are"} waiting in Changes.`,
      tone: "gold" as const,
    };
  }

  if (latestJob?.status === "succeeded") {
    if (unresolvedGapCount > 0) {
      return {
        label: "More research needed",
        detail: "The last search finished, but public profile details are still missing.",
        tone: "warn" as const,
      };
    }

    return {
      label: "Research complete",
      detail: "The latest profile research finished. Only approved information is shown here.",
      tone: "cool" as const,
    };
  }

  if (latestJob?.status === "failed") {
    return {
      label: "Research stopped",
      detail: "The last search did not finish. It can be started again.",
      tone: "warn" as const,
    };
  }

  return {
    label: "Not searched",
    detail: "Search can check source context and public profiles for missing links.",
    tone: "neutral" as const,
  };
}

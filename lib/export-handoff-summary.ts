export type ExportHandoffManifest = {
  tenantName: string;
  readyForOwnerUse: boolean;
  ownerVisibility: string;
  ownerReviewSurface: string;
  enabledModules: string[];
  hiddenModules: string[];
  missingSetup: string[];
  writePosture: {
    mechanicalWrites: string;
    judgmentFields: string;
    transcriptStorage: string;
  };
};

export type ExportHandoffSection = {
  key: string;
  label: string;
  table: string;
  count: number | null;
  exportedCount?: number;
  limit?: number;
  truncated?: boolean;
  error?: string;
};

export type ExportHandoffSummaryInput = {
  exportedAt: string;
  tenantName: string;
  manifest: ExportHandoffManifest;
  sections: ExportHandoffSection[];
};

export type ExportHandoffNextAction = {
  label: string;
  detail: string;
  href: string;
};

function countFor(sections: ExportHandoffSection[], key: string) {
  return sections.find((section) => section.key === key)?.count ?? 0;
}

function sectionWarnings(sections: ExportHandoffSection[]) {
  return sections.filter((section) => section.error || section.truncated);
}

function bullets(values: string[], empty: string) {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : `- ${empty}`;
}

export function buildExportHandoffReadiness(input: ExportHandoffSummaryInput) {
  const warnings = sectionWarnings(input.sections);
  const pendingChanges = countFor(input.sections, "pending_changes");
  const contacts = countFor(input.sections, "contacts");
  const jobs = countFor(input.sections, "jobs");
  const askRuns = countFor(input.sections, "ask_runs");
  const relationshipActions = countFor(input.sections, "relationship_actions");
  const blockers = [
    !input.manifest.readyForOwnerUse ? "install manifest has missing setup" : null,
    input.manifest.missingSetup.length > 0
      ? `${input.manifest.missingSetup.length} setup item${
          input.manifest.missingSetup.length === 1 ? "" : "s"
        } remain`
      : null,
    pendingChanges > 0
      ? `${pendingChanges} pending change${pendingChanges === 1 ? "" : "s"} need review`
      : null,
    contacts === 0 ? "no contacts are visible in export scope" : null,
    jobs === 0 ? "no Claude job evidence is visible yet" : null,
    askRuns === 0 ? "no saved Ask run evidence is visible yet" : null,
    relationshipActions === 0
      ? "no tracked relationship action evidence is visible yet"
      : null,
    warnings.length > 0
      ? `${warnings.length} export section${warnings.length === 1 ? "" : "s"} failed or was capped`
      : null,
  ].filter((item): item is string => Boolean(item));
  const nextActions: ExportHandoffNextAction[] = [
    input.manifest.missingSetup.length > 0
      ? {
          label: "Complete setup profile",
          detail: "Fill the missing operator setup items before owner handoff.",
          href: "/settings",
        }
      : null,
    pendingChanges > 0
      ? {
          label: "Clear proposed changes",
          detail: "Approve or reject pending Claude proposals before relying on the export.",
          href: "/changes",
        }
      : null,
    contacts === 0
      ? {
          label: "Seed relationship data",
          detail: "Import or seed verified contacts before using the Book.",
          href: "/claude-setup",
        }
      : null,
    jobs === 0
      ? {
          label: "Run Claude loop proof",
          detail: "Complete at least one Claude job so handoff includes automation evidence.",
          href: "/ops",
        }
      : null,
    askRuns === 0
      ? {
          label: "Run Ask proof",
          detail: "Save at least one Ask run to prove the query layer.",
          href: "/ask",
        }
      : null,
    relationshipActions === 0
      ? {
          label: "Track one relationship action",
          detail: "Create or close at least one movement item so the action loop is proven.",
          href: "/movement",
        }
      : null,
    warnings.length > 0
      ? {
          label: "Review export warnings",
          detail: "Resolve failed or capped sections before relying on the portable export.",
          href: "/export",
        }
      : null,
  ].filter((item): item is ExportHandoffNextAction => Boolean(item));

  return {
    ready: blockers.length === 0,
    blockers,
    nextActions,
    warningCount: warnings.length,
    counts: {
      contacts,
      pendingChanges,
      jobs,
      askRuns,
      auditRows: countFor(input.sections, "audit_log"),
      provenanceRows: countFor(input.sections, "field_provenance"),
      relationshipActions,
    },
  };
}

export function formatExportHandoffSummary(input: ExportHandoffSummaryInput) {
  const readiness = buildExportHandoffReadiness(input);

  return [
    `Little Black Book export handoff: ${input.tenantName}`,
    `Generated: ${input.exportedAt}`,
    "",
    "Readiness:",
    `- Export handoff status: ${readiness.ready ? "ready" : "needs review"}`,
    `- Owner visibility: ${input.manifest.ownerVisibility}`,
    `- Review surface: ${input.manifest.ownerReviewSurface}`,
    "",
    "Enabled modules:",
    bullets(input.manifest.enabledModules, "None enabled"),
    "",
    "Hidden modules:",
    bullets(input.manifest.hiddenModules, "None hidden"),
    "",
    "Write posture:",
    `- Mechanical writes: ${input.manifest.writePosture.mechanicalWrites}`,
    `- Judgment fields: ${input.manifest.writePosture.judgmentFields}`,
    `- Transcript storage: ${input.manifest.writePosture.transcriptStorage}`,
    "",
    "Export evidence counts:",
    `- Contacts: ${readiness.counts.contacts}`,
    `- Pending changes: ${readiness.counts.pendingChanges}`,
    `- Claude jobs: ${readiness.counts.jobs}`,
    `- Saved Ask runs: ${readiness.counts.askRuns}`,
    `- Relationship actions: ${readiness.counts.relationshipActions}`,
    `- Audit rows: ${readiness.counts.auditRows}`,
    `- Field provenance rows: ${readiness.counts.provenanceRows}`,
    "",
    "Blockers or review items:",
    readiness.blockers.length
      ? readiness.blockers.map((blocker) => `- ${blocker}`).join("\n")
      : "- None detected from export scope",
    "",
    "Operator next actions:",
    readiness.nextActions.length
      ? readiness.nextActions
          .map((action, index) => `${index + 1}. ${action.label} - ${action.detail} (${action.href})`)
          .join("\n")
      : "1. No export-derived action items remain.",
    "",
    "Export sections:",
    ...input.sections.map((section) =>
      `- ${section.label}: ${section.count ?? "blocked"} (${section.table})${
        section.error
          ? " - failed"
          : section.truncated
            ? ` - capped at ${section.exportedCount ?? section.limit ?? "configured limit"}`
            : ""
      }`,
    ),
  ].join("\n");
}

export function exportHandoffFileName(tenantName: string | null | undefined) {
  const date = new Date().toISOString().slice(0, 10);
  const slug = (tenantName ?? "little-black-book")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);

  return `${slug || "little-black-book"}-handoff-${date}.txt`;
}

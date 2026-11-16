export type LaunchTriageChange = {
  id: string;
  contact_id: string | null;
  contact?: { full_name: string; company_name: string | null } | null;
  change_type: string;
  summary: string;
  payload: Record<string, unknown>;
  risk_level: string | null;
  source: string | null;
  created_at: string;
  replaces_pending_change_id: string | null;
  replaced_by_pending_change_id: string | null;
  superseded_at: string | null;
};

export type LaunchChangeCohort = {
  key: string;
  fieldLabel: string;
  proposedValue: string;
  evidenceSummary: string | null;
  rows: LaunchTriageChange[];
};

export type LaunchChangeTriage = {
  testArtifacts: LaunchTriageChange[];
  cohorts: LaunchChangeCohort[];
  individualRows: LaunchTriageChange[];
};

function nestedRecord(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isTestArtifact(row: LaunchTriageChange) {
  return row.payload.dry_run === true || row.source?.includes("dry_run") === true;
}

function ownerVerified(row: LaunchTriageChange) {
  return nestedRecord(row.payload, "evidence")?.verified_with_owner === true;
}

function proposedFields(payload: Record<string, unknown>) {
  const fields = payload.fields;
  return fields && typeof fields === "object" && !Array.isArray(fields)
    ? (fields as Record<string, unknown>)
    : {};
}

function formatValue(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(", ");
  if (value === null || value === undefined || value === "") return "Not provided";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function cohortCandidate(row: LaunchTriageChange) {
  if (isTestArtifact(row) || ownerVerified(row)) return null;
  if (row.risk_level !== "high" || row.payload.confidence !== "low") return null;

  const entries = Object.entries(proposedFields(row.payload));
  if (entries.length !== 1) return null;

  const [field, value] = entries[0];
  const evidenceSummary = text(
    nestedRecord(row.payload, "evidence")?.verification_summary,
  );
  const normalizedEvidence = evidenceSummary
    ?.toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    key: JSON.stringify([field, value, normalizedEvidence]),
    fieldLabel: field.replaceAll("_", " "),
    proposedValue: formatValue(value),
    evidenceSummary,
  };
}

export function buildLaunchChangeTriage(
  rows: LaunchTriageChange[],
): LaunchChangeTriage {
  const testArtifacts = rows.filter(isTestArtifact);
  const testIds = new Set(testArtifacts.map((row) => row.id));
  const grouped = new Map<string, LaunchChangeCohort>();

  for (const row of rows) {
    if (testIds.has(row.id)) continue;
    const candidate = cohortCandidate(row);
    if (!candidate) continue;
    const existing = grouped.get(candidate.key);
    if (existing) existing.rows.push(row);
    else grouped.set(candidate.key, { ...candidate, rows: [row] });
  }

  const cohorts = [...grouped.values()].filter((cohort) => cohort.rows.length >= 2);
  const cohortIds = new Set(cohorts.flatMap((cohort) => cohort.rows.map((row) => row.id)));
  const individualRows = rows.filter(
    (row) => !testIds.has(row.id) && !cohortIds.has(row.id),
  );

  return { testArtifacts, cohorts, individualRows };
}

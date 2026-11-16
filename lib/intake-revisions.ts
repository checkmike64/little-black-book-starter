export type IntakeRevisionAuditRow = {
  id: string;
  actor_type: string;
  actor_user_id?: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
};

export type IntakeRevision = {
  id: string;
  action: string;
  actionLabel: string;
  actorLabel: string;
  createdAt: string;
  changedSections: string[];
  summary: string;
};

const trackedSections = [
  ["modules", "Module visibility"],
  ["quotas", "Quotas"],
  ["write_rules", "Write posture"],
  ["onboarding.network_thesis", "Network thesis"],
  ["onboarding.referral_lanes", "Referral lanes"],
  ["onboarding.prospecting_focus", "Prospecting focus"],
  ["onboarding.outreach_focus", "Outreach focus"],
  ["onboarding.relationship_rules", "Relationship rules"],
  ["onboarding.intake_notes", "Intake notes"],
  ["prospecting.buckets", "Prospecting buckets"],
  ["delivery.launch_notes", "Launch notes"],
  ["delivery.production_checks", "Production signoff"],
  ["voice_profile.owner_voice", "Owner voice"],
  ["voice_profile.assistant_style", "Assistant style"],
  ["voice_profile.default_outreach_tone", "Outreach tone"],
] as const;

function settingsFrom(payload: Record<string, unknown> | null) {
  const settings = payload?.settings;
  return settings && typeof settings === "object" && !Array.isArray(settings)
    ? (settings as Record<string, unknown>)
    : {};
}

function valueAtPath(root: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    return (current as Record<string, unknown>)[key];
  }, root);
}

function sortForComparison(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForComparison);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortForComparison(child)]),
  );
}

function stableString(value: unknown) {
  if (value === undefined) return "";
  return JSON.stringify(sortForComparison(value));
}

function actionLabel(action: string) {
  if (action === "tenant.intake.updated") return "Intake profile saved";
  if (action === "tenant.settings.updated") return "Install settings saved";
  return action.replaceAll("_", " ").replaceAll(".", " / ");
}

function actorLabel(row: IntakeRevisionAuditRow) {
  if (row.actor_type === "client") return "operator";
  if (row.actor_user_id) return row.actor_user_id.slice(0, 8);
  return row.actor_type || "system";
}

export function changedIntakeSections(row: IntakeRevisionAuditRow) {
  const before = settingsFrom(row.before);
  const after = settingsFrom(row.after);

  return trackedSections
    .filter(
      ([path]) =>
        stableString(valueAtPath(before, path)) !==
        stableString(valueAtPath(after, path)),
    )
    .map(([, label]) => label);
}

export function buildIntakeRevisionHistory(rows: IntakeRevisionAuditRow[]) {
  return rows.map((row) => {
    const changedSections = changedIntakeSections(row);
    const summary =
      changedSections.length > 0
        ? changedSections.join(", ")
        : "Settings were saved without tracked section changes.";

    return {
      id: row.id,
      action: row.action,
      actionLabel: actionLabel(row.action),
      actorLabel: actorLabel(row),
      createdAt: row.created_at,
      changedSections,
      summary,
    } satisfies IntakeRevision;
  });
}

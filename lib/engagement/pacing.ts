export type EngagementPacingIdentity = {
  engagement_target_per_month?: number | null;
  relationship_type?: string[] | null;
  touch_cadence?: string | null;
  trust_level?: string | null;
  is_want_to_know?: boolean;
  default_target_per_month?: number | null;
};

function cadenceTarget(value: string | null | undefined) {
  const cadence = value?.toLowerCase().trim() ?? "";
  if (!cadence) return null;
  if (/daily|weekly|biweekly|bi-weekly|fortnight/i.test(cadence)) return 2;
  if (/monthly|every month/i.test(cadence)) return 1;
  if (/every 2 months|bimonth|bi-month/i.test(cadence)) return 0.5;
  if (/quarter|3 months/i.test(cadence)) return 1 / 3;
  if (/biannual|semiannual|semi-annual|6 months|twice a year/i.test(cadence)) return 1 / 6;
  if (/dormant|no active cadence|ad hoc/i.test(cadence)) return 0;
  if (/annual|yearly|once a year|12 months/i.test(cadence)) return 1 / 12;
  return null;
}

function trustTarget(value: string | null | undefined) {
  const trust = value?.toLowerCase() ?? "";
  if (/tier 1|deep trust/i.test(trust)) return 1;
  if (/tier 2|working trust/i.test(trust)) return 0.5;
  return 0.25;
}

export function engagementTargetPerMonth(identity: EngagementPacingIdentity) {
  const override = identity.engagement_target_per_month;
  if (
    typeof override === "number" &&
    Number.isFinite(override) &&
    override >= 0
  ) {
    return Math.min(override, 8);
  }

  if (identity.is_want_to_know) {
    const configured = identity.default_target_per_month;
    return typeof configured === "number" && Number.isFinite(configured)
      ? Math.min(Math.max(configured, 0), 8)
      : 1;
  }

  const cadence = cadenceTarget(identity.touch_cadence);
  const relationshipTypes = identity.relationship_type ?? [];
  const buildingReferralRelationship = relationshipTypes.some((type) =>
    /referral partner|referral prospect|building referral/i.test(type),
  );
  const baseline = cadence ?? trustTarget(identity.trust_level);

  return buildingReferralRelationship ? Math.max(baseline, 1) : baseline;
}

export function minimumEngagementGapDays(identity: EngagementPacingIdentity) {
  const target = engagementTargetPerMonth(identity);
  if (target <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(4, Math.round(30 / target));
}

export function engagementCadenceAllows({
  identity,
  lastEngagedAt,
  now = new Date(),
}: {
  identity: EngagementPacingIdentity;
  lastEngagedAt: string | null;
  now?: Date;
}) {
  if (!lastEngagedAt) return true;
  const last = Date.parse(lastEngagedAt);
  if (!Number.isFinite(last)) return true;

  const elapsedDays = (now.getTime() - last) / 86_400_000;
  return elapsedDays >= minimumEngagementGapDays(identity);
}

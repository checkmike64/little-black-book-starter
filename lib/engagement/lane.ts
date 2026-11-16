export type EngagementLane = "active" | "partners" | "rescue";

export type EngagementLaneContact = {
  last_spoke?: string | null;
  relationship_strength?: string | null;
  relationship_type?: string[] | null;
  touch_cadence?: string | null;
  trust_level?: string | null;
};

function rescueThresholdDays(cadence: string | null | undefined) {
  const normalized = cadence?.toLowerCase().trim() ?? "";
  if (/dormant|no active cadence|ad hoc/.test(normalized)) {
    return Number.POSITIVE_INFINITY;
  }
  if (/daily/.test(normalized)) return 3;
  if (/weekly/.test(normalized)) return 14;
  if (/biweekly|bi-weekly|fortnight/.test(normalized)) return 30;
  if (/monthly|every month/.test(normalized)) return 45;
  if (/every 2 months|bimonth|bi-month/.test(normalized)) return 90;
  if (/quarter|3 months/.test(normalized)) return 135;
  if (/biannual|semiannual|semi-annual|6 months|twice a year/.test(normalized)) {
    return 240;
  }
  if (/annual|yearly|once a year|12 months/.test(normalized)) return 450;
  return 90;
}

export function recentContactPreventsRescue({
  contact,
  now = new Date(),
}: {
  contact: EngagementLaneContact | null | undefined;
  now?: Date;
}) {
  const lastSpoke = Date.parse(contact?.last_spoke ?? "");
  if (!Number.isFinite(lastSpoke)) return false;

  const elapsedDays = (now.getTime() - lastSpoke) / 86_400_000;
  return elapsedDays <= rescueThresholdDays(contact?.touch_cadence);
}

function partnerLane(contact: EngagementLaneContact | null | undefined) {
  return (contact?.relationship_type ?? []).some((type) =>
    /(referral|partner|connector|intro)/i.test(type),
  );
}

export function resolveEngagementLane({
  requestedLane,
  classification,
  isWantToKnow,
  contact,
  now = new Date(),
}: {
  requestedLane?: string | null;
  classification?: string | null;
  isWantToKnow?: boolean;
  contact?: EngagementLaneContact | null;
  now?: Date;
}): EngagementLane {
  if (isWantToKnow) return "active";

  const requestedRescue =
    requestedLane === "rescue" ||
    /relationship.?rescue|rescue|cooling/i.test(classification ?? "");
  const requestedPartner =
    requestedLane === "partners" ||
    /referral|partner/i.test(classification ?? "");

  if (requestedRescue) {
    if (recentContactPreventsRescue({ contact, now })) {
      return partnerLane(contact) ? "partners" : "active";
    }
    return "rescue";
  }
  if (requestedPartner || partnerLane(contact)) return "partners";
  if (requestedLane === "active") return "active";

  const strength = contact?.relationship_strength ?? "";
  const trust = contact?.trust_level ?? "";
  if (
    /(cold|cooling)/i.test(strength) &&
    /(tier 1|tier 2|deep trust|working trust)/i.test(trust) &&
    !recentContactPreventsRescue({ contact, now })
  ) {
    return "rescue";
  }

  return "active";
}

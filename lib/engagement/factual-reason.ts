type EngagementLane = "active" | "partners" | "rescue";

export function engagementPlacementReason({
  isProspect,
  lane,
  prospectPurpose,
}: {
  isProspect: boolean;
  lane: EngagementLane;
  prospectPurpose?: string | null;
}) {
  if (isProspect) {
    if (/podcast/i.test(prospectPurpose ?? "")) {
      return "This is a new episode or show milestone from a podcast host you chose to build a relationship with.";
    }
    if (/referral/i.test(prospectPurpose ?? "")) {
      return "This relevant update, ask, or celebration comes from a referral partner you chose to build a relationship with.";
    }
    return "This update matches the purpose you saved for this Want to Know relationship.";
  }
  if (lane === "partners") {
    return "This recent post belongs to a contact in Referral Partners.";
  }
  if (lane === "rescue") {
    return "This recent post belongs to a contact in Relationship Rescue.";
  }
  return "This recent post belongs to a contact in Active Pursuits.";
}

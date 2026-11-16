import type {
  BriefContact,
  BriefIntroduction,
  BriefPromise,
  BriefQuality,
} from "./contact-brief.js";

export type ContactExecutiveBrief = {
  status: "Act" | "Verify" | "Rewarm" | "Watch";
  tone: "hot" | "gold" | "cool";
  headline: string;
  bestMove: string;
  why: string[];
  proof: string[];
  guardrails: string[];
  askHref: string;
};

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function daysSince(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
}

function isOverdue(value: string | null | undefined) {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed < Date.now();
}

function openOwnerPromise(promises: BriefPromise[]) {
  return promises.find(
    (promise) =>
      promise.status === "open" && promise.direction === "owner_owes_contact",
  );
}

function activeIntroductions(introductions: BriefIntroduction[]) {
  return introductions.filter((intro) =>
    ["proposed", "follow_up"].includes(intro.status),
  );
}

function roleLine(contact: BriefContact) {
  return [contact.role_title?.join(", "), contact.company_name]
    .filter(Boolean)
    .join(" at ");
}

function bestUsefulLane(contact: BriefContact) {
  if (hasText(contact.current_asks)) return `Current ask: ${contact.current_asks}`;
  if (hasText(contact.wants_help_with)) return `Help lane: ${contact.wants_help_with}`;
  if (hasText(contact.ideal_referral)) return `Referral lane: ${contact.ideal_referral}`;
  if (hasText(contact.podcast_fit)) return `Outreach lane: ${contact.podcast_fit}`;
  return "No current ask or useful lane is stored yet.";
}

export function buildContactExecutiveBrief({
  contact,
  introductions,
  promises,
  quality,
}: {
  contact: BriefContact;
  introductions: BriefIntroduction[];
  promises: BriefPromise[];
  quality: BriefQuality | null;
}): ContactExecutiveBrief {
  const ownerPromise = openOwnerPromise(promises);
  const staleDays = daysSince(contact.last_spoke);
  const activeIntroCount = activeIntroductions(introductions).length;
  const needsJudgment = !contact.trust_level || !contact.relationship_strength;
  const readiness = quality?.readiness ?? 100;
  const qualityWeak = readiness < 80;
  const usefulLane = bestUsefulLane(contact);

  const status: ContactExecutiveBrief["status"] = ownerPromise
    ? "Act"
    : needsJudgment || qualityWeak
      ? "Verify"
      : staleDays !== null && staleDays > 120
        ? "Rewarm"
        : "Watch";
  const tone: ContactExecutiveBrief["tone"] =
    status === "Act" ? "hot" : status === "Verify" || status === "Rewarm" ? "gold" : "cool";

  const bestMove = ownerPromise
    ? `Close the loop: ${ownerPromise.promise_text}`
    : needsJudgment
      ? "Verify trust, relationship strength, and referral safety before using this relationship for important asks."
      : staleDays !== null && staleDays > 120
        ? "Send a light, specific rewarm touch based on the stored relationship context."
        : contact.current_asks
          ? `Act on or refresh the current ask: ${contact.current_asks}`
          : contact.ideal_referral
            ? `Look for a high-trust introduction lane: ${contact.ideal_referral}`
            : "Use Ask to pressure-test the next useful move.";

  const guardrails = [
    contact.do_not_refer_for ? `Do not refer for: ${contact.do_not_refer_for}` : null,
    contact.relationship_strength_override
      ? "Relationship strength is owner-locked; do not let old correspondence change it quietly."
      : null,
    needsJudgment
      ? "Trust or strength is missing; avoid referral or credibility-risk moves until verified."
      : null,
    qualityWeak && quality
      ? `Profile readiness is ${quality.readiness}%; missing ${quality.missing.slice(0, 4).join(", ")}.`
      : null,
    ownerPromise && isOverdue(ownerPromise.due_on)
      ? "This promise is overdue; do not add new asks before closing it."
      : null,
  ].filter((item): item is string => Boolean(item));

  return {
    status,
    tone,
    headline:
      status === "Act"
        ? "There is a trust loop to close first"
        : status === "Verify"
          ? "Verify the relationship posture before high-stakes use"
          : status === "Rewarm"
            ? "This useful relationship is cooling off"
            : "This profile is ready for a thoughtful next move",
    bestMove,
    why: [
      roleLine(contact) || contact.one_line_summary || "Relationship context needs more detail.",
      usefulLane,
      contact.why_stay_in_touch
        ? `Why stay in touch: ${contact.why_stay_in_touch}`
        : "No relationship thesis is stored yet.",
      activeIntroCount > 0
        ? `${activeIntroCount} active introduction loop${activeIntroCount === 1 ? "" : "s"}.`
        : null,
      staleDays !== null ? `${staleDays} days since last stored touch.` : "No last-touch date stored.",
    ].filter((item): item is string => Boolean(item)).slice(0, 5),
    proof: [
      contact.relationship_strength_reason
        ? `Strength reason: ${contact.relationship_strength_reason}`
        : null,
      contact.recent_activity ? `Recent activity: ${contact.recent_activity}` : null,
      contact.how_we_met ? `Origin: ${contact.how_we_met}` : null,
      contact.private_notes ? `Private context: ${contact.private_notes}` : null,
      quality ? quality.nextStep : null,
    ].filter((item): item is string => Boolean(item)).slice(0, 5),
    guardrails: guardrails.length
      ? guardrails.slice(0, 5)
      : ["No major guardrail is stored. Still verify before major referrals, asks, or introductions."],
    askHref: `/ask?mode=search&q=${encodeURIComponent(
      `${contact.full_name} best relationship move`,
    )}`,
  };
}

export type BriefContact = {
  id: string;
  full_name: string;
  company_name: string | null;
  role_title: string[] | null;
  one_line_summary: string | null;
  trust_level: string | null;
  relationship_strength: string | null;
  relationship_strength_reason: string | null;
  relationship_strength_override: boolean;
  relationship_type: string[] | null;
  last_spoke: string | null;
  touch_cadence: string | null;
  how_we_met: string | null;
  why_stay_in_touch: string | null;
  current_asks: string | null;
  wants_help_with: string | null;
  what_they_want_more_of: string | null;
  ideal_referral: string | null;
  do_not_refer_for: string | null;
  referral_intro_blurb: string | null;
  podcast_fit: string | null;
  recent_activity: string | null;
  personal_notes: string | null;
  private_notes: string | null;
  top_3_tags: string[] | null;
  keywords: string[] | null;
};

export type BriefPromise = {
  id: string;
  promise_text: string;
  direction: string;
  status: string;
  due_on: string | null;
};

export type BriefInteraction = {
  interactions: {
    id: string;
    occurred_at: string;
    interaction_type: string;
    title: string | null;
    summary: string | null;
    source: string;
  } | null;
};

export type BriefIntroduction = {
  id: string;
  person_a: string | null;
  person_b: string | null;
  why_context: string | null;
  status: string;
  outcome: string | null;
  follow_up_on: string | null;
  person_a_contact?: { full_name: string | null } | null;
  person_b_contact?: { full_name: string | null } | null;
};

export type BriefQuality = {
  readiness: number;
  missing: string[];
  nextStep: string;
};

export type ContactBrief = {
  posture: string;
  currentObjective: string;
  prepBullets: string[];
  usefulAngles: string[];
  guardrails: string[];
  openLoops: string[];
  verificationNeeded: string[];
  suggestedAsk: string;
  claudePrompt: string;
};

function formatDate(value: string | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function compact(values: Array<string | null | undefined>) {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function joinList(values: string[] | null | undefined) {
  return values?.length ? values.join(", ") : null;
}

function firstMeaningful(values: Array<string | null | undefined>, fallback: string) {
  return compact(values)[0] ?? fallback;
}

function daysSince(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
}

function line(label: string, value: string | null | undefined) {
  return value ? `${label}: ${value}` : null;
}

function promiseLine(promise: BriefPromise) {
  const ownerOwes = promise.direction === "owner_owes_contact";
  return `${ownerOwes ? "You owe" : "They owe"}: ${promise.promise_text} · Due ${formatDate(
    promise.due_on,
  )}`;
}

function recentInteractionLine(row: BriefInteraction) {
  if (!row.interactions) return null;
  return `${formatDate(row.interactions.occurred_at)} · ${row.interactions.interaction_type}: ${
    row.interactions.title ?? row.interactions.summary ?? "Logged interaction"
  }`;
}

function introductionLine(intro: BriefIntroduction, contactId: string) {
  const other =
    intro.person_a === contactId
      ? intro.person_b_contact?.full_name
      : intro.person_a_contact?.full_name;

  return `${other ?? "Other person"} · ${intro.status}${
    intro.why_context ? ` · ${intro.why_context}` : ""
  }`;
}

function suggestedAsk(contact: BriefContact, openPromises: BriefPromise[]) {
  const ownerPromises = openPromises.filter(
    (promise) => promise.direction === "owner_owes_contact",
  );

  if (ownerPromises.length > 0) {
    return `Lead by closing the loop on: ${ownerPromises[0].promise_text}`;
  }

  if (contact.current_asks) {
    return `Ask whether this is still current: ${contact.current_asks}`;
  }

  if (contact.wants_help_with) {
    return `Offer help around: ${contact.wants_help_with}`;
  }

  if (contact.ideal_referral) {
    return `Look for a useful introduction lane: ${contact.ideal_referral}`;
  }

  if (contact.podcast_fit) {
    return `Explore whether this podcast angle is still useful: ${contact.podcast_fit}`;
  }

  return "Use the conversation to verify what would be most useful right now.";
}

export function buildContactBrief({
  contact,
  promises,
  interactions,
  introductions,
  quality,
}: {
  contact: BriefContact;
  promises: BriefPromise[];
  interactions: BriefInteraction[];
  introductions: BriefIntroduction[];
  quality: BriefQuality | null;
}): ContactBrief {
  const openPromises = promises.filter((promise) => promise.status === "open");
  const staleDays = daysSince(contact.last_spoke);
  const posture = compact([
    contact.trust_level,
    contact.relationship_strength,
    joinList(contact.relationship_type),
  ]).join(" · ") || "Relationship posture not verified";
  const currentObjective = firstMeaningful(
    [
      contact.current_asks,
      contact.wants_help_with,
      contact.ideal_referral,
      contact.podcast_fit,
    ],
    "No current objective is stored yet.",
  );

  const prepBullets = compact([
    line("Profile", contact.one_line_summary),
    line(
      "Role",
      compact([joinList(contact.role_title), contact.company_name]).join(" at "),
    ),
    line("Why stay in touch", contact.why_stay_in_touch),
    line("How you met", contact.how_we_met),
    line(
      "Last touch",
      staleDays === null
        ? null
        : `${formatDate(contact.last_spoke)} (${staleDays} day${
            staleDays === 1 ? "" : "s"
          } ago)`,
    ),
    line("Recent activity", contact.recent_activity),
    line("Strength reason", contact.relationship_strength_reason),
  ]).slice(0, 7);

  const usefulAngles = compact([
    line("Current ask", contact.current_asks),
    line("Wants help with", contact.wants_help_with),
    line("Wants more of", contact.what_they_want_more_of),
    line("Ideal referral", contact.ideal_referral),
    line("Podcast fit", contact.podcast_fit),
    line("Intro blurb", contact.referral_intro_blurb),
    line("Tags", joinList(contact.top_3_tags)),
  ]).slice(0, 7);

  const guardrails = compact([
    line("Do not refer for", contact.do_not_refer_for),
    contact.relationship_strength_override
      ? "Relationship strength has been manually overridden; do not let old correspondence quietly move it."
      : null,
    contact.private_notes ? `Private context: ${contact.private_notes}` : null,
  ]).slice(0, 5);

  const openLoops = [
    ...openPromises.map(promiseLine),
    ...introductions
      .filter((intro) => !["closed", "stopped"].includes(intro.status))
      .map((intro) => introductionLine(intro, contact.id)),
  ].slice(0, 8);

  const verificationNeeded = [
    ...(quality && quality.readiness < 80
      ? [`Record readiness is ${quality.readiness}%; missing ${quality.missing.join(", ")}.`]
      : []),
    ...(quality?.missing.includes("trust tier") ||
    quality?.missing.includes("relationship strength")
      ? ["Ask the owner to verify trust and relationship strength before using referrals."]
      : []),
    ...interactions
      .map(recentInteractionLine)
      .filter((item): item is string => Boolean(item))
      .slice(0, 3)
      .map((item) => `Evidence to inspect: ${item}`),
  ].slice(0, 7);

  const ask = suggestedAsk(contact, openPromises);
  const prompt = [
    `Prepare a relationship brief for ${contact.full_name}.`,
    "",
    `Posture: ${posture}`,
    `Current objective: ${currentObjective}`,
    `Suggested ask: ${ask}`,
    "",
    "Useful angles:",
    ...(usefulAngles.length ? usefulAngles : ["No useful angles stored."]),
    "",
    "Open loops:",
    ...(openLoops.length ? openLoops : ["No open promises or intro loops stored."]),
    "",
    "Guardrails:",
    ...(guardrails.length ? guardrails : ["No special guardrails stored."]),
    "",
    "Verification needs:",
    ...(verificationNeeded.length
      ? verificationNeeded
      : ["No high-priority verification gaps detected."]),
    "",
    "Draft practical next steps. Put any factual or judgment-field updates into pending changes for review instead of writing directly.",
  ].join("\n");

  return {
    posture,
    currentObjective,
    prepBullets,
    usefulAngles,
    guardrails,
    openLoops,
    verificationNeeded,
    suggestedAsk: ask,
    claudePrompt: prompt,
  };
}

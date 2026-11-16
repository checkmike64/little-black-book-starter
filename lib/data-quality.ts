export type QualityContact = {
  id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  company_name: string | null;
  role_title: string[] | null;
  one_line_summary?: string | null;
  trust_level: string | null;
  relationship_strength: string | null;
  relationship_type: string[] | null;
  last_spoke: string | null;
  how_we_met?: string | null;
  why_stay_in_touch?: string | null;
  current_asks: string | null;
  wants_help_with?: string | null;
  ideal_referral?: string | null;
  podcast_fit?: string | null;
  linkedin?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  x_twitter?: string | null;
  youtube?: string | null;
  podcast_url?: string | null;
  website?: string | null;
  recent_activity?: string | null;
  private_notes?: string | null;
};

export type ContactQuality = QualityContact & {
  readiness: number;
  missing: string[];
  strengths: string[];
  nextStep: string;
};

function hasText(value: string | null | undefined) {
  return Boolean(value && value.trim().length > 0);
}

function hasArray(value: string[] | null | undefined) {
  return Boolean(value && value.length > 0);
}

function hasUseCase(contact: QualityContact) {
  return [
    contact.current_asks,
    contact.wants_help_with,
    contact.ideal_referral,
    contact.podcast_fit,
  ].some(hasText);
}

function hasReach(contact: QualityContact) {
  return [
    contact.email,
    contact.phone,
    contact.linkedin,
    contact.instagram,
    contact.facebook,
    contact.x_twitter,
    contact.youtube,
    contact.podcast_url,
    contact.website,
  ].some(hasText);
}

export function isPodcastRelationship(contact: QualityContact) {
  return /podcast|host|guest/i.test(
    [
      contact.role_title?.join(" "),
      contact.relationship_type?.join(" "),
      contact.how_we_met,
      contact.podcast_url,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function isHighValue(contact: QualityContact) {
  return /tier 1|tier 2|trusted|hot|warm|strong/i.test(
    [contact.trust_level, contact.relationship_strength, contact.relationship_type?.join(" ")]
      .filter(Boolean)
      .join(" "),
  );
}

export function scoreContactQuality(contact: QualityContact): ContactQuality {
  const missing: string[] = [];
  const strengths: string[] = [];
  let score = 100;

  const checks: Array<[boolean, string, number, string]> = [
    [hasText(contact.company_name) || hasArray(contact.role_title), "role or company", 8, "Identity context"],
    [hasText(contact.one_line_summary), "clean identity summary", 8, "Identity summary"],
    [hasText(contact.trust_level), "trust tier", 16, "Trust tier"],
    [
      hasText(contact.relationship_strength),
      "relationship strength",
      12,
      "Relationship strength",
    ],
    [hasArray(contact.relationship_type), "relationship type", 10, "Relationship type"],
    [hasText(contact.last_spoke), "last touch date", 12, "Last touch"],
    [hasText(contact.how_we_met), "how you met", 10, "Origin story"],
    [hasText(contact.why_stay_in_touch), "why stay in touch", 12, "Relationship thesis"],
    [hasUseCase(contact), "ask, help lane, referral lane, or podcast fit", 14, "Use case"],
    [hasReach(contact), "contact or profile link", 8, "Reachable"],
    [
      hasText(contact.recent_activity) || hasText(contact.private_notes),
      "recent activity or private notes",
      6,
      "Useful notes",
    ],
  ];

  if (isPodcastRelationship(contact)) {
    checks.push([
      hasText(contact.recent_activity),
      "current podcast or publishing signal",
      8,
      "Current publishing signal",
    ]);
  }

  for (const [passes, label, penalty, strength] of checks) {
    if (passes) {
      strengths.push(strength);
    } else {
      missing.push(label);
      score -= penalty;
    }
  }

  const readiness = Math.max(0, Math.min(100, score));
  let nextStep = "Ready enough for Ask, engagement, and referral workflows.";

  if (missing.includes("last touch date")) {
    nextStep =
      "Use correspondence summaries or owner memory to confirm the last meaningful touch.";
  }
  if (
    missing.includes("why stay in touch") ||
    missing.includes("ask, help lane, referral lane, or podcast fit")
  ) {
    nextStep =
      "Have Claude enrich the relationship thesis and useful lanes from transcripts or owner notes.";
  }
  if (
    missing.includes("trust tier") ||
    missing.includes("relationship strength")
  ) {
    nextStep =
      "Ask the owner to verify trust and relationship strength before using this record for referrals.";
  }
  if (missing.includes("clean identity summary")) {
    nextStep =
      "Write one plain-language sentence identifying the person and why they matter in this Book.";
  }
  if (missing.includes("contact or profile link")) {
    nextStep =
      "Find one reliable contact method or profile URL before using this record for outreach.";
  }
  if (missing.includes("current podcast or publishing signal")) {
    nextStep =
      "Verify whether the show or publishing channel is still active and store one source-backed update.";
  }

  return {
    ...contact,
    readiness,
    missing,
    strengths,
    nextStep,
  };
}

export function buildQualityCleanupFocus(contact: QualityContact) {
  const quality = scoreContactQuality(contact);

  return {
    readiness: quality.readiness,
    missing: quality.missing,
    strengths: quality.strengths,
    next_step: quality.nextStep,
    owner_verification_required: quality.missing.some((field) =>
      ["trust tier", "relationship strength", "why stay in touch"].includes(field),
    ),
  };
}

export function qualityStats(contacts: QualityContact[]) {
  const scored = contacts.map(scoreContactQuality);
  const ready = scored.filter((contact) => contact.readiness >= 80).length;
  const weak = scored.filter((contact) => contact.readiness < 60).length;
  const highValueWeak = scored.filter(
    (contact) => isHighValue(contact) && contact.readiness < 80,
  ).length;
  const average = scored.length
    ? Math.round(
        scored.reduce((total, contact) => total + contact.readiness, 0) /
          scored.length,
      )
    : 0;

  return {
    average,
    ready,
    weak,
    highValueWeak,
    scored: scored.sort(
      (a, b) =>
        a.readiness - b.readiness ||
        Number(isHighValue(b)) - Number(isHighValue(a)) ||
        a.full_name.localeCompare(b.full_name),
    ),
  };
}

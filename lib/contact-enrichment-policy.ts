import { createHash } from "node:crypto";

export type ProfileEnrichmentGap =
  | "primary_email"
  | "company_or_role"
  | "one_line_summary"
  | "website"
  | "social_profiles";

export type ProfileGapContact = {
  id: string;
  full_name: string;
  email: string | null;
  company_name: string | null;
  role_title: string[] | null;
  one_line_summary: string | null;
  website: string | null;
  linkedin: string | null;
  instagram: string | null;
  facebook: string | null;
  x_twitter: string | null;
  youtube: string | null;
};

export type ProfileResearchField =
  | "primary_email"
  | "company_name"
  | "role_title"
  | "one_line_summary"
  | "website"
  | "linkedin"
  | "instagram"
  | "facebook"
  | "x_twitter"
  | "youtube";

export type ProfileGapCandidate = {
  contact: ProfileGapContact;
  gaps: ProfileEnrichmentGap[];
};

export function selectProfileGapCandidates({
  candidates,
  skippedContactIds,
  limit,
  scanLimit,
}: {
  candidates: ProfileGapCandidate[];
  skippedContactIds: Set<string>;
  limit: number;
  scanLimit: number;
}) {
  const selected: ProfileGapCandidate[] = [];
  let considered = 0;
  let skipped = 0;
  for (const candidate of candidates.slice(0, scanLimit)) {
    if (selected.length >= limit) break;
    considered += 1;
    if (skippedContactIds.has(candidate.contact.id)) {
      skipped += 1;
      continue;
    }
    selected.push(candidate);
  }
  return { selected, considered, skipped };
}

export function hasProfileText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

export function hasProfileArray(value: string[] | null | undefined) {
  return Boolean(value?.some((item) => item.trim()));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

export function contactEnrichmentPayloadHash(payload: Record<string, unknown>) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(payload)))
    .digest("hex");
}

export function profileEnrichmentGaps(
  contact: ProfileGapContact,
): ProfileEnrichmentGap[] {
  const gaps: ProfileEnrichmentGap[] = [];
  if (!hasProfileText(contact.email)) gaps.push("primary_email");
  if (!hasProfileText(contact.company_name) && !hasProfileArray(contact.role_title)) {
    gaps.push("company_or_role");
  }
  if (!hasProfileText(contact.one_line_summary)) gaps.push("one_line_summary");
  if (!hasProfileText(contact.website)) gaps.push("website");
  if (
    ![
      contact.linkedin,
      contact.instagram,
      contact.facebook,
      contact.x_twitter,
      contact.youtube,
    ].some(hasProfileText)
  ) {
    gaps.push("social_profiles");
  }
  return gaps;
}

export function profileRefreshWindow(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function profileGapIdempotencyKey({
  contactId,
  gaps,
  now = new Date(),
}: {
  contactId: string;
  gaps: ProfileEnrichmentGap[];
  now?: Date;
}) {
  const fingerprint = createHash("sha256")
    .update([...gaps].sort().join("|"))
    .digest("hex")
    .slice(0, 20);
  const window = profileRefreshWindow(now);
  return `profile-gap:v2:${window}:${contactId}:${fingerprint}`;
}

export function contactEnrichmentIntentKey({
  prefix,
  contactId,
  intent,
}: {
  prefix: string;
  contactId: string;
  intent: unknown;
}) {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(stableValue(intent)))
    .digest("hex")
    .slice(0, 24);
  return `${prefix}:${contactId}:${fingerprint}`.slice(0, 240);
}

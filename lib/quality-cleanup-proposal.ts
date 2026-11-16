import type { ContactField } from "./contact-fields.js";

type CleanupFieldType = "text" | "text_array" | "date" | "boolean";

export type CleanupFieldOption = {
  value: ContactField;
  label: string;
  hint: string;
};

const cleanupFieldTypes: Partial<Record<ContactField, CleanupFieldType>> = {
  company_name: "text",
  role_title: "text_array",
  last_spoke: "date",
  how_we_met: "text",
  why_stay_in_touch: "text",
  trust_level: "text",
  relationship_strength: "text",
  relationship_type: "text_array",
  current_asks: "text",
  wants_help_with: "text",
  ideal_referral: "text",
  podcast_fit: "text",
  recent_activity: "text",
  private_notes: "text",
  relationship_strength_override: "boolean",
};

export const cleanupFieldOptions: CleanupFieldOption[] = [
  {
    value: "company_name",
    label: "Company name",
    hint: "Source-backed identity context.",
  },
  {
    value: "role_title",
    label: "Role title",
    hint: "Comma or line-separated values.",
  },
  { value: "last_spoke", label: "Last spoke", hint: "Use YYYY-MM-DD." },
  { value: "how_we_met", label: "How we met", hint: "Source-backed origin story." },
  {
    value: "why_stay_in_touch",
    label: "Why stay in touch",
    hint: "Owner-verified relationship thesis.",
  },
  { value: "trust_level", label: "Trust level", hint: "Owner verification required." },
  {
    value: "relationship_strength",
    label: "Relationship strength",
    hint: "Owner verification required.",
  },
  {
    value: "relationship_type",
    label: "Relationship type",
    hint: "Comma or line-separated values.",
  },
  { value: "current_asks", label: "Current asks", hint: "Verify before relying on it." },
  {
    value: "wants_help_with",
    label: "Wants help with",
    hint: "Useful lane from source or owner.",
  },
  { value: "ideal_referral", label: "Ideal referral", hint: "Referral lane, review-gated." },
  { value: "podcast_fit", label: "Podcast fit", hint: "Outreach lane, review-gated." },
  {
    value: "recent_activity",
    label: "Recent activity",
    hint: "Source-backed activity summary.",
  },
  { value: "private_notes", label: "Private notes", hint: "Owner verification required." },
];

const judgmentSensitiveCleanupFields = new Set<ContactField>([
  "trust_level",
  "relationship_strength",
  "relationship_strength_reason",
  "relationship_strength_override",
  "why_stay_in_touch",
  "current_asks",
  "wants_help_with",
  "ideal_referral",
  "do_not_refer_for",
  "could_refer_me_for",
  "referral_intro_blurb",
  "podcast_fit",
  "personal_notes",
  "private_notes",
]);

export function cleanupFieldNeedsOwnerVerification(field: ContactField) {
  return judgmentSensitiveCleanupFields.has(field);
}

export function normalizeCleanupFieldValue(field: ContactField, rawValue: string) {
  const clean = rawValue.trim().slice(0, 1600);
  if (!clean) return undefined;

  const type = cleanupFieldTypes[field];

  if (type === "boolean") {
    const normalized = clean.toLowerCase();
    if (["true", "yes", "1", "on"].includes(normalized)) return true;
    if (["false", "no", "0", "off"].includes(normalized)) return false;
    return undefined;
  }

  if (type === "date") {
    return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : undefined;
  }

  if (type === "text_array") {
    const values = clean
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);

    return values.length > 0 ? values : undefined;
  }

  return clean;
}

export function cleanCleanupField(value: string): ContactField | null {
  return value in cleanupFieldTypes ? (value as ContactField) : null;
}

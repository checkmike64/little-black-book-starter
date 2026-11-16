import { contactFieldTypes, type ContactField } from "../contact-fields.ts";

export const recordingBaselineFields = [
  "company_name",
  "company_description",
  "role_title",
  "location",
  "time_zone",
  "phone",
  "website",
  "linkedin",
  "instagram",
  "facebook",
  "x_twitter",
  "youtube",
  "podcast_url",
  "current_asks",
  "wants_help_with",
  "services_offered",
  "ideal_referral",
] as const satisfies readonly ContactField[];

export type RecordingBaselineField = (typeof recordingBaselineFields)[number];

const baselineFieldSet = new Set<string>(recordingBaselineFields);
const arrayFieldSet = new Set<string>(
  recordingBaselineFields.filter((field) => contactFieldTypes[field] === "text_array"),
);

export type RecordingBaselineSuggestion = {
  value: string | string[];
  evidence_summary: string;
  confidence: number;
};

export type RecordingBaselineFact = RecordingBaselineSuggestion & {
  field: RecordingBaselineField;
};

export type RecordingBaselineModelOutput = {
  facts: RecordingBaselineFact[];
};

export type RecordingBaselineOutput = {
  suggestions: Partial<Record<RecordingBaselineField, RecordingBaselineSuggestion>>;
};

export const recordingBaselineFieldDefinitions = {
  company_name: "Organization the contact works for, leads, founded, or owns.",
  company_description: "What the contact's organization does and who it serves.",
  role_title: "Array of the contact's explicitly stated professional roles or titles.",
  location: "Array of the contact's explicitly stated cities, regions, or countries.",
  time_zone: "Contact's explicitly stated time zone; never infer it from location.",
  phone: "Contact's explicitly stated phone number.",
  website: "Contact's or their organization's primary HTTPS website URL.",
  linkedin: "Contact's LinkedIn profile URL.",
  instagram: "Contact's Instagram profile URL.",
  facebook: "Contact's Facebook profile URL.",
  x_twitter: "Contact's X or Twitter profile URL.",
  youtube: "Contact's YouTube channel URL.",
  podcast_url: "Contact's podcast page or feed URL.",
  current_asks: "Concrete active requests or opportunities the contact is pursuing now.",
  wants_help_with: "Ongoing areas where the contact explicitly wants help.",
  services_offered: "Array of services the contact or their organization explicitly offers.",
  ideal_referral: "Explicitly described best-fit clients, customers, referrals, or introductions.",
} as const satisfies Record<RecordingBaselineField, string>;

function normalizedBoundedText(value: unknown, limit: number) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 && normalized.length <= limit ? normalized : null;
}

function normalizedEvidenceSource(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function recordingBaselineResolvedActionItems(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((item) => normalizedEvidenceSource(item))
    .filter(Boolean);
}

export function recordingBaselineEvidenceSources(
  interactionSummary: string,
  meetingActionItems: unknown,
) {
  return [
    normalizedEvidenceSource(interactionSummary),
    ...recordingBaselineResolvedActionItems(meetingActionItems),
  ].filter(Boolean);
}

export function recordingBaselineEvidenceCorpus(
  interactionSummary: string,
  meetingActionItems: unknown,
) {
  return recordingBaselineEvidenceSources(
    interactionSummary,
    meetingActionItems,
  ).join("\n");
}

function normalizedValue(field: RecordingBaselineField, value: unknown) {
  if (arrayFieldSet.has(field)) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null;
    const values = value.map((item) => normalizedBoundedText(item, 240));
    if (!values.every((item): item is string => item !== null)) return null;
    const unique = Array.from(new Set(values)).slice(0, 12);
    return unique.length > 0 ? unique : null;
  }
  if (Array.isArray(value)) return null;
  const text = normalizedBoundedText(value, 1_200);
  if (!text) return null;
  if (
    [
      "website",
      "linkedin",
      "instagram",
      "facebook",
      "x_twitter",
      "youtube",
      "podcast_url",
    ].includes(field)
  ) {
    if (text.length > 1_000) return null;
    try {
      const url = new URL(text);
      return url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  }
  if (field === "phone") {
    const digits = text.replace(/[^0-9]/g, "");
    if (!/^\+?[0-9 ()-]{7,40}$/.test(text) || digits.length < 7 || digits.length > 15) {
      return null;
    }
  }
  return text;
}

function groundedEvidence(evidence: string, evidenceText: string) {
  const needle = evidence.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const evidenceSources = evidenceText
    .split("\n")
    .map((source) => source.replace(/\s+/g, " ").trim().toLocaleLowerCase())
    .filter(Boolean);
  return needle.length >= 8
    && evidenceSources.some((source) => source.includes(needle));
}

export function normalizeRecordingBaselineOutput(
  value: unknown,
  evidenceText: string,
): RecordingBaselineOutput {
  const root = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rootEntries = Object.entries(root);
  const facts = rootEntries.length === 1 && rootEntries[0]?.[0] === "facts"
    && Array.isArray(rootEntries[0][1])
    ? rootEntries[0][1]
    : [];
  const result: Partial<Record<RecordingBaselineField, RecordingBaselineSuggestion>> = {};
  if (facts.length > 8) return { suggestions: result };

  const fieldCounts = new Map<string, number>();
  for (const rawFact of facts) {
    if (!rawFact || typeof rawFact !== "object" || Array.isArray(rawFact)) continue;
    const field = (rawFact as Record<string, unknown>).field;
    if (typeof field === "string" && baselineFieldSet.has(field)) {
      fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
    }
  }

  for (const rawFact of facts) {
    if (!rawFact || typeof rawFact !== "object" || Array.isArray(rawFact)) continue;
    const candidate = rawFact as Record<string, unknown>;
    if (
      Object.keys(candidate).length !== 4
      || !("field" in candidate)
      || !("value" in candidate)
      || !("evidence_summary" in candidate)
      || !("confidence" in candidate)
    ) continue;
    const field = candidate.field as RecordingBaselineField;
    const evidence = normalizedBoundedText(candidate.evidence_summary, 500);
    const confidence = typeof candidate.confidence === "number"
      ? candidate.confidence
      : Number.NaN;
    if (
      !baselineFieldSet.has(field)
      || fieldCounts.get(field) !== 1
      || !evidence
      || !groundedEvidence(evidence, evidenceText)
      || !Number.isFinite(confidence)
      || confidence < 0.9
      || confidence > 1
    ) continue;
    const safeValue = normalizedValue(field, candidate.value);
    if (safeValue === null) continue;
    result[field] = {
      value: safeValue,
      evidence_summary: evidence,
      confidence,
    };
  }

  return { suggestions: result };
}

const recordingBaselineValueSchema = {
  anyOf: [
    { type: "string", minLength: 1, maxLength: 1_200 },
    {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: { type: "string", minLength: 1, maxLength: 240 },
    },
  ],
} as const;

export const recordingBaselineSchema = {
  type: "object",
  additionalProperties: false,
  required: ["facts"],
  properties: {
    facts: {
      type: "array",
      maxItems: 8,
      uniqueItems: true,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "value", "evidence_summary", "confidence"],
        properties: {
          field: { type: "string", enum: recordingBaselineFields },
          value: recordingBaselineValueSchema,
          evidence_summary: { type: "string", minLength: 8, maxLength: 500 },
          confidence: { type: "number", minimum: 0.9, maximum: 1 },
        },
      },
    },
  },
} as const;

export function recordingBaselinePrompt(input: {
  contact_display_name: string;
  evidence_sources: string[];
}) {
  return {
    system: [
      "Extract relationship-profile facts from owner-confirmed meeting notes.",
      "Each evidence_sources entry is independent and may be a meeting summary or a contact-scoped, owner-confirmed resolved follow-up.",
      "Every evidence_summary must be one literal contiguous excerpt copied from exactly one evidence source; never combine excerpts across sources.",
      "Extract facts only for the named contact and only when one source clearly attributes the fact to that person.",
      "Never invent identity, contact details, trust, relationship strength, private notes, or sensitive personal facts.",
      "Return no suggestion when evidence or person attribution is ambiguous.",
      "Return at most eight facts with unique field names and confidence of at least 0.90.",
      "Use only the defined field names and keep evidence short.",
    ].join(" "),
    prompt: JSON.stringify({
      contact_display_name: normalizedBoundedText(input.contact_display_name, 160) ?? "",
      field_definitions: recordingBaselineFieldDefinitions,
      evidence_sources: input.evidence_sources.map(normalizedEvidenceSource).filter(Boolean),
    }),
  };
}

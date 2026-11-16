export const relationshipCommandIntents = {
  build_intro_map: {
    label: "Build intro map",
    objective:
      "Find useful warm paths, referral lanes, and introduction opportunities around this contact.",
    expected_outputs: [
      "recommended warm paths",
      "specific intro angles",
      "fields or notes that should be proposed through pending changes",
    ],
  },
  draft_outreach: {
    label: "Draft outreach",
    objective:
      "Prepare a practical outreach message from verified relationship context and known guardrails.",
    expected_outputs: [
      "draft message",
      "why this tone or ask fits",
      "what should be verified before sending",
    ],
  },
  prep_for_call: {
    label: "Prep for call",
    objective:
      "Prepare a concise call-prep packet with context, open loops, useful questions, and follow-up risks.",
    expected_outputs: [
      "call prep bullets",
      "open loops to raise",
      "recommended follow-up capture after the call",
    ],
  },
  verify_referral_lane: {
    label: "Verify referral lane",
    objective:
      "Pressure-test ideal referral, do-not-refer guardrails, podcast/outreach fit, and owner-sensitive judgments.",
    expected_outputs: [
      "confirmed referral lane",
      "guardrails and disqualifiers",
      "pending-change proposals for any updated relationship fields",
    ],
  },
} as const;

export type RelationshipCommandIntent = keyof typeof relationshipCommandIntents;

type FormLike = Pick<FormData, "get">;

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function cleanRelationshipCommandIntent(
  value: FormDataEntryValue | string | null | undefined,
): RelationshipCommandIntent {
  const clean = String(value ?? "").trim();
  return clean in relationshipCommandIntents
    ? (clean as RelationshipCommandIntent)
    : "draft_outreach";
}

export function cleanRelationshipCommandText(value: unknown, maxLength = 2000) {
  const clean = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
  return clean || null;
}

export function parseRelationshipCommandJobForm(formData: FormLike) {
  const contactId = String(formData.get("contact_id") ?? "");
  const intent = cleanRelationshipCommandIntent(formData.get("intent"));

  return {
    contactId,
    contactIdValid: isValidUuid(contactId),
    intent,
    command: relationshipCommandIntents[intent],
    primaryMove: cleanRelationshipCommandText(formData.get("primary_move"), 1200),
    commandPrompt: cleanRelationshipCommandText(formData.get("command_prompt"), 5000),
    source: cleanRelationshipCommandText(formData.get("source"), 120) ?? "relationship_command",
  };
}

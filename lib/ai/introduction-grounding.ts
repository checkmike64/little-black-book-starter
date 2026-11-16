import type {
  IntroductionEmailContext,
  IntroductionEmailPerson,
} from "../automation/llm.ts";

export type IntroductionEvidenceFact = {
  id: string;
  text: string;
};

export type IntroductionClaim = {
  text: string;
  evidence_ids: string[];
};

export type GroundedIntroductionOutput = {
  subject: string;
  body: string;
  claims: IntroductionClaim[];
};

const fillerWords = new Set([
  "a", "about", "and", "are", "as", "at", "be", "because", "both", "but",
  "can", "do", "each", "for", "from", "has", "have", "he", "her", "here",
  "him", "his", "i", "in", "is", "it", "know", "of", "on", "one", "or",
  "she", "so", "that", "the", "their", "them", "they", "this", "to", "two",
  "we", "who", "with", "would", "you", "your",
  // Functional introduction language does not assert a fact about either person.
  "intro", "introduction", "meet", "meeting",
]);

function clean(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function personFacts(prefix: "person_a" | "person_b", person: IntroductionEmailPerson) {
  const facts: IntroductionEvidenceFact[] = [];
  const add = (suffix: string, value: string | null | undefined) => {
    const text = clean(value);
    if (text) facts.push({ id: `${prefix}.${suffix}`, text });
  };
  add(
    "identity",
    [person.full_name, person.role, person.company].filter(Boolean).join("; "),
  );
  add("how_owner_knows", person.how_i_know_them || person.how_we_met);
  add("why_stay_in_touch", person.why_stay_in_touch);
  add("current_asks", person.current_asks);
  add("wants_help_with", person.wants_help_with);
  add("referral_fit", person.referral_fit);
  add("recent_activity", person.recent_activity);
  add("relationship_notes", person.relationship_notes);
  person.recent_interactions.forEach((value, index) =>
    add(`interaction_${index + 1}`, value),
  );
  person.open_promises.forEach((value, index) =>
    add(`promise_${index + 1}`, value),
  );
  person.groups.forEach((value, index) => add(`group_${index + 1}`, value));
  return facts;
}

export function introductionEvidenceFacts(input: IntroductionEmailContext) {
  return [
    ...(input.reason_verified
      ? [{ id: "introduction.reason", text: clean(input.reason) }]
      : []),
    ...personFacts("person_a", input.person_a),
    ...personFacts("person_b", input.person_b),
  ].filter((fact) => fact.text);
}

function terms(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .filter((term) => term.length > 2 && !fillerWords.has(term)),
    ),
  );
}

export function isEvidenceSupportedText(claim: string, evidenceText: string) {
  const evidenceTerms = new Set(terms(evidenceText));
  return terms(claim).every((term) => evidenceTerms.has(term));
}

function normalizedSentence(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function factualBodyLines(body: string, input: IntroductionEmailContext) {
  const firstA = normalizedSentence(input.person_a.first_name);
  const firstB = normalizedSentence(input.person_b.first_name);
  const safeNonFactualLines = new Set([
    `hey ${firstA} and ${firstB}`,
    `hey ${firstB} and ${firstA}`,
    "i will let you two take it from here",
    "i ll let you two take it from here",
    "i will leave it with you two",
    "i ll leave it with you two",
    "over to you two",
  ]);
  return body
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !safeNonFactualLines.has(normalizedSentence(line)));
}

export function validateIntroductionClaims(
  value: GroundedIntroductionOutput,
  input: IntroductionEmailContext,
) {
  if (!Array.isArray(value.claims) || value.claims.length < 3) return false;
  const evidence = new Map(
    introductionEvidenceFacts(input).map((fact) => [fact.id, fact.text]),
  );
  const validatedClaims: string[] = [];
  const usedEvidence = new Set<string>();

  for (const claim of value.claims) {
    if (!claim?.text?.trim() || !Array.isArray(claim.evidence_ids)) return false;
    const cited = claim.evidence_ids.map((id) => evidence.get(id)).filter(Boolean);
    if (cited.length !== claim.evidence_ids.length || cited.length === 0) return false;
    const citesReason = claim.evidence_ids.includes("introduction.reason");
    const citesA = claim.evidence_ids.some((id) => id.startsWith("person_a."));
    const citesB = claim.evidence_ids.some((id) => id.startsWith("person_b."));
    if ((citesReason && (citesA || citesB)) || (citesA && citesB)) return false;
    if (citesReason) {
      const reason = normalizedSentence(evidence.get("introduction.reason") ?? "");
      const normalizedClaim = normalizedSentence(claim.text);
      if (!reason || (!reason.includes(normalizedClaim) && !normalizedClaim.includes(reason))) {
        return false;
      }
    }
    if (citesA && !normalizedSentence(claim.text).includes(normalizedSentence(input.person_a.first_name))) {
      return false;
    }
    if (citesB && !normalizedSentence(claim.text).includes(normalizedSentence(input.person_b.first_name))) {
      return false;
    }
    // Draft validation is deliberately extractive. A model may reorder known
    // words, but it cannot introduce a new factual term that is absent from the
    // cited evidence. This favors abstention over a polished unsupported claim.
    if (!isEvidenceSupportedText(claim.text, cited.join(" "))) return false;
    claim.evidence_ids.forEach((id) => usedEvidence.add(id));
    validatedClaims.push(claim.text);
  }

  if (!usedEvidence.has("introduction.reason")) return false;
  if (!usedEvidence.has("person_a.identity") || !usedEvidence.has("person_b.identity")) {
    return false;
  }

  const knownNumbers = new Set(introductionEvidenceFacts(input).flatMap((fact) => fact.text.match(/\b\d+(?:\.\d+)?\b/g) ?? []));
  const bodyNumbers = value.body.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
  if (bodyNumbers.some((number) => !knownNumbers.has(number))) return false;

  const allEvidence = Array.from(evidence.values()).join(" ");
  if (!isEvidenceSupportedText(value.subject, allEvidence)) return false;

  const normalizedClaims = new Set(validatedClaims.map(normalizedSentence));
  return factualBodyLines(value.body, input).every((line) =>
    normalizedClaims.has(normalizedSentence(line)),
  );
}

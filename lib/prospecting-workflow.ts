import {
  getProspectingBucketMap,
  normalizeProspectingBucketPolicy,
  type ProspectingBucketConfig,
} from "./prospecting-buckets.ts";

type ProspectingSettings = {
  prospecting: {
    buckets: ProspectingBucketConfig[];
  };
};

function bucketLines(settings: ProspectingSettings) {
  return Object.values(getProspectingBucketMap(settings)).map((bucket) => {
    const policy = normalizeProspectingBucketPolicy(bucket.policy);
    return [
      `- ${bucket.name}`,
      `goal: ${bucket.goal}`,
      `look_for: ${bucket.look_for}`,
      `intensity: ${bucket.intensity}`,
      `lane: ${bucket.lane || "client-specific"}`,
      `cadence_days: ${policy.cadence_days}`,
      `qualifying_signals: ${policy.qualifying_signals.join(", ") || "operator review required"}`,
      `recommended_actions: ${policy.recommended_actions.join(", ")}`,
      `allowed_sources: ${policy.allowed_sources.join(", ")}`,
      `voice: ${policy.voice_instruction}`,
      `evidence: ${policy.evidence_requirement}`,
      `approval: ${policy.approval}`,
      `success: ${policy.success_definition}`,
    ].join(" | ");
  });
}

export function buildProspectingResearchPrompt(settings: ProspectingSettings) {
  return [
    "Review the owner-selected Little Black Book Want to Know list.",
    "",
    "Purpose:",
    "- Research only people the owner has already placed in Want to Know.",
    "- Do not discover, propose, or add new Want to Know candidates.",
    "- Never move or duplicate an existing Book contact into Want to Know because their profile is sparse.",
    "- Keep the research client-specific. Do not default to podcasts, investor outreach, or sales unless the bucket calls for it.",
    "- Prefer fewer, better candidates with source-backed reasons.",
    "",
    "Configured prospecting buckets:",
    ...bucketLines(settings),
    "",
    "For each existing person, produce:",
    "- full_name",
    "- bucket",
    "- lane",
    "- stage: watching, warming, or ready",
    "- company",
    "- source",
    "- why",
    "- linkedin if known",
    "- dossier.goal",
    "- dossier.look_for",
    "- dossier.next_touch",
    "- confidence",
    "- verification question for the owner or operator",
    "",
    "Routing:",
    "- Never send want_to_know_candidate. The owner adds people manually in the app.",
    "- If the person is already in the Book, keep them there and propose contact enrichment instead.",
    "- If evidence is thin, ask a verification question before proposing a write.",
  ].join("\n");
}

export function buildWantToKnowCandidateProposalPrompt(settings: ProspectingSettings) {
  return [
    "Little Black Book Want to Know boundary.",
    "",
    "The owner creates Want to Know records manually and chooses the purpose.",
    "Do not submit want_to_know_candidate to /api/claude/pending-changes.",
    "You may research or recommend next steps only for people already returned by the app.",
    "Do not infer prospecting intent from calendar attendance, sparse profiles, newsletters, or repeated email alone.",
    "",
    "Configured purposes:",
    ...bucketLines(settings),
  ].join("\n");
}

export function buildBucketResearchPrompt(bucket: ProspectingBucketConfig) {
  const policy = normalizeProspectingBucketPolicy(bucket.policy);
  return [
    `Research the ${bucket.name} prospecting bucket for Little Black Book.`,
    "",
    `Goal: ${bucket.goal}`,
    `Look for: ${bucket.look_for}`,
    `Intensity: ${bucket.intensity}`,
    `Lane: ${bucket.lane || "client-specific"}`,
    `Minimum cadence: wait ${policy.cadence_days} days between proactive touches unless a new qualifying signal appears.`,
    `Qualifying signals: ${policy.qualifying_signals.join(", ") || "operator verification required"}`,
    `Permitted recommendations: ${policy.recommended_actions.join(", ")}`,
    `Allowed evidence sources: ${policy.allowed_sources.join(", ")}`,
    `Voice constraint: ${policy.voice_instruction}`,
    `Evidence threshold: ${policy.evidence_requirement}`,
    `Minimum independent evidence sources: ${policy.minimum_evidence_sources}`,
    `Required approval: ${policy.approval}`,
    `Success or exit state: ${policy.success_definition}`,
    "",
    "Review only owner-selected people already stored in this bucket.",
    "Reject a candidate or action that violates the bucket cadence, source, evidence, action, or approval policy.",
    "Return a tight shortlist with factual source context, a confidence level, and one verification question per person.",
    "Do not create or propose new Want to Know candidates. The owner controls membership in the app.",
  ].join("\n");
}

export function buildProspectingVerificationPrompt(settings: ProspectingSettings) {
  return [
    "Run a Little Black Book prospecting verification pass.",
    "",
    "Purpose:",
    "- Help the owner review people they already placed in Want to Know.",
    "- Keep questions short enough to answer in conversation.",
    "- Verify bucket fit before any candidate becomes durable.",
    "",
    "Ask, in this order:",
    "1. Do you recognize this person or source context?",
    "2. Is the proposed bucket right for this install?",
    "3. Is this person worth watching, warming, adding to the Book, pausing, or ignoring?",
    "4. Is there an existing Book contact or Want to Know candidate this should merge with?",
    "5. What would make the next touch genuinely useful?",
    "",
    "Configured buckets:",
    ...bucketLines(settings),
  ].join("\n");
}

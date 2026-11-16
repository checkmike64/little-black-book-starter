export type AskQueryIntent = {
  ownerObligation: boolean;
  requestedDeliverable: boolean;
};

export type AskQueryConcept = {
  label: string;
  terms: string[];
  weight: number;
};

export type AskQueryAnalysis = {
  normalized: string;
  coreTerms: string[];
  concepts: AskQueryConcept[];
  intent: AskQueryIntent;
};

export type AskDocumentMatch = {
  score: number;
  matchedConcepts: string[];
  matchedTerms: string[];
};

const stopWords = new Set([
  "a",
  "about",
  "am",
  "an",
  "and",
  "are",
  "can",
  "did",
  "do",
  "does",
  "for",
  "from",
  "have",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "should",
  "that",
  "the",
  "them",
  "there",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "why",
  "with",
]);

const conceptRules: Array<{
  label: string;
  queryPattern: RegExp;
  terms: string[];
  weight: number;
}> = [
  {
    label: "an obligation or follow-up",
    queryPattern:
      /\b(owe|owed|owing|promise|promised|commit|committed|commitment|follow[ -]?up|action item|need to|supposed to|send|share|deliver|give|giving|show|agreed to|said (i|we) would|waiting for|expecting)\b/,
    terms: [
      "owe",
      "owed",
      "promise",
      "promised",
      "commitment",
      "committed",
      "commit",
      "follow up",
      "follow-up",
      "action item",
      "next step",
      "need to send",
      "send",
      "share",
      "deliver",
      "get you",
      "agreed to",
      "said i would",
      "waiting for",
      "expecting",
    ],
    weight: 30,
  },
  {
    label: "a requested deliverable",
    queryPattern: /\b(ask|asked|request|requested|wanted|send|share|copy|give|giving|show|get|waiting for|expecting)\b/,
    terms: [
      "asked",
      "requested",
      "wanted",
      "would like",
      "interested in",
      "send me",
      "send them",
      "share",
      "copy",
      "follow up",
      "next step",
      "waiting for",
      "expecting",
    ],
    weight: 22,
  },
  {
    label: "a Loom, video, demo, or walkthrough",
    queryPattern: /\b(loom|video|record|recording|demo|tour|show|product tour|walk[ -]?through|screen ?cast)\b/,
    terms: [
      "loom",
      "video",
      "recording",
      "demo",
      "demonstration",
      "walkthrough",
      "walk through",
      "screencast",
      "screen recording",
      "show me",
      "show them",
      "product tour",
      "tour",
    ],
    weight: 34,
  },
  {
    label: "the Little Black Book product",
    queryPattern:
      /\b(little black book|black book|the book|book works|lbb|crm|relationship (os|operating system)|relationship product|relationship app)\b/,
    terms: [
      "little black book",
      "black book",
      "the book",
      "book",
      "lbb",
      "crm",
      "relationship operating system",
      "relationship os",
      "relationship product",
      "relationship app",
      "relationship tool",
      "relationship software",
      "personal crm",
      "private crm",
      "networking app",
      "product prototype",
    ],
    weight: 38,
  },
  {
    label: "an introduction or referral",
    queryPattern: /\b(intro|introduce|introduction|referral|connect|connection)\b/,
    terms: [
      "intro",
      "introduce",
      "introduction",
      "referral",
      "connect",
      "connection",
      "warm path",
    ],
    weight: 28,
  },
  {
    label: "a document, deck, or copy",
    queryPattern: /\b(deck|document|doc|copy|pdf|proposal|notes|file)\b/,
    terms: ["deck", "document", "doc", "copy", "pdf", "proposal", "notes", "file"],
    weight: 30,
  },
];

export function normalizeAskText(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function attributableAskParticipantIds(participantIds: string[]) {
  const distinct = unique(participantIds);
  return distinct.length === 1 ? distinct : [];
}

function queryCoreTerms(normalized: string) {
  return unique(
    normalized
      .split(" ")
      .filter((term) => term.length > 1 && !stopWords.has(term)),
  );
}

export function analyzeAskQuery(query: string): AskQueryAnalysis {
  const normalized = normalizeAskText(query);
  const concepts = conceptRules
    .filter((rule) => rule.queryPattern.test(normalized))
    .map(({ label, terms, weight }) => ({ label, terms, weight }));

  return {
    normalized,
    coreTerms: queryCoreTerms(normalized),
    concepts,
    intent: {
      ownerObligation:
        /\b(i|we)\s+(owe|owed|promise|promised|commit|committed|need to|should|have to|was going to|agreed to|said (i|we) would)\b/.test(
          normalized,
        ) || /\bwho do (i|we) owe\b/.test(normalized) ||
        /\b(waiting for|expecting)\b/.test(normalized),
      requestedDeliverable:
        /\b(ask|asked|request|requested|wanted|send|share|copy|deliver|give|giving|show|get|waiting for|expecting)\b/.test(
          normalized,
        ) ||
        (/\b(owe|owed|promised|committed|need to)\b/.test(normalized) &&
          /\b(loom|video|recording|demo|walk through|walkthrough|deck|document|copy)\b/.test(
            normalized,
          )),
    },
  };
}

function termMatches(normalizedDocument: string, term: string) {
  const normalizedTerm = normalizeAskText(term);
  if (!normalizedTerm) return false;
  if (normalizedDocument.includes(normalizedTerm)) return true;

  if (normalizedTerm.length >= 5) {
    const stem = normalizedTerm.replace(/(ing|ed|es|s)$/, "");
    return stem.length >= 4 && normalizedDocument.split(" ").some((word) => word.startsWith(stem));
  }

  return false;
}

export function matchAskDocument(
  document: string,
  analysis: AskQueryAnalysis,
  options: { ownerOwes?: boolean; requestedByContact?: boolean } = {},
): AskDocumentMatch {
  const normalizedDocument = normalizeAskText(document);
  if (!normalizedDocument || !analysis.normalized) {
    return { score: 0, matchedConcepts: [], matchedTerms: [] };
  }

  const matchedTerms = analysis.coreTerms.filter((term) =>
    termMatches(normalizedDocument, term),
  );
  const matchedConcepts = analysis.concepts
    .filter((concept) => concept.terms.some((term) => termMatches(normalizedDocument, term)))
    .map((concept) => concept.label);
  let score = matchedTerms.length * 12;

  for (const concept of analysis.concepts) {
    if (matchedConcepts.includes(concept.label)) score += concept.weight;
  }

  if (analysis.normalized.length >= 4 && normalizedDocument.includes(analysis.normalized)) {
    score += 45;
  }
  const nonObligationConcepts = analysis.concepts.filter(
    (concept) =>
      concept.label !== "an obligation or follow-up" &&
      concept.label !== "a requested deliverable",
  );
  const hasRequestedSpecificMatch =
    nonObligationConcepts.length === 0 ||
    nonObligationConcepts.filter((concept) => matchedConcepts.includes(concept.label)).length >=
      Math.min(nonObligationConcepts.length, 2);

  if (analysis.intent.ownerObligation && options.ownerOwes && hasRequestedSpecificMatch) {
    score += 55;
    matchedConcepts.push("something you owe this person");
  }
  if (
    analysis.intent.requestedDeliverable &&
    options.requestedByContact &&
    hasRequestedSpecificMatch
  ) {
    score += 28;
    matchedConcepts.push("a request from this person");
  }

  return {
    score,
    matchedConcepts: unique(matchedConcepts),
    matchedTerms: unique(matchedTerms),
  };
}

export function isGroundedAskObligationMatch(
  match: AskDocumentMatch,
  analysis: AskQueryAnalysis,
) {
  if (!analysis.intent.ownerObligation) return true;
  return (
    match.matchedConcepts.includes("something you owe this person") ||
    match.matchedConcepts.includes("a request from this person")
  );
}

const obligationEvidenceTypes = new Set([
  "interaction",
  "transcript",
  "promise",
  "action",
  "provenance",
]);

export function isAskEvidenceTypeAllowed(
  type: string,
  analysis: AskQueryAnalysis,
) {
  return !analysis.intent.ownerObligation || obligationEvidenceTypes.has(type);
}

export function askMatchExplanation(match: AskDocumentMatch) {
  const parts = [
    ...match.matchedConcepts,
    match.matchedTerms.length > 0
      ? `the terms ${match.matchedTerms.slice(0, 4).join(", ")}`
      : "",
  ].filter(Boolean);
  return parts.length > 0 ? `Matched ${parts.join(" and ")}.` : "";
}

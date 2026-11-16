export type NetworkingContact = {
  id: string;
  full_name: string;
  company_name?: string | null;
  company_description?: string | null;
  role_title?: string[] | null;
  one_line_summary?: string | null;
  current_asks?: string | null;
  wants_help_with?: string | null;
  what_they_want_more_of?: string | null;
  ideal_referral?: string | null;
  podcast_fit?: string | null;
  podcast_url?: string | null;
  how_we_met?: string | null;
  why_stay_in_touch?: string | null;
  recent_activity?: string | null;
  services_offered?: string[] | null;
  could_refer_me_for?: string[] | null;
  primary_category?: string[] | null;
  top_3_tags?: string[] | null;
  keywords?: string[] | null;
  do_not_refer_for?: string | null;
  evidence_signals?: NetworkingEvidenceSignal[];
};

export type NetworkingEvidenceSignal = {
  source_kind: "conversation" | "promise" | "content" | "profile";
  source_ref: string;
  role: "need" | "offer" | "activity" | "explicit_introduction";
  text: string;
  observed_at?: string | null;
};

export type NetworkingMatchPolicy = {
  relationshipRules?: string | null;
};

export type NetworkingMatchDirection = "a_to_b" | "b_to_a" | "two_way";

export type NetworkingMatchEvidence = {
  summary: string;
  match_type:
    | "explicit_introduction"
    | "referral"
    | "commercial"
    | "expertise"
    | "collaboration"
    | "audience"
    | "peer"
    | "podcast";
  direction: NetworkingMatchDirection;
  matched_terms: string[];
  claims: NetworkingEvidenceClaim[];
  score: number;
  confidence_basis: string[];
  policy_checks: string[];
  version: "network_fit_v3";
};

export type NetworkingEvidenceClaim = {
  contact_id: string;
  source_kind: NetworkingEvidenceSignal["source_kind"];
  source_ref: string;
  role: NetworkingEvidenceSignal["role"];
  excerpt: string;
  observed_at?: string | null;
};

export type NetworkingMatch = {
  contactA: NetworkingContact;
  contactB: NetworkingContact;
  score: number;
  confidence: number;
  direction: NetworkingMatchDirection;
  matchedTerms: string[];
  evidence: NetworkingMatchEvidence;
};

type DirectionalFit = {
  score: number;
  matchedTerms: string[];
  podcast: boolean;
  explicitIntroduction: boolean;
  claims: NetworkingEvidenceClaim[];
};

const stopWords = new Set([
  "about", "after", "again", "also", "another", "because", "been", "being",
  "between", "build", "building", "business", "company", "contact", "could",
  "find", "finding", "from", "have", "help", "into", "looking", "make", "more",
  "most", "need", "needs", "other", "people", "person", "should", "someone",
  "their", "there", "these", "they", "this", "through", "very", "want", "wants",
  "what", "when", "where", "which", "with", "work", "would", "your",
]);

const displayLabels: Record<string, string> = {
  agency: "agencies",
  acquisition: "acquisitions",
  audience: "audience growth",
  automation: "automation",
  brand: "brand building",
  coaching: "coaching",
  ecommerce: "ecommerce",
  finance: "finance",
  founder: "founders",
  healthcare: "healthcare",
  investment: "investment",
  leadership: "leadership",
  marketing: "marketing",
  media: "media",
  operations: "operations",
  podcast: "podcasts",
  recruiting: "recruiting",
  referral: "referrals",
  sales: "sales",
  software: "software",
  strategy: "strategy",
  analytics: "analytics",
  community: "community building",
  design: "design",
  education: "education",
  events: "events",
  franchising: "franchising",
  legal: "legal support",
  manufacturing: "manufacturing",
  partnerships: "partnerships",
  product: "product development",
  realestate: "real estate",
  technology: "technology",
  wellness: "wellness",
};

const networkingTopics = new Set(Object.keys(displayLabels));

function list(value: string[] | null | undefined) {
  return value?.filter(Boolean).join(" ") ?? "";
}

function needsText(contact: NetworkingContact) {
  return [
    contact.current_asks,
    contact.wants_help_with,
    contact.what_they_want_more_of,
    contact.ideal_referral,
    contact.podcast_fit,
    ...(contact.evidence_signals ?? [])
      .filter((signal) => signal.role === "need" || signal.role === "explicit_introduction")
      .map((signal) => signal.text),
  ]
    .filter(Boolean)
    .join(" | ");
}

function offersText(contact: NetworkingContact) {
  return [
    list(contact.services_offered),
    list(contact.could_refer_me_for),
    list(contact.primary_category),
    list(contact.top_3_tags),
    list(contact.keywords),
    list(contact.role_title),
    contact.one_line_summary,
    contact.company_description,
    contact.company_name,
    ...(contact.evidence_signals ?? [])
      .filter((signal) => signal.role === "offer" || signal.role === "activity")
      .map((signal) => signal.text),
  ]
    .filter(Boolean)
    .join(" | ");
}

function canonicalWord(word: string) {
  if (/^agenc/.test(word)) return "agency";
  if (/^(acqui|buyer|merger|sell|exit)/.test(word)) return "acquisition";
  if (/^audien/.test(word)) return "audience";
  if (/^automat/.test(word)) return "automation";
  if (/^brand/.test(word)) return "brand";
  if (/^coach/.test(word)) return "coaching";
  if (/^(ecommerce|commerce)/.test(word)) return "ecommerce";
  if (/^(financ|cfo|account)/.test(word)) return "finance";
  if (/^(founder|entrepreneur)/.test(word)) return "founder";
  if (/^(health|medical)/.test(word)) return "healthcare";
  if (/^(invest|capital|funding)/.test(word)) return "investment";
  if (/^leader/.test(word)) return "leadership";
  if (/^market/.test(word)) return "marketing";
  if (/^(media|newsletter|content)/.test(word)) return "media";
  if (/^operat/.test(word)) return "operations";
  if (/^(podcast|podcaster)/.test(word)) return "podcast";
  if (/^(recruit|talent|hiring)/.test(word)) return "recruiting";
  if (/^refer/.test(word)) return "referral";
  if (/^sales/.test(word)) return "sales";
  if (/^(softwar|saas|technology|tech$)/.test(word)) return "software";
  if (/^strateg/.test(word)) return "strategy";
  if (/^(analytic|data|measurement|insight)/.test(word)) return "analytics";
  if (/^communit/.test(word)) return "community";
  if (/^(design|creative|branding)/.test(word)) return "design";
  if (/^(educat|course|training|workshop)/.test(word)) return "education";
  if (/^(event|conference|summit)/.test(word)) return "events";
  if (/^franchi/.test(word)) return "franchising";
  if (/^(legal|lawyer|attorney|contract)/.test(word)) return "legal";
  if (/^(manufactur|industrial|factory)/.test(word)) return "manufacturing";
  if (/^(partner|alliance|collaborat)/.test(word)) return "partnerships";
  if (/^(product|platform)/.test(word)) return "product";
  if (/^(realestate|property|realtor)/.test(word)) return "realestate";
  if (/^(technology|technical)/.test(word)) return "technology";
  if (/^(wellness|fitness|mentalhealth)/.test(word)) return "wellness";
  return word;
}

function words(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/m\s*&\s*a/g, " acquisition ")
      .replace(/[^a-z0-9+#]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4 && !stopWords.has(word))
      .map(canonicalWord)
      .filter((word) => networkingTopics.has(word)),
  );
}

const genericPodcastWords = new Set([
  "appear",
  "appearance",
  "business",
  "episode",
  "founder",
  "guest",
  "hosting",
  "interview",
  "podcast",
  "podcaster",
  "show",
  "speaker",
]);

function topicWords(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/m\s*&\s*a/g, " acquisition ")
      .replace(/[^a-z0-9+#]+/g, " ")
      .split(/\s+/)
      .filter(
        (word) =>
          word.length >= 4 &&
          !stopWords.has(word) &&
          !genericPodcastWords.has(word),
      )
      .map(canonicalWord),
  );
}

function normalizedPhrases(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .split(/[\n.;]+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function contactIdentifiers(contact: NetworkingContact) {
  return [contact.full_name, contact.company_name]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.toLowerCase().trim());
}

function ruleBlocksPair(
  contactA: NetworkingContact,
  contactB: NetworkingContact,
  relationshipRules: string | null | undefined,
  matchedTerms: string[],
) {
  const clauses = normalizedPhrases(relationshipRules);
  if (clauses.length === 0) return false;

  const identifiersA = contactIdentifiers(contactA);
  const identifiersB = contactIdentifiers(contactB);
  const negativeRule = /\b(?:avoid|do not|don't|never|no)\b/;
  const allowOnlyRule = /\bonly\b/;
  const relationshipAction = /\b(?:connect|connection|introduce|introduction|match|refer|referral)\w*\b/;

  return clauses.some((clause) => {
    if (!relationshipAction.test(clause)) return false;
    const isNegative = negativeRule.test(clause);
    const isAllowOnly = allowOnlyRule.test(clause);
    if (!isNegative && !isAllowOnly) return false;

    const namesA = identifiersA.some((identifier) => clause.includes(identifier));
    const namesB = identifiersB.some((identifier) => clause.includes(identifier));
    if (isNegative && (namesA || namesB)) return true;

    if (/\b(?:same company|coworkers?|colleagues?)\b/.test(clause)) {
      const companyA = contactA.company_name?.trim().toLowerCase();
      const companyB = contactB.company_name?.trim().toLowerCase();
      if (isNegative && companyA && companyB && companyA === companyB) return true;
    }

    if (/\bcompetitors?\b/.test(clause)) {
      const aTopics = words(offersText(contactA));
      const bTopics = words(offersText(contactB));
      if (
        isNegative &&
        [...aTopics].some((topic) => bTopics.has(topic))
      ) return true;
    }

    const ruleTopics = words(clause);
    const topicMatches = matchedTerms.some((term) => ruleTopics.has(term));
    if (isAllowOnly && ruleTopics.size > 0) return !topicMatches;
    if (isNegative && topicMatches) return true;

    // Free-form rules cannot always be evaluated safely. A relationship-action rule
    // with no machine-verifiable condition fails closed instead of being ignored.
    return true;
  });
}

function restrictionBlocksFit(provider: NetworkingContact, fit: DirectionalFit) {
  const restriction = provider.do_not_refer_for?.trim();
  if (!restriction || fit.score === 0) return false;
  if (/\b(?:any|all)\s+(?:introductions?|referrals?)\b/i.test(restriction)) return true;
  const restrictedTopics = words(restriction);
  return fit.matchedTerms.some((term) => restrictedTopics.has(term));
}

function seeksPodcastAppearances(contact: NetworkingContact) {
  const text = needsText(contact).toLowerCase();
  return (
    /(?:get|go|appear|book|guest|speak|placement|opportunit)[^.!|]{0,45}(?:podcast|show)/.test(
      text,
    ) ||
    /(?:podcast|show)[^.!|]{0,45}(?:guest|appearance|placement|opportunit)/.test(text)
  );
}

function hostsPodcast(contact: NetworkingContact) {
  if (contact.podcast_url?.trim()) return true;
  const text = offersText(contact).toLowerCase();
  return /\b(podcast host|podcaster|hosts? (?:a |the )?podcast|co-host|interview show)\b/.test(
    text,
  );
}

function compactExcerpt(value: string, maxLength = 220) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  const clipped = clean.slice(0, maxLength + 1);
  return `${clipped.slice(0, clipped.lastIndexOf(" ") || maxLength).trim()}…`;
}

function profileSignals(contact: NetworkingContact, role: "need" | "offer") {
  const values: Array<[string, string | null | undefined]> = role === "need"
    ? [
        ["current_asks", contact.current_asks],
        ["wants_help_with", contact.wants_help_with],
        ["what_they_want_more_of", contact.what_they_want_more_of],
        ["ideal_referral", contact.ideal_referral],
        ["podcast_fit", contact.podcast_fit],
      ]
    : [
        ["services_offered", list(contact.services_offered)],
        ["could_refer_me_for", list(contact.could_refer_me_for)],
        ["one_line_summary", contact.one_line_summary],
        ["company_description", contact.company_description],
        ["role_title", list(contact.role_title)],
      ];
  return values.flatMap(([field, value]) =>
    value?.trim()
      ? [{
          source_kind: "profile" as const,
          source_ref: `contacts.${field}`,
          role,
          text: value,
          observed_at: null,
        }]
      : [],
  );
}

function signalsFor(contact: NetworkingContact, role: "need" | "offer") {
  return [
    ...profileSignals(contact, role),
    ...(contact.evidence_signals ?? []).filter((signal) =>
      role === "need"
        ? signal.role === "need" || signal.role === "explicit_introduction"
        : signal.role === "offer" || signal.role === "activity",
    ),
  ];
}

function claimsForTerms(
  contact: NetworkingContact,
  role: "need" | "offer",
  matchedTerms: string[],
) {
  return signalsFor(contact, role)
    .filter((signal) => {
      const signalWords = words(signal.text);
      return matchedTerms.some((term) => signalWords.has(term));
    })
    .slice(0, 2)
    .map((signal): NetworkingEvidenceClaim => ({
      contact_id: contact.id,
      source_kind: signal.source_kind,
      source_ref: signal.source_ref,
      role: signal.role,
      excerpt: compactExcerpt(signal.text),
      observed_at: signal.observed_at ?? null,
    }));
}

function nameTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function explicitIntroductionRequest(
  seeker: NetworkingContact,
  provider: NetworkingContact,
): DirectionalFit | null {
  const providerTokens = nameTokens(provider.full_name);
  if (providerTokens.length === 0) return null;
  const directSignals = [
    ...profileSignals(seeker, "need"),
    ...(seeker.evidence_signals ?? []).filter(
      (signal) => signal.role === "explicit_introduction" || signal.role === "need",
    ),
  ];
  const match = directSignals.find((signal) => {
    const text = signal.text.toLowerCase();
    const distinctiveTokens = providerTokens.filter((token) => token.length >= 5);
    const namesProvider = distinctiveTokens.length > 0
      ? distinctiveTokens.some((token) => text.includes(token))
      : providerTokens.every((token) => text.includes(token));
    return namesProvider && /\b(?:intro(?:duce|duction)?|connect|refer)\w*\b/.test(text);
  });
  if (!match) return null;
  return {
    score: 98,
    matchedTerms: ["direct introduction request"],
    podcast: false,
    explicitIntroduction: true,
    claims: [{
      contact_id: seeker.id,
      source_kind: match.source_kind,
      source_ref: match.source_ref,
      role: "explicit_introduction",
      excerpt: compactExcerpt(match.text),
      observed_at: match.observed_at ?? null,
    }],
  };
}

function directionalFit(
  seeker: NetworkingContact,
  provider: NetworkingContact,
): DirectionalFit {
  const explicit = explicitIntroductionRequest(seeker, provider);
  if (explicit) return explicit;
  const podcast = seeksPodcastAppearances(seeker) && hostsPodcast(provider);
  if (podcast) {
    const guestTopics = topicWords(needsText(seeker));
    const showTopics = topicWords(offersText(provider));
    const matchedTopics = [...guestTopics]
      .filter((word) => showTopics.has(word))
      .sort()
      .slice(0, 5);
    if (matchedTopics.length === 0) {
      return { score: 0, matchedTerms: [], podcast: false, explicitIntroduction: false, claims: [] };
    }
    return {
      score: Math.min(82, 59 + matchedTopics.length * 7),
      matchedTerms: matchedTopics,
      podcast: true,
      explicitIntroduction: false,
      claims: [
        ...claimsForTerms(seeker, "need", matchedTopics),
        ...claimsForTerms(provider, "offer", matchedTopics),
      ],
    };
  }

  const needWords = words(needsText(seeker));
  const offerWords = words(offersText(provider));
  const matchedTerms = [...needWords]
    .filter((word) => offerWords.has(word) && word !== "podcast")
    .sort()
    .slice(0, 5);

  if (matchedTerms.length === 0) {
    return { score: 0, matchedTerms: [], podcast: false, explicitIntroduction: false, claims: [] };
  }

  const score = Math.min(88, 50 + matchedTerms.length * 12);
  return {
    score,
    matchedTerms,
    podcast: false,
    explicitIntroduction: false,
    claims: [
      ...claimsForTerms(seeker, "need", matchedTerms),
      ...claimsForTerms(provider, "offer", matchedTerms),
    ],
  };
}

function displayTerms(terms: string[]) {
  return terms.map((term) => displayLabels[term] ?? term.replace(/_/g, " "));
}

function joinTerms(terms: string[]) {
  const displayed = displayTerms(terms).slice(0, 3);
  if (displayed.length <= 1) return displayed[0] ?? "a relevant priority";
  if (displayed.length === 2) return `${displayed[0]} and ${displayed[1]}`;
  return `${displayed[0]}, ${displayed[1]}, and ${displayed[2]}`;
}

function directionFor(aToB: DirectionalFit, bToA: DirectionalFit) {
  if (aToB.score > 0 && bToA.score > 0) return "two_way" as const;
  return aToB.score > 0 ? ("a_to_b" as const) : ("b_to_a" as const);
}

function evidenceSummary(
  a: NetworkingContact,
  b: NetworkingContact,
  aToB: DirectionalFit,
  bToA: DirectionalFit,
) {
  const strongest = aToB.score >= bToA.score ? aToB : bToA;
  const seeker = strongest === aToB ? a : b;
  const provider = strongest === aToB ? b : a;
  const terms = joinTerms(strongest.matchedTerms);

  if (strongest.explicitIntroduction) {
    return `${seeker.full_name}'s saved context explicitly calls for an introduction to ${provider.full_name}.`;
  }
  if (strongest.podcast) {
    return `${seeker.full_name} wants podcast appearances about ${terms}, and ${provider.full_name}'s show covers those topics.`;
  }

  if (aToB.score > 0 && bToA.score > 0) {
    return `${a.full_name} and ${b.full_name} have complementary needs and experience in ${terms}.`;
  }
  return `${seeker.full_name} is looking for help with ${terms}, and ${provider.full_name} works in that area.`;
}

function matchTypeFor(fit: DirectionalFit, terms: string[]) {
  if (fit.explicitIntroduction) return "explicit_introduction" as const;
  if (fit.podcast) return "podcast" as const;
  if (terms.some((term) => ["referral", "acquisition", "investment"].includes(term))) {
    return "referral" as const;
  }
  if (terms.some((term) => ["sales", "marketing", "ecommerce", "finance", "legal", "recruiting"].includes(term))) {
    return "commercial" as const;
  }
  if (terms.some((term) => ["audience", "media", "events", "community"].includes(term))) {
    return "audience" as const;
  }
  if (terms.some((term) => ["partnerships", "product", "design", "technology"].includes(term))) {
    return "collaboration" as const;
  }
  if (terms.some((term) => ["founder", "leadership"].includes(term))) {
    return "peer" as const;
  }
  return "expertise" as const;
}

export function scoreNetworkingPair(
  contactA: NetworkingContact,
  contactB: NetworkingContact,
  policy: NetworkingMatchPolicy = {},
): NetworkingMatch | null {
  const rawAToB = directionalFit(contactA, contactB);
  const rawBToA = directionalFit(contactB, contactA);
  const blockedAToB = restrictionBlocksFit(contactB, rawAToB);
  const blockedBToA = restrictionBlocksFit(contactA, rawBToA);
  const aToB = blockedAToB
    ? { score: 0, matchedTerms: [], podcast: false, explicitIntroduction: false, claims: [] }
    : rawAToB;
  const bToA = blockedBToA
    ? { score: 0, matchedTerms: [], podcast: false, explicitIntroduction: false, claims: [] }
    : rawBToA;
  const strongestScore = Math.max(aToB.score, bToA.score);
  const twoWayBonus = aToB.score > 0 && bToA.score > 0 ? 8 : 0;
  const score = Math.min(100, strongestScore + twoWayBonus);
  const eligible = strongestScore >= 50;

  if (!eligible) {
    return null;
  }

  const direction = directionFor(aToB, bToA);
  const matchedTerms = [...new Set([...aToB.matchedTerms, ...bToA.matchedTerms])].slice(
    0,
    5,
  );
  if (ruleBlocksPair(contactA, contactB, policy.relationshipRules, matchedTerms)) {
    return null;
  }
  const strongest = aToB.score >= bToA.score ? aToB : bToA;
  const matchType = matchTypeFor(strongest, matchedTerms);
  const explicitSignals = matchedTerms.length + (matchType === "podcast" ? 1 : 0);
  const reciprocal = aToB.score > 0 && bToA.score > 0;
  const confidence = Math.min(
    0.95,
    0.58 + Math.min(0.24, explicitSignals * 0.08) + (reciprocal ? 0.08 : 0),
  );
  const policyChecks = [
    "tenant_relationship_rules",
    "contact_do_not_refer_for",
  ];
  const evidence: NetworkingMatchEvidence = {
    summary: evidenceSummary(contactA, contactB, aToB, bToA),
    match_type: matchType,
    direction,
    matched_terms: matchedTerms,
    claims: [...aToB.claims, ...bToA.claims].slice(0, 8),
    score,
    confidence_basis: [
      `${explicitSignals} explicit need/offer signal${explicitSignals === 1 ? "" : "s"}`,
      reciprocal ? "reciprocal fit" : "one-way fit",
      `${new Set(strongest.claims.map((claim) => claim.source_kind)).size} evidence source type${new Set(strongest.claims.map((claim) => claim.source_kind)).size === 1 ? "" : "s"}`,
    ],
    policy_checks: policyChecks,
    version: "network_fit_v3",
  };

  return {
    contactA,
    contactB,
    score,
    confidence,
    direction,
    matchedTerms,
    evidence,
  };
}

const acceptedStoredMatchSources = new Set([
  "deterministic_relationship_evidence",
  "stored_evidence_exact_excerpt",
]);

export type IntroductionFitEvidence = {
  terms: string[];
  reasonSource:
    | "connection.matched_terms"
    | "connection.current_contact_match";
};

function cleanMatchTerms(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(
        value
          .filter((term): term is string => typeof term === "string")
          .map((term) => term.replace(/\s+/g, " ").trim().slice(0, 120))
          .filter(Boolean),
      )].slice(0, 8)
    : [];
}

export function resolveIntroductionFitEvidence(input: {
  evidence: Record<string, unknown>;
  contactA?: NetworkingContact;
  contactB?: NetworkingContact;
  policy?: NetworkingMatchPolicy;
}): IntroductionFitEvidence | null {
  const storedTerms = cleanMatchTerms(input.evidence.matched_terms);
  const storedSource = input.evidence.matched_terms_source;
  if (
    storedTerms.length > 0 &&
    typeof storedSource === "string" &&
    acceptedStoredMatchSources.has(storedSource)
  ) {
    return {
      terms: storedTerms,
      reasonSource: "connection.matched_terms",
    };
  }

  if (!input.contactA || !input.contactB) return null;
  const currentMatch = scoreNetworkingPair(
    input.contactA,
    input.contactB,
    input.policy,
  );
  const currentTerms = cleanMatchTerms(currentMatch?.matchedTerms);
  if (currentTerms.length === 0) return null;

  return {
    terms: currentTerms,
    reasonSource: "connection.current_contact_match",
  };
}

function candidateKey(match: NetworkingMatch) {
  return [match.contactA.id, match.contactB.id].sort().join(":");
}

export function selectDiverseMatches(
  matches: NetworkingMatch[],
  limit: number,
  maxPerContact = Number.POSITIVE_INFINITY,
) {
  if (limit <= 0 || maxPerContact <= 0) return [];

  const remaining = [...matches].sort(
    (left, right) =>
      right.score - left.score || candidateKey(left).localeCompare(candidateKey(right)),
  );
  const selected: NetworkingMatch[] = [];
  const usedThisRound = new Set<string>();
  const selectionCounts = new Map<string, number>();

  while (remaining.length > 0 && selected.length < limit) {
    const underLimit = (match: NetworkingMatch) =>
      (selectionCounts.get(match.contactA.id) ?? 0) < maxPerContact &&
      (selectionCounts.get(match.contactB.id) ?? 0) < maxPerContact;
    let index = remaining.findIndex(
      (match) =>
        underLimit(match) &&
        !usedThisRound.has(match.contactA.id) &&
        !usedThisRound.has(match.contactB.id),
    );

    if (index === -1) {
      usedThisRound.clear();
      index = remaining.findIndex(underLimit);
    }

    if (index === -1) {
      break;
    }

    const [match] = remaining.splice(index, 1);
    selected.push(match);
    usedThisRound.add(match.contactA.id);
    usedThisRound.add(match.contactB.id);
    selectionCounts.set(
      match.contactA.id,
      (selectionCounts.get(match.contactA.id) ?? 0) + 1,
    );
    selectionCounts.set(
      match.contactB.id,
      (selectionCounts.get(match.contactB.id) ?? 0) + 1,
    );
  }

  return selected;
}

export function selectRecommendationPortfolio(
  matches: NetworkingMatch[],
  limit: number,
) {
  if (limit <= 0) return [];
  const podcastLimit = Math.max(1, Math.floor(limit * 0.2));
  const typeLimit = Math.max(2, Math.ceil(limit * 0.4));
  const contactCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  let podcastCount = 0;
  const selected: NetworkingMatch[] = [];

  for (const match of matches) {
    if (selected.length >= limit) break;
    const type = match.evidence.match_type;
    if (type === "podcast" && podcastCount >= podcastLimit) continue;
    if (
      type !== "explicit_introduction" &&
      (typeCounts.get(type) ?? 0) >= typeLimit
    ) continue;
    if (
      (contactCounts.get(match.contactA.id) ?? 0) >= 2 ||
      (contactCounts.get(match.contactB.id) ?? 0) >= 2
    ) continue;
    selected.push(match);
    if (type === "podcast") podcastCount += 1;
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    contactCounts.set(match.contactA.id, (contactCounts.get(match.contactA.id) ?? 0) + 1);
    contactCounts.set(match.contactB.id, (contactCounts.get(match.contactB.id) ?? 0) + 1);
  }
  for (const match of matches) {
    if (selected.length >= limit) break;
    if (selected.includes(match) || match.evidence.match_type === "podcast") continue;
    if (
      (contactCounts.get(match.contactA.id) ?? 0) >= 2 ||
      (contactCounts.get(match.contactB.id) ?? 0) >= 2
    ) continue;
    selected.push(match);
    contactCounts.set(match.contactA.id, (contactCounts.get(match.contactA.id) ?? 0) + 1);
    contactCounts.set(match.contactB.id, (contactCounts.get(match.contactB.id) ?? 0) + 1);
  }
  return selected;
}

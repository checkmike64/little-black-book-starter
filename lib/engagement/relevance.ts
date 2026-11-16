export type EngagementRelationshipContext = {
  relationship_type?: string[] | null;
  trust_level?: string | null;
  why_stay_in_touch?: string | null;
  current_asks?: string | null;
  wants_help_with?: string | null;
  what_they_want_more_of?: string | null;
  ideal_referral?: string | null;
  services_offered?: string[] | null;
  could_refer_me_for?: string[] | null;
  top_3_tags?: string[] | null;
  keywords?: string[] | null;
};

export type WantToKnowEngagementContext = {
  bucket?: string | null;
  lane?: string | null;
  why?: string | null;
  engagement_focus?: string | null;
  dossier?: Record<string, unknown> | null;
};

type EngagementFitInput = {
  content: string | null;
  relevance: string | null;
  classification: string | null;
  metrics?: Record<string, unknown> | null;
  context?: EngagementRelationshipContext | null;
};

const stopWords = new Set([
  "about", "after", "again", "also", "because", "been", "being", "between",
  "could", "from", "have", "into", "more", "most", "other", "should", "their",
  "there", "these", "they", "this", "through", "very", "what", "when", "where",
  "which", "with", "would", "your", "relationship", "contact", "people", "person",
  "company", "business", "building", "support",
  "first", "good", "help", "last", "make", "need", "right", "stay", "think",
  "time", "touch", "want", "work",
  "asked", "comes", "doesn", "figure", "look", "looking", "paid",
  "recently", "says", "that", "them", "then", "toward", "using",
]);

function canonicalWord(value: string) {
  if (/^acqui/.test(value)) return "acquisition";
  if (/^automat/.test(value)) return "automation";
  if (/^coach/.test(value)) return "coaching";
  if (/^consult/.test(value)) return "consulting";
  if (/^entrepreneur/.test(value)) return "entrepreneur";
  if (/^founder/.test(value)) return "founder";
  if (/^market/.test(value)) return "marketing";
  if (/^operat/.test(value)) return "operations";
  if (/^refer/.test(value)) return "referral";
  return value.endsWith("s") && value.length > 5 ? value.slice(0, -1) : value;
}

function words(value: string | null | undefined) {
  return new Set(
    (value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9+#]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4 && !stopWords.has(word))
      .map(canonicalWord),
  );
}

function list(value: string[] | null | undefined) {
  return value?.filter(Boolean).join(" ") ?? "";
}

export function relationshipContextText(
  context: EngagementRelationshipContext | null | undefined,
) {
  if (!context) return "";
  return [
    list(context.top_3_tags),
    list(context.keywords),
    list(context.services_offered),
    list(context.could_refer_me_for),
    context.ideal_referral,
    context.current_asks,
    context.wants_help_with,
    context.what_they_want_more_of,
  ]
    .filter(Boolean)
    .join(" | ");
}

function numberMetric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function genericRationale(value: string | null) {
  const rationale = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!rationale) return true;
  return (
    /low[- ]friction (way|opportunity)/i.test(rationale) ||
    /timely (way|opportunity) to (support|engage|reconnect)/i.test(rationale) ||
    /recent (post|update) from someone/i.test(rationale)
  );
}

const meaningfulMomentPattern =
  /\b(?:hiring|we(?:'re| are) hiring|join (?:our|the) team|open role|new role|promot(?:ed|ion)|launch(?:ed|ing)?|releas(?:ed|ing)|announc(?:e|ed|ing|ement)|company news|funding|fundrais(?:e|ing)|acqui(?:red|sition)|merger|partnership|award|milestone|expan(?:d|ding|sion)|new office|new market|podcast (?:guest|episode|appearance|interview)|guest(?:ed|ing)? on (?:a |the )?podcast|joined (?:a |the )?[^.!?]{0,60}podcast|interviewed on|keynote|speaking at|conference speaker|hosting (?:an? )?(?:event|conference))\b/i;

const helpOpportunityPattern =
  /\b(?:looking for|seeking|need help|could use help|asking for|recommendations? for|who (?:do you|should we|can)|can anyone|introduc(?:e|tion)|referr(?:al|ing)|open to ideas|advice|challenge|struggl(?:e|ing)|problem|stuck|support with|help us|help me)\b/i;

const businessSituationPattern =
  /\b(?:founder|leadership|executive|team|culture|sales|marketing|growth|scale|scaling|strategy|operations|acquisition|retention|revenue|positioning|offer|pipeline|hiring|management)\b/i;

const podcastSignalPattern =
  /\b(?:new|latest|recent|published|released|launch(?:ed)?|episode|podcast|show|season|guest|interview|milestone|anniversary|downloads?|listeners?|ranking|chart|award)\b/i;

const referralSignalPattern =
  /\b(?:announc(?:e|ed|ement)|celebrat(?:e|ed|ing|ion)|milestone|launch(?:ed|ing)?|new (?:site|website|service|offer|role|office|market)|website update|client result|case study|hiring|promotion|partnership|award|looking for|seeking|recommendation|introduction|referral)\b/i;

function dossierText(value: Record<string, unknown> | null | undefined) {
  if (!value) return "";
  return ["goal", "look_for", "next_touch"]
    .map((key) => typeof value[key] === "string" ? value[key] : "")
    .filter(Boolean)
    .join(" | ");
}

export function wantToKnowRelationshipContext(
  context: WantToKnowEngagementContext | null | undefined,
): EngagementRelationshipContext | null {
  if (!context) return null;
  return {
    relationship_type: [context.bucket, context.lane].filter(
      (value): value is string => Boolean(value),
    ),
    why_stay_in_touch: context.why,
    wants_help_with: context.engagement_focus,
    keywords: dossierText(context.dossier).split(/[^a-z0-9+#]+/i).filter(Boolean),
  };
}

export function wantToKnowEngagementFit(input: {
  content: string | null;
  relevance: string | null;
  classification: string | null;
  metrics?: Record<string, unknown> | null;
  context: WantToKnowEngagementContext;
}) {
  const relationshipContext = wantToKnowRelationshipContext(input.context);
  const base = engagementRelationshipFit({
    content: input.content,
    relevance: input.relevance,
    classification: input.classification,
    metrics: input.metrics,
    context: relationshipContext,
  });
  const lane = `${input.context.lane ?? ""} ${input.context.bucket ?? ""}`;
  const sourceText = `${input.content ?? ""} ${input.relevance ?? ""} ${input.classification ?? ""}`;

  if (/podcast|media/i.test(lane)) {
    const categorySignal = podcastSignalPattern.test(sourceText);
    return {
      ...base,
      eligible: categorySignal,
      categorySignal,
      categoryReason: categorySignal
        ? "A new episode or show milestone gives you a specific reason to engage."
        : null,
    };
  }

  if (/referral/i.test(lane)) {
    const categorySignal = referralSignalPattern.test(sourceText);
    return {
      ...base,
      eligible: categorySignal && (base.eligible || Boolean(input.context.engagement_focus)),
      categorySignal,
      categoryReason: categorySignal
        ? "A relevant update, ask, launch, or celebration creates a useful relationship touch."
        : null,
    };
  }

  return {
    ...base,
    categorySignal: base.meaningfulMoment || base.helpOpportunity,
    categoryReason: null,
  };
}

export function engagementRelationshipFit(input: EngagementFitInput) {
  const contextText = relationshipContextText(input.context);
  const contextWords = words(contextText);
  const postWords = words(`${input.content ?? ""} ${input.relevance ?? ""}`);
  const matchedTerms = [...contextWords]
    .filter((word) => postWords.has(word))
    .slice(0, 4);
  const overlap = matchedTerms.length;
  const rationale = input.relevance?.replace(/\s+/g, " ").trim() ?? "";
  const specificRationale =
    rationale.length >= 32 && !genericRationale(input.relevance);
  const meaningfulClassification = /structural|hiring|launch|milestone|opportunity/i.test(
    input.classification ?? "",
  );
  const likes = numberMetric(input.metrics?.likes);
  const comments = numberMetric(input.metrics?.comments);
  const trusted = /tier\s*[12]|high|black book|referral/i.test(
    `${input.context?.trust_level ?? ""} ${list(input.context?.relationship_type)}`,
  );
  const exceptionalResponse = trusted && (likes >= 100 || comments >= 20);
  const sourceText = `${input.content ?? ""} ${input.relevance ?? ""}`;
  const meaningfulMoment = meaningfulMomentPattern.test(sourceText);
  const helpOpportunity = helpOpportunityPattern.test(sourceText);
  const coachingOpportunity =
    businessSituationPattern.test(sourceText) &&
    (specificRationale || overlap >= 1 || helpOpportunity);
  const eligible =
    specificRationale ||
    overlap >= 2 ||
    (meaningfulClassification && overlap >= 1) ||
    exceptionalResponse ||
    meaningfulMoment ||
    helpOpportunity ||
    coachingOpportunity;
  const score = Math.min(
    40,
    overlap * 6 +
      (specificRationale ? 14 : 0) +
      (meaningfulClassification ? 5 : 0) +
      (exceptionalResponse ? 12 : 0) +
      (meaningfulMoment ? 10 : 0) +
      (helpOpportunity ? 12 : 0) +
      (coachingOpportunity ? 8 : 0),
  );

  return {
    eligible,
    score,
    matchedTerms,
    specificRationale,
    exceptionalResponse,
    meaningfulMoment,
    helpOpportunity,
    coachingOpportunity,
  };
}

export function fallbackRelationshipRationale(input: EngagementFitInput) {
  const fit = engagementRelationshipFit(input);
  if (fit.specificRationale && input.relevance) return input.relevance;
  if (fit.helpOpportunity) {
    return "They shared a concrete need where a useful offer, recommendation, or introduction may help.";
  }
  if (fit.matchedTerms.length > 0) {
    const labels = fit.matchedTerms.map((term) =>
      term === "founder" ? "founders" : term,
    );
    const finalLabel = labels.at(-1);
    const labelText =
      labels.length === 1
        ? finalLabel
        : `${labels.slice(0, -1).join(", ")} and ${finalLabel}`;
    return `Relevant to your shared context: ${labelText}.`;
  }
  if (fit.exceptionalResponse) {
    return "This post is receiving unusual attention and comes from a high-priority relationship.";
  }
  if (fit.meaningfulMoment) {
    return "They shared a meaningful business or personal milestone worth acknowledging specifically.";
  }
  if (fit.coachingOpportunity) {
    return "The post opens a credible way to contribute a relevant coaching perspective.";
  }
  return null;
}

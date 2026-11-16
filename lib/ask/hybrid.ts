import {
  analyzeAskQuery,
  isGroundedAskObligationMatch,
  matchAskDocument,
  normalizeAskText,
} from "./retrieval.ts";

export type AskRetrievalChannel = "exact" | "full_text" | "semantic";

export type AskEvidenceDocument = {
  id: string;
  type: string;
  contactId: string | null;
  title: string;
  text: string;
  sourceUrl?: string | null;
  occurredAt?: string | null;
};

export type AskRetrievalHit = {
  document: AskEvidenceDocument;
  score: number;
  channel: AskRetrievalChannel;
  explanation?: string;
};

export interface AskRetrievalSource {
  channel: AskRetrievalChannel;
  search(query: string, limit: number): Promise<AskRetrievalHit[]>;
}

/**
 * Builds production retrieval channels over the evidence records already
 * loaded for the signed-in tenant. The exact channel rewards direct lexical
 * coverage; the full-text channel rewards stored term matches; and the
 * semantic channel uses the Book's relationship ontology and intent expansion.
 * This remains deterministic and evidence-addressable. A vector source can be
 * added later without changing fusion or abstention behavior.
 */
export function buildLoadedEvidenceRetrievalSources(
  documents: AskEvidenceDocument[],
): AskRetrievalSource[] {
  const search = (
    channel: "exact" | "full_text" | "semantic",
    query: string,
    limit: number,
  ): AskRetrievalHit[] => {
    const analysis = analyzeAskQuery(query);
    if (!analysis.normalized) return [];

    const hits: AskRetrievalHit[] = [];
    for (const document of documents) {
        const body = [document.title, document.text].filter(Boolean).join(" ");
        if (channel === "exact") {
          const normalizedBody = normalizeAskText(body);
          const terms = analysis.coreTerms;
          const matched = terms.filter((term) => normalizedBody.includes(term));
          const coverage = terms.length > 0 ? matched.length / terms.length : 0;
          if (coverage < 0.6 || matched.length < Math.min(2, terms.length)) continue;
          hits.push({
            document,
            score: Math.min(1, 0.55 + coverage * 0.45),
            channel,
            explanation: `Direct evidence matched ${matched.length} query terms.`,
          });
          continue;
        }

        const match = matchAskDocument(
          body,
          channel === "full_text" ? { ...analysis, concepts: [] } : analysis,
          {
          requestedByContact: /\b(asked|requested|wanted|interested|send me|share)\b/i.test(body),
          ownerOwes: /\b(i|we)\s+(owe|promised|need to send|will send)\b/i.test(body),
          },
        );
        if (match.score < 20 || !isGroundedAskObligationMatch(match, analysis)) continue;
        hits.push({
          document,
          score:
            channel === "semantic"
              ? Math.min(1.5, Math.max(0.25, match.score / 100))
              : Math.min(1, Math.max(0.25, match.score / 80)),
          channel,
          explanation:
            channel === "semantic"
              ? "Relationship concepts in the stored evidence match the meaning of the request."
              : "Stored evidence matched the request terms and relationship intent.",
        });
    }
    return hits.sort((left, right) => right.score - left.score).slice(0, limit);
  };

  return [
    {
      channel: "exact",
      async search(query, limit) {
        return search("exact", query, limit);
      },
    },
    {
      channel: "full_text",
      async search(query, limit) {
        return search("full_text", query, limit);
      },
    },
    {
      channel: "semantic",
      async search(query, limit) {
        return search("semantic", query, limit);
      },
    },
  ];
}

export type HybridAskHit = AskEvidenceDocument & {
  score: number;
  channels: AskRetrievalChannel[];
  explanations: string[];
};

export type HybridAskResult = {
  status: "answerable" | "abstain";
  reason: string | null;
  hits: HybridAskHit[];
};

const channelWeight: Record<AskRetrievalChannel, number> = {
  exact: 1.25,
  full_text: 1,
  semantic: 0.85,
};

function validHit(hit: AskRetrievalHit) {
  if (!hit.document.id || !hit.document.text.trim()) return false;
  if (!Number.isFinite(hit.score) || hit.score <= 0) return false;
  if (hit.channel === "semantic" && hit.score < 0.58) return false;
  return true;
}

export async function hybridRetrieveAsk(
  query: string,
  sources: AskRetrievalSource[],
  options: {
    limit?: number;
    minimumScore?: number;
    requireCorroborationBelow?: number;
  } = {},
): Promise<HybridAskResult> {
  const normalized = normalizeAskText(query);
  if (!normalized) {
    return { status: "abstain", reason: "empty_query", hits: [] };
  }
  const limit = Math.min(30, Math.max(1, options.limit ?? 10));
  const rows = await Promise.all(
    sources.map(async (source) => {
      try {
        return await source.search(query, limit * 2);
      } catch {
        return [];
      }
    }),
  );
  const fused = new Map<string, HybridAskHit>();
  rows.flat().filter(validHit).forEach((hit, index) => {
    const contribution =
      channelWeight[hit.channel] * (hit.score + 1 / (60 + index + 1));
    const current = fused.get(hit.document.id);
    if (current) {
      current.score += contribution;
      if (!current.channels.includes(hit.channel)) current.channels.push(hit.channel);
      if (hit.explanation) current.explanations.push(hit.explanation);
      return;
    }
    fused.set(hit.document.id, {
      ...hit.document,
      score: contribution,
      channels: [hit.channel],
      explanations: hit.explanation ? [hit.explanation] : [],
    });
  });

  const hits = [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const minimumScore = options.minimumScore ?? 0.7;
  const corroborationThreshold = options.requireCorroborationBelow ?? 1.1;
  if (hits.length === 0 || hits[0].score < minimumScore) {
    return { status: "abstain", reason: "insufficient_evidence", hits };
  }
  if (
    hits[0].score < corroborationThreshold &&
    hits[0].channels.length < 2
  ) {
    return { status: "abstain", reason: "uncorroborated_evidence", hits };
  }
  return { status: "answerable", reason: null, hits };
}

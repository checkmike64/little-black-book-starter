import type { ModuleKey } from "./modules.js";
import type { ProspectingBucketConfig } from "./prospecting-buckets.js";

export type AskSuggestion = {
  label: string;
  href: string;
  reason: string;
};

type AskSuggestionInput = {
  enabledModules: ModuleKey[];
  prospectingBuckets: ProspectingBucketConfig[];
};

function href({ mode, query }: { mode: string; query?: string }) {
  const params = new URLSearchParams({ mode });
  if (query) params.set("q", query);
  return `/ask?${params.toString()}`;
}

function bucketMode(bucket: ProspectingBucketConfig) {
  const text = `${bucket.name} ${bucket.lane} ${bucket.goal}`.toLowerCase();
  if (/podcast|media|guest/.test(text)) return "podcasts";
  if (/investor|capital|fund/.test(text)) return "investors";
  if (/m&a|acquisition|deal/.test(text)) return "ma";
  if (/referral|partner|intro/.test(text)) return "referrals";
  return "search";
}

function bucketQuery(bucket: ProspectingBucketConfig) {
  if (bucket.lane && bucket.lane.length > 2) return bucket.lane;
  return bucket.name;
}

export function buildAskSuggestions({
  enabledModules,
  prospectingBuckets,
}: AskSuggestionInput) {
  const enabled = new Set(enabledModules);
  const suggestions: AskSuggestion[] = [
    {
      label: "Who should I reconnect with this week?",
      href: href({ mode: "stale" }),
      reason: "Find useful relationships that are cooling off.",
    },
  ];

  if (enabled.has("networking")) {
    suggestions.push(
      {
        label: "Who can make a useful intro right now?",
        href: href({ mode: "referrals", query: "intro referral warm path" }),
        reason: "Turn stored relationship context into warm paths.",
      },
      {
        label: "Who has an open ask or promise?",
        href: href({ mode: "asks" }),
        reason: "Find active loops that should become follow-through.",
      },
    );
  }

  if (enabled.has("engagement")) {
    suggestions.push({
      label: "Which valuable contacts need a light touch?",
      href: href({ mode: "stale", query: "trusted warm useful" }),
      reason: "Protect relationship warmth without turning it into a campaign.",
    });
  }

  if (enabled.has("want_to_know")) {
    for (const bucket of prospectingBuckets.slice(0, 4)) {
      const mode = bucketMode(bucket);
      suggestions.push({
        label: `Find paths for ${bucket.name}`,
        href: href({
          mode,
          query: mode === "search" ? bucketQuery(bucket) : bucket.look_for || bucketQuery(bucket),
        }),
        reason: bucket.goal || "Use the configured prospecting bucket.",
      });
    }
  }

  const unique = new Map<string, AskSuggestion>();
  for (const suggestion of suggestions) {
    unique.set(suggestion.href, suggestion);
  }

  return Array.from(unique.values()).slice(0, 8);
}

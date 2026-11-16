import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildAskSuggestions } from "../lib/ask-suggestions.js";

const buckets = [
  {
    name: "Podcast hosts",
    goal: "Earn high-context guest spots.",
    look_for: "recent episode gaps",
    intensity: "Medium" as const,
    lane: "podcast",
  },
  {
    name: "Acquisition targets",
    goal: "Research fit before outreach.",
    look_for: "ownership and succession signals",
    intensity: "High" as const,
    lane: "M&A",
  },
];

describe("Ask suggestions", () => {
  test("builds launch-friendly defaults without prospecting enabled", () => {
    const suggestions = buildAskSuggestions({
      enabledModules: ["networking", "engagement"],
      prospectingBuckets: buckets,
    });

    assert.ok(
      suggestions.some((suggestion) => suggestion.href.includes("mode=referrals")),
    );
    assert.ok(!suggestions.some((suggestion) => suggestion.label.includes("Podcast hosts")));
  });

  test("uses configured prospecting buckets when Want to Know is enabled", () => {
    const suggestions = buildAskSuggestions({
      enabledModules: ["want_to_know"],
      prospectingBuckets: buckets,
    });

    assert.ok(
      suggestions.some(
        (suggestion) =>
          suggestion.label.includes("Podcast hosts") &&
          suggestion.href.includes("mode=podcasts"),
      ),
    );
    assert.ok(
      suggestions.some(
        (suggestion) =>
          suggestion.label.includes("Acquisition targets") &&
          suggestion.href.includes("mode=ma"),
      ),
    );
  });
});

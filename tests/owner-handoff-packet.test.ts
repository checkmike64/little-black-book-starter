import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildOwnerHandoffPacket,
  formatOwnerHandoffPacket,
  ownerHandoffPacketFileName,
  type OwnerHandoffPacketInput,
} from "../lib/owner-handoff-packet.js";

function input(
  overrides: Partial<OwnerHandoffPacketInput> = {},
): OwnerHandoffPacketInput {
  return {
    tenantName: "Moll Group",
    generatedAt: "2026-07-20T15:00:00.000Z",
    launchStatus: "Ready",
    launchCompleted: 13,
    launchTotal: 13,
    enabledModules: [
      {
        label: "Ask",
        operatingUse: "Query the Book across people, asks, promises, and notes.",
      },
      {
        label: "Want to Know",
        operatingUse: "Track podcast hosts and other configured prospecting buckets.",
      },
    ],
    contactCount: 88,
    qualityAverage: 91,
    weakRecordCount: 0,
    highValueWeakCount: 0,
    pendingReviewCount: 0,
    askRunCount: 4,
    askRunUndecidedCount: 0,
    startingPoints: [
      {
        label: "Open the Book",
        detail: "Review the people and useful next moves already loaded.",
        href: "/contacts",
      },
      {
        label: "Ask a relationship question",
        detail: "Search across relationship context.",
        href: "/ask",
      },
    ],
    walkthroughSteps: [
      {
        label: "Start on Today",
        detail: "Open the dashboard and review the private operating surface.",
        href: "/dashboard",
        status: "pass",
      },
      {
        label: "Review one relationship",
        detail: "Open one contact and inspect context, notes, and next moves.",
        href: "/contacts",
        status: "pass",
      },
    ],
    launchNotes: "Start with the Book, then Ask, then proposed updates.",
    ...overrides,
  };
}

describe("owner handoff packet", () => {
  test("marks clean launch evidence ready for owner use", () => {
    const packet = buildOwnerHandoffPacket(input());

    assert.equal(packet.readyForOwnerUse, true);
    assert.equal(packet.attentionItems.length, 0);
  });

  test("surfaces owner-facing review and quality attention items", () => {
    const packet = buildOwnerHandoffPacket(
      input({
        pendingReviewCount: 3,
        highValueWeakCount: 2,
        askRunUndecidedCount: 1,
      }),
    );

    assert.equal(packet.readyForOwnerUse, false);
    assert.deepEqual(
      packet.attentionItems.map((item) => item.label),
      [
        "Review proposed updates",
        "Verify high-value relationships",
        "Close saved Ask decisions",
      ],
    );
  });

  test("formats a concise owner-safe packet", () => {
    const text = formatOwnerHandoffPacket(buildOwnerHandoffPacket(input()));

    assert.match(text, /Little Black Book Owner Handoff: Moll Group/);
    assert.match(text, /Private access:/);
    assert.match(text, /Enabled workflows:/);
    assert.match(text, /Ask: Query the Book/);
    assert.match(text, /1\. Open the Book/);
    assert.match(text, /First walkthrough:/);
    assert.match(text, /1\. Start on Today - pass/);
    assert.match(text, /Start with the Book/);
    assert.doesNotMatch(
      text,
      /service-role|CLAUDE_WRITE_TOKEN|endpoint contract|secret key|Vercel|Supabase/i,
    );
  });

  test("creates a stable owner packet filename", () => {
    assert.equal(
      ownerHandoffPacketFileName("Alex / Demo Client!"),
      "alex-demo-client-owner-handoff.txt",
    );
  });
});

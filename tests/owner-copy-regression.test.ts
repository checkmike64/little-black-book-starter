import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const files = [
  "app/(portal)/admin-mode-toggle.tsx",
  "app/(portal)/ask/page.tsx",
  "app/(portal)/changes/page.tsx",
  "app/(portal)/changes/[id]/page.tsx",
  "app/(portal)/contacts/page.tsx",
  "app/(portal)/contacts/[id]/page.tsx",
  "app/(portal)/dashboard/page.tsx",
  "app/(portal)/engagement/page.tsx",
  "app/(portal)/layout.tsx",
  "app/(portal)/movement/page.tsx",
  "app/(portal)/movement/relationship-command-shortcut-form.tsx",
  "app/(portal)/networking/page.tsx",
  "app/(portal)/promises/page.tsx",
  "app/(portal)/want-to-know/page.tsx",
  "lib/engagement-action-defaults.ts",
  "lib/movement-source-mix.ts",
];

const removedOwnerPhrases = [
  "Ask Claude to work this",
  "Queue handoff",
  "Queue Claude handoff",
  "Queue follow-through handoff",
  "Queue referral handoff",
  "Queue podcast handoff",
  "Queue rewarm handoff",
  "Queue touch handoff",
  "Use Claude for draft language",
  "Claude interaction ingestion",
  "Payload review",
  "unsupported payload keys",
  "Unsupported payload keys",
  "Supported fields:",
  "Unsupported keys:",
  "Approval workflow pending",
  "before launch",
  "Claude command:",
  "Claude command output",
  "Claude payload drift",
  "Ask Claude to prepare",
  "Ask Claude to inspect",
  "available for this install",
  "core workflow",
  "normal owner-style navigation",
  "Private relationship workspace",
  "security posture",
  "Daily goal met",
  "completed today",
  "Propose a different introduction",
  "Introductions in progress",
  "Owner-safe",
  "Confidence rules",
  "Trust loops",
  "Generated work",
  "operating loops",
  "trust debt",
];

describe("owner copy regression", () => {
  test("keeps removed setup and implementation phrases out of owner surfaces", () => {
    const source = files
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    for (const phrase of removedOwnerPhrases) {
      assert.equal(source.includes(phrase), false, phrase);
    }
  });

  test("keeps Today factual and leaves owner work on its dedicated pages", () => {
    const source = readFileSync("app/(portal)/dashboard/page.tsx", "utf8");

    for (const phrase of [
      "Top priority",
      "Worth Knowing",
      "Open commitments",
      "Relationship movement",
      "Open engagement",
    ]) {
      assert.equal(source.includes(phrase), false, phrase);
    }
    assert.doesNotMatch(source, /buildTodayAttention/);
    assert.doesNotMatch(source, /View Changes/);
    assert.doesNotMatch(source, /Promises/);
    assert.match(source, /People to place/);
    assert.match(source, /id="upcoming-title">Coming up/);
    assert.doesNotMatch(source, /Who should enter your Book\?/);
    assert.match(source, /Add to Book/);
    assert.match(source, />Ask the Book</);
    assert.doesNotMatch(source, /Google|Gmail|Reconnect calendar|Connect calendar|Open calendar/);
    assert.doesNotMatch(source, /syncCalendarNow/);
    assert.doesNotMatch(source, /disconnectCalendar/);
    assert.doesNotMatch(source, /Run the Claude calendar refresh/);
  });
});

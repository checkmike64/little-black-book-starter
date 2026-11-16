import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const page = readFileSync("app/(portal)/dashboard/page.tsx", "utf8");
const data = readFileSync("lib/dashboard/data.ts", "utf8");

describe("Today owner workflow", () => {
  test("keeps Today focused on people and meeting preparation", () => {
    assert.match(page, /People to place/);
    assert.match(page, /id="upcoming-title">Coming up/);
    assert.match(page, /<summary>Recent activity<\/summary>/);
    assert.match(page, /recentCutoff/);
    assert.doesNotMatch(page, /Your three moves/);
    assert.doesNotMatch(page, /buildTodayQueueSummary/);
    assert.doesNotMatch(page, /getNetworkingData/);
    assert.doesNotMatch(page, /getEngagementData/);
    assert.doesNotMatch(page, /getTodayActionData/);
    assert.doesNotMatch(page, /buildTodayAttention/);
    assert.doesNotMatch(page, /View Changes/);
    assert.doesNotMatch(page, /item.*to review/);
  });

  test("supports one clean membership decision for recently met people", () => {
    assert.match(page, /Add to Book/);
    assert.match(page, /Want to Know/);
    assert.match(page, /name="purpose" required/);
    assert.match(page, /Choose purpose/);
    assert.match(page, /Not for the Book/);
    assert.match(page, /decideCalendarAttendee/);
    assert.match(page, /recentlyMet\.length > 0/);
    assert.doesNotMatch(page, /No people need placement from the last three days/);
  });

  test("puts factual preparation inside each upcoming meeting", () => {
    assert.match(page, /Preparation/);
    assert.match(page, /briefing\?\.opportunities/);
    assert.match(page, /briefing\?\.their_asks/);
    assert.match(page, /briefing\?\.whats_new/);
    assert.match(page, />Ask the Book</);
    assert.match(page, /Use only relationship history, current asks, promises, and verified profile facts/);
  });

  test("loads Claude-supplied meeting context without promise or change queues", () => {
    const todayLoader = data.slice(data.indexOf("export async function getTodayData"));
    assert.match(todayLoader, /\.from\("calendar_events"\)/);
    assert.match(todayLoader, /\.eq\("provider", "claude_calendar"\)/);
    assert.match(todayLoader, /\.from\("calendar_attendee_preferences"\)/);
    assert.doesNotMatch(todayLoader, /\.from\("promises"\)/);
    assert.doesNotMatch(todayLoader, /\.from\("pending_changes"\)/);
    assert.doesNotMatch(todayLoader, /\.from\("relationship_actions"\)/);
    assert.match(todayLoader, /\.from\("interactions"\)/);
    assert.doesNotMatch(todayLoader, /\.from\("integration_connections"\)/);
    assert.doesNotMatch(todayLoader, /\.from\("connections"\)/);
  });

  test("does not expose direct account connection or freshness controls", () => {
    assert.doesNotMatch(page, /Google|Gmail|Reconnect calendar|Connect calendar|Open calendar/);
    assert.doesNotMatch(page, /\/api\/integrations\/google/);
    assert.doesNotMatch(data, /google_calendar/);
  });
});

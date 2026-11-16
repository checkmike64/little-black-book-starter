import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const interfaceFiles = [
  "app/(portal)/dashboard/page.tsx",
  "app/(portal)/networking/page.tsx",
  "app/(portal)/recordings/page.tsx",
  "app/(portal)/settings/page.tsx",
  "app/(portal)/support/page.tsx",
  "app/(portal)/contacts/[id]/page.tsx",
  "app/(portal)/claude-setup/page.tsx",
];

const retiredRoutes = [
  "app/api/integrations/google/calendar/connect/route.ts",
  "app/api/integrations/google/calendar/callback/route.ts",
  "app/api/integrations/google/gmail/connect/route.ts",
  "app/api/integrations/google/gmail/callback/route.ts",
];

test("keeps direct Google, Gmail, and Calendar integration out of the interface", () => {
  const source = interfaceFiles.map((file) => readFileSync(file, "utf8")).join("\n");
  const loadNotice = readFileSync("app/(portal)/data-load-notice.tsx", "utf8");

  assert.doesNotMatch(source, /Google|Gmail|Reconnect calendar|Connect calendar|Open calendar/);
  assert.doesNotMatch(source, /\/api\/integrations\/google/);
  assert.match(source, /Copy this draft into the email service you use\./);
  assert.match(loadNotice, /Ask your concierge team to refresh this Book in Claude\./);
});

test("removes direct provider routes, scheduled sync, and install configuration", () => {
  for (const route of retiredRoutes) assert.equal(existsSync(route), false, route);

  const daily = readFileSync("app/api/automation/daily/route.ts", "utf8");
  const environment = readFileSync("lib/deployment-environment.ts", "utf8");
  const example = readFileSync(".env.example", "utf8");
  const todayData = readFileSync("lib/dashboard/data.ts", "utf8");

  assert.doesNotMatch(daily, /google_calendar|syncGoogleCalendarConnection/);
  assert.doesNotMatch(environment, /GOOGLE_CLIENT|GOOGLE_REDIRECT|GOOGLE_GMAIL/);
  assert.doesNotMatch(example, /GOOGLE_CLIENT|GOOGLE_REDIRECT|GOOGLE_GMAIL/);
  assert.match(todayData, /\.eq\("provider", "claude_calendar"\)/);
  assert.doesNotMatch(todayData, /\.in\("provider", \["google_calendar"/);
});

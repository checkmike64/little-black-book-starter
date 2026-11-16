import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

describe("product readiness owner interface", () => {
  test("keeps owner navigation focused and groups implementation tools", () => {
    const source = readFileSync("app/(portal)/portal-nav.tsx", "utf8");

    assert.match(source, /ownerNavigationModuleKeys\.includes\(module\.key\)/);
    assert.match(source, /const coreNav:[\s\S]*?Today[\s\S]*?My Book/);
    assert.doesNotMatch(
      source.match(/const coreNav:[\s\S]*?\];/)?.[0] ?? "",
      /Recordings|Ask|Scoreboard/,
    );
    assert.match(
      source.match(/const operatorNav:[\s\S]*?\];/)?.[0] ?? "",
      /Recordings/,
    );
    assert.match(source, /nav-management/);
    assert.match(source, />\s*Management\s*</);
  });

  test("bounds My Book results while keeping live searches URL-addressable", () => {
    const source = readFileSync("app/(portal)/contacts/book-live-search.tsx", "utf8");

    assert.match(source, /const pageSize = 25/);
    assert.match(source, /visibleContacts\.slice\(pageStart, pageStart \+ pageSize\)/);
    assert.match(source, /searchParams\.set\("q", cleaned\)/);
    assert.match(source, /Show next/);
  });

  test("does not require an email to be typed twice after code delivery", () => {
    const page = readFileSync("app/login/page.tsx", "utf8");
    const actions = readFileSync("app/login/actions.ts", "utf8");

    assert.match(page, /type="hidden" name="email" value=\{email\}/);
    assert.match(page, /Enter the latest code sent to/);
    assert.match(actions, /loginPathWithEmail\("check-email", next, email\)/);
  });

  test("gives owners a plain-language privacy and data route", () => {
    const layout = readFileSync("app/(portal)/layout.tsx", "utf8");
    const privacy = readFileSync("app/(portal)/privacy/page.tsx", "utf8");

    assert.match(layout, />Privacy<\/Link>/);
    assert.match(privacy, /Who can see it/);
    assert.match(privacy, /Copies and removal/);
  });

  test("keeps initial support requests free of relationship content", () => {
    const support = readFileSync("app/(portal)/support/page.tsx", "utf8");

    assert.match(support, /page or feature/);
    assert.match(support, /date and time/);
    assert.match(support, /Do not include contact names, relationship details/);
    assert.doesNotMatch(support, /person or page involved/);
  });

  test("compresses empty operational surfaces and clarifies profile metrics", () => {
    const promises = readFileSync("app/(portal)/promises/page.tsx", "utf8");
    const prospects = readFileSync("app/(portal)/want-to-know/page.tsx", "utf8");

    assert.match(promises, /No commitments are waiting/);
    assert.match(prospects, /Outer ring clear/);
  });
});

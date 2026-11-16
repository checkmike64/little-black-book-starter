import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const controls = readFileSync(
  "app/(portal)/want-to-know/want-to-know-controls.tsx",
  "utf8",
);
const navigator = readFileSync(
  "app/(portal)/want-to-know/relationship-plan-navigator.tsx",
  "utf8",
);
const styles = readFileSync(
  "app/(portal)/want-to-know/want-to-know-controls.module.css",
  "utf8",
);

describe("Want to Know owner interactions", () => {
  test("coordinates every Plan and More surface through one open id", () => {
    assert.match(controls, /WantToKnowDisclosureProvider/);
    assert.match(controls, /const \[openId, setOpenId\]/);
    assert.match(controls, /const next = current === id \? null : id/);
    assert.match(controls, /const planId = `\$\{id\}:plan`/);
    assert.match(controls, /const moreId = `\$\{id\}:more`/);
  });

  test("light-dismisses, handles Escape, and returns focus to the trigger", () => {
    assert.match(controls, /document\.addEventListener\("click"/);
    assert.doesNotMatch(controls, /document\.addEventListener\("pointerdown"/);
    assert.match(controls, /document\.addEventListener\("focusin"/);
    assert.match(controls, /window\.requestAnimationFrame/);
    assert.match(controls, /openIdRef\.current !== leavingId/);
    assert.match(controls, /if \(triggerIdFor\(event\.target\)\) return/);
    assert.match(controls, /trigger\.contains\(target\)/);
    assert.match(controls, /event\.key !== "Escape"/);
    assert.match(controls, /close\(true\)/);
    assert.match(controls, /triggers\.current\.get\(closingId\)\?\.focus\(\)/);
  });

  test("exposes disclosure state and panel ownership to assistive technology", () => {
    assert.match(controls, /aria-controls=\{controls\}/);
    assert.match(controls, /aria-expanded=\{open\}/);
    assert.match(controls, /aria-label=\{`\$\{openPanel/);
  });

  test("turns relationship categories into genuine navigation", () => {
    assert.match(navigator, /<nav aria-label=\{label\}/);
    assert.match(navigator, /aria-current=\{active \? "page" : undefined\}/);
    assert.match(navigator, /href=\{item\.href\}/);
  });

  test("uses inline panels and touch-safe controls on narrow screens", () => {
    assert.match(styles, /\.actionRail > \.panel \{/);
    assert.match(styles, /justify-self: end;/);
    assert.match(styles, /@media \(max-width: 760px\)/);
    assert.match(styles, /height: 44px/);
    assert.match(styles, /position: static/);
    assert.match(styles, /prefers-reduced-motion: reduce/);
  });
});

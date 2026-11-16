import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildOwnerSurfaceAudit } from "../lib/owner-surface-audit.js";
import type { OwnerPreviewNavItem } from "../lib/owner-launch-preview.js";

const ownerNav = [
  { label: "Today", href: "/dashboard", kind: "core" },
  { label: "My Book", href: "/contacts", kind: "core" },
  { label: "Next Moves", href: "/movement", kind: "utility" },
  { label: "Changes", href: "/changes", kind: "utility" },
] satisfies OwnerPreviewNavItem[];

describe("owner surface audit", () => {
  test("passes when operator tooling is hidden and owner review is concentrated", () => {
    const audit = buildOwnerSurfaceAudit({
      ownerNav,
      hiddenOperatorTools: ["Ops", "Launch", "Settings"],
      enabledModules: ["ask"],
      adminModeDefault: false,
      reviewSurface: "changes_only",
    });

    assert.equal(audit.ready, true);
    assert.match(audit.summary, /ready/);
  });

  test("flags admin mode defaults and leaked operator navigation", () => {
    const audit = buildOwnerSurfaceAudit({
      ownerNav: [...ownerNav, { label: "Ops", href: "/ops", kind: "utility" }],
      hiddenOperatorTools: ["Ops", "Launch", "Settings"],
      enabledModules: ["ask"],
      adminModeDefault: true,
      reviewSurface: "changes_only",
    });

    assert.equal(audit.ready, false);
    assert.deepEqual(
      audit.items
        .filter((item) => item.status === "review")
        .map((item) => item.key),
      [
        "default-owner-mode",
        "operator-tools-hidden",
        "operator-deep-links-hidden",
      ],
    );
  });

  test("flags mismatched module navigation and review surface setup", () => {
    const audit = buildOwnerSurfaceAudit({
      ownerNav,
      hiddenOperatorTools: ["Ops"],
      enabledModules: ["ask", "networking"],
      adminModeDefault: false,
      reviewSurface: "self_serve_intake",
    });

    assert.equal(audit.ready, false);
    assert.deepEqual(
      audit.items
        .filter((item) => item.status === "review")
        .map((item) => item.key),
      ["module-nav-matches-install", "review-surface"],
    );
  });

  test("flags hidden operator deep links in owner-visible surfaces", () => {
    const audit = buildOwnerSurfaceAudit({
      ownerNav,
      hiddenOperatorTools: ["Ops"],
      enabledModules: ["ask"],
      adminModeDefault: false,
      reviewSurface: "changes_only",
      ownerHrefs: ["/contacts/new", "/claude-setup/packet"],
    });

    assert.equal(audit.ready, false);
    assert.ok(
      audit.items
        .filter((item) => item.status === "review")
        .some((item) => item.key === "operator-deep-links-hidden"),
    );
  });
});

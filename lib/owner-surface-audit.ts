import { ownerNavigationModuleKeys, type ModuleKey } from "./modules.ts";
import type { OwnerPreviewNavItem } from "./owner-launch-preview.js";
import { isOwnerForbiddenHref } from "../runtime/owner-route-policy.js";

export type OwnerSurfaceAuditItem = {
  key: string;
  label: string;
  detail: string;
  status: "pass" | "review";
  href: string;
};

export type OwnerSurfaceAuditInput = {
  ownerNav: OwnerPreviewNavItem[];
  hiddenOperatorTools: string[];
  enabledModules: ModuleKey[];
  adminModeDefault: boolean;
  reviewSurface: string;
  ownerHrefs?: string[];
};

export type OwnerSurfaceAudit = {
  ready: boolean;
  summary: string;
  items: OwnerSurfaceAuditItem[];
};

function item({
  detail,
  href,
  key,
  label,
  passes,
}: {
  detail: string;
  href: string;
  key: string;
  label: string;
  passes: boolean;
}): OwnerSurfaceAuditItem {
  return {
    key,
    label,
    detail,
    href,
    status: passes ? "pass" : "review",
  };
}

export function buildOwnerSurfaceAudit(
  input: OwnerSurfaceAuditInput,
): OwnerSurfaceAudit {
  const navLabels = new Set(input.ownerNav.map((nav) => nav.label));
  const ownerHrefs = Array.from(
    new Set([...input.ownerNav.map((nav) => nav.href), ...(input.ownerHrefs ?? [])]),
  );
  const hiddenLeak = input.hiddenOperatorTools.filter((label) => navLabels.has(label));
  const forbiddenHrefLeak = ownerHrefs.filter(isOwnerForbiddenHref);
  const visibleModuleCount = input.ownerNav.filter((nav) => nav.kind === "module").length;
  const hasCoreBook = navLabels.has("Today") && navLabels.has("My Book");
  const hasReviewSurface = navLabels.has("Changes");
  const expectedModuleCount = input.enabledModules.filter((module) =>
    ownerNavigationModuleKeys.includes(module),
  ).length;

  const items = [
    item({
      key: "default-owner-mode",
      label: "Default experience is owner mode",
      detail: input.adminModeDefault
        ? "Admin tools are currently the default. Hide them before client handoff."
        : "Operator accounts open into the same focused Book experience unless admin tools are explicitly shown.",
      href: "/dashboard",
      passes: !input.adminModeDefault,
    }),
    item({
      key: "operator-tools-hidden",
      label: "Operator tools stay hidden",
      detail: hiddenLeak.length
        ? `${hiddenLeak.join(", ")} appear in owner navigation.`
        : `${input.hiddenOperatorTools.length} operator-only tools are withheld from owner navigation.`,
      href: "/launch/preview",
      passes: hiddenLeak.length === 0,
    }),
    item({
      key: "operator-deep-links-hidden",
      label: "Operator deep links stay hidden",
      detail: forbiddenHrefLeak.length
        ? `${forbiddenHrefLeak.join(", ")} appear in owner-visible links.`
        : "Owner-visible links avoid operator-only routes and manual intake surfaces.",
      href: "/launch/preview",
      passes: forbiddenHrefLeak.length === 0,
    }),
    item({
      key: "core-book-visible",
      label: "Core Book is visible",
      detail: hasCoreBook
        ? "Today and My Book are present as the everyday starting points."
        : "Today and My Book should both be visible before handoff.",
      href: "/dashboard",
      passes: hasCoreBook,
    }),
    item({
      key: "module-nav-matches-install",
      label: "Workflow navigation matches install",
      detail:
        visibleModuleCount === expectedModuleCount
          ? `${visibleModuleCount} enabled workflow${visibleModuleCount === 1 ? "" : "s"} are visible.`
          : `${visibleModuleCount} visible workflow${visibleModuleCount === 1 ? "" : "s"} for ${expectedModuleCount} enabled module${expectedModuleCount === 1 ? "" : "s"}.`,
      href: "/settings",
      passes: visibleModuleCount === expectedModuleCount,
    }),
    item({
      key: "review-surface",
      label: "Review surface is available",
      detail:
        input.reviewSurface === "changes_only"
          ? "Owner review is concentrated in Changes, keeping setup and intake out of view."
          : `Review surface is configured as ${input.reviewSurface || "unset"}.`,
      href: "/changes",
      passes: hasReviewSurface && input.reviewSurface === "changes_only",
    }),
  ];

  const ready = items.every((auditItem) => auditItem.status === "pass");
  const reviewCount = items.length - items.filter((auditItem) => auditItem.status === "pass").length;

  return {
    ready,
    summary: ready
      ? "Owner/admin separation is ready for handoff."
      : `${reviewCount} owner/admin separation check${reviewCount === 1 ? "" : "s"} need attention.`,
    items,
  };
}

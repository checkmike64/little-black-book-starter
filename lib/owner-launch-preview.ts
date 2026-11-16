import { ownerNavigationModuleKeys, type ModuleKey } from "./modules.ts";
import { ownerSafeHrefs } from "../runtime/owner-route-policy.js";

export type OwnerPreviewMetric = {
  label: string;
  value: string;
  tone: "ok" | "warn" | "neutral";
  detail: string;
};

export type OwnerPreviewNavItem = {
  label: string;
  href: string;
  kind: "core" | "module" | "utility";
};

export type OwnerPreviewAction = {
  label: string;
  detail: string;
  href: string;
  tone: "primary" | "review" | "neutral";
};

export type OwnerDemoStep = {
  step: number;
  label: string;
  detail: string;
  href: string;
  status: "pass" | "action" | "waiting";
};

export type OwnerLaunchPreviewInput = {
  tenantName: string;
  enabledModules: ModuleKey[];
  contactCount: number;
  pendingReviewCount: number;
  openActionCount: number;
  openPromiseCount: number;
  askRunCount: number;
  askRunUndecidedCount: number;
  launchStatus: string;
  launchCompleted: number;
  launchTotal: number;
};

export type OwnerLaunchPreview = {
  tenantName: string;
  ready: boolean;
  ownerNav: OwnerPreviewNavItem[];
  ownerHrefs: string[];
  hiddenOperatorTools: string[];
  metrics: OwnerPreviewMetric[];
  firstUseActions: OwnerPreviewAction[];
  demoSteps: OwnerDemoStep[];
};

const coreNav: OwnerPreviewNavItem[] = [
  { label: "Today", href: "/dashboard", kind: "core" },
  { label: "My Book", href: "/contacts", kind: "core" },
];

const ownerFeatureNav = [
  { key: "networking", label: "Networking", href: "/networking" },
  { key: "engagement", label: "Engagement", href: "/engagement" },
  { key: "want_to_know", label: "Want to Know", href: "/want-to-know" },
] satisfies Array<{ key: ModuleKey; label: string; href: string }>;

const hiddenOperatorTools = [
  "Client Intake",
  "Client Admin",
  "Recordings",
  "Claude Setup",
  "Ops",
  "Quality",
  "Launch",
  "Deployment",
  "Export",
  "Settings",
];

function moduleNav(enabledModules: ModuleKey[]) {
  const enabled = new Set(enabledModules);

  return ownerFeatureNav
    .filter(
      (module) =>
        enabled.has(module.key) && ownerNavigationModuleKeys.includes(module.key),
    )
    .map((module) => ({
      label: module.label,
      href: module.href,
      kind: "module" as const,
    }));
}

function utilityNav(enabledModules: ModuleKey[]) {
  const enabled = new Set(enabledModules);
  const items: OwnerPreviewNavItem[] = [
    { label: "Next Moves", href: "/movement", kind: "utility" },
    { label: "Changes", href: "/changes", kind: "utility" },
  ];

  if (enabled.has("networking")) {
    items.splice(1, 0, {
      label: "Promises",
      href: "/promises",
      kind: "utility",
    });
  }

  return items;
}

function metricTone(passes: boolean, neutralWhenFalse = false): OwnerPreviewMetric["tone"] {
  if (passes) return "ok";
  return neutralWhenFalse ? "neutral" : "warn";
}

function firstUseActions(input: OwnerLaunchPreviewInput): OwnerPreviewAction[] {
  const actions: OwnerPreviewAction[] = [
    {
      label: "Review the Book",
      detail:
        input.contactCount > 0
          ? `Start with ${input.contactCount} visible contact${
              input.contactCount === 1 ? "" : "s"
            } and scan the highest-value relationship context.`
          : "Add verified contacts before the owner starts using the Book.",
      href: "/contacts",
      tone: "primary",
    },
  ];

  if (input.pendingReviewCount > 0) {
    actions.push({
      label: "Approve proposed updates",
      detail: `${input.pendingReviewCount} proposed update${
        input.pendingReviewCount === 1 ? "" : "s"
      } need owner or operator approval before they become trusted data.`,
      href: "/changes",
      tone: "review",
    });
  }

  if (input.enabledModules.includes("ask")) {
    actions.push({
      label: "Ask the Book",
      detail:
        input.askRunCount > 0
          ? "Run a practical relationship query and save any follow-up decision."
          : "Run one practical query to prove the owner can search across relationship context.",
      href: "/ask",
      tone: input.askRunUndecidedCount > 0 ? "review" : "primary",
    });
  }

  if (input.openActionCount > 0) {
    actions.push({
      label: "Work next moves",
      detail: `${input.openActionCount} open relationship action${
        input.openActionCount === 1 ? "" : "s"
      } are ready to inspect or close.`,
      href: "/movement",
      tone: "neutral",
    });
  }

  if (input.openPromiseCount > 0 && input.enabledModules.includes("networking")) {
    actions.push({
      label: "Check promises",
      detail: `${input.openPromiseCount} open promise${
        input.openPromiseCount === 1 ? "" : "s"
      } should be monitored so trust loops stay clean.`,
      href: "/promises",
      tone: "neutral",
    });
  }

  if (input.enabledModules.includes("want_to_know")) {
    actions.push({
      label: "Review prospecting buckets",
      detail:
        "Use Want to Know for podcast hosts, investors, partners, or whatever prospecting bucket this install is configured around.",
      href: "/want-to-know",
      tone: "neutral",
    });
  }

  return actions.slice(0, 6);
}

function buildOwnerDemoSteps(input: OwnerLaunchPreviewInput): OwnerDemoStep[] {
  const steps: Omit<OwnerDemoStep, "step">[] = [
    {
      label: "Start on Today",
      detail:
        input.contactCount > 0
          ? "Open the dashboard and confirm the owner sees a private operating surface instead of setup controls."
          : "Wait until contacts are added so the first screen has real relationship context.",
      href: "/dashboard",
      status: input.contactCount > 0 ? "pass" : "waiting",
    },
    {
      label: "Review one relationship",
      detail:
        input.contactCount > 0
          ? "Open My Book, choose a real contact, and inspect context, notes, promises, and next moves."
          : "Add a real contact before using the owner walkthrough.",
      href: "/contacts",
      status: input.contactCount > 0 ? "pass" : "waiting",
    },
  ];

  if (input.enabledModules.includes("ask")) {
    steps.push({
      label: "Ask a week-one question",
      detail:
        input.askRunCount > 0 && input.askRunUndecidedCount === 0
          ? "Run or replay a practical Ask query and show the saved decision trail."
          : input.askRunUndecidedCount > 0
            ? "Open the saved Ask run and mark the follow-up or no-action decision."
            : "Run one representative query before handoff so the owner sees useful answers immediately.",
      href: input.askRunUndecidedCount > 0 ? "/ask?saved=needs_decision" : "/ask",
      status:
        input.askRunCount > 0 && input.askRunUndecidedCount === 0
          ? "pass"
          : input.contactCount > 0
            ? "action"
            : "waiting",
    });
  }

  steps.push({
    label:
      input.pendingReviewCount > 0
        ? "Review proposed updates"
        : "Confirm review queue is clear",
    detail:
      input.pendingReviewCount > 0
        ? `${input.pendingReviewCount} proposed update${
            input.pendingReviewCount === 1 ? "" : "s"
          } should be approved, edited, or dismissed before trust-sensitive use.`
        : "Show that Claude-suggested changes stay reviewable and the current queue is clear.",
    href: "/changes",
    status: input.pendingReviewCount > 0 ? "action" : "pass",
  });

  if (input.openActionCount > 0) {
    steps.push({
      label: "Close or inspect one next move",
      detail: `${input.openActionCount} open relationship action${
        input.openActionCount === 1 ? "" : "s"
      } can be used to demonstrate follow-through.`,
      href: "/movement",
      status: "action",
    });
  }

  if (input.enabledModules.includes("want_to_know")) {
    steps.push({
      label: "Show the prospecting bucket",
      detail:
        "Open Want to Know and explain the client-specific bucket label, such as podcast hosts, investors, targets, or partners.",
      href: "/want-to-know",
      status: input.contactCount > 0 ? "pass" : "waiting",
    });
  }

  if (input.openPromiseCount > 0 && input.enabledModules.includes("networking")) {
    steps.push({
      label: "Review open promises",
      detail: `${input.openPromiseCount} open promise${
        input.openPromiseCount === 1 ? " is" : "s are"
      } available for follow-through.`,
      href: "/promises",
      status: "action",
    });
  }

  return steps.slice(0, 7).map((step, index) => ({
    ...step,
    step: index + 1,
  }));
}

export function buildOwnerLaunchPreview(
  input: OwnerLaunchPreviewInput,
): OwnerLaunchPreview {
  const ready =
    input.contactCount > 0 &&
    input.pendingReviewCount === 0 &&
    input.askRunUndecidedCount === 0 &&
    input.launchCompleted === input.launchTotal;

  const ownerNav = [
    ...coreNav,
    ...moduleNav(input.enabledModules),
    ...utilityNav(input.enabledModules),
  ];
  const firstActions = firstUseActions(input);
  const demoSteps = buildOwnerDemoSteps(input);
  const ownerHrefs = ownerSafeHrefs([
    ...ownerNav.map((item) => item.href),
    ...firstActions.map((action) => action.href),
    ...demoSteps.map((step) => step.href),
  ]);

  return {
    tenantName: input.tenantName,
    ready,
    ownerNav,
    ownerHrefs,
    hiddenOperatorTools,
    metrics: [
      {
        label: "Launch status",
        value: input.launchStatus,
        tone: metricTone(input.launchCompleted === input.launchTotal),
        detail: `${input.launchCompleted}/${input.launchTotal} launch checks are complete.`,
      },
      {
        label: "Visible contacts",
        value: String(input.contactCount),
        tone: metricTone(input.contactCount > 0),
        detail: "Owner-facing contact records available in the Book.",
      },
      {
        label: "Proposed updates",
        value: String(input.pendingReviewCount),
        tone: metricTone(input.pendingReviewCount === 0),
        detail: "Judgment-heavy changes should be reviewed before trust-sensitive use.",
      },
      {
        label: "Open next moves",
        value: String(input.openActionCount),
        tone: metricTone(input.openActionCount > 0, true),
        detail: "Tracked relationship actions visible to the owner.",
      },
      {
        label: "Saved Ask runs",
        value: String(input.askRunCount),
        tone: metricTone(input.askRunCount > 0, true),
        detail:
          input.askRunUndecidedCount > 0
            ? `${input.askRunUndecidedCount} saved Ask run needs a decision.`
            : "Saved queries are decision-tracked when the owner uses Ask.",
      },
    ],
    firstUseActions: firstActions,
    demoSteps,
  };
}

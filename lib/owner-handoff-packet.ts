export type OwnerHandoffModule = {
  label: string;
  operatingUse: string;
};

export type OwnerHandoffStartingPoint = {
  label: string;
  detail: string;
  href: string;
};

export type OwnerHandoffWalkthroughStep = OwnerHandoffStartingPoint & {
  status: "pass" | "action" | "waiting";
};

export type OwnerHandoffPacketInput = {
  tenantName: string;
  generatedAt: string;
  launchStatus: string;
  launchCompleted: number;
  launchTotal: number;
  enabledModules: OwnerHandoffModule[];
  contactCount: number;
  qualityAverage: number;
  weakRecordCount: number;
  highValueWeakCount: number;
  pendingReviewCount: number;
  askRunCount: number;
  askRunUndecidedCount: number;
  startingPoints: OwnerHandoffStartingPoint[];
  walkthroughSteps: OwnerHandoffWalkthroughStep[];
  launchNotes: string;
};

export type OwnerHandoffAttentionItem = {
  label: string;
  detail: string;
};

export type OwnerHandoffPacket = OwnerHandoffPacketInput & {
  readyForOwnerUse: boolean;
  attentionItems: OwnerHandoffAttentionItem[];
};

function plural(count: number, singular: string, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function bulletList(values: string[], empty: string) {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : `- ${empty}`;
}

export function buildOwnerHandoffAttentionItems(
  input: OwnerHandoffPacketInput,
): OwnerHandoffAttentionItem[] {
  const items: Array<OwnerHandoffAttentionItem | null> = [
    input.contactCount === 0
      ? {
          label: "Relationship data needs to be loaded",
          detail:
            "The Book is private and ready for sign-in, but it needs verified contacts before it can be useful day to day.",
        }
      : null,
    input.pendingReviewCount > 0
      ? {
          label: "Review proposed updates",
          detail: `${plural(
            input.pendingReviewCount,
            "proposed update",
          )} should be approved or dismissed before relying on the latest relationship fields.`,
        }
      : null,
    input.highValueWeakCount > 0
      ? {
          label: "Verify high-value relationships",
          detail: `${plural(
            input.highValueWeakCount,
            "important relationship",
            "important relationships",
          )} need trust, context, or use-case confirmation before referral or outreach work.`,
        }
      : null,
    input.askRunUndecidedCount > 0
      ? {
          label: "Close saved Ask decisions",
          detail: `${plural(
            input.askRunUndecidedCount,
            "saved Ask result",
          )} still needs a follow-up or no-action decision.`,
        }
      : null,
    input.weakRecordCount > 0 && input.highValueWeakCount === 0
      ? {
          label: "Improve low-context records over time",
          detail: `${plural(
            input.weakRecordCount,
            "lower-context record",
          )} can be enriched as new calls, notes, or owner feedback come in.`,
        }
      : null,
  ];

  return items.filter((item): item is OwnerHandoffAttentionItem => Boolean(item));
}

export function buildOwnerHandoffPacket(
  input: OwnerHandoffPacketInput,
): OwnerHandoffPacket {
  const attentionItems = buildOwnerHandoffAttentionItems(input);
  const readyForOwnerUse =
    input.contactCount > 0 &&
    input.launchCompleted === input.launchTotal &&
    input.pendingReviewCount === 0 &&
    input.highValueWeakCount === 0 &&
    input.askRunUndecidedCount === 0;

  return {
    ...input,
    readyForOwnerUse,
    attentionItems,
  };
}

export function formatOwnerHandoffPacket(packet: OwnerHandoffPacket) {
  const moduleLines = packet.enabledModules.map(
    (module) => `${module.label}: ${module.operatingUse}`,
  );
  const startingPointLines = packet.startingPoints.map(
    (item, index) => `${index + 1}. ${item.label} - ${item.detail} (${item.href})`,
  );
  const walkthroughLines = packet.walkthroughSteps.map(
    (item, index) =>
      `${index + 1}. ${item.label} - ${item.status}: ${item.detail} (${item.href})`,
  );
  const attentionLines = packet.attentionItems.map(
    (item, index) => `${index + 1}. ${item.label} - ${item.detail}`,
  );

  return [
    `Little Black Book Owner Handoff: ${packet.tenantName}`,
    `Generated: ${packet.generatedAt}`,
    "",
    "What this is:",
    "- A private relationship operating system configured around this executive's network, goals, and enabled workflows.",
    "- The owner sees the finished Book, useful relationship context, proposed updates, and the action surfaces that were enabled for this install.",
    "- Setup intake, deployment controls, and internal operating instructions stay outside the owner experience.",
    "",
    "Private access:",
    "- Sign-in is required before private pages can be viewed.",
    "- Pages are configured not to appear in search engines.",
    "- Owner-visible modules are intentionally enabled per install; unused workflows can stay hidden until they are needed.",
    "- Judgment-heavy relationship changes are routed through review before they become trusted Book data.",
    "",
    "Enabled workflows:",
    bulletList(moduleLines, "No owner-facing workflows are enabled yet."),
    "",
    "Starting points:",
    startingPointLines.length ? startingPointLines.join("\n") : "1. Open the Book after contacts are loaded.",
    "",
    "First walkthrough:",
    walkthroughLines.length
      ? walkthroughLines.join("\n")
      : "1. Start on Today - waiting: Load contacts before the first walkthrough. (/dashboard)",
    "",
    "Current launch state:",
    `- Status: ${packet.launchStatus}`,
    `- Checklist: ${packet.launchCompleted}/${packet.launchTotal}`,
    `- Ready for owner use: ${packet.readyForOwnerUse ? "yes" : "not yet"}`,
    `- Contacts available: ${packet.contactCount}`,
    `- Average relationship-data quality: ${packet.qualityAverage}%`,
    `- Proposed updates waiting for review: ${packet.pendingReviewCount}`,
    `- Saved Ask runs: ${packet.askRunCount}`,
    "",
    "Items needing attention:",
    attentionLines.length ? attentionLines.join("\n") : "1. No owner-facing action items are currently blocking use.",
    "",
    "Launch notes:",
    packet.launchNotes.trim() ||
      "No custom launch notes have been added for this install yet.",
  ].join("\n");
}

export function ownerHandoffPacketFileName(tenantName: string | null | undefined) {
  const slug = (tenantName ?? "little-black-book")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);

  return `${slug || "little-black-book"}-owner-handoff.txt`;
}

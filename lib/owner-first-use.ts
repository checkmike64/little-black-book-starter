import { ownerSafeHref } from "../runtime/owner-route-policy.js";

export type OwnerFirstUseSurface =
  | "contacts"
  | "ask"
  | "changes"
  | "want_to_know"
  | "launch_preview";

export type OwnerFirstUseState = {
  eyebrow: string;
  title: string;
  detail: string;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  proof: string[];
};

export type OwnerFirstUseInput = {
  contactCount?: number;
  pendingReviewCount?: number;
  askRunCount?: number;
  bucketCount?: number;
  candidateCount?: number;
  filtered?: boolean;
};

function safe(href: string) {
  return ownerSafeHref(href, false);
}

export function buildOwnerFirstUseState(
  surface: OwnerFirstUseSurface,
  input: OwnerFirstUseInput = {},
): OwnerFirstUseState {
  const contactCount = input.contactCount ?? 0;
  const pendingReviewCount = input.pendingReviewCount ?? 0;
  const askRunCount = input.askRunCount ?? 0;
  const bucketCount = input.bucketCount ?? 0;
  const candidateCount = input.candidateCount ?? 0;

  if (surface === "contacts") {
    return {
      eyebrow: "First-use state",
      title: input.filtered
        ? "No matching relationships yet."
        : "The Book is ready for verified relationships.",
      detail: input.filtered
        ? "Try a broader search or another signal view. The Book only shows relationships that are visible in this private install."
        : "Once verified contacts are added, this becomes the owner's daily relationship cockpit with context, asks, promises, and best next actions.",
      primaryLabel: input.filtered ? "Clear filters" : "Return to Today",
      primaryHref: safe(input.filtered ? "/contacts" : "/dashboard"),
      secondaryLabel: contactCount > 0 ? "Ask about this view" : undefined,
      secondaryHref: contactCount > 0 ? safe("/ask") : undefined,
      proof: [
        `${contactCount} relationship${contactCount === 1 ? "" : "s"} visible in this install`,
        "Private notes and judgment fields stay inside the owner's Book",
        "Manual additions are optional and routed through enrichment",
      ],
    };
  }

  if (surface === "ask") {
    return {
      eyebrow: "First-use state",
      title: input.filtered ? "No answerable match yet." : "Ask is waiting for a useful question.",
      detail: input.filtered
        ? "Broaden the request to a company, relationship lane, outcome, city, or category. The answer should stay grounded in stored relationship context."
        : "Ask works best once the Book has real contacts, notes, interactions, promises, and next moves to search across.",
      primaryLabel: input.filtered ? "Ask a broader question" : "Review My Book",
      primaryHref: safe(input.filtered ? "/ask" : "/contacts"),
      secondaryLabel: askRunCount > 0 ? "Saved decisions" : "Today",
      secondaryHref: safe(askRunCount > 0 ? "/ask?saved=needs_decision" : "/dashboard"),
      proof: [
        `${contactCount} contact${contactCount === 1 ? "" : "s"} stored in this Book`,
        `${askRunCount} saved Ask run${askRunCount === 1 ? "" : "s"} tracked`,
        "Answers should become actions only after the owner decides what is useful",
      ],
    };
  }

  if (surface === "changes") {
    return {
      eyebrow: "Review queue",
      title:
        pendingReviewCount > 0
          ? "Proposed updates are waiting for review."
          : "No proposed updates are waiting.",
      detail:
        pendingReviewCount > 0
          ? "Open the highest-priority item first, then approve, edit, dismiss, or request more context before it becomes trusted Book data."
          : "The Book is not holding any pending judgment-heavy updates. Use Today or Ask to decide what deserves attention next.",
      primaryLabel: pendingReviewCount > 0 ? "Open next review" : "Return to Today",
      primaryHref: safe(pendingReviewCount > 0 ? "/changes" : "/dashboard"),
      secondaryLabel: "Ask the Book",
      secondaryHref: safe("/ask"),
      proof: [
        `${pendingReviewCount} active proposal${pendingReviewCount === 1 ? "" : "s"}`,
        "Judgment-sensitive fields remain reviewable before they change the Book",
        "Every accepted update keeps a subtle inspection trail",
      ],
    };
  }

  if (surface === "want_to_know") {
    return {
      eyebrow: "Outer ring",
      title: input.filtered
        ? "No candidates match this view yet."
        : "No active candidates in this bucket yet.",
      detail: input.filtered
        ? "Try all stages or all buckets. Each prospecting lane can be podcast hosts, investors, acquisition targets, partners, or any other purpose-specific label."
        : "When a prospecting bucket is active, verified candidates will appear here with their reason, source, stage, and next useful touch.",
      primaryLabel: input.filtered ? "Show all candidates" : "Return to Today",
      primaryHref: safe(input.filtered ? "/want-to-know" : "/dashboard"),
      secondaryLabel: "Ask who fits",
      secondaryHref: safe("/ask?mode=search&q=who%20should%20I%20meet%20next"),
      proof: [
        `${bucketCount} prospecting bucket${bucketCount === 1 ? "" : "s"} configured`,
        `${candidateCount} candidate${candidateCount === 1 ? "" : "s"} visible`,
        "Buckets stay flexible and can change without rebuilding the product",
      ],
    };
  }

  return {
    eyebrow: "Owner walkthrough",
    title: "The executive path stays focused on the finished Book.",
    detail:
      "This preview proves that normal owner navigation opens relationship surfaces, while setup controls stay outside the default experience.",
    primaryLabel: "Preview Today",
    primaryHref: safe("/dashboard"),
    secondaryLabel: "Preview My Book",
    secondaryHref: safe("/contacts"),
    proof: [
      `${contactCount} contact${contactCount === 1 ? "" : "s"} ready for the walkthrough`,
      `${pendingReviewCount} pending review${pendingReviewCount === 1 ? "" : "s"} visible only as owner decisions`,
      "Owner links are checked before launch",
    ],
  };
}

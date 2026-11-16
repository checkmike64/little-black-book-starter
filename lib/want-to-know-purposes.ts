import type { ProspectingBucketConfig } from "./prospecting-buckets.ts";

export type WantToKnowPurpose = {
  label: string;
  lane: string;
};

const defaultPurposes: WantToKnowPurpose[] = [
  { label: "Client prospect", lane: "client" },
  { label: "Referral partner", lane: "referral" },
  { label: "Strategic partner", lane: "partner" },
  { label: "Investor", lane: "investor" },
  { label: "Media or speaking", lane: "media" },
  { label: "Acquisition", lane: "M&A" },
  { label: "Other opportunity", lane: "other" },
];

export function ownerWantToKnowPurposes(
  buckets: ProspectingBucketConfig[] = [],
) {
  const configured = buckets
    .filter((bucket) => bucket.enabled !== false)
    .map((bucket) => ({ label: bucket.name.trim(), lane: bucket.lane.trim() || "other" }))
    .filter((purpose) => purpose.label);

  const seen = new Set<string>();
  return [...configured, ...defaultPurposes].filter((purpose) => {
    const key = purpose.label.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function ownerWantToKnowPurpose(
  value: unknown,
  buckets: ProspectingBucketConfig[] = [],
) {
  const requested = String(value ?? "").trim().toLocaleLowerCase();
  return ownerWantToKnowPurposes(buckets).find(
    (purpose) => purpose.label.toLocaleLowerCase() === requested,
  ) ?? null;
}

export type ProspectingIntensity = "Low" | "Medium" | "High";

export const prospectingSourceTypes = [
  "linkedin",
  "facebook",
  "calendar",
  "email",
  "transcript",
  "website",
  "podcast",
  "article",
  "newsletter",
  "referral",
  "operator_research",
] as const;

export type ProspectingSourceType = (typeof prospectingSourceTypes)[number];
export type ProspectingApproval = "operator" | "owner" | "automatic";

export type ProspectingBucketPolicy = {
  cadence_days: number;
  qualifying_signals: string[];
  recommended_actions: string[];
  allowed_sources: ProspectingSourceType[];
  voice_instruction: string;
  evidence_requirement: string;
  minimum_evidence_sources: number;
  approval: ProspectingApproval;
  success_definition: string;
};

export type ProspectingBucketConfig = {
  name: string;
  goal: string;
  look_for: string;
  intensity: ProspectingIntensity;
  lane: string;
  /** Missing means enabled for backward compatibility with saved client settings. */
  enabled?: boolean;
  policy?: ProspectingBucketPolicy;
};

export type ProspectingBucketMap = Record<string, ProspectingBucketConfig>;

export type ProspectingPolicyValidation =
  | { ok: true; bucket: ProspectingBucketConfig; source: ProspectingSourceType; action: string }
  | { ok: false; reason: string };

type ProspectingBucketSettings = {
  prospecting: {
    buckets: ProspectingBucketConfig[];
  };
};

const defaultPolicy: ProspectingBucketPolicy = {
  cadence_days: 14,
  qualifying_signals: [],
  recommended_actions: ["research", "offer_value", "request_introduction"],
  allowed_sources: [
    "linkedin",
    "facebook",
    "calendar",
    "email",
    "transcript",
    "operator_research",
  ],
  voice_instruction: "Concise, direct, warm, factual, and easy to read.",
  evidence_requirement:
    "Use verified relationship history or a current source. Do not infer personal facts.",
  minimum_evidence_sources: 1,
  approval: "operator",
  success_definition: "A useful, evidence-backed next step is clear.",
};

function policy(overrides: Partial<ProspectingBucketPolicy> = {}) {
  return { ...defaultPolicy, ...overrides };
}

/** Operator-only templates. Templates are never activated for a client implicitly. */
export const defaultProspectingBuckets: ProspectingBucketConfig[] = [
  {
    name: "Podcast hosts",
    goal: "Earn the right to pitch a high-context guest angle.",
    look_for:
      "Episodes, posts, guest gaps, and topics where the owner has a genuinely useful story.",
    intensity: "Medium",
    lane: "podcast",
    enabled: false,
    policy: policy({
      cadence_days: 21,
      qualifying_signals: ["guest fit", "topic overlap", "recent episode"],
      recommended_actions: ["research", "share_episode", "pitch_guest_angle"],
      allowed_sources: ["linkedin", "facebook", "podcast", "website", "operator_research"],
      success_definition: "A source-backed guest angle is ready for operator review.",
    }),
  },
  {
    name: "Guest post targets",
    goal: "Find credible editorial or contributor opportunities without forcing a podcast motion.",
    look_for:
      "Published themes, audience overlap, contributor gaps, and topics where the owner can add substance.",
    intensity: "Medium",
    lane: "media",
    enabled: false,
    policy: policy({
      cadence_days: 21,
      recommended_actions: ["research", "share_article", "pitch_contribution"],
      allowed_sources: ["linkedin", "facebook", "article", "newsletter", "website", "operator_research"],
    }),
  },
  {
    name: "Referral partners",
    goal: "Stay visible until there is enough trust for durable two-way introductions.",
    look_for:
      "Signals that reveal who they serve, what they need, and where the owner can be useful.",
    intensity: "Medium",
    lane: "referral",
    enabled: false,
    policy: policy({
      cadence_days: 14,
      qualifying_signals: ["specific ask", "shared client need", "warm path"],
      recommended_actions: ["offer_value", "make_introduction", "request_introduction"],
      success_definition: "There is a credible two-way value exchange or warm introduction.",
    }),
  },
  {
    name: "Investor targets",
    goal: "Understand whether the investor belongs near the owner's trusted capital or deal-flow circle.",
    look_for:
      "Portfolio fit, thesis overlap, recent investments, dry-powder signals, and warm-path evidence.",
    intensity: "Low",
    lane: "investor",
    enabled: false,
    policy: policy({ cadence_days: 30, approval: "owner" }),
  },
  {
    name: "Acquisition targets",
    goal: "Research fit and warm paths before spending direct relationship capital.",
    look_for:
      "Ownership context, growth or succession signals, acquisition relevance, and credible mutual connections.",
    intensity: "High",
    lane: "M&A",
    enabled: false,
    policy: policy({ cadence_days: 30, approval: "owner" }),
  },
  {
    name: "Client prospects",
    goal: "Warm the relationship before any direct commercial ask.",
    look_for:
      "Expansion, acquisition, hiring, integration, or strategic pain the owner can help with.",
    intensity: "High",
    lane: "client",
    enabled: false,
    policy: policy({
      cadence_days: 14,
      qualifying_signals: ["hiring", "launch", "company news", "specific need", "warm path"],
      recommended_actions: ["offer_value", "engage_with_post", "make_introduction", "make_offer"],
      approval: "owner",
      success_definition: "A useful, timely conversation is opened without a generic pitch.",
    }),
  },
  {
    name: "Partner prospects",
    goal: "Understand whether this person belongs near the trusted circle.",
    look_for:
      "Shared audience, aligned incentives, credible relationship behavior, and mutual value.",
    intensity: "Low",
    lane: "partner",
    enabled: false,
    policy: policy({ cadence_days: 21 }),
  },
];

function clean(value: unknown, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanList(value: unknown, maxItems = 20, maxLength = 120) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return Array.from(
    new Set(
      values
        .map((item) => clean(item, maxLength))
        .filter(Boolean),
    ),
  ).slice(0, maxItems);
}

function cleanIntensity(value: unknown): ProspectingIntensity {
  if (value === "High" || value === "high") return "High";
  if (value === "Medium" || value === "medium") return "Medium";
  return "Low";
}

function cleanApproval(value: unknown): ProspectingApproval {
  if (value === "owner") return "owner";
  if (value === "automatic") return "automatic";
  return "operator";
}

function cleanCadence(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultPolicy.cadence_days;
  return Math.min(Math.max(Math.round(parsed), 1), 365);
}

function cleanEvidenceMinimum(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultPolicy.minimum_evidence_sources;
  return Math.min(Math.max(Math.round(parsed), 1), 5);
}

function normalizeSources(value: unknown) {
  const allowed = new Set<string>(prospectingSourceTypes);
  const sources = cleanList(value).filter(
    (source): source is ProspectingSourceType => allowed.has(source),
  );
  return sources.length ? sources : [...defaultPolicy.allowed_sources];
}

export function normalizeProspectingBucketPolicy(value: unknown): ProspectingBucketPolicy {
  const root = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

  return {
    cadence_days: cleanCadence(root.cadence_days),
    qualifying_signals: cleanList(root.qualifying_signals),
    recommended_actions:
      cleanList(root.recommended_actions).length > 0
        ? cleanList(root.recommended_actions)
        : [...defaultPolicy.recommended_actions],
    allowed_sources: normalizeSources(root.allowed_sources),
    voice_instruction:
      clean(root.voice_instruction, 700) || defaultPolicy.voice_instruction,
    evidence_requirement:
      clean(root.evidence_requirement, 700) || defaultPolicy.evidence_requirement,
    minimum_evidence_sources: cleanEvidenceMinimum(root.minimum_evidence_sources),
    approval: cleanApproval(root.approval),
    success_definition:
      clean(root.success_definition, 700) || defaultPolicy.success_definition,
  };
}

export function normalizeProspectingBuckets(value: unknown): ProspectingBucketConfig[] {
  if (!Array.isArray(value)) return [];

  const names = new Set<string>();
  const buckets: ProspectingBucketConfig[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const candidate = row as Record<string, unknown>;
    const name = clean(candidate.name, 80);
    const key = name.toLocaleLowerCase();
    if (!name || names.has(key)) continue;
    names.add(key);

    buckets.push({
      name,
      goal: clean(candidate.goal, 500),
      look_for: clean(candidate.look_for, 700),
      intensity: cleanIntensity(candidate.intensity),
      lane: clean(candidate.lane, 80),
      enabled: candidate.enabled !== false,
      policy: normalizeProspectingBucketPolicy(candidate.policy),
    });
  }
  return buckets;
}

export function parseProspectingBucketLines(value: string) {
  return normalizeProspectingBuckets(
    value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const [
          name,
          goal,
          lookFor,
          intensity,
          lane,
          cadenceDays,
          signals,
          actions,
          sources,
          voice,
          evidence,
          approval,
          success,
          minimumEvidenceSources,
        ] = line.split("|").map((part) => part.trim());

        return {
          name,
          goal,
          look_for: lookFor,
          intensity,
          lane,
          enabled: true,
          policy: {
            cadence_days: cadenceDays,
            qualifying_signals: signals,
            recommended_actions: actions,
            allowed_sources: sources,
            voice_instruction: voice,
            evidence_requirement: evidence,
            approval,
            success_definition: success,
            minimum_evidence_sources: minimumEvidenceSources,
          },
        };
      }),
  );
}

export function formatProspectingBucketLines(buckets: ProspectingBucketConfig[]) {
  return buckets
    .filter((bucket) => bucket.enabled !== false)
    .map((bucket) => {
      const bucketPolicy = normalizeProspectingBucketPolicy(bucket.policy);
      return [
        bucket.name,
        bucket.goal,
        bucket.look_for,
        bucket.intensity,
        bucket.lane,
        bucketPolicy.cadence_days,
        bucketPolicy.qualifying_signals.join(", "),
        bucketPolicy.recommended_actions.join(", "),
        bucketPolicy.allowed_sources.join(", "),
        bucketPolicy.voice_instruction,
        bucketPolicy.evidence_requirement,
        bucketPolicy.approval,
        bucketPolicy.success_definition,
        bucketPolicy.minimum_evidence_sources,
      ].join(" | ");
    })
    .join("\n");
}

export function getProspectingBucketMap(settings: ProspectingBucketSettings): ProspectingBucketMap {
  return settings.prospecting.buckets
    .filter((bucket) => bucket.enabled !== false)
    .reduce((accumulator, bucket) => {
      accumulator[bucket.name] = bucket;
      return accumulator;
    }, {} as ProspectingBucketMap);
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function policySource(payload: Record<string, unknown>, proposalSource?: string | null) {
  const candidate = record(payload.candidate);
  const evidence = record(payload.evidence);
  const raw = clean(evidence.source_type ?? candidate.source_type, 80).toLowerCase();
  if (prospectingSourceTypes.includes(raw as ProspectingSourceType)) {
    return raw as ProspectingSourceType;
  }
  if (proposalSource === "operator_client_list") return "operator_research";
  if (/linkedin\.com/i.test(clean(candidate.linkedin, 500))) return "linkedin";
  return null;
}

export function validateProspectingCandidatePolicy(input: {
  settings: ProspectingBucketSettings;
  payload: Record<string, unknown>;
  proposalSource?: string | null;
  reviewerRole?: "owner" | "operator" | null;
}): ProspectingPolicyValidation {
  const candidate = record(input.payload.candidate);
  const evidence = record(input.payload.evidence);
  const bucketName = clean(candidate.bucket, 80);
  const bucket = Object.values(getProspectingBucketMap(input.settings)).find(
    (item) => item.name.toLowerCase() === bucketName.toLowerCase(),
  );
  if (!bucketName || !bucket) return { ok: false, reason: "The prospecting bucket is not enabled." };

  const policy = normalizeProspectingBucketPolicy(bucket.policy);
  const source = policySource(input.payload, input.proposalSource);
  if (!source || !policy.allowed_sources.includes(source)) {
    return { ok: false, reason: "The proposal source is not allowed for this bucket." };
  }
  const evidenceSummary = clean(evidence.source_summary ?? evidence.source_ref, 1200);
  if (!evidenceSummary) {
    return { ok: false, reason: "Source-backed evidence is required for this bucket." };
  }
  const evidenceRefs = cleanList([
    evidence.source_ref,
    ...(Array.isArray(evidence.source_refs) ? evidence.source_refs : []),
  ]);
  if (evidenceRefs.length < policy.minimum_evidence_sources) {
    return {
      ok: false,
      reason: `This bucket requires ${policy.minimum_evidence_sources} independent evidence source${policy.minimum_evidence_sources === 1 ? "" : "s"}.`,
    };
  }

  const action = clean(candidate.recommended_action, 120) || "research";
  if (!policy.recommended_actions.includes(action)) {
    return { ok: false, reason: "The recommended action is not allowed for this bucket." };
  }
  if (policy.qualifying_signals.length > 0) {
    const suppliedSignals = cleanList(
      candidate.qualifying_signals ?? evidence.qualifying_signals,
    ).map((value) => value.toLowerCase());
    const allowedSignals = policy.qualifying_signals.map((value) => value.toLowerCase());
    if (!suppliedSignals.some((value) => allowedSignals.includes(value))) {
      return { ok: false, reason: "A configured qualifying signal is required for this bucket." };
    }
  }
  const lastTouch = clean(candidate.last_touch, 40);
  if (lastTouch) {
    const lastTouchTime = Date.parse(lastTouch);
    const observedAt = Date.parse(
      clean(candidate.qualifying_signal_observed_at ?? evidence.observed_at, 80),
    );
    const elapsedDays = Number.isFinite(lastTouchTime)
      ? Math.floor((Date.now() - lastTouchTime) / 86_400_000)
      : policy.cadence_days;
    const isNewSignal = Number.isFinite(observedAt) && observedAt > lastTouchTime;
    if (elapsedDays < policy.cadence_days && !isNewSignal) {
      return { ok: false, reason: `Wait ${policy.cadence_days} days between proactive touches unless a new qualifying signal appears.` };
    }
  }
  if (input.reviewerRole && policy.approval !== "automatic" && policy.approval !== input.reviewerRole) {
    return { ok: false, reason: `This bucket requires ${policy.approval} approval.` };
  }

  return { ok: true, bucket, source, action };
}

export function prospectingBucketExamples(settings: ProspectingBucketSettings) {
  return Object.keys(getProspectingBucketMap(settings)).join(", ");
}

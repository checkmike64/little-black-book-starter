import { aiGatewayConfigured } from "./ai/policy.ts";
import {
  hasMatchingSupabaseProjectIdentity,
  validateDeploymentEnvironment,
} from "./deployment-environment.ts";
import type { ProductionCheckRecord } from "./production-check-evidence.ts";

export type DeploymentCheck = {
  label: string;
  value: string;
  tone: "ok" | "warn" | "neutral";
  detail: string;
};

type ProductionCheckSettings = {
  delivery: {
    production_checks: Record<string, ProductionCheckRecord>;
  };
};

export type ProductionCheckKey =
  | "supabase_project_isolated"
  | "rls_data_api_reviewed"
  | "preview_protection_enabled"
  | "claude_token_scoped"
  | "auth_email_template_ready"
  | "commercial_agreement_signed"
  | "billing_owner_and_collection_ready"
  | "support_contact_and_process_ready"
  | "backup_and_restore_proven"
  | "retention_and_offboarding_ready"
  | "owner_acceptance_recorded";

export type ProductionCheckItem = {
  key: ProductionCheckKey;
  label: string;
  detail: string;
};

export const productionCheckItems: ProductionCheckItem[] = [
  {
    key: "supabase_project_isolated",
    label: "Supabase project is client-isolated",
    detail:
      "This install uses its own Supabase project, keys, Auth users, and tenant row.",
  },
  {
    key: "rls_data_api_reviewed",
    label: "RLS and Data API grants reviewed",
    detail:
      "RLS is enabled on private tables, grants are intentional, and signed-out reads do not expose rows.",
  },
  {
    key: "preview_protection_enabled",
    label: "Preview deployment protection enabled",
    detail:
      "Vercel previews are protected or intentionally limited before any real client data is present.",
  },
  {
    key: "claude_token_scoped",
    label: "Claude credentials are capability-scoped",
    detail:
      "Claude receives distinct read, job-control, and write tokens, never Supabase service-role credentials.",
  },
  {
    key: "auth_email_template_ready",
    label: "Auth email delivery is production-ready",
    detail:
      "A production SMTP provider is configured, the Supabase template includes both the confirmation URL and one-time token, and a current fallback-code sign-in exercise has passed.",
  },
  {
    key: "commercial_agreement_signed",
    label: "Commercial agreement is signed and versioned",
    detail:
      "The signed client agreement and its exact version or effective date are recorded in the approved operator file.",
  },
  {
    key: "billing_owner_and_collection_ready",
    label: "Billing owner and collection path are ready",
    detail:
      "A billing owner is named and the agreed payment authorization or invoice process is ready before service begins.",
  },
  {
    key: "support_contact_and_process_ready",
    label: "Support contact and process are ready",
    detail:
      "The client-facing support contact, request path, and operator triage and escalation process are confirmed.",
  },
  {
    key: "backup_and_restore_proven",
    label: "Backup and isolated restore are proven",
    detail:
      "Backup coverage is active and a current restore proof for this install is recorded outside the production project.",
  },
  {
    key: "retention_and_offboarding_ready",
    label: "Retention and offboarding plan are recorded",
    detail:
      "The approved retention, export, credential revocation, integration cleanup, and deletion steps are recorded for this install.",
  },
  {
    key: "owner_acceptance_recorded",
    label: "Owner acceptance is recorded",
    detail:
      "The owner completed the handoff review and acceptance to begin production service is recorded.",
  },
];

export function productionCheckEvidence(settings: ProductionCheckSettings) {
  const items = productionCheckItems.map((item) => {
    const evidence = settings.delivery.production_checks[item.key];
    const evidenceRef = evidence?.evidence_ref ?? null;
    const confirmed = evidence?.confirmed === true && evidenceRef !== null;

    return {
      ...item,
      confirmed,
      confirmedAt: confirmed ? evidence?.confirmed_at ?? null : null,
      confirmedBy: confirmed ? evidence?.confirmed_by ?? null : null,
      evidenceRef: confirmed ? evidenceRef : null,
    };
  });
  const confirmed = items.filter((item) => item.confirmed).length;

  return {
    items,
    confirmed,
    total: items.length,
    missing: items.length - confirmed,
    ready: confirmed === items.length,
  };
}

type DeploymentEnv = Record<string, string | undefined>;

function publicSupabaseEnv(env: DeploymentEnv) {
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const legacyAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const anonKey = publishableKey || legacyAnonKey;

  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey,
    keySource: publishableKey
      ? "publishable"
      : legacyAnonKey
        ? "legacy_anon"
        : null,
  };
}

function operatorEmailAllowlist(env: DeploymentEnv) {
  const raw = env.OPERATOR_EMAILS ?? env.OPERATOR_EMAIL ?? "";

  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function normalizedHttpUrl(value: string | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function siteUrlCheck(siteUrl: string | undefined, isVercel: boolean): DeploymentCheck {
  const parsed = normalizedHttpUrl(siteUrl);

  if (!siteUrl) {
    return {
      label: "Production site URL",
      value: "Missing",
      tone: "warn",
      detail:
        "Controls magic-link callbacks. Set it to the final Vercel production URL or custom domain.",
    };
  }

  if (!parsed) {
    return {
      label: "Production site URL",
      value: "Invalid",
      tone: "warn",
      detail:
        "NEXT_PUBLIC_SITE_URL must be a full http or https URL so auth callbacks resolve.",
    };
  }

  if (isVercel && ["localhost", "127.0.0.1"].includes(parsed.hostname)) {
    return {
      label: "Production site URL",
      value: "Localhost",
      tone: "warn",
      detail:
        "Production deployments cannot use a local callback URL for magic-link sign-in.",
    };
  }

  return {
    label: "Production site URL",
    value: parsed.origin,
    tone: "ok",
    detail:
      "Controls magic-link callbacks. Confirm this exact origin is allowed in Supabase Auth URL settings.",
  };
}

function deploymentCommitCheck(env: DeploymentEnv, isVercel: boolean): DeploymentCheck {
  const commitSha = env.VERCEL_GIT_COMMIT_SHA ?? env.GIT_COMMIT_SHA;
  const commitRef = env.VERCEL_GIT_COMMIT_REF ?? env.GIT_COMMIT_REF;

  return {
    label: "Deployment commit",
    value: commitSha ? commitSha.slice(0, 7) : "Unavailable",
    tone: commitSha ? "ok" : "neutral",
    detail: commitSha
      ? `Current build source${commitRef ? ` from ${commitRef}` : ""}.`
      : isVercel
        ? "Vercel did not expose commit metadata to this runtime."
        : "Commit metadata is expected to be unavailable during local development.",
  };
}

export function deploymentReadiness(env: DeploymentEnv = process.env) {
  const publicEnv = publicSupabaseEnv(env);
  const supabaseProjectRef = env.SUPABASE_PROJECT_REF;
  const siteUrl = env.NEXT_PUBLIC_SITE_URL;
  const installName = env.NEXT_PUBLIC_INSTALL_NAME;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const claudeReadToken = env.CLAUDE_READ_TOKEN;
  const claudeJobToken = env.CLAUDE_JOB_TOKEN;
  const claudeWriteToken = env.CLAUDE_WRITE_TOKEN;
  const cronSecret = env.CRON_SECRET;
  const defaultTenantId = env.DEFAULT_TENANT_ID;
  const operatorEmails = operatorEmailAllowlist(env);
  const isVercel = env.VERCEL === "1";
  const vercelUrl = env.VERCEL_URL;
  const environmentPolicy = validateDeploymentEnvironment(env, {
    production: isVercel,
  });
  const supabaseIdentityMatches = hasMatchingSupabaseProjectIdentity(env);
  const aiGatewayReady = aiGatewayConfigured(env);

  const checks: DeploymentCheck[] = [
    {
      label: "Supabase project URL",
      value: publicEnv.url ? "Set" : "Missing",
      tone: publicEnv.url ? "ok" : "warn",
      detail: "Required for every browser and server Supabase client.",
    },
    {
      label: "Supabase project identity",
      value: supabaseProjectRef ?? "Missing",
      tone: supabaseIdentityMatches ? "ok" : "warn",
      detail:
        supabaseIdentityMatches
          ? "The project ref matches this install's Supabase URL."
          : "Set this install's 20-character project ref and use the matching Supabase URL before production promotion.",
    },
    {
      label: "Supabase publishable key",
      value: publicEnv.anonKey
        ? publicEnv.keySource === "publishable"
          ? "Publishable key"
          : "Legacy anon fallback"
        : "Missing",
      tone: publicEnv.anonKey
        ? publicEnv.keySource === "publishable"
          ? "ok"
          : "neutral"
        : "warn",
      detail:
        "Use NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY for new installs; the older anon-key variable still works while testing.",
    },
    {
      label: "Server-only Supabase key",
      value: serviceRoleKey ? "Set" : "Missing",
      tone: serviceRoleKey ? "ok" : "warn",
      detail:
        "Required for audited server actions and Claude gateway writes. Never expose this to the browser or Claude.",
    },
    {
      label: "Claude read token",
      value: claudeReadToken ? "Set" : "Missing",
      tone: claudeReadToken ? "ok" : "warn",
      detail:
        "Allows tenant-safe research context reads without granting writes or job control.",
    },
    {
      label: "Claude job token",
      value: claudeJobToken ? "Set" : "Missing",
      tone: claudeJobToken ? "ok" : "warn",
      detail:
        "Allows job claim, completion, and failure calls without granting other writes.",
    },
    {
      label: "Claude write token",
      value: claudeWriteToken ? "Set" : "Missing",
      tone: claudeWriteToken ? "ok" : "warn",
      detail:
        "Allows audited intake writes without granting research reads or job control.",
    },
    {
      label: "Automation secret",
      value: cronSecret ? "Set" : "Missing",
      tone: cronSecret ? "ok" : "warn",
      detail: "Protects scheduled automation routes from unauthenticated invocation.",
    },
    {
      label: "Profile research worker",
      value: /^(0|false|no|off)$/i.test(env.LBB_ENRICHMENT_WORKER_ENABLED?.trim() ?? "")
        ? "Turned off"
        : aiGatewayReady
          ? "Running every 10 minutes"
          : "AI Gateway missing",
      tone: /^(0|false|no|off)$/i.test(env.LBB_ENRICHMENT_WORKER_ENABLED?.trim() ?? "") || !aiGatewayReady
        ? "warn"
        : "ok",
      detail:
        "Researches every new person and profile gap and sends findings to Changes. Without it, the research queue only grows. Needs CRON_SECRET and Vercel AI Gateway; apply the contact_enrichment ledger migration first.",
    },
    {
      label: "Profile research connector",
      value: env.APIFY_API_TOKEN?.trim() ? "Apify set" : "Book-only research",
      tone: env.APIFY_API_TOKEN?.trim() ? "ok" : "neutral",
      detail:
        "With APIFY_API_TOKEN and the tenant's Apify plan enabled, research adds Google, LinkedIn and Instagram. Without it, research uses Book notes and websites only.",
    },
    {
      label: "Default tenant id",
      value: defaultTenantId ? "Set" : "Missing",
      tone: defaultTenantId ? "ok" : "warn",
      detail:
        "Used by Claude endpoints when a tenant id is not included in the request body.",
    },
    {
      label: "Operator email allowlist",
      value: operatorEmails.length ? `${operatorEmails.length} set` : "Tenant role only",
      tone: operatorEmails.length ? "ok" : "neutral",
      detail:
        "Server-only OPERATOR_EMAILS lets the installer access setup tools without exposing them to the executive owner.",
    },
    siteUrlCheck(siteUrl, isVercel),
    {
      label: "Production environment policy",
      value: isVercel
        ? environmentPolicy.valid
          ? "Pass"
          : `${environmentPolicy.issues.length} issue${environmentPolicy.issues.length === 1 ? "" : "s"}`
        : "Checked during deploy",
      tone: isVercel
        ? environmentPolicy.valid
          ? "ok"
          : "warn"
        : "neutral",
      detail: isVercel
        ? environmentPolicy.valid
          ? "Production URLs, tenant scope, credential strength, credential separation, and optional provider pairs are valid."
          : environmentPolicy.issues.map((issue) => issue.message).join(" ")
        : "Production Vercel builds fail closed when install-critical environment policy is not satisfied.",
    },
    {
      label: "Vercel runtime",
      value: isVercel ? "Detected" : "Local",
      tone: isVercel ? "ok" : "neutral",
      detail: vercelUrl
        ? `Current deployment URL is ${vercelUrl}.`
        : "This is expected during local development.",
    },
    deploymentCommitCheck(env, isVercel),
    {
      label: "Install label",
      value: installName ? "Set" : "Optional",
      tone: installName ? "ok" : "neutral",
      detail:
        "Helps label a client install without changing application behavior.",
    },
  ];

  const blockingCount = checks.filter((check) => check.tone === "warn").length;

  return {
    checks,
    blockingCount,
    ready: blockingCount === 0,
  };
}

export const requiredVercelEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_PROJECT_REF",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CLAUDE_READ_TOKEN",
  "CLAUDE_JOB_TOKEN",
  "CLAUDE_WRITE_TOKEN",
  "CRON_SECRET",
  "DEFAULT_TENANT_ID",
  "OPERATOR_EMAILS",
  "SUPPORT_EMAIL",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_INSTALL_NAME",
];

export const ownerFlowSmokeRoutes = [
  {
    label: "Today",
    path: "/dashboard",
    expected: "Daily brief, agenda, relationship health, and closeout summary",
  },
  {
    label: "My Book",
    path: "/contacts",
    expected: "Contact search, views, stats, and empty-state handling",
  },
  {
    label: "Engagement",
    path: "/engagement",
    expected: "Weekly operating plan, priority queue, and recent signals",
  },
  {
    label: "Ask the Book",
    path: "/ask",
    expected: "Query form, quick prompts, saved answer decisions, and zero-match handling",
  },
  {
    label: "Next Moves",
    path: "/movement",
    expected: "Relationship action queue, filters, lanes, and command center",
  },
  {
    label: "Review Changes",
    path: "/changes",
    expected: "Pending change review with subtle evidence trails",
  },
  {
    label: "Want-to-Know",
    path: "/want-to-know",
    expected: "Prospecting bucket review for configurable target lanes",
  },
] as const;

export const signedInOwnerSmokeRoutes = [
  {
    label: "Today",
    path: "/dashboard",
    expectedHeading: "Today",
    evidence:
      "Daily brief, relationship stats, agenda, review pressure, and closeout summary render without setup tools.",
  },
  {
    label: "My Book",
    path: "/contacts",
    expectedHeading: "My Book",
    evidence:
      "Contact stats, search, signal views, contact rows, and empty states render for the active book.",
  },
  {
    label: "Engagement",
    path: "/engagement",
    expectedHeading: "Engagement",
    evidence:
      "Weekly touch plan, priority queue, recent signals, and useful outreach actions render when enabled.",
  },
  {
    label: "Ask the Book",
    path: "/ask",
    expectedHeading: "Ask the Book",
    evidence:
      "Query form, mode controls, quick questions, saved runs, and answer decision actions render.",
  },
  {
    label: "Next Moves",
    path: "/movement",
    expectedHeading: "Next Moves",
    evidence:
      "Action queue filters, pressure stats, movement command center, and lane empty states render.",
  },
  {
    label: "Changes",
    path: "/changes",
    expectedHeading: "Changes",
    evidence:
      "Pending review queue, owner packet actions, risk labels, and subtle evidence trails render.",
  },
  {
    label: "Want to Know",
    path: "/want-to-know",
    expectedHeading: "Want to Know",
    evidence:
      "Prospecting buckets, candidate filters, and bucket-specific empty states render when enabled.",
  },
] as const;

export const ownerModeForbiddenNavLabels = [
  "Management",
  "Ask",
  "Client Intake",
  "Client Admin",
  "Recordings",
  "Scoreboard",
  "Claude Setup",
  "Ops",
  "Quality",
  "Launch",
  "Deployment",
  "Export",
  "Settings",
] as const;

export function productionRedirectUrls(siteUrl = "https://CLIENT_DOMAIN") {
  const normalized = siteUrl.replace(/\/$/, "");

  return [
    `${normalized}/auth/callback`,
    "http://localhost:3000/auth/callback",
  ];
}

export function liveSmokeCommandForSite(siteUrl?: string) {
  const target = normalizedHttpUrl(siteUrl)?.origin ?? "https://CLIENT_DOMAIN";

  return `pnpm smoke:live ${target}`;
}

export function signedInOwnerSmokeCommandForSite(siteUrl?: string) {
  const target = normalizedHttpUrl(siteUrl)?.origin ?? "https://CLIENT_DOMAIN";

  return `LBB_SMOKE_COOKIE="<owner session cookie>" ${liveSmokeCommandForSite(target)}`;
}

export function liveSmokeChecklistForSite(siteUrl?: string) {
  const target = normalizedHttpUrl(siteUrl)?.origin ?? "https://CLIENT_DOMAIN";

  return {
    target,
    command: liveSmokeCommandForSite(siteUrl),
    ownerRoutes: ownerFlowSmokeRoutes,
    evidence: [
      "Login page loads and sends private response headers.",
      "Owner routes redirect signed-out visitors to /login with noindex and CSP guards intact.",
      "robots.txt blocks crawlers and sitemap.xml avoids private app routes.",
      "Unsigned Claude write calls return 401 and keep private JSON response headers.",
      "Operator-only setup routes stay protected outside a signed-in operator session.",
    ],
  };
}

export function signedInOwnerSmokeChecklistForSite(siteUrl?: string) {
  const target = normalizedHttpUrl(siteUrl)?.origin ?? "https://CLIENT_DOMAIN";

  return {
    target,
    command: signedInOwnerSmokeCommandForSite(siteUrl),
    routes: signedInOwnerSmokeRoutes,
    forbiddenNavLabels: ownerModeForbiddenNavLabels,
    evidence: [
      "Owner routes render while signed in and do not fall back to the login form.",
      "Normal owner mode shows relationship-product navigation only.",
      "Operator surfaces stay hidden until an operator explicitly enables admin tools.",
      "Enabled modules render their working surface; disabled modules return the owner to Today with a clear message.",
      "Primary owner actions are visible: ask, open contact, review change, save movement, and work top touch.",
    ],
  };
}

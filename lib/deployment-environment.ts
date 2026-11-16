export type DeploymentEnvironment = Record<string, string | undefined>;

export type DeploymentEnvironmentIssue = {
  code:
    | "missing"
    | "invalid_url"
    | "insecure_url"
    | "invalid_project_ref"
    | "invalid_uuid"
    | "invalid_email"
    | "origin_mismatch"
    | "placeholder"
    | "weak_secret"
    | "duplicate_secret"
    | "invalid_timestamp"
    | "expired_cutoff"
    | "cutoff_too_far"
    | "partial_feature"
    | "unsafe_setup_mode";
  variables: string[];
  message: string;
};

const minimumSecretLength = 32;
const maximumClaudeLegacyCutoverMs = 24 * 60 * 60 * 1000;

const requiredProductionVariables = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CLAUDE_READ_TOKEN",
  "CLAUDE_JOB_TOKEN",
  "CLAUDE_WRITE_TOKEN",
  "CRON_SECRET",
  "DEFAULT_TENANT_ID",
  "OPERATOR_EMAILS",
  "SUPPORT_EMAIL",
  "NEXT_PUBLIC_SITE_URL",
] as const;

const protectedSecretVariables = [
  "CLAUDE_READ_TOKEN",
  "CLAUDE_JOB_TOKEN",
  "CLAUDE_WRITE_TOKEN",
  "CLAUDE_LEGACY_TOKEN",
  "CRON_SECRET",
] as const;

const placeholderCheckedVariables = [
  ...requiredProductionVariables,
  "EXPECTED_SUPABASE_PROJECT_REF",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "CLAUDE_LEGACY_TOKEN",
  "NOTION_OAUTH_CLIENT_ID",
  "NOTION_OAUTH_CLIENT_SECRET",
  "NOTION_REDIRECT_URI",
  "APIFY_API_TOKEN",
  "APIFY_WEBHOOK_SECRET",
] as const;

const featureGroups = [
  {
    name: "Notion OAuth",
    variables: [
      "NOTION_OAUTH_CLIENT_ID",
      "NOTION_OAUTH_CLIENT_SECRET",
      "NOTION_REDIRECT_URI",
    ],
  },
  {
    name: "Apify monitoring",
    variables: ["APIFY_API_TOKEN", "APIFY_WEBHOOK_SECRET"],
  },
] as const;

function hasValue(value: string | undefined) {
  return Boolean(value?.trim());
}

function isUuid(value: string | undefined) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
}

function parsedHttpUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

export function hasMatchingSupabaseProjectIdentity(
  env: DeploymentEnvironment,
) {
  const projectRef = env.SUPABASE_PROJECT_REF?.trim();
  const projectUrl = parsedHttpUrl(env.NEXT_PUBLIC_SUPABASE_URL);

  return Boolean(
    projectRef &&
      /^[a-z0-9]{20}$/.test(projectRef) &&
      projectUrl?.hostname === `${projectRef}.supabase.co`,
  );
}

function isPlaceholder(value: string) {
  return (
    /(?:^|[-_])(?:your|placeholder|changeme)(?:[-_]|$)/i.test(value) ||
    /replace(?:_|-)with/i.test(value) ||
    /generate-(?:a|another|different)-/i.test(value) ||
    /(?:^|[.@/-])example(?:[.@/-]|$)/i.test(value) ||
    /tenant-uuid-after-bootstrap/i.test(value) ||
    value === "00000000-0000-4000-8000-000000000000"
  );
}

function validEmail(value: string) {
  return /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(value);
}

function parseUtcTimestamp(value: string | undefined) {
  const normalized = value?.trim();
  if (
    !normalized ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized)
  ) {
    return null;
  }

  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isClaudeLegacyCutoverActive(
  env: DeploymentEnvironment = process.env,
  now = Date.now(),
) {
  const cutoff = parseUtcTimestamp(env.CLAUDE_LEGACY_TOKEN_CUTOFF_AT);
  return Boolean(
    (hasValue(env.CLAUDE_LEGACY_TOKEN) || hasValue(env.CLAUDE_WRITE_TOKEN)) &&
      cutoff &&
      now < cutoff &&
      cutoff - now <= maximumClaudeLegacyCutoverMs,
  );
}

function addMissingIssue(
  issues: DeploymentEnvironmentIssue[],
  variable: string,
) {
  issues.push({
    code: "missing",
    variables: [variable],
    message: `${variable} is required for a production client install.`,
  });
}

export function validateDeploymentEnvironment(
  env: DeploymentEnvironment = process.env,
  options: { production?: boolean; now?: Date } = {},
) {
  const production =
    options.production ??
    (env.VERCEL_ENV === "production" || env.LBB_ENV_VALIDATION === "production");
  const issues: DeploymentEnvironmentIssue[] = [];
  const now = options.now?.getTime() ?? Date.now();

  if (!production) {
    return { production: false, valid: true, issues };
  }

  for (const variable of requiredProductionVariables) {
    if (!hasValue(env[variable])) addMissingIssue(issues, variable);
  }

  for (const variable of placeholderCheckedVariables) {
    const value = env[variable]?.trim();
    if (!value || !isPlaceholder(value)) continue;
    issues.push({
      code: "placeholder",
      variables: [variable],
      message: `${variable} still contains an example or placeholder value.`,
    });
  }

  if (
    !hasValue(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) &&
    !hasValue(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  ) {
    issues.push({
      code: "missing",
      variables: [
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ],
      message:
        "A Supabase publishable key is required for a production client install.",
    });
  }

  const urlVariables = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SITE_URL",
    "NOTION_REDIRECT_URI",
  ];

  for (const variable of urlVariables) {
    const value = env[variable];
    if (!hasValue(value)) continue;
    const url = parsedHttpUrl(value);
    if (!url) {
      issues.push({
        code: "invalid_url",
        variables: [variable],
        message: `${variable} must be a full HTTP or HTTPS URL.`,
      });
      continue;
    }
    if (
      url.protocol !== "https:" ||
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    ) {
      issues.push({
        code: "insecure_url",
        variables: [variable],
        message: `${variable} must use a non-local HTTPS URL in production.`,
      });
    }
  }

  const supabaseProjectRef = env.SUPABASE_PROJECT_REF?.trim();
  const expectedSupabaseProjectRef = env.EXPECTED_SUPABASE_PROJECT_REF?.trim();
  const supabaseUrl = parsedHttpUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  if (supabaseProjectRef && !/^[a-z0-9]{20}$/.test(supabaseProjectRef)) {
    issues.push({
      code: "invalid_project_ref",
      variables: ["SUPABASE_PROJECT_REF"],
      message:
        "SUPABASE_PROJECT_REF must be the 20-character ref for this client's isolated project.",
    });
  }
  if (
    supabaseProjectRef &&
    supabaseUrl &&
    supabaseUrl.hostname !== `${supabaseProjectRef}.supabase.co`
  ) {
    issues.push({
      code: "invalid_project_ref",
      variables: ["SUPABASE_PROJECT_REF", "NEXT_PUBLIC_SUPABASE_URL"],
      message:
        "NEXT_PUBLIC_SUPABASE_URL must belong to SUPABASE_PROJECT_REF for this install.",
    });
  }
  if (
    expectedSupabaseProjectRef &&
    (!/^[a-z0-9]{20}$/.test(expectedSupabaseProjectRef) ||
      expectedSupabaseProjectRef !== supabaseProjectRef)
  ) {
    issues.push({
      code: "invalid_project_ref",
      variables: ["EXPECTED_SUPABASE_PROJECT_REF", "SUPABASE_PROJECT_REF"],
      message:
        "EXPECTED_SUPABASE_PROJECT_REF must match this deployment's SUPABASE_PROJECT_REF when the optional pin is set.",
    });
  }

  if (hasValue(env.DEFAULT_TENANT_ID) && !isUuid(env.DEFAULT_TENANT_ID)) {
    issues.push({
      code: "invalid_uuid",
      variables: ["DEFAULT_TENANT_ID"],
      message: "DEFAULT_TENANT_ID must be a valid UUID.",
    });
  }

  if (hasValue(env.OPERATOR_EMAILS)) {
    const emails = env.OPERATOR_EMAILS!.split(",").map((email) => email.trim());
    if (emails.some((email) => !validEmail(email))) {
      issues.push({
        code: "invalid_email",
        variables: ["OPERATOR_EMAILS"],
        message:
          "OPERATOR_EMAILS must be a comma-separated list of complete email addresses.",
      });
    }
  }

  if (
    hasValue(env.SUPPORT_EMAIL) &&
    !validEmail(env.SUPPORT_EMAIL!.trim())
  ) {
    issues.push({
      code: "invalid_email",
      variables: ["SUPPORT_EMAIL"],
      message: "SUPPORT_EMAIL must be one complete email address.",
    });
  }

  const siteUrl = parsedHttpUrl(env.NEXT_PUBLIC_SITE_URL);
  if (siteUrl) {
    for (const variable of ["NOTION_REDIRECT_URI"] as const) {
      const redirectUrl = parsedHttpUrl(env[variable]);
      if (!redirectUrl || redirectUrl.origin === siteUrl.origin) continue;
      issues.push({
        code: "origin_mismatch",
        variables: [variable, "NEXT_PUBLIC_SITE_URL"],
        message: `${variable} must use the same origin as NEXT_PUBLIC_SITE_URL.`,
      });
    }
  }

  for (const variable of protectedSecretVariables) {
    const value = env[variable]?.trim();
    if (value && value.length < minimumSecretLength) {
      issues.push({
        code: "weak_secret",
        variables: [variable],
        message: `${variable} must contain at least ${minimumSecretLength} characters.`,
      });
    }
  }

  const secretOwners = new Map<string, string[]>();
  for (const variable of protectedSecretVariables) {
    const value = env[variable]?.trim();
    if (!value) continue;
    secretOwners.set(value, [...(secretOwners.get(value) ?? []), variable]);
  }
  for (const variables of secretOwners.values()) {
    if (variables.length < 2) continue;
    const isActiveLegacyWritePair =
      variables.length === 2 &&
      variables.includes("CLAUDE_WRITE_TOKEN") &&
      variables.includes("CLAUDE_LEGACY_TOKEN") &&
      isClaudeLegacyCutoverActive(env, now);
    if (isActiveLegacyWritePair) continue;
    issues.push({
      code: "duplicate_secret",
      variables,
      message: `${variables.join(", ")} must use distinct credentials.`,
    });
  }

  const hasLegacyCutoff = hasValue(env.CLAUDE_LEGACY_TOKEN_CUTOFF_AT);
  if (hasValue(env.CLAUDE_LEGACY_TOKEN) && !hasLegacyCutoff) {
    issues.push({
      code: "partial_feature",
      variables: ["CLAUDE_LEGACY_TOKEN", "CLAUDE_LEGACY_TOKEN_CUTOFF_AT"],
      message:
        "CLAUDE_LEGACY_TOKEN is optional, but it cannot be used without CLAUDE_LEGACY_TOKEN_CUTOFF_AT.",
    });
  }
  if (hasLegacyCutoff) {
    const cutoff = parseUtcTimestamp(env.CLAUDE_LEGACY_TOKEN_CUTOFF_AT);
    if (!cutoff) {
      issues.push({
        code: "invalid_timestamp",
        variables: ["CLAUDE_LEGACY_TOKEN_CUTOFF_AT"],
        message:
          "CLAUDE_LEGACY_TOKEN_CUTOFF_AT must be an explicit UTC timestamp ending in Z.",
      });
    } else if (cutoff <= now) {
      issues.push({
        code: "expired_cutoff",
        variables: ["CLAUDE_LEGACY_TOKEN_CUTOFF_AT"],
        message: "CLAUDE_LEGACY_TOKEN_CUTOFF_AT must be in the future.",
      });
    } else if (cutoff - now > maximumClaudeLegacyCutoverMs) {
      issues.push({
        code: "cutoff_too_far",
        variables: ["CLAUDE_LEGACY_TOKEN_CUTOFF_AT"],
        message:
          "CLAUDE_LEGACY_TOKEN_CUTOFF_AT must be no more than 24 hours in the future.",
      });
    }
  }

  for (const group of featureGroups) {
    const configured = group.variables.filter((variable) => hasValue(env[variable]));
    if (configured.length > 0 && configured.length < group.variables.length) {
      const missing = group.variables.filter((variable) => !hasValue(env[variable]));
      issues.push({
        code: "partial_feature",
        variables: [...group.variables],
        message: `${group.name} is partially configured; add ${missing.join(", ")} or remove the feature variables.`,
      });
    }
  }

  if (env.ALLOW_SETUP_MODE?.trim().toLowerCase() === "true") {
    issues.push({
      code: "unsafe_setup_mode",
      variables: ["ALLOW_SETUP_MODE"],
      message: "ALLOW_SETUP_MODE must not be enabled in production.",
    });
  }

  return { production: true, valid: issues.length === 0, issues };
}

export { requiredProductionVariables };

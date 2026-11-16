export type AiTask =
  | "engagement_rank"
  | "networking_rank"
  | "introduction_draft"
  | "ask_answer"
  | "recording_baseline"
  | "contact_enrichment";

export type AiTaskPolicy = {
  task: AiTask;
  feature: "engagement" | "networking" | "ask" | "recordings" | "enrichment";
  promptVersion: string;
  primaryModel: string;
  fallbackModels: string[];
  timeoutMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
};

type AiEnvironment = Readonly<Record<string, string | undefined>>;

const CURRENT_GATEWAY_MODELS = {
  openai: "openai/gpt-5.4",
  anthropic: "anthropic/claude-sonnet-4.6",
} as const;

const taskDefaults: Record<AiTask, Omit<AiTaskPolicy, "task">> = {
  engagement_rank: {
    feature: "engagement",
    promptVersion: "engagement_rank_v2",
    primaryModel: CURRENT_GATEWAY_MODELS.openai,
    fallbackModels: [CURRENT_GATEWAY_MODELS.anthropic],
    timeoutMs: 25_000,
    maxInputTokens: 18_000,
    maxOutputTokens: 2_000,
  },
  networking_rank: {
    feature: "networking",
    promptVersion: "networking_rank_v2",
    primaryModel: CURRENT_GATEWAY_MODELS.anthropic,
    fallbackModels: [CURRENT_GATEWAY_MODELS.openai],
    timeoutMs: 30_000,
    maxInputTokens: 32_000,
    maxOutputTokens: 3_000,
  },
  introduction_draft: {
    feature: "networking",
    promptVersion: "introduction_draft_v2",
    primaryModel: CURRENT_GATEWAY_MODELS.anthropic,
    fallbackModels: [CURRENT_GATEWAY_MODELS.openai],
    timeoutMs: 25_000,
    maxInputTokens: 12_000,
    maxOutputTokens: 1_500,
  },
  ask_answer: {
    feature: "ask",
    promptVersion: "ask_grounded_answer_v1",
    primaryModel: CURRENT_GATEWAY_MODELS.openai,
    fallbackModels: [CURRENT_GATEWAY_MODELS.anthropic],
    timeoutMs: 30_000,
    maxInputTokens: 24_000,
    maxOutputTokens: 2_500,
  },
  recording_baseline: {
    feature: "recordings",
    promptVersion: "recording_baseline_v2",
    primaryModel: CURRENT_GATEWAY_MODELS.anthropic,
    fallbackModels: [CURRENT_GATEWAY_MODELS.openai],
    timeoutMs: 120_000,
    maxInputTokens: 16_000,
    maxOutputTokens: 2_000,
  },
  contact_enrichment: {
    feature: "enrichment",
    promptVersion: "contact_enrichment_v1",
    primaryModel: CURRENT_GATEWAY_MODELS.anthropic,
    fallbackModels: [CURRENT_GATEWAY_MODELS.openai],
    timeoutMs: 120_000,
    maxInputTokens: 30_000,
    maxOutputTokens: 4_000,
  },
};

const modelIdPattern = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/i;

function modelFromEnv(value: string | undefined, fallback: string) {
  const candidate = value?.trim();
  return candidate && modelIdPattern.test(candidate) ? candidate : fallback;
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function taskEnvPrefix(task: AiTask) {
  return `LBB_AI_${task.toUpperCase()}`;
}

export function resolveAiTaskPolicy(
  task: AiTask,
  options: {
    env?: AiEnvironment;
    promptVersion?: string;
  } = {},
): AiTaskPolicy {
  const env = options.env ?? process.env;
  const defaults = taskDefaults[task];
  const prefix = taskEnvPrefix(task);
  const primaryModel = modelFromEnv(
    env[`${prefix}_PRIMARY_MODEL`] ?? env.LBB_AI_PRIMARY_MODEL,
    defaults.primaryModel,
  );
  const fallbackModel = modelFromEnv(
    env[`${prefix}_FALLBACK_MODEL`] ?? env.LBB_AI_FALLBACK_MODEL,
    defaults.fallbackModels[0],
  );

  return {
    task,
    ...defaults,
    promptVersion:
      options.promptVersion?.trim() ||
      env[`${prefix}_PROMPT_VERSION`]?.trim() ||
      defaults.promptVersion,
    primaryModel,
    fallbackModels: fallbackModel === primaryModel ? [] : [fallbackModel],
    timeoutMs: positiveInt(env[`${prefix}_TIMEOUT_MS`], defaults.timeoutMs),
    maxInputTokens: positiveInt(
      env[`${prefix}_MAX_INPUT_TOKENS`],
      defaults.maxInputTokens,
    ),
    maxOutputTokens: positiveInt(
      env[`${prefix}_MAX_OUTPUT_TOKENS`],
      defaults.maxOutputTokens,
    ),
  };
}

export function aiGatewayConfigured(env: AiEnvironment = process.env) {
  return Boolean(
    env.AI_GATEWAY_API_KEY?.trim() ||
      env.VERCEL_OIDC_TOKEN?.trim() ||
      env.VERCEL === "1",
  );
}

export function allAiTaskPolicies(env: AiEnvironment = process.env) {
  return (Object.keys(taskDefaults) as AiTask[]).map((task) =>
    resolveAiTaskPolicy(task, { env }),
  );
}

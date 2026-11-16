import { createHash } from "node:crypto";
import {
  APICallError,
  Output,
  generateText,
  gateway,
  jsonSchema,
} from "ai";
import { resolveAiTaskPolicy, type AiTask } from "./policy.ts";

export type AiFailureKind =
  | "budget"
  | "rate_limit"
  | "timeout"
  | "unavailable"
  | "configuration"
  | "invalid_output";

export type AiGenerationLedgerEntry = {
  status: "completed" | "failed";
  task: AiTask;
  feature: string;
  tenantId: string | null;
  userId: string | null;
  promptVersion: string;
  promptHash: string;
  primaryModel: string;
  fallbackModels: string[];
  servedModel: string | null;
  responseId: string | null;
  gatewayGenerationId: string | null;
  modelAttemptCount: number | null;
  finalProvider: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  finishReason: string | null;
  errorKind: AiFailureKind | null;
  errorCode: string | null;
};

export type AiGenerationLedger = (
  entry: AiGenerationLedgerEntry,
) => Promise<void> | void;

export type AiExecutionContext = {
  tenantId?: string | null;
  userId?: string | null;
  tags?: string[];
  promptVersion?: string;
  ledger?: AiGenerationLedger;
};

export function assertAiAuditContext(context: AiExecutionContext | undefined) {
  if (context?.tenantId && !context.ledger) {
    throw new AiGenerationError(
      "configuration",
      "ledger_required",
      "Tenant AI cannot run without an append-only audit ledger.",
    );
  }
}

export class AiGenerationError extends Error {
  constructor(
    readonly kind: AiFailureKind,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "AiGenerationError";
  }
}

function nestedStatus(error: unknown): number | null {
  if (APICallError.isInstance(error)) return error.statusCode ?? null;
  if (!error || typeof error !== "object") return null;
  const status = (error as { statusCode?: unknown }).statusCode;
  if (typeof status === "number") return status;
  const errors = (error as { errors?: unknown }).errors;
  if (Array.isArray(errors)) {
    for (const item of errors) {
      const found = nestedStatus(item);
      if (found !== null) return found;
    }
  }
  return nestedStatus((error as { cause?: unknown }).cause);
}

function retryAfter(error: unknown) {
  if (!APICallError.isInstance(error)) return null;
  const raw = error.responseHeaders?.["retry-after"];
  const seconds = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function classifyAiGenerationError(error: unknown): AiGenerationError {
  if (error instanceof AiGenerationError) return error;
  const status = nestedStatus(error);
  const name =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";

  if (status === 402) {
    return new AiGenerationError(
      "budget",
      "gateway_budget_exceeded",
      "AI capacity is temporarily paused because its budget was reached.",
    );
  }
  if (status === 429) {
    return new AiGenerationError(
      "rate_limit",
      "gateway_rate_limited",
      "AI capacity is busy. The deterministic workflow remains available.",
      retryAfter(error),
    );
  }
  if (status === 408 || /timeout|abort/i.test(name)) {
    return new AiGenerationError(
      "timeout",
      "gateway_timeout",
      "AI took too long. The deterministic workflow remains available.",
    );
  }
  if (status === 401 || status === 403 || status === 400 || status === 404) {
    return new AiGenerationError(
      "configuration",
      `gateway_http_${status}`,
      "AI is not configured for this task.",
    );
  }
  if (status !== null && status >= 500) {
    return new AiGenerationError(
      "unavailable",
      `gateway_http_${status}`,
      "AI is temporarily unavailable. The deterministic workflow remains available.",
    );
  }
  return new AiGenerationError(
    "invalid_output",
    "gateway_generation_failed",
    "AI could not return a grounded result.",
  );
}

export function estimateAiTokens(value: string) {
  return Math.ceil(value.length / 4);
}

function safeTag(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function aiGatewayTags(input: {
  task: AiTask;
  feature: string;
  promptVersion: string;
  tenantId?: string | null;
  extra?: string[];
}) {
  return Array.from(
    new Set(
      [
        "product:little-black-book",
        `feature:${input.feature}`,
        `task:${input.task}`,
        `prompt:${input.promptVersion}`,
        input.tenantId ? `tenant:${input.tenantId}` : "tenant:unattributed",
        ...(input.extra ?? []),
      ]
        .map(safeTag)
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

export function aiGatewayQuotaEntityId(
  tenantId: string | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const enabled = /^(1|true|yes)$/i.test(
    env.LBB_AI_TENANT_QUOTAS_ENABLED?.trim() ?? "",
  );
  const normalizedTenantId = tenantId?.trim();
  return enabled && normalizedTenantId ? normalizedTenantId : undefined;
}

type AiGatewayGenerationAttribution = {
  servedModel: string;
  servedProvider: string;
  gatewayGenerationId: string;
  modelAttemptCount: number;
};

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function gatewayGenerationId(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 &&
    trimmed.length <= 256 &&
    /^gen_[A-Za-z0-9._:-]+$/.test(trimmed)
    ? trimmed
    : null;
}

function gatewayProvider(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(trimmed) ? trimmed : null;
}

/**
 * Resolve the model that Gateway actually served and its Gateway generation ID.
 * The AI SDK model object retains the requested primary model even after a
 * Gateway fallback, so it must not be used for completion attribution.
 */
export function aiGatewayGenerationAttribution(input: {
  providerMetadata: unknown;
  primaryModel: string;
  fallbackModels: readonly string[];
}): AiGatewayGenerationAttribution | null {
  const providerMetadata = objectRecord(input.providerMetadata);
  const gatewayMetadata = objectRecord(providerMetadata?.gateway);
  const routing = objectRecord(gatewayMetadata?.routing);
  const servedModel =
    typeof routing?.canonicalSlug === "string"
      ? routing.canonicalSlug
      : null;
  const allowedModels = new Set([
    input.primaryModel,
    ...input.fallbackModels,
  ]);
  const generationId = gatewayGenerationId(gatewayMetadata?.generationId);
  const rawAttemptCount = routing?.modelAttemptCount;
  const modelAttemptCount =
    typeof rawAttemptCount === "number" &&
    Number.isSafeInteger(rawAttemptCount) &&
    rawAttemptCount >= 1 &&
    rawAttemptCount <= 16
      ? rawAttemptCount
      : null;

  if (
    !servedModel ||
    !allowedModels.has(servedModel) ||
    !generationId ||
    modelAttemptCount === null
  ) {
    return null;
  }

  const servedProvider = gatewayProvider(routing?.finalProvider);
  if (!servedProvider) return null;

  return {
    servedModel,
    servedProvider,
    gatewayGenerationId: generationId,
    modelAttemptCount,
  };
}

async function recordLedger(
  ledger: AiGenerationLedger | undefined,
  entry: AiGenerationLedgerEntry,
  required: boolean,
) {
  if (!ledger) return;
  try {
    await ledger(entry);
  } catch {
    if (required) {
      throw new AiGenerationError(
        "unavailable",
        "ledger_write_failed",
        "AI completed, but its required audit receipt could not be recorded.",
      );
    }
  }
}

export async function generateStructuredAi<T>(input: {
  task: AiTask;
  system: string;
  prompt: string;
  schema: object;
  context?: AiExecutionContext;
}) {
  assertAiAuditContext(input.context);
  const startedAt = Date.now();
  const policy = resolveAiTaskPolicy(input.task, {
    promptVersion: input.context?.promptVersion,
  });
  const promptHash = createHash("sha256")
    .update(`${policy.promptVersion}\0${input.system}\0${input.prompt}`)
    .digest("hex");
  const baseEntry = {
    task: policy.task,
    feature: policy.feature,
    tenantId: input.context?.tenantId ?? null,
    userId: input.context?.userId ?? null,
    promptVersion: policy.promptVersion,
    promptHash,
    primaryModel: policy.primaryModel,
    fallbackModels: policy.fallbackModels,
  };

  if (estimateAiTokens(`${input.system}\n${input.prompt}`) > policy.maxInputTokens) {
    const error = new AiGenerationError(
      "budget",
      "input_token_limit",
      "The evidence set is too large for this AI task.",
    );
    await recordLedger(input.context?.ledger, {
      ...baseEntry,
      status: "failed",
      servedModel: null,
      responseId: null,
      gatewayGenerationId: null,
      modelAttemptCount: null,
      finalProvider: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      latencyMs: Date.now() - startedAt,
      finishReason: null,
      errorKind: error.kind,
      errorCode: error.code,
    }, false);
    throw error;
  }

  try {
    const result = await generateText({
      model: gateway(policy.primaryModel),
      system: input.system,
      prompt: input.prompt,
      output: Output.object({ schema: jsonSchema<T>(input.schema) }),
      maxOutputTokens: policy.maxOutputTokens,
      maxRetries: 1,
      timeout: { totalMs: policy.timeoutMs },
      providerOptions: {
        gateway: {
          models: policy.fallbackModels,
          user: input.context?.userId ?? input.context?.tenantId ?? undefined,
          quotaEntityId: aiGatewayQuotaEntityId(input.context?.tenantId),
          tags: aiGatewayTags({
            task: policy.task,
            feature: policy.feature,
            promptVersion: policy.promptVersion,
            tenantId: input.context?.tenantId,
            extra: input.context?.tags,
          }),
          disallowPromptTraining: true,
        },
      },
      telemetry: {
        functionId: `lbb.${policy.task}.${policy.promptVersion}`,
        recordInputs: false,
        recordOutputs: false,
      },
    });
    const attribution = aiGatewayGenerationAttribution({
      providerMetadata: result.providerMetadata,
      primaryModel: policy.primaryModel,
      fallbackModels: policy.fallbackModels,
    });
    if (!attribution) {
      throw new AiGenerationError(
        "invalid_output",
        "gateway_attribution_invalid",
        "AI completed, but Gateway did not return valid routing attribution.",
      );
    }
    const servedModel = attribution.servedModel;
    await recordLedger(input.context?.ledger, {
      ...baseEntry,
      status: "completed",
      servedModel,
      responseId: result.response.id ?? null,
      gatewayGenerationId: attribution.gatewayGenerationId,
      modelAttemptCount: attribution.modelAttemptCount,
      finalProvider: attribution.servedProvider,
      inputTokens: result.usage.inputTokens ?? null,
      outputTokens: result.usage.outputTokens ?? null,
      totalTokens: result.usage.totalTokens ?? null,
      latencyMs: Date.now() - startedAt,
      finishReason: result.finishReason,
      errorKind: null,
      errorCode: null,
    }, true);
    return {
      output: result.output,
      model: servedModel,
      provider: attribution.servedProvider,
      promptVersion: policy.promptVersion,
      responseId: result.response.id ?? null,
      gatewayGenerationId: attribution.gatewayGenerationId,
      modelAttemptCount: attribution.modelAttemptCount,
      usage: result.usage,
    };
  } catch (cause) {
    const error = classifyAiGenerationError(cause);
    if (error.code !== "ledger_write_failed") await recordLedger(input.context?.ledger, {
      ...baseEntry,
      status: "failed",
      servedModel: null,
      responseId: null,
      gatewayGenerationId: null,
      modelAttemptCount: null,
      finalProvider: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      latencyMs: Date.now() - startedAt,
      finishReason: null,
      errorKind: error.kind,
      errorCode: error.code,
    }, false);
    throw error;
  }
}

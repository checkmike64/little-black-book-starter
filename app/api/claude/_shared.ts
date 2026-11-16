import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  claudeTokenEnvironmentKey,
  resolveClaudeCredential,
  type ClaudeAccessScope,
} from "@/lib/claude-auth";
import { isUuid, resolveClaudeTenantId } from "@/lib/claude-tenant-scope";
import { isProductionRuntime } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const privateHeaders = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
};

const defaultMaxJsonBytes = 1_000_000;

export function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...privateHeaders,
      ...init?.headers,
    },
  });
}

export function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  return token ?? null;
}

export function isValidUuid(value: string) {
  return isUuid(value);
}

export function jsonError(error: string, status = 400) {
  return privateJson({ error }, { status });
}

export async function readClaudeJson<T>(
  request: Request,
  {
    allowEmpty = false,
    maxBytes = defaultMaxJsonBytes,
  }: {
    allowEmpty?: boolean;
    maxBytes?: number;
  } = {},
): Promise<{ body: T; error: null } | { body: null; error: NextResponse }> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) {
    return {
      body: null,
      error: jsonError("JSON body is too large.", 413),
    };
  }

  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return {
      body: null,
      error: jsonError("Request body could not be read."),
    };
  }

  if (raw.length > maxBytes) {
    return {
      body: null,
      error: jsonError("JSON body is too large.", 413),
    };
  }

  if (!raw.trim()) {
    if (allowEmpty) {
      return { body: {} as T, error: null };
    }

    return {
      body: null,
      error: jsonError("JSON body is required."),
    };
  }

  try {
    return { body: JSON.parse(raw) as T, error: null };
  } catch {
    return {
      body: null,
      error: jsonError("Invalid JSON body."),
    };
  }
}

export { claudeTokenEnvironmentKey };
export type { ClaudeAccessScope };

export function authenticateClaudeRequest(
  request: Request,
  scope: ClaudeAccessScope,
) {
  const token = getBearerToken(request);
  const authorization = resolveClaudeCredential(token, scope);

  if (!authorization.authorized) {
    return {
      admin: null,
      error: jsonError("Unauthorized", 401),
    };
  }

  if (authorization.credential === "legacy") {
    console.info("claude_legacy_token_accepted", authorization.telemetry);
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      admin: null,
      error: jsonError("Supabase admin environment is not configured.", 500),
    };
  }

  return {
    admin,
    error: null,
  };
}

export type ClaudeWriteClass = "mechanical" | "proposal";

type ClaudeWriteAuthorization = {
  allowed?: boolean;
  reason?: string;
  duplicate?: boolean;
  used?: number;
  limit?: number;
};

export function claudeWriteRequestKey(scope: string, parts: unknown[]) {
  const digest = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex");
  return `${scope.slice(0, 70)}:${digest}`;
}

export async function authorizeClaudeWrite(input: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  tenantId: string;
  writeClass: ClaudeWriteClass;
  requestKey: string;
  units?: number;
}) {
  const { data, error } = await input.admin.rpc("lbb_authorize_claude_write", {
    p_tenant_id: input.tenantId,
    p_write_class: input.writeClass,
    p_request_key: input.requestKey,
    p_units: input.units ?? 1,
  });

  if (error) {
    return jsonError("Claude write policy could not be verified.", 503);
  }

  const result = (data ?? {}) as ClaudeWriteAuthorization;
  if (result.allowed === true) return null;

  if (result.reason === "daily_quota_exceeded") {
    return privateJson(
      {
        error: "The daily Claude write limit has been reached.",
        code: result.reason,
        used: result.used ?? null,
        limit: result.limit ?? null,
      },
      { status: 429 },
    );
  }

  if (result.reason === "mechanical_writes_disabled") {
    return privateJson(
      {
        error: "Mechanical Claude writes are disabled for this Book.",
        code: result.reason,
      },
      { status: 403 },
    );
  }

  return jsonError("Claude writes are not authorized for this Book.", 403);
}

export function tenantIdFrom(value?: string | null) {
  return resolveClaudeTenantId(
    value,
    process.env.DEFAULT_TENANT_ID,
    isProductionRuntime(),
  );
}

export function cleanText(value: unknown, maxLength = 4000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

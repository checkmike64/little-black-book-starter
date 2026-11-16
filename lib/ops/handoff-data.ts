import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TenantContext } from "@/lib/tenant-context";
import { isValidUuid } from "@/lib/uuid";

export type HandoffJobDetail = {
  id: string;
  tenant_id: string | null;
  job_type: string;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  run_after: string;
  locked_at: string | null;
  created_at: string;
};

export type HandoffContext = {
  contact: Record<string, unknown> | null;
  recent_interactions: Record<string, unknown>[];
  open_promises: Record<string, unknown>[];
  pending_changes: Record<string, unknown>[];
  field_provenance: Record<string, unknown>[];
  errors: string[];
};

function emptyContext(errors: string[] = []): HandoffContext {
  return {
    contact: null,
    recent_interactions: [],
    open_promises: [],
    pending_changes: [],
    field_provenance: [],
    errors,
  };
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids));
}

export async function getHandoffData({
  id,
  context,
}: {
  id: string;
  context: TenantContext | null;
}) {
  if (!context || context.role !== "operator") {
    return {
      setupMode: false,
      job: null,
      context: emptyContext(["Operator access is required."]),
    };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      setupMode: true,
      job: null,
      context: emptyContext(),
    };
  }

  const { data: job } = await admin
    .from("jobs")
    .select(
      "id, tenant_id, job_type, status, attempts, payload, result, run_after, locked_at, created_at",
    )
    .eq("tenant_id", context.tenantId)
    .eq("id", id)
    .maybeSingle();

  const typedJob = (job as HandoffJobDetail | null) ?? null;
  if (!typedJob || !typedJob.tenant_id) {
    return {
      setupMode: false,
      job: typedJob,
      context: emptyContext(
        typedJob ? ["Job is missing tenant ownership."] : [],
      ),
    };
  }

  const contactId =
    typeof typedJob.payload.contact_id === "string" &&
    isValidUuid(typedJob.payload.contact_id)
      ? typedJob.payload.contact_id
      : null;

  if (!contactId) {
    return {
      setupMode: false,
      job: typedJob,
      context: emptyContext(["Job payload does not include a valid contact_id."]),
    };
  }

  const [
    contactResult,
    interactionLinksResult,
    promisesResult,
    pendingResult,
    provenanceResult,
  ] = await Promise.all([
    admin
      .from("contacts")
      .select(
        [
          "id",
          "full_name",
          "email",
          "phone",
          "company_name",
          "company_description",
          "role_title",
          "one_line_summary",
          "trust_level",
          "touch_cadence",
          "relationship_strength",
          "relationship_strength_computed",
          "relationship_strength_override",
          "relationship_strength_reason",
          "relationship_type",
          "last_spoke",
          "met_date",
          "how_we_met",
          "how_i_know_them",
          "why_stay_in_touch",
          "location",
          "time_zone",
          "linkedin",
          "instagram",
          "facebook",
          "x_twitter",
          "youtube",
          "podcast_url",
          "website",
          "birthday",
          "spouse_partner",
          "children",
          "important_dates",
          "current_asks",
          "wants_help_with",
          "what_they_want_more_of",
          "services_offered",
          "ideal_referral",
          "do_not_refer_for",
          "could_refer_me_for",
          "referral_intro_blurb",
          "podcast_fit",
          "primary_category",
          "top_3_tags",
          "keywords",
          "recent_activity",
          "personal_notes",
          "private_notes",
          "source",
          "created_at",
          "updated_at",
        ].join(", "),
      )
      .eq("tenant_id", typedJob.tenant_id)
      .eq("id", contactId)
      .is("archived_at", null)
      .maybeSingle(),
    admin
      .from("interaction_contacts")
      .select("interaction_id")
      .eq("tenant_id", typedJob.tenant_id)
      .eq("contact_id", contactId)
      .limit(12),
    admin
      .from("promises")
      .select("id, direction, promise_text, status, due_on, source, evidence, created_at")
      .eq("tenant_id", typedJob.tenant_id)
      .eq("contact_id", contactId)
      .in("status", ["open", "stopped"])
      .order("created_at", { ascending: false })
      .limit(12),
    admin
      .from("pending_changes")
      .select("id, change_type, summary, risk_level, source, payload, created_at")
      .eq("tenant_id", typedJob.tenant_id)
      .eq("contact_id", contactId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(12),
    admin
      .from("field_provenance")
      .select("field_name, source_type, source_ref, summary, confidence, metadata, created_at")
      .eq("tenant_id", typedJob.tenant_id)
      .eq("table_name", "contacts")
      .eq("record_id", contactId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const interactionIds = uniqueIds(
    ((interactionLinksResult.data ?? []) as { interaction_id: string }[])
      .map((row) => row.interaction_id)
      .filter(isValidUuid),
  );

  const interactionsResult =
    interactionIds.length > 0
      ? await admin
          .from("interactions")
          .select(
            "id, occurred_at, interaction_type, title, summary, source, source_ref, metadata, created_at",
          )
          .eq("tenant_id", typedJob.tenant_id)
          .in("id", interactionIds)
          .order("occurred_at", { ascending: false })
          .limit(12)
      : { data: [], error: null };

  return {
    setupMode: false,
    job: typedJob,
    context: {
      contact: (contactResult.data as Record<string, unknown> | null) ?? null,
      recent_interactions:
        ((interactionsResult.data ?? []) as unknown) as Record<string, unknown>[],
      open_promises:
        ((promisesResult.data ?? []) as unknown) as Record<string, unknown>[],
      pending_changes:
        ((pendingResult.data ?? []) as unknown) as Record<string, unknown>[],
      field_provenance:
        ((provenanceResult.data ?? []) as unknown) as Record<string, unknown>[],
      errors: [
        contactResult.error?.message,
        interactionLinksResult.error?.message,
        promisesResult.error?.message,
        pendingResult.error?.message,
        provenanceResult.error?.message,
        interactionsResult.error?.message,
      ].filter(Boolean) as string[],
    },
  };
}

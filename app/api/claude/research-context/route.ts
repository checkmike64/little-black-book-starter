import {
  authenticateClaudeRequest,
  privateJson,
  tenantIdFrom,
} from "@/app/api/claude/_shared";
import { normalizeExternalContentUrl } from "@/lib/engagement-source";

type ContactResearchRow = {
  id: string;
  full_name: string;
  company_name: string | null;
  role_title: string[] | null;
  one_line_summary: string | null;
  relationship_type: string[] | null;
  relationship_strength: string | null;
  touch_cadence: string | null;
  last_spoke: string | null;
  why_stay_in_touch: string | null;
  current_asks: string | null;
  wants_help_with: string | null;
  services_offered: string[] | null;
  ideal_referral: string | null;
  podcast_fit: string | null;
  top_3_tags: string[] | null;
  linkedin: string | null;
  instagram: string | null;
  facebook: string | null;
  x_twitter: string | null;
  youtube: string | null;
  podcast_url: string | null;
  website: string | null;
  engagement_target_per_month: number | null;
};

type WantToKnowResearchRow = {
  id: string;
  full_name: string;
  company: string | null;
  lane: string | null;
  stage: string;
  bucket: string | null;
  why: string | null;
  linkedin: string | null;
  dossier: Record<string, unknown> | null;
  engagement_target_per_month: number | null;
};

type EngagedResearchRow = {
  contact_id: string | null;
  want_to_know_id: string | null;
  engaged_at: string;
};

function boundedInteger(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0
    ? Math.min(parsed, max)
    : fallback;
}

function publicUrl(value: string | null) {
  return value ? normalizeExternalContentUrl(value) : null;
}

function publicProfiles(contact: ContactResearchRow) {
  return {
    linkedin: publicUrl(contact.linkedin),
    instagram: publicUrl(contact.instagram),
    facebook: publicUrl(contact.facebook),
    x: publicUrl(contact.x_twitter),
    youtube: publicUrl(contact.youtube),
    podcast: publicUrl(contact.podcast_url),
    website: publicUrl(contact.website),
  };
}

function hasPublicProfile(profiles: ReturnType<typeof publicProfiles>) {
  return Object.values(profiles).some(Boolean);
}

function cleanDossier(dossier: Record<string, unknown> | null) {
  const value = dossier ?? {};
  const text = (key: string) =>
    typeof value[key] === "string" ? String(value[key]).trim().slice(0, 500) : null;
  return {
    goal: text("goal"),
    look_for: text("look_for"),
    next_touch: text("next_touch"),
  };
}

function researchTargetKey(row: {
  contact_id: string | null;
  want_to_know_id: string | null;
}) {
  if (row.contact_id) return `contact:${row.contact_id}`;
  if (row.want_to_know_id) return `want:${row.want_to_know_id}`;
  return null;
}

export async function GET(request: Request) {
  const { admin, error } = authenticateClaudeRequest(request, "read");
  if (error) {
    console.info("claude_research_context", {
      endpoint: "/api/claude/research-context",
      outcome: "failed",
      stage: "authentication",
    });
    return error;
  }

  const url = new URL(request.url);
  const tenantId = tenantIdFrom(url.searchParams.get("tenant_id"));
  const limit = Math.max(1, boundedInteger(url.searchParams.get("limit"), 250, 250));
  const offset = boundedInteger(url.searchParams.get("offset"), 0, 5_000);
  if (!tenantId) {
    console.error("claude_research_context", {
      endpoint: "/api/claude/research-context",
      outcome: "failed",
      stage: "tenant_scope",
    });
    return privateJson({ error: "Valid tenant_id is required." }, { status: 400 });
  }

  const [contactsResult, prospectsResult, engagementHistoryResult] =
    await Promise.all([
    admin
      .from("contacts")
      .select(
        "id, full_name, company_name, role_title, one_line_summary, relationship_type, relationship_strength, touch_cadence, last_spoke, why_stay_in_touch, current_asks, wants_help_with, services_offered, ideal_referral, podcast_fit, top_3_tags, linkedin, instagram, facebook, x_twitter, youtube, podcast_url, website, engagement_target_per_month",
      )
      .eq("tenant_id", tenantId)
      .is("archived_at", null)
      .order("full_name", { ascending: true })
      .range(offset, offset + limit - 1),
    admin
      .from("want_to_know")
      .select(
        "id, full_name, company, lane, stage, bucket, why, linkedin, dossier, engagement_target_per_month",
      )
      .eq("tenant_id", tenantId)
      .neq("stage", "graduated")
      .not("owner_selected_at", "is", null)
      .order("full_name", { ascending: true })
      .range(offset, offset + limit - 1),
    admin
      .from("signals")
      .select("contact_id, want_to_know_id, engaged_at")
      .eq("tenant_id", tenantId)
      .not("engaged_at", "is", null)
      .order("engaged_at", { ascending: false })
      .limit(500),
    ]);

  if (
    contactsResult.error ||
    prospectsResult.error ||
    engagementHistoryResult.error
  ) {
    const failure = {
      endpoint: "/api/claude/research-context",
      outcome: "failed",
      stage: "research_context_query",
      offset,
      limit,
      error:
        contactsResult.error?.message ??
        prospectsResult.error?.message ??
        engagementHistoryResult.error?.message ??
        "Research context could not be loaded.",
    };
    console.error("claude_research_context", failure);
    await admin.from("audit_log").insert({
      tenant_id: tenantId,
      actor_type: "claude",
      action: "research_context.read_failed",
      metadata: failure,
    });
    return privateJson(
      { error: "Research context could not be loaded." },
      { status: 500 },
    );
  }

  const lastEngagedByTarget = new Map<string, string>();
  for (const row of
    (engagementHistoryResult.data ?? []) as EngagedResearchRow[]) {
    const key = researchTargetKey(row);
    if (key && !lastEngagedByTarget.has(key)) {
      lastEngagedByTarget.set(key, row.engaged_at);
    }
  }

  const contacts = ((contactsResult.data ?? []) as ContactResearchRow[]).flatMap(
    (contact) => {
      const profiles = publicProfiles(contact);
      if (!hasPublicProfile(profiles)) return [];
      return [{
        id: contact.id,
        name: contact.full_name,
        company: contact.company_name,
        roles: contact.role_title ?? [],
        public_profiles: profiles,
        relationship_context: {
          summary: contact.one_line_summary,
          relationship_types: contact.relationship_type ?? [],
          relationship_strength: contact.relationship_strength,
          touch_cadence: contact.touch_cadence,
          last_spoke: contact.last_spoke,
          last_engaged_at:
            lastEngagedByTarget.get(`contact:${contact.id}`) ?? null,
          why_stay_in_touch: contact.why_stay_in_touch,
          current_asks: contact.current_asks,
          wants_help_with: contact.wants_help_with,
          services_offered: contact.services_offered ?? [],
          ideal_referral: contact.ideal_referral,
          podcast_fit: contact.podcast_fit,
          tags: contact.top_3_tags ?? [],
          engagement_target_per_month: contact.engagement_target_per_month,
        },
      }];
    },
  );

  const wantToKnow = (
    (prospectsResult.data ?? []) as WantToKnowResearchRow[]
  ).flatMap((prospect) => {
    const linkedin = publicUrl(prospect.linkedin);
    if (!linkedin) return [];
    return [{
      id: prospect.id,
      name: prospect.full_name,
      company: prospect.company,
      public_profiles: { linkedin },
      relationship_context: {
        lane: prospect.lane,
        stage: prospect.stage,
        bucket: prospect.bucket,
        why: prospect.why,
        last_engaged_at:
          lastEngagedByTarget.get(`want:${prospect.id}`) ?? null,
        dossier: cleanDossier(prospect.dossier),
        engagement_target_per_month: prospect.engagement_target_per_month,
      },
    }];
  });

  const metadata = {
    endpoint: "/api/claude/research-context",
    outcome: "succeeded",
    offset,
    limit,
    contacts_returned: contacts.length,
    want_to_know_returned: wantToKnow.length,
    contacts_page_size: contactsResult.data?.length ?? 0,
    want_to_know_page_size: prospectsResult.data?.length ?? 0,
  };
  console.info("claude_research_context", metadata);
  const [auditResult, usageResult] = await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: tenantId,
      actor_type: "claude",
      action: "research_context.read",
      metadata,
    }),
    admin.from("usage_events").insert({
      tenant_id: tenantId,
      actor_type: "claude",
      event_type: "research_context_read",
      quantity: contacts.length + wantToKnow.length,
      unit: "research_target",
      metadata,
    }),
  ]);
  if (auditResult.error || usageResult.error) {
    console.error("claude_research_context_heartbeat_failed", {
      endpoint: "/api/claude/research-context",
      auditError: auditResult.error?.message ?? null,
      usageError: usageResult.error?.message ?? null,
    });
  }

  return privateJson({
    generated_at: new Date().toISOString(),
    contacts,
    want_to_know: wantToKnow,
    pagination: {
      offset,
      limit,
      has_more:
        (contactsResult.data?.length ?? 0) === limit ||
        (prospectsResult.data?.length ?? 0) === limit,
    },
  });
}

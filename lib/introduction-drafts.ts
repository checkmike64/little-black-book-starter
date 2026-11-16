import "server-only";

import {
  generateIntroductionEmail,
  type IntroductionEmailPerson,
} from "@/lib/automation/llm";
import { introductionEvidenceFacts } from "@/lib/ai/introduction-grounding";
import type { AdminClient } from "@/lib/server-action-context";
import type { TenantSettings } from "@/lib/tenant-settings";
import { createAiGenerationLedger } from "@/lib/ai/ledger";

type ContactRow = {
  id: string;
  full_name: string;
  company_name: string | null;
  role_title: string[] | null;
  relationship_type: string[] | null;
  how_we_met: string | null;
  why_stay_in_touch: string | null;
  current_asks: string | null;
  wants_help_with: string | null;
  ideal_referral: string | null;
  recent_activity: string | null;
};

type InteractionRow = {
  id: string;
  occurred_at: string;
  interaction_type: string;
  title: string | null;
  summary: string | null;
};

type PromiseRow = {
  id: string;
  contact_id: string;
  direction: string;
  promise_text: string;
  due_on: string | null;
};

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || "there";
}

function interactionLine(interaction: InteractionRow) {
  const detail = interaction.summary || interaction.title || interaction.interaction_type;
  return `${interaction.occurred_at.slice(0, 10)}: ${detail.replace(/\s+/g, " ").trim()}`;
}

function relationshipLine({
  contact,
  interactions,
  groups,
}: {
  contact: ContactRow;
  interactions: InteractionRow[];
  groups: string[];
}) {
  if (contact.how_we_met?.trim()) return contact.how_we_met.trim();
  const recent = interactions[0];
  if (recent) {
    const topic = recent.summary || recent.title || recent.interaction_type;
    return `We spoke on ${recent.occurred_at.slice(0, 10)} about ${topic.replace(/\s+/g, " ").trim()}.`;
  }
  if (groups[0]) return `We know each other through ${groups[0]}.`;
  if (contact.relationship_type?.[0]) {
    return `They are part of my ${contact.relationship_type[0]} network.`;
  }
  return null;
}

export async function generateAndStoreIntroductionDraft(input: {
  admin: AdminClient;
  tenantId: string;
  introductionId: string;
  settings: TenantSettings;
  userId: string;
  requestId?: string;
  revisionGuidance?: string;
}) {
  const { admin, tenantId, introductionId, settings } = input;
  const { data: introduction, error: introductionError } = await admin
    .from("introductions")
    .select("id, person_a, person_b, why_context, draft_evidence")
    .eq("tenant_id", tenantId)
    .eq("id", introductionId)
    .single();
  if (
    introductionError ||
    !introduction?.person_a ||
    !introduction.person_b ||
    !introduction.why_context
  ) return null;

  const priorEvidence =
    introduction.draft_evidence &&
    typeof introduction.draft_evidence === "object" &&
    !Array.isArray(introduction.draft_evidence)
      ? (introduction.draft_evidence as Record<string, unknown>)
      : {};
  const reasonFacts =
    [
      "connection.matched_terms",
      "connection.current_contact_match",
    ].includes(String(priorEvidence.reason_source ?? "")) &&
    Array.isArray(priorEvidence.reason_facts)
      ? priorEvidence.reason_facts
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.replace(/\s+/g, " ").trim().slice(0, 120))
          .filter(Boolean)
          .slice(0, 8)
      : [];
  if (reasonFacts.length === 0) return null;

  const contactIds = [introduction.person_a, introduction.person_b];
  const [contactsResult, linksResult, promisesResult, groupsResult] = await Promise.all([
    admin
      .from("contacts")
      .select("id, full_name, company_name, role_title, relationship_type, how_we_met, why_stay_in_touch, current_asks, wants_help_with, ideal_referral, recent_activity")
      .eq("tenant_id", tenantId)
      .in("id", contactIds),
    admin
      .from("interaction_contacts")
      .select("interaction_id, contact_id")
      .eq("tenant_id", tenantId)
      .in("contact_id", contactIds)
      .limit(200),
    admin
      .from("promises")
      .select("id, contact_id, direction, promise_text, due_on")
      .eq("tenant_id", tenantId)
      .in("contact_id", contactIds)
      .eq("status", "open")
      .limit(30),
    admin
      .from("relationship_context_memberships")
      .select("contact_id, relationship_contexts!inner(name)")
      .eq("tenant_id", tenantId)
      .in("contact_id", contactIds)
      .eq("verification_state", "confirmed")
      .limit(100),
  ]);
  if (contactsResult.error || linksResult.error || promisesResult.error || groupsResult.error) {
    return null;
  }

  const contacts = (contactsResult.data ?? []) as ContactRow[];
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const personA = contactById.get(introduction.person_a);
  const personB = contactById.get(introduction.person_b);
  if (!personA || !personB) return null;

  const links = linksResult.data ?? [];
  const interactionIds = [...new Set(links.map((row) => row.interaction_id))];
  const interactionsResult = interactionIds.length
    ? await admin
        .from("interactions")
        .select("id, occurred_at, interaction_type, title, summary")
        .eq("tenant_id", tenantId)
        .in("id", interactionIds)
        .order("occurred_at", { ascending: false })
        .limit(40)
    : { data: [] as InteractionRow[], error: null };
  if (interactionsResult.error) return null;

  const interactions = (interactionsResult.data ?? []) as InteractionRow[];
  const interactionById = new Map(interactions.map((interaction) => [interaction.id, interaction]));
  const promises = (promisesResult.data ?? []) as PromiseRow[];
  const groupRows = groupsResult.data ?? [];

  const groupNamesFor = (contactId: string) =>
    groupRows
      .filter((row) => row.contact_id === contactId)
      .flatMap((row) => {
        const related = row.relationship_contexts as unknown;
        if (Array.isArray(related)) {
          return related
            .map((item) =>
              item && typeof item === "object" && "name" in item
                ? String(item.name)
                : null,
            )
            .filter((name): name is string => Boolean(name));
        }
        return related && typeof related === "object" && "name" in related
          ? [String(related.name)]
          : [];
      });

  const contextFor = (contact: ContactRow): IntroductionEmailPerson => {
    const recentInteractions = links
      .filter((link) => link.contact_id === contact.id)
      .map((link) => interactionById.get(link.interaction_id))
      .filter((row): row is InteractionRow => Boolean(row))
      .slice(0, 6);
    const groups = groupNamesFor(contact.id);
    return {
      first_name: firstName(contact.full_name),
      full_name: contact.full_name,
      company: contact.company_name,
      role: contact.role_title?.join(", ") ?? null,
      how_we_met: contact.how_we_met,
      how_i_know_them: relationshipLine({
        contact,
        interactions: recentInteractions,
        groups,
      }),
      why_stay_in_touch: contact.why_stay_in_touch,
      current_asks: contact.current_asks,
      wants_help_with: contact.wants_help_with,
      referral_fit: contact.ideal_referral,
      recent_activity: contact.recent_activity,
      relationship_notes: null,
      recent_interactions: recentInteractions.map(interactionLine),
      open_promises: promises
        .filter((promise) => promise.contact_id === contact.id)
        .slice(0, 6)
        .map((promise) =>
          `${promise.direction}: ${promise.promise_text}${promise.due_on ? ` (due ${promise.due_on})` : ""}`,
        ),
      groups,
    };
  };

  const draftInput = {
    reason: `The source-backed fit is: ${reasonFacts.join(", ")}.`,
    reason_verified: true,
    revision_guidance: input.revisionGuidance,
    voice: settings.voice_profile,
    person_a: contextFor(personA),
    person_b: contextFor(personB),
  };
  const email = await generateIntroductionEmail(draftInput, {
    tenantId,
    userId: input.userId,
    tags: ["trigger:owner_draft"],
    ledger: createAiGenerationLedger(admin),
  });
  if (!email) return null;

  const generatedAt = new Date().toISOString();
  const evidence = {
    ...priorEvidence,
    contact_ids: contactIds,
    interaction_ids: links.map((row) => row.interaction_id).slice(0, 20),
    promise_ids: promises.map((promise) => promise.id).slice(0, 20),
    generated_from: "relationship_context_v1",
    prompt_version: email.prompt_version,
    facts: introductionEvidenceFacts(draftInput),
    claims: email.claims,
    ...(input.requestId
      ? {
          draft_status: "ready",
          draft_completed_at: generatedAt,
          draft_error_code: null,
          draft_revision_guidance: null,
        }
      : {}),
  };
  let updateQuery = admin
    .from("introductions")
    .update({
      draft_subject: email.subject,
      draft_body: email.body,
      draft_generated_at: generatedAt,
      draft_provider: email.provider,
      draft_model: email.model,
      draft_evidence: evidence,
      updated_at: generatedAt,
    })
    .eq("tenant_id", tenantId)
    .eq("id", introductionId);
  if (input.requestId) {
    updateQuery = updateQuery
      .eq("draft_evidence->>draft_request_id", input.requestId)
      .eq("draft_evidence->>draft_status", "running");
  }
  const { data: updated, error: updateError } = await updateQuery
    .select("id")
    .maybeSingle();
  if (updateError || !updated) return null;

  return email;
}

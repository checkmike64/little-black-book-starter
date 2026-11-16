"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantActionContext } from "@/lib/server-action-context";
import {
  redirectToFormReturn,
  redirectWithMessage,
} from "@/lib/server-action-redirect";
import { normalizeCalendarEmail } from "@/lib/calendar-identity";
import { runContentScansForTenant } from "@/lib/automation/content-scans";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { ownerWantToKnowPurpose } from "@/lib/want-to-know-purposes";

const stages = new Set(["watching", "warming", "ready", "graduated"]);
const relationshipPriorities = new Set(["high", "standard", "watch"]);
const programIntensities = new Set(["Low", "Medium", "High"]);
const relationshipStatuses = new Set(["active", "paused", "archived"]);
const eventDirections = new Set(["inbound", "outbound", "mutual", "system"]);
const touchEventTypes = new Set(["touch", "email", "call", "meeting", "message"]);
const eventTypes = new Set([
  ...touchEventTypes,
  "note",
  "research",
  "milestone",
]);

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function returnTo(message: string): never {
  redirectWithMessage("/want-to-know", message);
}

function returnFrom(formData: FormData, message: string, fallback = "/want-to-know"): never {
  redirectToFormReturn(formData, fallback, message);
}

function cleanText(value: unknown, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizedName(value: unknown) {
  return cleanText(value, 300).replace(/\s+/g, " ").toLocaleLowerCase();
}

function actorType(role: "owner" | "operator") {
  return role === "operator" ? "operator" : "client";
}

function programKey(name: string) {
  const slug = name
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "program";
  return `${slug}-${crypto.randomUUID().slice(0, 8)}`;
}

function cleanOptionalUrl(value: unknown) {
  const url = cleanText(value, 1000);
  if (!url) return null;
  return /^https:\/\//i.test(url) ? url : "invalid";
}

async function writeAudit(
  admin: Awaited<ReturnType<typeof requireTenantActionContext>>["admin"],
  context: Awaited<ReturnType<typeof requireTenantActionContext>>["context"],
  row: {
    action: string;
    table_name: string;
    record_id: string;
    before?: unknown;
    after?: unknown;
    metadata?: Record<string, unknown>;
  },
) {
  await admin.from("audit_log").insert({
    tenant_id: context.tenantId,
    actor_user_id: context.userId,
    actor_type: actorType(context.role),
    ...row,
  });
}

async function startOwnerSelectedContentScan({
  admin,
  context,
  wantToKnowId,
}: {
  admin: Awaited<ReturnType<typeof requireTenantActionContext>>["admin"];
  context: Awaited<ReturnType<typeof requireTenantActionContext>>["context"];
  wantToKnowId: string;
}) {
  try {
    const result = await runContentScansForTenant({
      admin,
      tenantId: context.tenantId,
      rawSettings: context.settings,
      force: true,
      priorityWantToKnowIds: [wantToKnowId],
    });
    await writeAudit(admin, context, {
      action: "want_to_know.content_scan_requested",
      table_name: "want_to_know",
      record_id: wantToKnowId,
      metadata: {
        started: result.started,
        failed: result.failed,
        status: result.status,
      },
    });
    return result;
  } catch (caught) {
    const message = caught instanceof Error
      ? cleanText(caught.message, 500)
      : "Content scan could not be started.";
    await writeAudit(admin, context, {
      action: "want_to_know.content_scan_failed",
      table_name: "want_to_know",
      record_id: wantToKnowId,
      metadata: { error: message },
    });
    return {
      started: 0,
      failed: 1,
      available: 0,
      status: "failed" as const,
    };
  }
}

function contentScanMessage(
  result: Awaited<ReturnType<typeof startOwnerSelectedContentScan>>,
  prefix: string,
) {
  const lead = prefix ? `${prefix} ` : "";
  if (result.started > 0) {
    return `${lead}Content scan started.`;
  }
  if (result.status === "no_runs_reserved") {
    return `${lead}Content scan prioritized for the next available provider slot.`;
  }
  if (result.status === "no_due_sources") {
    return `${lead}Add a LinkedIn profile to start automatic content scanning.`;
  }
  return `${lead}Content scanning is temporarily unavailable; the source remains prioritized.`;
}

function revalidateWantToKnow(candidateId?: string) {
  revalidatePath("/want-to-know");
  if (candidateId) revalidatePath(`/want-to-know/${candidateId}`);
  revalidatePath("/engagement");
}

function requireOwner(role: "owner" | "operator", formData: FormData) {
  if (role !== "owner") {
    returnFrom(formData, "Only the Book owner can change relationship programs.");
  }
}

function programValues(formData: FormData) {
  const name = cleanText(formData.get("name"), 80).replace(/\s+/g, " ");
  const lane = cleanText(formData.get("lane"), 80) || null;
  const goal = cleanText(formData.get("goal"), 500) || null;
  const lookFor = cleanText(formData.get("look_for"), 700) || null;
  const intensity = cleanText(formData.get("intensity"), 20) || "Low";
  return { name, lane, goal, look_for: lookFor, intensity };
}

export async function createWantToKnowProgram(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnFrom(formData, "The private data connection is unavailable."),
  );
  requireOwner(context.role, formData);
  const values = programValues(formData);
  if (!values.name) returnFrom(formData, "Give this relationship program a name.");
  if (!programIntensities.has(values.intensity)) {
    returnFrom(formData, "Choose a valid program intensity.");
  }

  const { data: lastProgram } = await admin
    .from("want_to_know_programs")
    .select("sort_order")
    .eq("tenant_id", context.tenantId)
    .neq("status", "archived")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = Number(lastProgram?.sort_order ?? 0) + 10;
  const { data: program, error } = await admin
    .from("want_to_know_programs")
    .insert({
      tenant_id: context.tenantId,
      program_key: programKey(values.name),
      ...values,
      status: "active",
      sort_order: sortOrder,
      provenance: { origin: "owner_created" },
      created_by: context.userId,
      updated_by: context.userId,
    })
    .select("id,name,lane,goal,look_for,intensity,status,sort_order")
    .single();
  if (error || !program) {
    returnFrom(formData, "That relationship program could not be created. Its name may already exist.");
  }

  await writeAudit(admin, context, {
    action: "want_to_know_program.created",
    table_name: "want_to_know_programs",
    record_id: program.id,
    after: program,
  });
  revalidateWantToKnow();
  returnFrom(formData, "Relationship program created.");
}

export async function updateWantToKnowProgram(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnFrom(formData, "The private data connection is unavailable."),
  );
  requireOwner(context.role, formData);
  const id = cleanText(formData.get("program_id"), 80);
  const values = programValues(formData);
  if (!isValidUuid(id) || !values.name) {
    returnFrom(formData, "That relationship program is not valid.");
  }
  if (!programIntensities.has(values.intensity)) {
    returnFrom(formData, "Choose a valid program intensity.");
  }

  const { data: before, error: readError } = await admin
    .from("want_to_know_programs")
    .select("id,name,lane,goal,look_for,intensity,status,sort_order")
    .eq("tenant_id", context.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (readError || !before) {
    returnFrom(formData, "That relationship program is no longer available.");
  }

  const update = { ...values, updated_by: context.userId };
  const { error } = await admin
    .from("want_to_know_programs")
    .update(update)
    .eq("tenant_id", context.tenantId)
    .eq("id", id);
  if (error) {
    returnFrom(formData, "That relationship program could not be updated. Its name may already exist.");
  }

  await writeAudit(admin, context, {
    action: "want_to_know_program.updated",
    table_name: "want_to_know_programs",
    record_id: id,
    before,
    after: update,
  });
  revalidateWantToKnow();
  returnFrom(formData, "Relationship program updated.");
}

async function setWantToKnowProgramStatus(
  formData: FormData,
  status: "active" | "paused" | "archived",
) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnFrom(formData, "The private data connection is unavailable."),
  );
  requireOwner(context.role, formData);
  const id = cleanText(formData.get("program_id"), 80);
  if (!isValidUuid(id) || !relationshipStatuses.has(status)) {
    returnFrom(formData, "That relationship program is not valid.");
  }

  const { data: before, error: readError } = await admin
    .from("want_to_know_programs")
    .select("id,name,status,paused_at,archived_at")
    .eq("tenant_id", context.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (readError || !before) {
    returnFrom(formData, "That relationship program is no longer available.");
  }
  if (before.status === status) {
    returnFrom(formData, `That relationship program is already ${status}.`);
  }

  if (status === "archived") {
    const { count, error: countError } = await admin
      .from("want_to_know")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", context.tenantId)
      .eq("program_id", id)
      .neq("relationship_status", "archived");
    if (countError) returnFrom(formData, "That relationship program could not be checked.");
    if ((count ?? 0) > 0) {
      returnFrom(formData, "Pause this program or move its people before archiving it.");
    }
  }

  const update = { status, updated_by: context.userId };
  const { error } = await admin
    .from("want_to_know_programs")
    .update(update)
    .eq("tenant_id", context.tenantId)
    .eq("id", id);
  if (error) returnFrom(formData, "That relationship program could not be updated.");

  await writeAudit(admin, context, {
    action: `want_to_know_program.${status}`,
    table_name: "want_to_know_programs",
    record_id: id,
    before,
    after: update,
  });
  revalidateWantToKnow();
  returnFrom(
    formData,
    status === "active"
      ? "Relationship program restored."
      : status === "paused"
        ? "Relationship program paused."
        : "Relationship program archived.",
  );
}

export async function pauseWantToKnowProgram(formData: FormData) {
  return setWantToKnowProgramStatus(formData, "paused");
}

export async function restoreWantToKnowProgram(formData: FormData) {
  return setWantToKnowProgramStatus(formData, "active");
}

export async function archiveWantToKnowProgram(formData: FormData) {
  return setWantToKnowProgramStatus(formData, "archived");
}

export async function reorderWantToKnowPrograms(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnFrom(formData, "The private data connection is unavailable."),
  );
  requireOwner(context.role, formData);
  const repeatedIds = formData.getAll("program_id").map((value) => cleanText(value, 80));
  const serializedIds = cleanText(formData.get("program_ids"), 5000)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const programIds = repeatedIds.length > 0 ? repeatedIds : serializedIds;
  if (
    programIds.length === 0
    || programIds.some((id) => !isValidUuid(id))
    || new Set(programIds).size !== programIds.length
  ) {
    returnFrom(formData, "That relationship program order is not valid.");
  }

  const { error } = await admin.rpc("lbb_reorder_want_to_know_programs", {
    p_tenant_id: context.tenantId,
    p_program_ids: programIds,
  });
  if (error) {
    returnFrom(formData, "Relationship programs changed while they were being reordered. Refresh and try again.");
  }

  await writeAudit(admin, context, {
    action: "want_to_know_program.reordered",
    table_name: "want_to_know_programs",
    record_id: programIds[0],
    metadata: { program_ids: programIds },
  });
  revalidateWantToKnow();
  returnFrom(formData, "Relationship programs reordered.");
}

export async function createManualWantToKnow(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnFrom(formData, "The private data connection is unavailable."),
  );
  const fullName = cleanText(formData.get("full_name"), 300).replace(/\s+/g, " ");
  const email = normalizeCalendarEmail(formData.get("email"));
  const company = cleanText(formData.get("company"), 300) || null;
  const linkedin = cleanOptionalUrl(formData.get("linkedin"));
  const engagementFocus = cleanText(formData.get("engagement_focus"), 500) || null;
  const relationshipPriority = cleanText(formData.get("relationship_priority"), 20) || "standard";
  const engagementTarget = Number(formData.get("engagement_target_per_month") ?? 1);
  const requestedProgramId = cleanText(formData.get("program_id"), 80);
  const purpose = ownerWantToKnowPurpose(
    formData.get("purpose"),
    normalizeTenantSettings(context.settings).prospecting.buckets,
  );

  if (!fullName) returnFrom(formData, "Add the person's name.");
  if (!requestedProgramId && !purpose) {
    returnFrom(formData, "Choose why you want to know this person.");
  }
  if (requestedProgramId && !isValidUuid(requestedProgramId)) {
    returnFrom(formData, "Choose a valid relationship program.");
  }
  if (formData.get("email") && !email) {
    returnFrom(formData, "Enter a valid primary email.");
  }
  if (linkedin === "invalid") {
    returnFrom(formData, "Enter a complete LinkedIn URL beginning with https://.");
  }
  if (!relationshipPriorities.has(relationshipPriority)) {
    returnFrom(formData, "Choose a valid relationship priority.");
  }
  if (!Number.isInteger(engagementTarget) || engagementTarget < 0 || engagementTarget > 5) {
    returnFrom(formData, "Choose Watch or between 1 and 5 touches per month.");
  }

  let programQuery = admin
    .from("want_to_know_programs")
    .select("id,name,lane,status")
    .eq("tenant_id", context.tenantId)
    .neq("status", "archived");
  programQuery = requestedProgramId
    ? programQuery.eq("id", requestedProgramId)
    : programQuery.eq("name", purpose?.label ?? "");
  const { data: program, error: programError } = await programQuery.maybeSingle();
  if (programError || !program) {
    returnFrom(formData, "That relationship program is no longer available.");
  }

  const [contactsResult, candidatesResult] = await Promise.all([
    admin
      .from("contacts")
      .select("id,full_name,email", { count: "exact" })
      .eq("tenant_id", context.tenantId)
      .is("archived_at", null)
      .limit(2000),
    admin
      .from("want_to_know")
      .select("id,full_name,email", { count: "exact" })
      .eq("tenant_id", context.tenantId)
      .neq("stage", "graduated")
      .limit(2000),
  ]);
  const contacts = contactsResult.data ?? [];
  const candidates = candidatesResult.data ?? [];
  const complete =
    !contactsResult.error
    && !candidatesResult.error
    && Number.isSafeInteger(contactsResult.count)
    && contactsResult.count === contacts.length
    && Number.isSafeInteger(candidatesResult.count)
    && candidatesResult.count === candidates.length;
  if (!complete) {
    returnFrom(formData, "The Book could not be checked completely for duplicates.");
  }

  const requestedName = normalizedName(fullName);
  const contactMatch = contacts.find((row) =>
    (email && normalizeCalendarEmail(row.email) === email)
    || normalizedName(row.full_name) === requestedName,
  );
  if (contactMatch) returnFrom(formData, "That person is already in the Book.");

  const candidateMatch = candidates.find((row) =>
    (email && normalizeCalendarEmail(row.email) === email)
    || normalizedName(row.full_name) === requestedName,
  );
  if (candidateMatch) returnFrom(formData, "That person is already in Want to Know.");

  const { data: candidate, error } = await admin
    .from("want_to_know")
    .insert({
      tenant_id: context.tenantId,
      full_name: fullName,
      email,
      program_id: program.id,
      bucket: program.name,
      lane: program.lane,
      stage: "watching",
      company,
      linkedin: linkedin || null,
      source: "owner_manual",
      why: `Owner added for ${program.name}.`,
      owner_selected_at: new Date().toISOString(),
      owner_selected_by: context.userId,
      relationship_priority: relationshipPriority,
      engagement_target_per_month: engagementTarget,
      engagement_focus: engagementFocus,
    })
    .select("id")
    .single();
  if (error || !candidate) {
    returnFrom(formData, "That person could not be added to Want to Know.");
  }

  await writeAudit(admin, context, {
    action: "want_to_know.created_by_owner",
    table_name: "want_to_know",
    record_id: candidate.id,
    metadata: {
      program_id: program.id,
      purpose: program.name,
      lane: program.lane,
      relationship_priority: relationshipPriority,
      engagement_target_per_month: engagementTarget,
    },
  });

  const scanResult = linkedin
    ? await startOwnerSelectedContentScan({
        admin,
        context,
        wantToKnowId: candidate.id,
      })
    : null;

  revalidateWantToKnow(candidate.id);
  returnFrom(
    formData,
    scanResult
      ? contentScanMessage(scanResult, "Added to Want to Know.")
      : "Added to Want to Know. Add a LinkedIn profile to start automatic content scanning.",
    `/want-to-know/${candidate.id}`,
  );
}

export async function scanWantToKnowContent(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnFrom(formData, "The private data connection is unavailable."),
  );
  const id = cleanText(formData.get("want_to_know_id"), 80);
  if (!isValidUuid(id)) returnFrom(formData, "That person is not valid.");

  const { data: candidate, error } = await admin
    .from("want_to_know")
    .select("id,linkedin")
    .eq("tenant_id", context.tenantId)
    .eq("id", id)
    .not("owner_selected_at", "is", null)
    .neq("stage", "graduated")
    .maybeSingle();
  if (error || !candidate) {
    returnFrom(formData, "That person is no longer active in Want to Know.");
  }
  if (!candidate.linkedin) {
    returnFrom(formData, "Add a LinkedIn profile before scanning for content.");
  }

  const result = await startOwnerSelectedContentScan({
    admin,
    context,
    wantToKnowId: candidate.id,
  });
  revalidateWantToKnow(candidate.id);
  returnFrom(
    formData,
    contentScanMessage(result, ""),
    `/want-to-know/${candidate.id}`,
  );
}

export async function updateWantToKnowProfile(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnFrom(formData, "The private data connection is unavailable."),
  );
  const id = cleanText(formData.get("want_to_know_id"), 80);
  const fullName = cleanText(formData.get("full_name"), 300).replace(/\s+/g, " ");
  const email = normalizeCalendarEmail(formData.get("email"));
  const company = cleanText(formData.get("company"), 300) || null;
  const linkedin = cleanOptionalUrl(formData.get("linkedin"));
  const programId = cleanText(formData.get("program_id"), 80);
  const stage = cleanText(formData.get("stage"), 30);
  const relationshipPriority = cleanText(formData.get("relationship_priority"), 20);
  const engagementTarget = Number(formData.get("engagement_target_per_month"));
  const engagementFocus = cleanText(formData.get("engagement_focus"), 500) || null;
  const why = cleanText(formData.get("why"), 1000) || null;

  if (!isValidUuid(id) || !fullName || !isValidUuid(programId)) {
    returnFrom(formData, "That profile update is not valid.");
  }
  if (!stages.has(stage) || stage === "graduated") {
    returnFrom(formData, "Use Add to Book to graduate this person.");
  }
  if (!relationshipPriorities.has(relationshipPriority)) {
    returnFrom(formData, "Choose a valid relationship priority.");
  }
  if (!Number.isInteger(engagementTarget) || engagementTarget < 0 || engagementTarget > 5) {
    returnFrom(formData, "Choose Watch or between 1 and 5 touches per month.");
  }
  if (formData.get("email") && !email) {
    returnFrom(formData, "Enter a valid primary email.");
  }
  if (linkedin === "invalid") {
    returnFrom(formData, "Enter a complete LinkedIn URL beginning with https://.");
  }

  const [{ data: before, error: readError }, { data: program, error: programError }] =
    await Promise.all([
      admin
        .from("want_to_know")
        .select(
          "id,full_name,email,company,linkedin,program_id,bucket,lane,stage,relationship_status,relationship_priority,engagement_target_per_month,engagement_focus,why,dossier,source",
        )
        .eq("tenant_id", context.tenantId)
        .eq("id", id)
        .not("owner_selected_at", "is", null)
        .maybeSingle(),
      admin
        .from("want_to_know_programs")
        .select("id,name,lane,status")
        .eq("tenant_id", context.tenantId)
        .eq("id", programId)
        .neq("status", "archived")
        .maybeSingle(),
    ]);
  if (readError || !before) returnFrom(formData, "That person is no longer in Want to Know.");
  if (programError || !program) {
    returnFrom(formData, "That relationship program is no longer available.");
  }

  const [contactsResult, candidatesResult] = await Promise.all([
    admin
      .from("contacts")
      .select("id,full_name,email", { count: "exact" })
      .eq("tenant_id", context.tenantId)
      .is("archived_at", null)
      .limit(2000),
    admin
      .from("want_to_know")
      .select("id,full_name,email", { count: "exact" })
      .eq("tenant_id", context.tenantId)
      .neq("id", id)
      .neq("stage", "graduated")
      .limit(2000),
  ]);
  const contacts = contactsResult.data ?? [];
  const candidates = candidatesResult.data ?? [];
  const duplicateCheckComplete =
    !contactsResult.error
    && !candidatesResult.error
    && Number.isSafeInteger(contactsResult.count)
    && contactsResult.count === contacts.length
    && Number.isSafeInteger(candidatesResult.count)
    && candidatesResult.count === candidates.length;
  if (!duplicateCheckComplete) {
    returnFrom(formData, "The Book could not be checked completely for duplicates.");
  }
  const requestedName = normalizedName(fullName);
  if (
    contacts.some((row) =>
      (email && normalizeCalendarEmail(row.email) === email)
      || normalizedName(row.full_name) === requestedName,
    )
  ) {
    returnFrom(formData, "That profile matches someone already in the Book.");
  }
  if (
    candidates.some((row) =>
      (email && normalizeCalendarEmail(row.email) === email)
      || normalizedName(row.full_name) === requestedName,
    )
  ) {
    returnFrom(formData, "That profile matches another person in Want to Know.");
  }

  const dossier = {
    ...((before.dossier && typeof before.dossier === "object" && !Array.isArray(before.dossier)
      ? before.dossier
      : {}) as Record<string, unknown>),
  };
  const dossierFields = [
    ["dossier_goal", "goal", 700],
    ["dossier_look_for", "look_for", 1000],
    ["dossier_next_touch", "next_touch", 700],
    ["website", "website", 1000],
    ["dossier_notes", "notes", 2000],
  ] as const;
  for (const [formKey, dossierKey, maxLength] of dossierFields) {
    if (!formData.has(formKey)) continue;
    const value = cleanText(formData.get(formKey), maxLength);
    if (value) dossier[dossierKey] = value;
    else delete dossier[dossierKey];
  }
  const website = typeof dossier.website === "string" ? dossier.website : "";
  if (formData.has("website") && website && !/^https:\/\//i.test(website)) {
    returnFrom(formData, "Enter a complete website URL beginning with https://.");
  }

  const update = {
    full_name: fullName,
    email,
    company,
    linkedin: linkedin || null,
    program_id: program.id,
    bucket: program.name,
    lane: program.lane,
    stage,
    relationship_priority: relationshipPriority,
    engagement_target_per_month: engagementTarget,
    engagement_focus: engagementFocus,
    why,
    dossier,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin
    .from("want_to_know")
    .update(update)
    .eq("tenant_id", context.tenantId)
    .eq("id", id)
    .not("owner_selected_at", "is", null);
  if (error) returnFrom(formData, "That profile could not be updated.");

  const changedFields = Object.keys(update).filter(
    (key) => key !== "updated_at"
      && JSON.stringify(before[key as keyof typeof before])
        !== JSON.stringify(update[key as keyof typeof update]),
  );
  await admin.from("want_to_know_events").insert({
    tenant_id: context.tenantId,
    want_to_know_id: id,
    program_id: program.id,
    event_type: "profile_updated",
    is_touch: false,
    occurred_at: new Date().toISOString(),
    title: "Profile updated",
    summary: changedFields.length > 0
      ? `Updated ${changedFields.join(", ")}.`
      : "Profile saved without substantive changes.",
    direction: "system",
    source: "owner_manual",
    metadata: { changed_fields: changedFields },
    created_by: context.userId,
  });
  await writeAudit(admin, context, {
    action: "want_to_know.profile_updated",
    table_name: "want_to_know",
    record_id: id,
    before,
    after: update,
    metadata: { changed_fields: changedFields },
  });

  const scanResult = changedFields.includes("linkedin") && update.linkedin
    ? await startOwnerSelectedContentScan({
        admin,
        context,
        wantToKnowId: id,
      })
    : null;

  revalidateWantToKnow(id);
  returnFrom(
    formData,
    scanResult
      ? contentScanMessage(scanResult, "Profile updated.")
      : "Profile updated.",
    `/want-to-know/${id}`,
  );
}

async function insertWantToKnowEvent(
  formData: FormData,
  defaults: { eventType?: string; title?: string; summary?: string } = {},
) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnFrom(formData, "The private data connection is unavailable."),
  );
  const id = cleanText(formData.get("want_to_know_id"), 80);
  const eventType = cleanText(formData.get("event_type"), 40) || defaults.eventType || "touch";
  const title = cleanText(formData.get("title"), 240) || defaults.title || null;
  const summary = cleanText(formData.get("summary"), 2000) || defaults.summary || null;
  const channel = cleanText(formData.get("channel"), 80) || null;
  const directionValue = cleanText(formData.get("direction"), 20);
  const direction = directionValue || (touchEventTypes.has(eventType) ? "outbound" : "system");
  const sourceRef = cleanText(formData.get("source_ref"), 500) || null;
  const occurredAtValue = cleanText(formData.get("occurred_at"), 80);
  const occurredOn = cleanText(formData.get("occurred_on"), 10);
  const occurredAt = occurredAtValue
    ? new Date(occurredAtValue)
    : /^\d{4}-\d{2}-\d{2}$/.test(occurredOn)
      ? new Date(`${occurredOn}T12:00:00.000Z`)
      : new Date();

  if (!isValidUuid(id) || !eventTypes.has(eventType)) {
    returnFrom(formData, "That relationship event is not valid.");
  }
  if (!eventDirections.has(direction) || Number.isNaN(occurredAt.getTime())) {
    returnFrom(formData, "Choose a valid event date and direction.");
  }
  if (occurredAt.getTime() > Date.now() + 5 * 60 * 1000) {
    returnFrom(formData, "Relationship events cannot be logged in the future.");
  }
  if (!title && !summary) returnFrom(formData, "Add a short note about what happened.");

  const { data: candidate, error: readError } = await admin
    .from("want_to_know")
    .select("id,program_id,relationship_status,full_name")
    .eq("tenant_id", context.tenantId)
    .eq("id", id)
    .not("owner_selected_at", "is", null)
    .maybeSingle();
  if (readError || !candidate) returnFrom(formData, "That person is no longer in Want to Know.");
  if (candidate.relationship_status === "archived" && touchEventTypes.has(eventType)) {
    returnFrom(formData, "Restore this relationship before logging a new touch.");
  }

  const event = {
    tenant_id: context.tenantId,
    want_to_know_id: id,
    program_id: candidate.program_id,
    event_type: eventType,
    is_touch: touchEventTypes.has(eventType),
    occurred_at: occurredAt.toISOString(),
    title,
    summary,
    channel,
    direction,
    source: "owner_manual",
    source_ref: sourceRef,
    metadata: {},
    created_by: context.userId,
  };
  const { data: created, error } = await admin
    .from("want_to_know_events")
    .insert(event)
    .select("id")
    .single();
  if (error || !created) returnFrom(formData, "That relationship event could not be recorded.");

  await writeAudit(admin, context, {
    action: `want_to_know.${eventType}_logged`,
    table_name: "want_to_know_events",
    record_id: created.id,
    after: event,
    metadata: { want_to_know_id: id },
  });
  revalidateWantToKnow(id);
  returnFrom(
    formData,
    touchEventTypes.has(eventType) ? "Touch logged." : "Relationship note added.",
    `/want-to-know/${id}`,
  );
}

export async function logWantToKnowEvent(formData: FormData) {
  return insertWantToKnowEvent(formData);
}

async function setWantToKnowRelationshipStatus(
  formData: FormData,
  relationshipStatus: "active" | "paused" | "archived",
) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnFrom(formData, "The private data connection is unavailable."),
  );
  const id = cleanText(formData.get("want_to_know_id"), 80);
  if (!isValidUuid(id) || !relationshipStatuses.has(relationshipStatus)) {
    returnFrom(formData, "That relationship update is not valid.");
  }

  const { data: before, error: readError } = await admin
    .from("want_to_know")
    .select("id,program_id,full_name,relationship_status,paused_at,archived_at")
    .eq("tenant_id", context.tenantId)
    .eq("id", id)
    .not("owner_selected_at", "is", null)
    .maybeSingle();
  if (readError || !before) returnFrom(formData, "That person is no longer in Want to Know.");
  if (before.relationship_status === relationshipStatus) {
    returnFrom(formData, `That relationship is already ${relationshipStatus}.`);
  }

  const update = { relationship_status: relationshipStatus, updated_at: new Date().toISOString() };
  const { error } = await admin
    .from("want_to_know")
    .update(update)
    .eq("tenant_id", context.tenantId)
    .eq("id", id)
    .not("owner_selected_at", "is", null);
  if (error) returnFrom(formData, "That relationship could not be updated.");

  const eventType = relationshipStatus === "active"
    ? "relationship_restored"
    : relationshipStatus === "paused"
      ? "relationship_paused"
      : "relationship_archived";
  await admin.from("want_to_know_events").insert({
    tenant_id: context.tenantId,
    want_to_know_id: id,
    program_id: before.program_id,
    event_type: eventType,
    is_touch: false,
    occurred_at: new Date().toISOString(),
    title: relationshipStatus === "active"
      ? "Relationship restored"
      : relationshipStatus === "paused"
        ? "Relationship paused"
        : "Relationship archived",
    direction: "system",
    source: "owner_manual",
    metadata: { from: before.relationship_status, to: relationshipStatus },
    created_by: context.userId,
  });
  await writeAudit(admin, context, {
    action: `want_to_know.relationship_${relationshipStatus}`,
    table_name: "want_to_know",
    record_id: id,
    before,
    after: update,
  });

  revalidateWantToKnow(id);
  returnFrom(
    formData,
    relationshipStatus === "active"
      ? "Relationship restored."
      : relationshipStatus === "paused"
        ? "Relationship paused."
        : "Relationship archived.",
    relationshipStatus === "archived" ? "/want-to-know" : `/want-to-know/${id}`,
  );
}

export async function pauseWantToKnowRelationship(formData: FormData) {
  return setWantToKnowRelationshipStatus(formData, "paused");
}

export async function restoreWantToKnowRelationship(formData: FormData) {
  return setWantToKnowRelationshipStatus(formData, "active");
}

export async function archiveWantToKnowRelationship(formData: FormData) {
  return setWantToKnowRelationshipStatus(formData, "archived");
}

export async function updateWantToKnowPlan(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnFrom(formData, "The private data connection is unavailable."),
  );
  const id = cleanText(formData.get("want_to_know_id"), 80);
  const relationshipPriority = cleanText(formData.get("relationship_priority"), 20);
  const engagementTarget = Number(formData.get("engagement_target_per_month"));
  const engagementFocus = cleanText(formData.get("engagement_focus"), 500) || null;

  if (!isValidUuid(id) || !relationshipPriorities.has(relationshipPriority)) {
    returnFrom(formData, "That relationship plan is not valid.");
  }
  if (!Number.isInteger(engagementTarget) || engagementTarget < 0 || engagementTarget > 5) {
    returnFrom(formData, "Choose Watch or between 1 and 5 touches per month.");
  }

  const { data: before, error: readError } = await admin
    .from("want_to_know")
    .select("id,relationship_priority,engagement_target_per_month,engagement_focus")
    .eq("tenant_id", context.tenantId)
    .eq("id", id)
    .not("owner_selected_at", "is", null)
    .maybeSingle();
  if (readError || !before) {
    returnFrom(formData, "That person is no longer in Want to Know.");
  }

  const update = {
    relationship_priority: relationshipPriority,
    engagement_target_per_month: engagementTarget,
    engagement_focus: engagementFocus,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin
    .from("want_to_know")
    .update(update)
    .eq("tenant_id", context.tenantId)
    .eq("id", id)
    .not("owner_selected_at", "is", null);
  if (error) returnFrom(formData, "That relationship plan could not be updated.");

  await admin.from("audit_log").insert({
    tenant_id: context.tenantId,
    actor_user_id: context.userId,
    actor_type: "client",
    action: "want_to_know.plan_updated",
    table_name: "want_to_know",
    record_id: id,
    before,
    after: update,
  });

  revalidatePath("/want-to-know");
  revalidatePath("/engagement");
  returnFrom(formData, "Relationship plan updated.");
}

function words(value: string | null) {
  return (value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
}

function overlapScore(left: string | null, right: string | null) {
  const leftWords = new Set(words(left));
  return words(right).filter((word) => leftWords.has(word)).length;
}

function candidateTags({
  bucket,
  lane,
}: {
  bucket: string | null;
  lane: string | null;
}) {
  return Array.from(
    new Set(
      [bucket, lane, "Want to Know"]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).slice(0, 3);
}

function dossierText(dossier: Record<string, unknown> | null, key: string) {
  const value = dossier?.[key];
  return typeof value === "string" ? value.trim() : "";
}

type WantToKnowCandidate = {
  id: string;
  tenant_id: string;
  full_name: string;
  bucket: string | null;
  lane: string | null;
  stage: string;
  company: string | null;
  source: string | null;
  why: string | null;
  linkedin: string | null;
  dossier: Record<string, unknown> | null;
  engagement_count: number | null;
  last_touch: string | null;
};

type ContactDuplicateOption = {
  id: string;
  full_name: string;
  company_name: string | null;
  email: string | null;
  one_line_summary: string | null;
};

function duplicateCandidates({
  candidate,
  contacts,
}: {
  candidate: WantToKnowCandidate;
  contacts: ContactDuplicateOption[];
}) {
  return contacts
    .map((contact) => {
      const nameScore = overlapScore(candidate.full_name, contact.full_name);
      const companyScore = overlapScore(candidate.company, contact.company_name);
      const score =
        nameScore * 4 +
        companyScore * 2 +
        (candidate.full_name.toLowerCase() === contact.full_name.toLowerCase()
          ? 10
          : 0);

      return { contact, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.contact.full_name.localeCompare(b.contact.full_name))
    .slice(0, 5)
    .map(({ contact, score }) => ({
      id: contact.id,
      full_name: contact.full_name,
      company_name: contact.company_name,
      email: contact.email,
      reason: `Potential overlap from Want to Know graduation review. Match score ${score}.`,
    }));
}

export async function updateWantToKnowStage(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnFrom(formData, "Supabase admin environment is not configured."),
  );
  const id = String(formData.get("want_to_know_id") ?? "");
  const stage = String(formData.get("stage") ?? "");

  if (!isValidUuid(id) || !stages.has(stage)) {
    returnFrom(formData, "That stage update is not valid.");
  }
  if (stage === "graduated") {
    returnFrom(formData, "Use Add to Book to graduate this person.");
  }

  const { data: before, error: readError } = await admin
    .from("want_to_know")
    .select("id, tenant_id, full_name, stage, bucket, lane")
    .eq("tenant_id", context.tenantId)
    .eq("id", id)
    .single();

  if (readError || !before) {
    returnFrom(formData, "That candidate is no longer available.");
  }

  const update = {
    stage,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from("want_to_know")
    .update(update)
    .eq("tenant_id", context.tenantId)
    .eq("id", id);

  if (error) {
    returnFrom(formData, "The candidate could not be updated.");
  }

  await admin.from("audit_log").insert({
    tenant_id: context.tenantId,
    actor_user_id: context.userId,
    actor_type: "client",
    action: "want_to_know.stage_updated",
    table_name: "want_to_know",
    record_id: id,
    before,
    after: update,
  });

  revalidatePath("/want-to-know");
  revalidatePath("/engagement");
  returnFrom(formData, "Candidate stage updated.");
}

export async function logWantToKnowTouch(formData: FormData) {
  return insertWantToKnowEvent(formData, {
    eventType: "touch",
    title: "Touch logged",
    summary: "Owner recorded a relationship touch.",
  });
}

export async function proposeWantToKnowGraduation(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnTo("Supabase admin environment is not configured."),
  );
  const id = String(formData.get("want_to_know_id") ?? "");

  if (!isValidUuid(id)) returnTo("Choose a valid Want to Know candidate.");

  const { data: candidate, error: candidateError } = await admin
    .from("want_to_know")
    .select(
      "id, tenant_id, full_name, bucket, lane, stage, company, source, why, linkedin, dossier, engagement_count, last_touch",
    )
    .eq("tenant_id", context.tenantId)
    .eq("id", id)
    .single();

  if (candidateError || !candidate) {
    returnTo("That candidate is no longer available.");
  }

  const typedCandidate = candidate as WantToKnowCandidate;
  if (typedCandidate.stage === "graduated") {
    returnTo("That candidate is already marked graduated.");
  }

  const idempotencyKey = `want-to-know-graduation-${typedCandidate.id}`;
  const existing = await admin
    .from("pending_changes")
    .select("id, status")
    .eq("tenant_id", context.tenantId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing.data?.id && existing.data.status === "pending") {
    redirect(`/changes/${existing.data.id}`);
  }

  if (existing.data?.id) {
    returnTo("That graduation proposal was already reviewed.");
  }

  const contactsResult = await admin
    .from("contacts")
    .select("id, full_name, company_name, email, one_line_summary")
    .eq("tenant_id", context.tenantId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(300);

  const duplicates = duplicateCandidates({
    candidate: typedCandidate,
    contacts: ((contactsResult.data ?? []) as unknown) as ContactDuplicateOption[],
  });
  const tags = candidateTags({
    bucket: typedCandidate.bucket,
    lane: typedCandidate.lane,
  });
  const goal = dossierText(typedCandidate.dossier, "goal");
  const lookFor = dossierText(typedCandidate.dossier, "look_for");
  const nextTouch = dossierText(typedCandidate.dossier, "next_touch");
  const summary = `Graduate ${typedCandidate.full_name} from Want to Know into the Book.`;
  const source = typedCandidate.source ?? "want_to_know";

  const payload = {
    contact: {
      full_name: typedCandidate.full_name,
      company_name: cleanText(typedCandidate.company, 240) || null,
      linkedin: cleanText(typedCandidate.linkedin, 500) || null,
      one_line_summary:
        `Graduated from Want to Know${typedCandidate.bucket ? ` / ${typedCandidate.bucket}` : ""}.`,
      relationship_type: tags,
      why_stay_in_touch: null,
      how_we_met: source
        ? `Want to Know source: ${cleanText(source, 240)}`
        : "Graduated from Want to Know.",
      recent_activity: [
        `Want to Know stage: ${typedCandidate.stage}`,
        typedCandidate.bucket ? `Bucket: ${typedCandidate.bucket}` : null,
        typedCandidate.engagement_count
          ? `${typedCandidate.engagement_count} recorded touch${typedCandidate.engagement_count === 1 ? "" : "es"}`
          : null,
        nextTouch ? `Suggested next touch: ${nextTouch}` : null,
      ]
        .filter(Boolean)
        .join(". "),
      top_3_tags: tags,
      keywords: tags,
    },
    evidence: {
      want_to_know_id: typedCandidate.id,
      prospecting_bucket: typedCandidate.bucket,
      lane: typedCandidate.lane,
      stage: typedCandidate.stage,
      source,
      why: typedCandidate.why,
      dossier_goal: goal,
      dossier_look_for: lookFor,
      dossier_next_touch: nextTouch,
      last_touch: typedCandidate.last_touch,
      engagement_count: typedCandidate.engagement_count ?? 0,
    },
    verification: {
      required: true,
      reason:
        "Graduating an outer-ring prospect creates a new Book relationship and should receive duplicate review.",
      owner_question: `Should ${typedCandidate.full_name} become a real Book contact, or should this be merged into an existing person?`,
    },
    duplicate_candidates: duplicates,
    source_ref: `want_to_know:${typedCandidate.id}`,
  };

  const { data: change, error } = await admin
    .from("pending_changes")
    .insert({
      tenant_id: context.tenantId,
      contact_id: null,
      idempotency_key: idempotencyKey,
      change_type: "new_contact",
      summary,
      payload,
      status: "pending",
      source: "want_to_know_graduation",
      proposed_by: "operator",
      risk_level: "high",
    })
    .select("id")
    .single();

  if (error || !change) {
    returnTo("The graduation proposal could not be created.");
  }

  await admin.from("audit_log").insert({
    tenant_id: context.tenantId,
    actor_user_id: context.userId,
    actor_type: "client",
    action: "want_to_know.graduation_proposed",
    table_name: "want_to_know",
    record_id: typedCandidate.id,
    before: typedCandidate,
    after: {
      pending_change_id: change.id,
      change_type: "new_contact",
      summary,
    },
  });

  revalidatePath("/want-to-know");
  revalidatePath("/changes");
  redirect(`/changes/${change.id}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { requireTenantActionContext } from "@/lib/server-action-context";
import { requireOperatorAccess } from "@/lib/operator-access";
import {
  redirectToFormReturn,
  redirectWithMessage,
} from "@/lib/server-action-redirect";

type ConnectionStatusResult = {
  changed?: boolean;
  connection_id?: string;
  contact_a?: string;
  contact_b?: string;
  status?: string;
  snoozed_until?: string | null;
};

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function cleanText(formData: FormData, key: string, maxLength = 500) {
  return String(formData.get(key) ?? "").trim().slice(0, maxLength);
}

function returnToNetworking(formData: FormData, message: string): never {
  redirectToFormReturn(formData, "/networking", message);
}

function revalidateConnection(result: ConnectionStatusResult) {
  revalidatePath("/networking");
  revalidatePath("/dashboard");
  if (result.contact_a) revalidatePath(`/contacts/${result.contact_a}`);
  if (result.contact_b) revalidatePath(`/contacts/${result.contact_b}`);
}

export async function markConnectionAlreadyConnected(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnToNetworking(formData, "Supabase admin environment is not configured."),
  );
  const connectionId = cleanText(formData, "connection_id", 80);
  const captureContext = formData.get("capture_context") !== "false";
  const requestedContextId = cleanText(
    formData,
    "relationship_context_id",
    80,
  );
  const relationshipContextId =
    captureContext && isValidUuid(requestedContextId)
      ? requestedContextId
      : null;
  const relationshipContextName = captureContext
    ? cleanText(formData, "relationship_context_name", 160)
    : "";
  const relationshipContextType = captureContext
    ? cleanText(formData, "relationship_context_type", 40) || "other"
    : "other";
  const ownerNote =
    cleanText(formData, "owner_note") ||
    (relationshipContextName
      ? `Already connected through ${relationshipContextName}.`
      : "They already know each other.");

  if (!isValidUuid(connectionId)) {
    returnToNetworking(formData, "That connection recommendation is not valid.");
  }
  if (captureContext && requestedContextId && !relationshipContextId) {
    returnToNetworking(formData, "That group is not valid.");
  }

  const { data, error } = await admin.rpc("lbb_confirm_connection_context", {
    p_connection_id: connectionId,
    p_tenant_id: context.tenantId,
    p_actor_user_id: context.userId,
    p_owner_note: ownerNote,
    p_context_id: relationshipContextId,
    p_context_name: relationshipContextName || null,
    p_context_type: relationshipContextType,
  });

  if (error || !data) {
    returnToNetworking(formData, "That connection context could not be saved.");
  }
  revalidateConnection(data as ConnectionStatusResult);

  redirectWithMessage(
    `/networking?undo_connection=${encodeURIComponent(connectionId)}`,
    "Marked as already connected. This pair will not be recommended again.",
  );
}

export async function saveRelationshipContext(formData: FormData) {
  await requireOperatorAccess();
  const { admin, context } = await requireTenantActionContext(() =>
    returnToNetworking(formData, "Supabase admin environment is not configured."),
  );
  const requestedContextId = cleanText(formData, "relationship_context_id", 80);
  const relationshipContextId = requestedContextId
    ? isValidUuid(requestedContextId)
      ? requestedContextId
      : null
    : null;
  const name = cleanText(formData, "relationship_context_name", 160);
  const contextType =
    cleanText(formData, "relationship_context_type", 40) || "other";
  const description = cleanText(formData, "relationship_context_description", 1200);
  const contactIds = Array.from(
    new Set(
      formData
        .getAll("contact_ids")
        .map((value) => String(value))
        .filter(isValidUuid),
    ),
  );

  if (requestedContextId && !relationshipContextId) {
    returnToNetworking(formData, "That group is not valid.");
  }
  if (!relationshipContextId && !name) {
    returnToNetworking(formData, "Give the group a name.");
  }
  if (contactIds.length === 0) {
    returnToNetworking(formData, "Add at least one person.");
  }

  const { data, error } = await admin.rpc("lbb_save_relationship_context", {
    p_tenant_id: context.tenantId,
    p_actor_user_id: context.userId,
    p_context_id: relationshipContextId,
    p_name: name,
    p_context_type: contextType,
    p_description: description || null,
    p_contact_ids: contactIds,
  });

  if (error || !data) {
    returnToNetworking(formData, "The group could not be saved.");
  }

  revalidatePath("/networking");
  contactIds.forEach((contactId) => revalidatePath(`/contacts/${contactId}`));
  returnToNetworking(
    formData,
    "Group created.",
  );
}

type ReplacedGroupMembers = {
  previous_contact_ids?: string[];
  contact_ids?: string[];
};

export async function replaceRelationshipGroupMembers(formData: FormData) {
  await requireOperatorAccess();
  const { admin, context } = await requireTenantActionContext(() =>
    returnToNetworking(formData, "Supabase admin environment is not configured."),
  );
  const relationshipContextId = cleanText(
    formData,
    "relationship_context_id",
    80,
  );
  const contactIds = Array.from(
    new Set(
      formData
        .getAll("contact_ids")
        .map((value) => String(value))
        .filter(isValidUuid),
    ),
  );

  if (!isValidUuid(relationshipContextId)) {
    returnToNetworking(formData, "That group is not valid.");
  }
  if (contactIds.length > 100) {
    returnToNetworking(formData, "A group can include up to 100 people.");
  }

  const { data, error } = await admin.rpc(
    "lbb_replace_relationship_context_members",
    {
      p_tenant_id: context.tenantId,
      p_actor_user_id: context.userId,
      p_context_id: relationshipContextId,
      p_contact_ids: contactIds,
    },
  );

  if (error || !data) {
    returnToNetworking(formData, "The group could not be updated.");
  }

  const result = data as ReplacedGroupMembers;
  revalidatePath("/networking");
  new Set([
    ...(result.previous_contact_ids ?? []),
    ...(result.contact_ids ?? []),
  ]).forEach((contactId) => revalidatePath(`/contacts/${contactId}`));
  returnToNetworking(formData, "Group updated.");
}

export async function blockConnectionRecommendation(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnToNetworking(formData, "Supabase admin environment is not configured."),
  );
  const connectionId = cleanText(formData, "connection_id", 80);
  const ownerNote =
    cleanText(formData, "owner_note") ||
    "I do not want these people connected.";

  if (!isValidUuid(connectionId)) {
    returnToNetworking(formData, "That connection recommendation is not valid.");
  }

  const { data, error } = await admin.rpc("block_connection_recommendation", {
    p_connection_id: connectionId,
    p_tenant_id: context.tenantId,
    p_actor_user_id: context.userId,
    p_owner_note: ownerNote,
  });

  if (error || !data) {
    returnToNetworking(formData, "That connection could not be blocked.");
  }

  revalidateConnection(data as ConnectionStatusResult);
  redirectWithMessage(
    `/networking?undo_connection=${encodeURIComponent(connectionId)}`,
    "Marked do not connect. This pair will not be recommended again.",
  );
}

export async function snoozeConnectionRecommendation(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnToNetworking(formData, "Supabase admin environment is not configured."),
  );
  const connectionId = cleanText(formData, "connection_id", 80);

  if (!isValidUuid(connectionId)) {
    returnToNetworking(formData, "That connection recommendation is not valid.");
  }

  const { data, error } = await admin.rpc("snooze_connection_recommendation", {
    p_connection_id: connectionId,
    p_tenant_id: context.tenantId,
    p_actor_user_id: context.userId,
  });

  if (error || !data) {
    returnToNetworking(formData, "That recommendation could not be skipped.");
  }

  revalidateConnection(data as ConnectionStatusResult);
  redirectWithMessage(
    `/networking?undo_connection=${encodeURIComponent(connectionId)}`,
    "Skipped for 45 days.",
  );
}

export async function restoreConnectionRecommendation(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnToNetworking(formData, "Supabase admin environment is not configured."),
  );
  const connectionId = cleanText(formData, "connection_id", 80);
  if (!isValidUuid(connectionId)) {
    returnToNetworking(formData, "That connection recommendation is not valid.");
  }

  const { data, error } = await admin.rpc("lbb_restore_connection_recommendation", {
    p_connection_id: connectionId,
    p_tenant_id: context.tenantId,
    p_actor_user_id: context.userId,
  });
  if (error || !data) {
    returnToNetworking(formData, "That connection could not be restored.");
  }
  const result = data as ConnectionStatusResult;
  revalidateConnection(result);

  returnToNetworking(
    formData,
    result.changed !== false
      ? "Connection restored to the recommendation queue."
      : "That connection was already in the recommendation queue.",
  );
}

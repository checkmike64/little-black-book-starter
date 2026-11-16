"use server";

import { revalidatePath } from "next/cache";
import { requireTenantActionContext } from "@/lib/server-action-context";
import { refillEngagementRecommendations } from "@/lib/automation/engagement-refill";
import {
  redirectToFormReturn,
  redirectWithMessage,
  safeFormReturnPath,
} from "@/lib/server-action-redirect";

type EngagementSignalResult = {
  changed?: boolean;
  contact_id?: string | null;
  signal_id?: string;
};

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function signalId(formData: FormData) {
  return String(formData.get("signal_id") ?? "").trim().slice(0, 80);
}

function returnToEngagement(formData: FormData, message: string): never {
  redirectToFormReturn(formData, "/engagement", message);
}

async function setSignalState(
  formData: FormData,
  action:
    | "engaged"
    | "dismissed"
    | "restore_engaged"
    | "restore_dismissed"
    | "restored",
) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnToEngagement(formData, "Supabase admin environment is not configured."),
  );
  const id = signalId(formData);

  if (!isValidUuid(id)) {
    returnToEngagement(formData, "That engagement item is not valid.");
  }

  const { data, error } = await admin.rpc("lbb_set_engagement_signal_state", {
    p_actor_user_id: context.userId,
    p_action: action,
    p_signal_id: id,
    p_tenant_id: context.tenantId,
  });

  if (error || !data) {
    returnToEngagement(formData, "That engagement item could not be updated.");
  }

  const result = data as EngagementSignalResult;
  if (action === "engaged" || action === "dismissed") {
    try {
      await refillEngagementRecommendations({
        admin,
        tenantId: context.tenantId,
        settings: context.settings,
      });
    } catch {
      // The action is complete even if the background queue cannot refill yet.
    }
  }
  revalidatePath("/engagement");
  revalidatePath("/dashboard");
  if (result.contact_id) revalidatePath(`/contacts/${result.contact_id}`);

  return { id, changed: result.changed !== false };
}

export async function refillEngagementQueue(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnToEngagement(
      formData,
      "The private data connection is unavailable.",
    ),
  );
  try {
    const result = await refillEngagementRecommendations({
      admin,
      tenantId: context.tenantId,
      settings: context.settings,
    });
    revalidatePath("/engagement");
    returnToEngagement(
      formData,
      result.promoted > 0
        ? `${result.promoted} fresh recommendation${result.promoted === 1 ? "" : "s"} ready.`
        : "You are caught up for now.",
    );
  } catch {
    returnToEngagement(
      formData,
      "Fresh recommendations could not be prepared yet.",
    );
  }
}

function redirectWithUndo(
  formData: FormData,
  id: string,
  kind: "engaged" | "dismissed",
  message: string,
): never {
  const returnTo = safeFormReturnPath(formData, "/engagement");
  const separator = returnTo.includes("?") ? "&" : "?";

  redirectWithMessage(
    `${returnTo}${separator}undo_signal=${encodeURIComponent(id)}&undo_kind=${kind}`,
    message,
  );
}

export async function markEngagementSignalEngaged(formData: FormData) {
  const { id } = await setSignalState(formData, "engaged");
  redirectWithUndo(formData, id, "engaged", "Marked engaged.");
}

export async function doNotEngageSignal(formData: FormData) {
  const { id } = await setSignalState(formData, "dismissed");
  redirectWithUndo(
    formData,
    id,
    "dismissed",
    "Removed from your engagement queue.",
  );
}

export async function skipEngagementSignal(formData: FormData) {
  return doNotEngageSignal(formData);
}

export async function restoreEngagementSignal(formData: FormData) {
  const undoKind = String(formData.get("undo_kind") ?? "");
  const action =
    undoKind === "engaged"
      ? "restore_engaged"
      : undoKind === "dismissed"
        ? "restore_dismissed"
        : "restored";
  const { changed } = await setSignalState(formData, action);

  returnToEngagement(
    formData,
    changed ? "Recommendation restored." : "That recommendation was already active.",
  );
}

"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { previewClientListImport } from "@/lib/client-list-import";
import { getClientListImportIdentities } from "@/lib/client-list-import-data";
import { requireOperatorAccess } from "@/lib/operator-access";
import { redirectWithMessage } from "@/lib/server-action-redirect";
import { requireOperatorTenantActionContext } from "@/lib/server-action-context";

function returnToImport(message: string): never {
  redirectWithMessage("/intake/import", message);
}

function safeFileName(value: string) {
  return value.replace(/[^a-z0-9._ -]/gi, "").trim().slice(0, 180) || "client-list.csv";
}

export async function importClientListCandidates(formData: FormData) {
  await requireOperatorAccess();
  const { admin, context } = await requireOperatorTenantActionContext(
    () => returnToImport("The private data connection is unavailable."),
    () => returnToImport("Client-list imports are operator-only."),
  );
  const file = formData.get("client_list");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv")) {
    returnToImport("Choose the reviewed CSV file again.");
  }
  if (file.size <= 0 || file.size > 2_000_000) {
    returnToImport("The CSV must be between 1 byte and 2 MB.");
  }

  const existing = await getClientListImportIdentities();
  let preview;
  try {
    preview = previewClientListImport({ csv: await file.text(), existing });
  } catch (cause) {
    returnToImport(cause instanceof Error ? cause.message : "The list could not be checked.");
  }
  if (preview.truncated) {
    returnToImport("Split the list into files of 500 rows or fewer before importing.");
  }
  if (preview.invalid > 0 || preview.duplicates > 0) {
    returnToImport(
      `Nothing was imported. Resolve ${preview.invalid} invalid and ${preview.duplicates} duplicate row${preview.invalid + preview.duplicates === 1 ? "" : "s"} first.`,
    );
  }
  const rows = preview.rows
    .filter((item) => item.status === "ready")
    .map((item) => ({
      ...item.row,
      role_title: item.row.role_title ? [item.row.role_title] : [],
      dossier: {
        goal: item.row.notes,
        look_for: "Operator review required before outreach.",
        next_touch: "Review bucket fit and source context.",
      },
      source_type: item.row.source_type || "operator_research",
      recommended_action: item.row.recommended_action || "research",
      qualifying_signals: item.row.qualifying_signal
        ? [item.row.qualifying_signal]
        : [],
    }));
  if (rows.length === 0) returnToImport("No reviewed rows were ready to import.");

  const batchId = randomUUID();
  const { data, error } = await admin.rpc("lbb_import_client_list_candidates", {
    p_tenant_id: context.tenantId,
    p_actor_user_id: context.userId,
    p_batch_id: batchId,
    p_file_name: safeFileName(file.name),
    p_rows: rows,
  });
  const result = data as { created?: number } | null;
  if (error || result?.created !== rows.length) {
    returnToImport("The reviewed list was not imported. No partial batch was kept.");
  }

  revalidatePath("/intake/import");
  revalidatePath("/changes");
  returnToImport(
    `${rows.length} candidate${rows.length === 1 ? "" : "s"} added to Changes for review.`,
  );
}

export async function rollbackClientListImport(formData: FormData) {
  await requireOperatorAccess();
  const { admin, context } = await requireOperatorTenantActionContext(
    () => returnToImport("The private data connection is unavailable."),
    () => returnToImport("Client-list rollback is operator-only."),
  );
  const batchId = String(formData.get("batch_id") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) returnToImport("That import batch is not valid.");

  const { data, error } = await admin.rpc("lbb_rollback_client_list_import", {
    p_tenant_id: context.tenantId,
    p_actor_user_id: context.userId,
    p_batch_id: batchId,
  });
  const result = data as { dismissed?: number } | null;
  if (error) {
    returnToImport(
      "This batch could not be rolled back. If any row was already reviewed, handle it individually in Changes.",
    );
  }

  revalidatePath("/intake/import");
  revalidatePath("/changes");
  returnToImport(
    `${result?.dismissed ?? 0} pending proposal${result?.dismissed === 1 ? "" : "s"} rolled back.`,
  );
}

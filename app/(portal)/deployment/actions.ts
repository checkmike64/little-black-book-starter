"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  productionCheckItems,
  type ProductionCheckKey,
} from "@/lib/deployment-readiness";
import { requireOperatorAccess } from "@/lib/operator-access";
import { parseProductionCheckSubmission } from "@/lib/production-check-evidence";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const productionCheckKeys = new Set<ProductionCheckKey>(
  productionCheckItems.map((item) => item.key),
);

export async function updateProductionCheck(formData: FormData) {
  const context = await requireOperatorAccess();
  const admin = createSupabaseAdminClient();

  if (!context) {
    redirect("/deployment?message=Create a tenant before saving production checks.");
  }

  if (!admin) {
    redirect("/deployment?message=Supabase admin environment is not configured.");
  }

  const key = String(formData.get("key") ?? "") as ProductionCheckKey;
  if (!productionCheckKeys.has(key)) {
    redirect("/deployment?message=Unknown production check.");
  }

  const expectedVersion = Number.parseInt(
    String(formData.get("settings_version") ?? ""),
    10,
  );
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    redirect("/deployment?message=Reload the page before saving production evidence.");
  }

  const submission = parseProductionCheckSubmission({
    confirmed: formData.get("confirmed") === "on",
    evidenceRef: formData.get("evidence_ref"),
  });

  if (!submission.ok) {
    redirect(`/deployment?message=${encodeURIComponent(submission.message)}`);
  }

  const { error } = await admin.rpc("lbb_update_production_check", {
    p_tenant_id: context.tenantId,
    p_actor_user_id: context.userId,
    p_expected_version: expectedVersion,
    p_check_key: key,
    p_confirmed: submission.confirmed,
    p_evidence_ref: submission.evidenceRef,
  });

  if (error) {
    const message =
      error.code === "40001"
        ? "Production evidence changed in another session. Reload and review it before saving."
        : "Production check could not be saved.";
    redirect(`/deployment?message=${encodeURIComponent(message)}`);
  }

  revalidatePath("/deployment");
  revalidatePath("/launch");
  revalidatePath("/dashboard");
  redirect(
    `/deployment?message=${encodeURIComponent(
      submission.confirmed
        ? "Production check confirmed."
        : "Production check cleared.",
    )}`,
  );
}

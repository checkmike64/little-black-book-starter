import { NextResponse } from "next/server";
import { requireOperatorAccess } from "@/lib/operator-access";
import { queueQualityCleanupBatch } from "@/lib/quality/cleanup-queue";

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function qualityRedirect(request: Request, message: string) {
  return NextResponse.redirect(
    new URL(`/quality?message=${encodeURIComponent(message)}`, request.url),
  );
}

function cleanContactIds(formData: FormData) {
  const candidates = [
    ...formData.getAll("contact_id").flatMap((value) => String(value).split(/[\s,]+/)),
    ...String(formData.get("contact_ids") ?? "").split(/[\s,]+/),
  ].filter(Boolean);
  const valid = Array.from(new Set(candidates.filter(isValidUuid)));

  return {
    contactIds: valid.slice(0, 12),
    ignored: candidates.filter((value) => !isValidUuid(value)).length,
    omitted: Math.max(0, valid.length - 12),
  };
}

export async function POST(request: Request) {
  const context = await requireOperatorAccess();

  if (!context) {
    return qualityRedirect(request, "Connect the private database before queueing cleanup.");
  }

  const formData = await request.formData();
  const { contactIds, ignored, omitted } = cleanContactIds(formData);

  if (contactIds.length === 0) {
    return qualityRedirect(request, "No quality cleanup contacts were selected.");
  }

  let result;
  try {
    result = await queueQualityCleanupBatch({
      contactIds,
      requestedBy: context.userId,
      tenantId: context.tenantId,
    });
  } catch {
    return qualityRedirect(
      request,
      "Quality cleanup could not be queued. No Book fields were changed.",
    );
  }

  if (!result.configured) {
    return qualityRedirect(request, "The private cleanup service is not configured.");
  }

  const ignoredSummary = [
    ignored > 0 ? `${ignored} invalid ignored` : null,
    omitted > 0 ? `${omitted} beyond the 12-job limit omitted` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return qualityRedirect(
    request,
    `Quality cleanup queued: ${result.created} new, ${result.existing} already active, ${result.skipped} skipped${ignoredSummary ? `, ${ignoredSummary}` : ""}.`,
  );
}

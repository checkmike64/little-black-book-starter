import type { SupabaseClient } from "@supabase/supabase-js";

type AdminClient = SupabaseClient;

export type ApifyContentInsertRow = {
  tenant_id: string;
  contact_id: string | null;
  want_to_know_id: string | null;
  target_name: null;
  platform: string;
  content_type: string;
  source_url: string;
  title: string | null;
  content: string | null;
  classification: null;
  relevance: null;
  published_at: string;
  observed_at: string;
  metrics: Record<string, number>;
  content_scan_source_id: string;
  provider: "apify";
  provider_item_id: string | null;
  provider_run_id: string;
  match_status: "matched";
  match_method: "registered_source";
  source_payload: Record<string, unknown>;
};

export type ContentProviderIdentity = {
  tenant_id: string;
  provider: string;
  platform: string;
  provider_item_id: string | null;
};

export type ApifyContentOwnership = {
  tenantId: string;
  sourceId: string;
  providerRunId: string;
  platform: string;
  contactId: string | null;
  wantToKnowId: string | null;
};

function providerIdentityKey(identity: ContentProviderIdentity) {
  if (!identity.provider_item_id) return null;
  return [
    identity.tenant_id,
    identity.provider,
    identity.platform,
    identity.provider_item_id,
  ]
    .map((part) => `${part.length}:${part}`)
    .join("|");
}

export function selectReplaySafeApifyRows(
  rows: ApifyContentInsertRow[],
  existing: ContentProviderIdentity[],
) {
  const seen = new Set(
    existing
      .map(providerIdentityKey)
      .filter((key): key is string => Boolean(key)),
  );
  const pending: ApifyContentInsertRow[] = [];
  let providerDuplicates = 0;

  for (const row of rows) {
    const key = providerIdentityKey(row);
    if (key && seen.has(key)) {
      providerDuplicates += 1;
      continue;
    }
    if (key) seen.add(key);
    pending.push(row);
  }

  return { pending, providerDuplicates };
}

function assertApifyContentOwnership(
  rows: ApifyContentInsertRow[],
  ownership: ApifyContentOwnership,
) {
  if (
    rows.some(
      (row) =>
        row.tenant_id !== ownership.tenantId ||
        row.provider !== "apify" ||
        row.platform !== ownership.platform ||
        row.content_scan_source_id !== ownership.sourceId ||
        row.provider_run_id !== ownership.providerRunId ||
        row.contact_id !== ownership.contactId ||
        row.want_to_know_id !== ownership.wantToKnowId,
    )
  ) {
    throw new Error("Apify content ownership does not match the claimed scan run.");
  }
}

async function loadExistingProviderIdentities({
  admin,
  tenantId,
  platform,
  providerItemIds,
}: {
  admin: AdminClient;
  tenantId: string;
  platform: string;
  providerItemIds: string[];
}) {
  if (providerItemIds.length === 0) return [];
  const { data, error } = await admin
    .from("content_items")
    .select("tenant_id, provider, platform, provider_item_id")
    .eq("tenant_id", tenantId)
    .eq("provider", "apify")
    .eq("platform", platform)
    .in("provider_item_id", providerItemIds);
  if (error) throw new Error("Existing Apify content identities could not be loaded.");
  return (data ?? []) as ContentProviderIdentity[];
}

export async function persistReplaySafeApifyContent({
  admin,
  rows,
  ownership,
}: {
  admin: AdminClient;
  rows: ApifyContentInsertRow[];
  ownership: ApifyContentOwnership;
}) {
  assertApifyContentOwnership(rows, ownership);
  const providerItemIds = Array.from(
    new Set(
      rows
        .map((row) => row.provider_item_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await loadExistingProviderIdentities({
      admin,
      tenantId: ownership.tenantId,
      platform: ownership.platform,
      providerItemIds,
    });
    const selected = selectReplaySafeApifyRows(rows, existing);
    if (selected.pending.length === 0) {
      return {
        insertedIds: [] as string[],
        providerDuplicates: selected.providerDuplicates,
      };
    }

    const inserted = await admin
      .from("content_items")
      .upsert(selected.pending, {
        onConflict: "tenant_id,source_url",
        ignoreDuplicates: true,
      })
      .select("id");
    if (!inserted.error) {
      return {
        insertedIds: (inserted.data ?? []).map((row) => row.id),
        providerDuplicates: selected.providerDuplicates,
      };
    }
    if (inserted.error.code !== "23505" || attempt === 1) {
      throw new Error("Content could not be saved.");
    }
  }

  throw new Error("Content could not be saved.");
}

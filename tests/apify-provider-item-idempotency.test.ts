import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  persistReplaySafeApifyContent,
  selectReplaySafeApifyRows,
  type ApifyContentInsertRow,
  type ContentProviderIdentity,
} from "../lib/automation/apify-content-items.js";

function row(
  overrides: Partial<ApifyContentInsertRow> = {},
): ApifyContentInsertRow {
  return {
    tenant_id: "tenant-a",
    contact_id: "contact-a",
    want_to_know_id: null,
    target_name: null,
    platform: "facebook",
    content_type: "social_post",
    source_url: "https://facebook.com/post/original",
    title: "Update",
    content: "Public post",
    classification: null,
    relevance: null,
    published_at: "2026-09-04T12:00:00.000Z",
    observed_at: "2026-09-04T12:05:00.000Z",
    metrics: { likes: 1 },
    content_scan_source_id: "source-a",
    provider: "apify",
    provider_item_id: "provider-item-a",
    provider_run_id: "run-a",
    match_status: "matched",
    match_method: "registered_source",
    source_payload: { ingested_via: "apify" },
    ...overrides,
  };
}

function identity(
  overrides: Partial<ContentProviderIdentity> = {},
): ContentProviderIdentity {
  return {
    tenant_id: "tenant-a",
    provider: "apify",
    platform: "facebook",
    provider_item_id: "provider-item-a",
    ...overrides,
  };
}

const ownership = {
  tenantId: "tenant-a",
  sourceId: "source-a",
  providerRunId: "run-a",
  platform: "facebook",
  contactId: "contact-a",
  wantToKnowId: null,
};

describe("Apify provider item idempotency", () => {
  test("treats a provider item replay with a changed URL as already persisted", () => {
    const result = selectReplaySafeApifyRows(
      [row({ source_url: "https://facebook.com/post/changed-slug" })],
      [identity()],
    );

    assert.deepEqual(result.pending, []);
    assert.equal(result.providerDuplicates, 1);
  });

  test("treats an exact provider item and URL replay as already persisted", () => {
    const result = selectReplaySafeApifyRows([row()], [identity()]);

    assert.deepEqual(result.pending, []);
    assert.equal(result.providerDuplicates, 1);
  });

  test("keeps the same provider item independent across tenants and providers", () => {
    const candidate = row();
    const result = selectReplaySafeApifyRows(
      [candidate],
      [
        identity({ tenant_id: "tenant-b" }),
        identity({ provider: "another-provider" }),
      ],
    );

    assert.deepEqual(result.pending, [candidate]);
    assert.equal(result.providerDuplicates, 0);
  });

  test("deduplicates the same provider identity within one callback batch", () => {
    const first = row();
    const second = row({ source_url: "https://facebook.com/post/changed-slug" });
    const result = selectReplaySafeApifyRows([first, second], []);

    assert.deepEqual(result.pending, [first]);
    assert.equal(result.providerDuplicates, 1);
  });

  test("fails closed before persistence when a row does not belong to the claimed run", async () => {
    await assert.rejects(
      persistReplaySafeApifyContent({
        admin: {} as SupabaseClient,
        rows: [row({ provider_run_id: "other-run" })],
        ownership,
      }),
      /ownership does not match the claimed scan run/,
    );
  });

  test("keeps source URL conflicts non-destructive", async () => {
    const candidate = row();
    let receivedRows: unknown;
    let receivedOptions: unknown;
    const admin = {
      from(table: string) {
        assert.equal(table, "content_items");
        return {
          select() {
            return {
              eq() {
                return this;
              },
              in() {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
          upsert(rows: unknown, options: unknown) {
            receivedRows = rows;
            receivedOptions = options;
            return {
              select() {
                return Promise.resolve({ data: [{ id: "inserted-a" }], error: null });
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;

    const result = await persistReplaySafeApifyContent({
      admin,
      rows: [candidate],
      ownership,
    });

    assert.deepEqual(receivedRows, [candidate]);
    assert.deepEqual(receivedOptions, {
      onConflict: "tenant_id,source_url",
      ignoreDuplicates: true,
    });
    assert.deepEqual(result, {
      insertedIds: ["inserted-a"],
      providerDuplicates: 0,
    });
  });

  test("rechecks provider identity after a concurrent unique-key race", async () => {
    let identityReads = 0;
    let upserts = 0;
    const admin = {
      from(table: string) {
        assert.equal(table, "content_items");
        return {
          select() {
            return {
              eq() {
                return this;
              },
              in() {
                identityReads += 1;
                return Promise.resolve({
                  data: identityReads === 1 ? [] : [identity()],
                  error: null,
                });
              },
            };
          },
          upsert() {
            upserts += 1;
            return {
              select() {
                return Promise.resolve({
                  data: null,
                  error: { code: "23505" },
                });
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;

    const result = await persistReplaySafeApifyContent({
      admin,
      rows: [row({ source_url: "https://facebook.com/post/changed-slug" })],
      ownership,
    });

    assert.deepEqual(result, { insertedIds: [], providerDuplicates: 1 });
    assert.equal(identityReads, 2);
    assert.equal(upserts, 1);
  });
});

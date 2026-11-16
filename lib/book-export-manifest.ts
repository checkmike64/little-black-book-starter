export type ExportTable = {
  key: string;
  label: string;
  table: string;
  orderBy?: string;
  limit: number;
};

export const bookExportTables = [
  { key: "contacts", label: "Contacts", table: "contacts", orderBy: "updated_at", limit: 10000 },
  { key: "connections", label: "Connections", table: "connections", orderBy: "created_at", limit: 10000 },
  { key: "introductions", label: "Introductions", table: "introductions", orderBy: "updated_at", limit: 10000 },
  { key: "interactions", label: "Interactions", table: "interactions", orderBy: "occurred_at", limit: 10000 },
  { key: "interaction_contacts", label: "Interaction links", table: "interaction_contacts", limit: 20000 },
  { key: "promises", label: "Promises", table: "promises", orderBy: "updated_at", limit: 10000 },
  { key: "relationship_actions", label: "Relationship actions", table: "relationship_actions", orderBy: "created_at", limit: 10000 },
  { key: "signals", label: "Signals", table: "signals", orderBy: "observed_at", limit: 10000 },
  { key: "want_to_know", label: "Want to know", table: "want_to_know", orderBy: "updated_at", limit: 10000 },
  { key: "pending_changes", label: "Pending changes", table: "pending_changes", orderBy: "created_at", limit: 10000 },
  { key: "field_provenance", label: "Field provenance", table: "field_provenance", orderBy: "created_at", limit: 20000 },
  { key: "transcripts", label: "Transcript records", table: "transcripts", orderBy: "created_at", limit: 10000 },
  { key: "jobs", label: "Claude jobs", table: "jobs", orderBy: "created_at", limit: 10000 },
  { key: "ask_runs", label: "Saved Ask runs", table: "ask_runs", orderBy: "created_at", limit: 10000 },
  { key: "audit_log", label: "Audit log", table: "audit_log", orderBy: "created_at", limit: 20000 },
  { key: "usage_events", label: "Usage events", table: "usage_events", orderBy: "created_at", limit: 20000 },
] satisfies ExportTable[];

export const bookExportTenantScopedTables = [
  "ask_runs", "audit_log", "calendar_attendee_preferences", "calendar_attendees",
  "calendar_events", "claude_write_receipts", "client_import_batches",
  "connection_contexts", "connections", "contacts", "content_items",
  "content_scan_runs", "content_scan_sources", "field_provenance",
  "google_oauth_transactions", "integration_connections", "interaction_contacts",
  "interactions", "introductions", "jobs", "notion_oauth_transactions",
  "notion_webhook_events", "pending_changes", "promises",
  "recommendation_day_overrides", "recording_followups",
  "recording_ingest_receipts", "recording_sync_state", "relationship_actions",
  "relationship_context_memberships", "relationship_contexts", "reviews", "signals",
  "tenant_config", "tenant_members", "transcripts", "usage_events", "want_to_know",
] as const;

export const bookExportExcludedSections = [
  {
    label: "Install, access, and runtime configuration",
    tables: ["tenant_members", "tenant_config", "recommendation_day_overrides"],
    tenantScoped: true,
    reason: "Operator-managed configuration and access state are not part of the portable relationship-data export.",
  },
  {
    label: "Provider credentials and authorization state",
    tables: ["integration_connections", "google_oauth_transactions", "notion_oauth_transactions", "notion_webhook_events"],
    tenantScoped: true,
    reason: "Credentials, authorization handshakes, and webhook controls require separate revocation and disposition evidence.",
  },
  {
    label: "Meeting and recording intake state",
    tables: ["calendar_events", "calendar_attendees", "calendar_attendee_preferences", "recording_sync_state", "recording_followups", "recording_ingest_receipts"],
    tenantScoped: true,
    reason: "Source synchronization and review state require an install-specific export or deletion decision.",
  },
  {
    label: "Content monitoring and review state",
    tables: ["content_scan_sources", "content_scan_runs", "content_items", "reviews"],
    tenantScoped: true,
    reason: "Provider-derived monitoring and review records are outside this portable export.",
  },
  {
    label: "Relationship grouping internals",
    tables: ["relationship_contexts", "relationship_context_memberships", "connection_contexts"],
    tenantScoped: true,
    reason: "Internal grouping records are not included in the current portable snapshot.",
  },
  {
    label: "Import and gateway receipts",
    tables: ["client_import_batches", "claude_write_receipts"],
    tenantScoped: true,
    reason: "Operator import and gateway receipt records require separate evidence handling.",
  },
  {
    label: "Install-wide and private infrastructure",
    tables: ["tenants", "app_private.calendar_snapshot_receipts", "notion_webhook_config", "app_private.recording_baseline_field_policy", "Auth", "Storage", "Vault", "migration and runtime configuration"],
    tenantScoped: false,
    reason: "These scopes are handled separately from tenant-row portable data.",
  },
] as const;

export type ExportSection = {
  key: string;
  label: string;
  table: string;
  count: number | null;
  exportedCount: number;
  limit: number;
  truncated: boolean;
  rows?: unknown[];
  error?: string;
};

export function buildBookExportManifest(sections: ExportSection[]) {
  const capped = sections
    .filter((section) => section.truncated)
    .map(({ key, label, table, count, exportedCount, limit }) => ({
      key, label, table, count, exportedCount, limit,
    }));
  const failed = sections
    .filter((section) => Boolean(section.error))
    .map(({ key, label, table }) => ({ key, label, table }));
  const expectedTables = new Set<string>(bookExportTenantScopedTables);
  const includedTables = sections.map((section) => section.table);
  const excludedTables = bookExportExcludedSections.flatMap((section) =>
    section.tenantScoped ? [...section.tables] : [],
  );
  const categorizedTables = [...includedTables, ...excludedTables];
  const categorizedTableSet = new Set(categorizedTables);
  const uncategorized = bookExportTenantScopedTables.filter(
    (table) => !categorizedTableSet.has(table),
  );
  const unexpected = categorizedTables.filter((table) => !expectedTables.has(table));
  const duplicate = categorizedTables.filter(
    (table, index) => categorizedTables.indexOf(table) !== index,
  );
  const scopeInventoryReady =
    uncategorized.length === 0 &&
    unexpected.length === 0 &&
    duplicate.length === 0 &&
    categorizedTableSet.size === bookExportTenantScopedTables.length;

  return {
    included: sections.map(({ key, label, table, count, exportedCount, limit }) => ({
      key, label, table, count, exportedCount, limit,
    })),
    excluded: bookExportExcludedSections,
    capped,
    failed,
    uncategorized,
    unexpected,
    duplicate,
    scopeInventoryReady,
    tenantScopedTableCount: bookExportTenantScopedTables.length,
    portableExportReady:
      capped.length === 0 && failed.length === 0 && scopeInventoryReady,
    offboardingComplete: false,
  };
}

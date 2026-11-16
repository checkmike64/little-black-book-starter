import { buildClientInstallManifest } from "@/lib/client-install-manifest";
import {
  bookExportTables,
  type ExportSection,
} from "@/lib/book-export-manifest";
import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeTenantSettings } from "@/lib/tenant-settings";

function emptySections(): ExportSection[] {
  return bookExportTables.map((table) => ({
    key: table.key,
    label: table.label,
    table: table.table,
    count: 0,
    exportedCount: 0,
    limit: table.limit,
    truncated: false,
  }));
}

export async function getBookExportSnapshot({
  includeRows = false,
}: {
  includeRows?: boolean;
} = {}) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false,
      status: 503,
      reason: "Supabase is not configured.",
      tenant: null,
      exportedAt: new Date().toISOString(),
      sections: emptySections(),
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      status: 401,
      reason: "Sign in before exporting the book.",
      tenant: null,
      exportedAt: new Date().toISOString(),
      sections: emptySections(),
    };
  }

  const context = await getTenantContext();
  if (!context) {
    return {
      ok: false,
      status: 403,
      reason: "No active tenant membership was found.",
      tenant: null,
      exportedAt: new Date().toISOString(),
      sections: emptySections(),
    };
  }

  const sections = await Promise.all(
    bookExportTables.map(async (item): Promise<ExportSection> => {
      let query = supabase
        .from(item.table)
        .select(includeRows ? "*" : "id", { count: "exact", head: !includeRows })
        .eq("tenant_id", context.tenantId)
        .limit(item.limit);

      if (includeRows && item.orderBy) {
        query = query.order(item.orderBy, { ascending: false });
      }

      const { data, count, error } = await query;

      if (error) {
        return {
          key: item.key,
          label: item.label,
          table: item.table,
          count: null,
          exportedCount: 0,
          limit: item.limit,
          truncated: false,
          error: "section_read_failed",
          rows: includeRows ? [] : undefined,
        };
      }

      const rows = includeRows ? data ?? [] : undefined;
      const totalCount = count ?? 0;
      const exportedCount = includeRows
        ? rows?.length ?? 0
        : Math.min(totalCount, item.limit);

      return {
        key: item.key,
        label: item.label,
        table: item.table,
        count: totalCount,
        exportedCount,
        limit: item.limit,
        truncated: totalCount > exportedCount,
        rows,
      };
    }),
  );

  return {
    ok: true,
    status: 200,
    reason: null,
    exportedAt: new Date().toISOString(),
    clientManifest: buildClientInstallManifest({
      tenantName: context.tenantName,
      settings: normalizeTenantSettings(context.settings),
    }),
    tenant: {
      id: context.tenantId,
      name: context.tenantName,
      role: context.role,
      requestedBy: {
        id: context.userId,
        email: user.email,
      },
    },
    sections,
  };
}

export function bookExportFileName(tenantName: string | null | undefined) {
  const date = new Date().toISOString().slice(0, 10);
  const slug = (tenantName ?? "little-black-book")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);

  return `${slug || "little-black-book"}-export-${date}.json`;
}

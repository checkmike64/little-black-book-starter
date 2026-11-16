import { getBookExportSnapshot } from "@/lib/book-export";
import {
  exportHandoffFileName,
  formatExportHandoffSummary,
} from "@/lib/export-handoff-summary";
import { getTenantContext } from "@/lib/tenant-context";

export async function GET() {
  const context = await getTenantContext();
  if (context?.role !== "operator") {
    return Response.json(
      { error: "Handoff exports are operator-only for this install." },
      { status: 403 },
    );
  }

  const snapshot = await getBookExportSnapshot();

  if (!snapshot.ok || !snapshot.clientManifest || !snapshot.tenant) {
    return Response.json(
      { error: snapshot.reason ?? "The handoff summary could not be generated." },
      { status: snapshot.status },
    );
  }

  const body = formatExportHandoffSummary({
    exportedAt: snapshot.exportedAt,
    tenantName: snapshot.tenant.name,
    manifest: snapshot.clientManifest,
    sections: snapshot.sections,
  });

  return new Response(body, {
    headers: {
      "Content-Disposition": `attachment; filename="${exportHandoffFileName(
        snapshot.tenant.name,
      )}"`,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

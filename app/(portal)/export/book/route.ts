import {
  bookExportFileName,
  getBookExportSnapshot,
} from "@/lib/book-export";
import { buildBookExportManifest } from "@/lib/book-export-manifest";
import { getTenantContext } from "@/lib/tenant-context";

export async function GET() {
  const context = await getTenantContext();
  if (context?.role !== "operator") {
    return Response.json(
      { error: "Book exports are operator-only for this install." },
      { status: 403 },
    );
  }

  const snapshot = await getBookExportSnapshot({ includeRows: true });

  if (!snapshot.ok) {
    return Response.json(
      { error: snapshot.reason },
      { status: snapshot.status },
    );
  }

  const body = {
    export_version: "2026-07-19",
    app: "Little Black Book",
    exported_at: snapshot.exportedAt,
    tenant: snapshot.tenant,
    client_manifest: snapshot.clientManifest,
    export_manifest: buildBookExportManifest(snapshot.sections),
    sections: snapshot.sections,
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Disposition": `attachment; filename="${bookExportFileName(
        snapshot.tenant?.name,
      )}"`,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

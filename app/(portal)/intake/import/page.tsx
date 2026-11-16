import Link from "next/link";
import { ListImportPreview } from "@/app/(portal)/intake/import/list-import-preview";
import { rollbackClientListImport } from "@/app/(portal)/intake/import/actions";
import {
  getClientListImportBatches,
  getClientListImportIdentities,
} from "@/lib/client-list-import-data";
import { requireOperatorAccess } from "@/lib/operator-access";

export default async function ClientListImportPage() {
  await requireOperatorAccess();
  const [existing, batches] = await Promise.all([
    getClientListImportIdentities(),
    getClientListImportBatches(),
  ]);

  return (
    <>
      <div className="crumb">Client Intake / List Preview</div>
      <h1 className="portal-title">Preview a client list</h1>
      <p className="lede">
        Map a standard CSV, identify duplicates, and preserve source context
        before anything is added to the Book.
      </p>
      <ListImportPreview existing={existing} />
      <section className="card">
        <h2>Supported columns</h2>
        <p className="muted">
          full_name, email, phone, company_name, role_title, linkedin, bucket,
          qualifying_signal, recommended_action, source_type, and notes. Name,
          company, role, LinkedIn URL, group, and context aliases are also recognized.
        </p>
        <p className="source-note">
          A successful import creates high-risk candidate proposals in Changes.
          Nothing enters the Book until it is reviewed.
        </p>
      </section>
      {batches.length > 0 ? (
        <section className="card">
          <h2>Recent import batches</h2>
          <div className="mini-list">
            {batches.map((batch) => (
              <div className="mini-item dense" key={batch.id}>
                <div className="mini-item-head">
                  <b>{batch.file_name}</b>
                  <span className={`pill ${batch.status === "applied" ? "gold" : "cool"}`}>
                    {batch.status.replaceAll("_", " ")}
                  </span>
                </div>
                <span>{batch.ready_count} proposal{batch.ready_count === 1 ? "" : "s"}</span>
                {batch.status === "applied" ? (
                  <form action={rollbackClientListImport}>
                    <input name="batch_id" type="hidden" value={batch.id} />
                    <button className="button small ghost" type="submit">
                      Roll back pending proposals
                    </button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <Link className="button ghost" href="/intake">Back to Client Intake</Link>
    </>
  );
}

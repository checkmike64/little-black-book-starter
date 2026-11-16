"use client";

import { useState } from "react";
import { importClientListCandidates } from "@/app/(portal)/intake/import/actions";
import {
  previewClientListImport,
  type ClientListImportIdentity,
  type ClientListImportPreview,
} from "@/lib/client-list-import";

export function ListImportPreview({
  existing,
}: {
  existing: ClientListImportIdentity[];
}) {
  const [preview, setPreview] = useState<ClientListImportPreview | null>(null);
  const [error, setError] = useState("");

  async function onFile(file: File | undefined) {
    setPreview(null);
    setError("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Choose a CSV file.");
      return;
    }
    try {
      setPreview(previewClientListImport({ csv: await file.text(), existing }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The list could not be previewed.");
    }
  }

  return (
    <form action={importClientListCandidates} className="card settings-form" aria-labelledby="list-preview-title">
      <div>
        <span className="section-label">Governed preview</span>
        <h2 id="list-preview-title">Check a client list before import</h2>
        <p className="muted">
          Previewing does not write data. Import is enabled only when every row
          is valid and unique; it creates review proposals, never Book contacts.
        </p>
      </div>
      <label className="field">
        <span>Client CSV</span>
        <input
          accept=".csv,text/csv"
          name="client_list"
          onChange={(event) => void onFile(event.target.files?.[0])}
          type="file"
        />
      </label>
      {error ? <div className="notice" role="alert">{error}</div> : null}
      {preview ? (
        <div aria-live="polite">
          <div className="statband" aria-label="Import preview counts">
            <div className="stat"><div className="number">{preview.ready}</div><div className="label">Ready</div></div>
            <div className="stat"><div className="number">{preview.duplicates}</div><div className="label">Duplicates</div></div>
            <div className="stat"><div className="number">{preview.invalid}</div><div className="label">Invalid</div></div>
          </div>
          {preview.truncated ? (
            <p className="notice" role="status">Only the first 500 rows are shown.</p>
          ) : null}
          <div className="mini-list">
            {preview.rows.slice(0, 100).map((item) => (
              <div className="mini-item dense" key={item.row.source_row}>
                <div className="mini-item-head">
                  <b>{item.row.full_name || `Row ${item.row.source_row}`}</b>
                  <span className={`pill ${item.status === "ready" ? "cool" : item.status === "duplicate" ? "gold" : "warn"}`}>
                    {item.status}
                  </span>
                </div>
                <span>{[item.row.company_name, item.row.email, item.row.linkedin].filter(Boolean).join(" · ")}</span>
                {item.duplicateOf ? <span>Matches {item.duplicateOf}</span> : null}
                {item.issues.map((issue) => <span key={issue}>{issue}</span>)}
              </div>
            ))}
          </div>
          {preview.rows.length > 100 ? (
            <p className="source-note">Showing the first 100 preview rows.</p>
          ) : null}
          <button
            className="button hot"
            disabled={preview.ready === 0 || preview.invalid > 0 || preview.duplicates > 0 || preview.truncated}
            type="submit"
          >
            Add reviewed candidates to Changes
          </button>
        </div>
      ) : null}
    </form>
  );
}

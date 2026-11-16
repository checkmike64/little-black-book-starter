import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import {
  buildClientListImportProvenance,
  previewClientListImport,
} from "../lib/client-list-import.js";

describe("operator client-list import foundation", () => {
  test("parses quoted CSV values and normalizes mapped fields", () => {
    const preview = previewClientListImport({
      csv: [
        "Name,Email,Company,LinkedIn URL,Notes",
        '"Avery Rhodes",AVERY@example.com,"Signal, Inc.",linkedin.com/in/avery,"Met at summit"',
      ].join("\n"),
    });

    assert.equal(preview.ready, 1);
    assert.equal(preview.rows[0]?.row.email, "avery@example.com");
    assert.equal(preview.rows[0]?.row.company_name, "Signal, Inc.");
    assert.equal(preview.rows[0]?.row.source_row, 2);
  });

  test("flags existing and within-file duplicates before any write", () => {
    const preview = previewClientListImport({
      csv: [
        "full_name,email,company_name",
        "Avery Rhodes,avery@example.com,Signal",
        "Avery Rhodes,avery@example.com,Signal",
        "Morgan Lee,morgan@example.com,Northstar",
      ].join("\n"),
      existing: [
        { id: "contact-1", full_name: "Morgan Lee", email: "morgan@example.com" },
      ],
    });

    assert.equal(preview.ready, 1);
    assert.equal(preview.duplicates, 2);
    assert.equal(preview.rows[1]?.duplicateOf, "CSV row 2");
    assert.equal(preview.rows[2]?.duplicateOf, "contact-1");
  });

  test("rejects rows without identity and creates stable provenance", () => {
    const preview = previewClientListImport({
      csv: "full_name,email\n,not-an-email",
    });
    assert.equal(preview.invalid, 1);
    assert.match(preview.rows[0]?.issues.join(" ") ?? "", /Full name is required/);

    assert.deepEqual(
      buildClientListImportProvenance({
        batchId: "batch-123",
        fileName: "Client/List.csv",
        importedByUserId: "user-123",
        observedAt: "2026-08-22T12:00:00.000Z",
        sourceRow: 9,
      }),
      {
        source_type: "operator_client_list",
        source_ref: "client-list:batch-123:row:9",
        import_batch_id: "batch-123",
        file_name: "ClientList.csv",
        source_row: 9,
        imported_by_user_id: "user-123",
        observed_at: "2026-08-22T12:00:00.000Z",
      },
    );
  });

  test("imports only through an operator-only atomic proposal batch with rollback", () => {
    const action = readFileSync("app/(portal)/intake/import/actions.ts", "utf8");
    const migration = readFileSync(
      "supabase/migrations/20260822143000_canonical_tenant_settings_and_workflow_grants.sql",
      "utf8",
    );
    const page = readFileSync("app/(portal)/intake/import/page.tsx", "utf8");

    assert.match(action, /preview\.invalid > 0 \|\| preview\.duplicates > 0/);
    assert.match(action, /lbb_import_client_list_candidates/);
    assert.match(action, /lbb_rollback_client_list_import/);
    assert.match(migration, /create table if not exists public\.client_import_batches/i);
    assert.match(migration, /change_type,[\s\S]*'want_to_know_candidate'/i);
    assert.match(migration, /status <> 'pending'/i);
    assert.match(migration, /cannot be rolled back automatically/i);
    assert.match(
      migration,
      /revoke execute on function public\.lbb_import_client_list_candidates[\s\S]*from public, anon, authenticated/i,
    );
    assert.match(page, /Nothing enters the Book until it is reviewed/);
    assert.match(page, /Roll back pending proposals/);
  });
});

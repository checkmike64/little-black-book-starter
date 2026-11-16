export const clientListImportFields = [
  "full_name",
  "email",
  "phone",
  "company_name",
  "role_title",
  "linkedin",
  "bucket",
  "qualifying_signal",
  "recommended_action",
  "source_type",
  "notes",
] as const;

export type ClientListImportField = (typeof clientListImportFields)[number];

export type ClientListImportIdentity = {
  id?: string;
  full_name?: string | null;
  email?: string | null;
  company_name?: string | null;
  linkedin?: string | null;
};

export type ClientListImportRow = Record<ClientListImportField, string> & {
  source_row: number;
};

export type ClientListImportPreviewRow = {
  row: ClientListImportRow;
  status: "ready" | "duplicate" | "invalid";
  issues: string[];
  duplicateOf: string | null;
};

export type ClientListImportPreview = {
  headers: ClientListImportField[];
  rows: ClientListImportPreviewRow[];
  ready: number;
  duplicates: number;
  invalid: number;
  truncated: boolean;
};

export type ClientListImportProvenance = {
  source_type: "operator_client_list";
  source_ref: string;
  import_batch_id: string;
  file_name: string;
  source_row: number;
  imported_by_user_id: string;
  observed_at: string;
};

const aliases: Record<string, ClientListImportField> = {
  name: "full_name",
  full_name: "full_name",
  fullname: "full_name",
  contact: "full_name",
  email: "email",
  email_address: "email",
  phone: "phone",
  phone_number: "phone",
  company: "company_name",
  company_name: "company_name",
  organization: "company_name",
  title: "role_title",
  role: "role_title",
  role_title: "role_title",
  linkedin: "linkedin",
  linkedin_url: "linkedin",
  bucket: "bucket",
  group: "bucket",
  want_to_know_bucket: "bucket",
  qualifying_signal: "qualifying_signal",
  signal: "qualifying_signal",
  recommended_action: "recommended_action",
  next_action: "recommended_action",
  source_type: "source_type",
  notes: "notes",
  note: "notes",
  context: "notes",
};

function normalizedHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function parseCsvRows(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "," && !quoted) {
      row.push(field);
      field = "";
      continue;
    }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += character;
  }

  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function clean(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizedEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function normalizedLinkedin(value: string | null | undefined) {
  if (!value?.trim()) return "";
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`,
    );
    if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return "";
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/$/, "").toLowerCase()}`;
  } catch {
    return "";
  }
}

function normalizedNameCompany(identity: ClientListImportIdentity) {
  const name = identity.full_name?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  const company = identity.company_name?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  return name && company ? `${name}|${company}` : "";
}

function duplicateKeys(identity: ClientListImportIdentity) {
  return [
    normalizedEmail(identity.email) ? `email:${normalizedEmail(identity.email)}` : "",
    normalizedLinkedin(identity.linkedin)
      ? `linkedin:${normalizedLinkedin(identity.linkedin)}`
      : "",
    normalizedNameCompany(identity)
      ? `name_company:${normalizedNameCompany(identity)}`
      : "",
  ].filter(Boolean);
}

function rowIssues(row: ClientListImportRow) {
  const issues: string[] = [];
  if (!row.full_name) issues.push("Full name is required.");
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
    issues.push("Email is not valid.");
  }
  if (row.linkedin && !normalizedLinkedin(row.linkedin)) {
    issues.push("LinkedIn URL is not valid.");
  }
  if (!row.email && !row.linkedin && !row.company_name) {
    issues.push("Add an email, LinkedIn URL, or company so this person can be checked for duplicates.");
  }
  return issues;
}

export function previewClientListImport({
  csv,
  existing = [],
  maxRows = 500,
}: {
  csv: string;
  existing?: ClientListImportIdentity[];
  maxRows?: number;
}): ClientListImportPreview {
  if (csv.length > 2_000_000) throw new Error("The CSV is larger than the 2 MB preview limit.");
  const parsed = parseCsvRows(csv);
  if (parsed.length === 0) throw new Error("The CSV is empty.");

  const mappedHeaders = parsed[0].map((header) => aliases[normalizedHeader(header)] ?? null);
  const headers = Array.from(
    new Set(mappedHeaders.filter((field): field is ClientListImportField => Boolean(field))),
  );
  if (!headers.includes("full_name")) {
    throw new Error("Add a full_name or name column before previewing the list.");
  }

  const existingKeys = new Map<string, string>();
  existing.forEach((identity) => {
    duplicateKeys(identity).forEach((key) =>
      existingKeys.set(key, identity.id ?? identity.full_name ?? "an existing contact"),
    );
  });
  const fileKeys = new Map<string, number>();
  const dataRows = parsed.slice(1);
  const rows = dataRows.slice(0, maxRows).map((values, index) => {
    const row = Object.fromEntries(
      clientListImportFields.map((field) => [field, ""]),
    ) as Record<ClientListImportField, string>;
    mappedHeaders.forEach((field, column) => {
      if (!field || row[field]) return;
      row[field] = clean(values[column] ?? "", field === "notes" ? 4000 : 500);
    });
    row.email = normalizedEmail(row.email);
    const importedRow: ClientListImportRow = { ...row, source_row: index + 2 };
    const issues = rowIssues(importedRow);
    let duplicateOf: string | null = null;
    for (const key of duplicateKeys(importedRow)) {
      if (existingKeys.has(key)) {
        duplicateOf = existingKeys.get(key) ?? "an existing contact";
        break;
      }
      if (fileKeys.has(key)) {
        duplicateOf = `CSV row ${fileKeys.get(key)}`;
        break;
      }
    }
    duplicateKeys(importedRow).forEach((key) => {
      if (!fileKeys.has(key)) fileKeys.set(key, importedRow.source_row);
    });

    return {
      row: importedRow,
      status: issues.length ? "invalid" : duplicateOf ? "duplicate" : "ready",
      issues,
      duplicateOf,
    } satisfies ClientListImportPreviewRow;
  });

  return {
    headers,
    rows,
    ready: rows.filter((row) => row.status === "ready").length,
    duplicates: rows.filter((row) => row.status === "duplicate").length,
    invalid: rows.filter((row) => row.status === "invalid").length,
    truncated: dataRows.length > maxRows,
  };
}

export function buildClientListImportProvenance({
  batchId,
  fileName,
  importedByUserId,
  observedAt,
  sourceRow,
}: {
  batchId: string;
  fileName: string;
  importedByUserId: string;
  observedAt: string;
  sourceRow: number;
}): ClientListImportProvenance {
  const safeFileName = fileName.replace(/[^a-z0-9._ -]/gi, "").trim().slice(0, 180) || "client-list.csv";
  return {
    source_type: "operator_client_list",
    source_ref: `client-list:${batchId}:row:${sourceRow}`,
    import_batch_id: batchId,
    file_name: safeFileName,
    source_row: sourceRow,
    imported_by_user_id: importedByUserId,
    observed_at: observedAt,
  };
}

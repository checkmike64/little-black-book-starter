export type DuplicateConfidence = "high" | "medium" | "low";

export type DuplicateReviewAction = "merge_review" | "compare";

export type ContactDuplicateRecord = {
  id: string;
  full_name: string | null;
  email?: string | null;
  phone?: string | null;
  company_name?: string | null;
  role_title?: string[] | null;
  linkedin?: string | null;
  website?: string | null;
  relationship_type?: string[] | null;
  one_line_summary?: string | null;
};

export type ContactDuplicateInput = Omit<ContactDuplicateRecord, "id"> & {
  id?: string | null;
};

export type ContactDuplicateMatch<T extends ContactDuplicateRecord = ContactDuplicateRecord> = {
  contact: T;
  score: number;
  confidence: DuplicateConfidence;
  action: DuplicateReviewAction;
  reasons: string[];
};

export type ExactIdentityDuplicateMatch<
  T extends ContactDuplicateRecord = ContactDuplicateRecord,
> = {
  contact: T;
  reason: "Exact name and email match";
};

const recommendedIdentityReasons = new Set([
  "Exact email match",
  "Exact phone match",
  "Exact LinkedIn match",
  "Exact name match",
]);

const strongIdentifierReasons = new Set([
  "Exact email match",
  "Exact phone match",
  "Exact LinkedIn match",
]);

export type DuplicatePayloadCandidate = {
  id: string;
  full_name: string | null;
  company_name: string | null;
  email: string | null;
  score: number;
  confidence: DuplicateConfidence;
  reason: string;
  source: "app_duplicate_check";
};

type DuplicateOptions = {
  limit?: number;
  minimumScore?: number;
};

const honorifics = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "sir", "dame"]);
const companySuffixes = new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "llc",
  "ltd",
  "limited",
  "lp",
  "plc",
  "group",
]);

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function cleanArray(value: unknown) {
  if (!Array.isArray(value)) return null;
  const clean = value.map(cleanText).filter(Boolean);
  return clean.length > 0 ? clean : null;
}

function normalizeWords(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9@.+\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(value: unknown) {
  return normalizeWords(value)
    .split(" ")
    .map((token) => token.replace(/\.$/, ""))
    .filter((token) => token.length > 1 && !honorifics.has(token));
}

function companyTokens(value: unknown) {
  return normalizeWords(value)
    .split(" ")
    .filter((token) => token.length > 1 && !companySuffixes.has(token));
}

function normalizeEmail(value: unknown) {
  const email = cleanText(value).toLowerCase();
  return email.includes("@") ? email : "";
}

export function findExactIdentityDuplicate<
  T extends ContactDuplicateRecord,
>(
  input: ContactDuplicateInput,
  contacts: T[],
): ExactIdentityDuplicateMatch<T> | null {
  const inputName = normalizeWords(input.full_name);
  const inputEmail = normalizeEmail(input.email);

  if (!inputName || !inputEmail) return null;

  const matches = contacts.filter(
    (contact) =>
      (!input.id || contact.id !== input.id) &&
      normalizeWords(contact.full_name) === inputName &&
      normalizeEmail(contact.email) === inputEmail,
  );

  if (matches.length !== 1) return null;

  return {
    contact: matches[0],
    reason: "Exact name and email match",
  };
}

function normalizePhone(value: unknown) {
  const digits = cleanText(value).replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : "";
}

function normalizeUrl(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

function normalizeLinkedIn(value: unknown) {
  return normalizeUrl(value)
    .replace(/^linkedin\.com\//, "")
    .replace(/^in\//, "")
    .replace(/^company\//, "");
}

function overlap(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length;
}

function stringArrayText(value: string[] | null | undefined) {
  return value?.join(" ") ?? "";
}

function confidenceForScore(score: number): DuplicateConfidence {
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function actionForScore(score: number): DuplicateReviewAction {
  return score >= 70 ? "merge_review" : "compare";
}

function dedupeReasons(reasons: string[]) {
  return Array.from(new Set(reasons)).slice(0, 5);
}

export function contactDuplicateInputFromPayload(
  payload: Record<string, unknown>,
): ContactDuplicateInput {
  const nested =
    payload.contact && typeof payload.contact === "object" && !Array.isArray(payload.contact)
      ? (payload.contact as Record<string, unknown>)
      : payload.candidate && typeof payload.candidate === "object" && !Array.isArray(payload.candidate)
        ? (payload.candidate as Record<string, unknown>)
      : payload.fields && typeof payload.fields === "object" && !Array.isArray(payload.fields)
        ? (payload.fields as Record<string, unknown>)
        : payload;

  return {
    full_name: cleanText(nested.full_name ?? nested.name) || null,
    email: cleanText(nested.email) || null,
    phone: cleanText(nested.phone) || null,
    company_name: cleanText(nested.company_name ?? nested.company) || null,
    role_title: cleanArray(nested.role_title),
    linkedin: cleanText(nested.linkedin) || null,
    website: cleanText(nested.website) || null,
    relationship_type: cleanArray(nested.relationship_type),
    one_line_summary: cleanText(nested.one_line_summary) || null,
  };
}

export function findDuplicateCandidates<T extends ContactDuplicateRecord>(
  input: ContactDuplicateInput,
  contacts: T[],
  options: DuplicateOptions = {},
): ContactDuplicateMatch<T>[] {
  const minimumScore = options.minimumScore ?? 30;
  const limit = options.limit ?? 8;
  const inputEmail = normalizeEmail(input.email);
  const inputPhone = normalizePhone(input.phone);
  const inputLinkedIn = normalizeLinkedIn(input.linkedin);
  const inputWebsite = normalizeUrl(input.website);
  const inputName = normalizeWords(input.full_name);
  const inputNameTokens = nameTokens(input.full_name);
  const inputCompany = companyTokens(input.company_name);
  const inputRole = nameTokens(stringArrayText(input.role_title));

  return contacts
    .filter((contact) => !input.id || contact.id !== input.id)
    .map((contact) => {
      let score = 0;
      const reasons: string[] = [];
      const contactName = normalizeWords(contact.full_name);
      const contactNameTokens = nameTokens(contact.full_name);
      const contactCompany = companyTokens(contact.company_name);

      if (inputEmail && inputEmail === normalizeEmail(contact.email)) {
        score += 70;
        reasons.push("Exact email match");
      }

      if (inputPhone && inputPhone === normalizePhone(contact.phone)) {
        score += 55;
        reasons.push("Exact phone match");
      }

      if (inputLinkedIn && inputLinkedIn === normalizeLinkedIn(contact.linkedin)) {
        score += 65;
        reasons.push("Exact LinkedIn match");
      }

      if (inputWebsite && inputWebsite === normalizeUrl(contact.website)) {
        score += 12;
        reasons.push("Same website");
      }

      if (inputName && contactName) {
        const nameOverlap = overlap(inputNameTokens, contactNameTokens);
        if (inputName === contactName) {
          score += 35;
          reasons.push("Exact name match");
        } else if (
          nameOverlap >= Math.min(inputNameTokens.length, contactNameTokens.length) &&
          nameOverlap >= 2
        ) {
          score += 28;
          reasons.push("Strong name match");
        } else if (nameOverlap >= 2) {
          score += 20;
          reasons.push("Partial name match");
        } else if (nameOverlap === 1 && inputNameTokens.length === 1) {
          score += 8;
          reasons.push("Name token match");
        }
      }

      const companyOverlap = overlap(inputCompany, contactCompany);
      if (inputCompany.length > 0 && contactCompany.length > 0) {
        if (
          inputCompany.join(" ") === contactCompany.join(" ") ||
          companyOverlap >= Math.min(inputCompany.length, contactCompany.length)
        ) {
          score += 18;
          reasons.push("Company match");
        } else if (companyOverlap > 0) {
          score += 8;
          reasons.push("Company overlap");
        }
      }

      const roleOverlap = overlap(inputRole, nameTokens(stringArrayText(contact.role_title)));
      if (roleOverlap > 0) {
        score += Math.min(8, roleOverlap * 4);
        reasons.push("Role/title overlap");
      }

      const cappedScore = Math.min(100, score);
      return {
        contact,
        score: cappedScore,
        confidence: confidenceForScore(cappedScore),
        action: actionForScore(cappedScore),
        reasons: dedupeReasons(reasons),
      };
    })
    .filter((match) => match.score >= minimumScore)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.contact.full_name?.localeCompare(right.contact.full_name ?? "") ||
        0,
    )
    .slice(0, limit);
}

export function recommendedExistingContact<
  T extends ContactDuplicateRecord,
>(matches: ContactDuplicateMatch<T>[]) {
  const identityMatches = matches.filter((match) =>
    match.reasons.some((reason) => recommendedIdentityReasons.has(reason)),
  );

  return identityMatches.length === 1 ? identityMatches[0] : null;
}

export function hasStrongIdentityIdentifier(
  match: ContactDuplicateMatch | null | undefined,
) {
  return Boolean(
    match?.reasons.some((reason) => strongIdentifierReasons.has(reason)),
  );
}

export function duplicateMatchesToPayloadCandidates(
  matches: ContactDuplicateMatch[],
): DuplicatePayloadCandidate[] {
  return matches.map((match) => ({
    id: match.contact.id,
    full_name: match.contact.full_name,
    company_name: match.contact.company_name ?? null,
    email: match.contact.email ?? null,
    score: match.score,
    confidence: match.confidence,
    reason: match.reasons.join(" · "),
    source: "app_duplicate_check",
  }));
}

export function mergeDuplicateCandidatesIntoPayload(
  payload: Record<string, unknown>,
  appCandidates: DuplicatePayloadCandidate[],
) {
  if (appCandidates.length === 0) return payload;

  const existing = Array.isArray(payload.duplicate_candidates)
    ? payload.duplicate_candidates.filter(
        (candidate): candidate is Record<string, unknown> =>
          Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate),
      )
    : [];
  const seen = new Set<string>();
  const duplicateCandidates = [...appCandidates, ...existing].filter((candidate) => {
    const id =
      typeof candidate.id === "string"
        ? candidate.id
        : `${candidate.full_name ?? ""}:${candidate.email ?? ""}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return {
    ...payload,
    duplicate_candidates: duplicateCandidates.slice(0, 8),
  };
}

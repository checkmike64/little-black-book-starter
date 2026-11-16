export type BookSearchContact = {
  id: string;
  full_name: string;
  email: string | null;
  company_name: string | null;
  role_title: string[] | null;
  primary_category: string[] | null;
  relationship_type: string[] | null;
  top_3_tags: string[] | null;
  keywords: string[] | null;
};

export type BookSearchMatchKind = "name" | "email" | "company-role" | "profile";

export type BookSearchMatch = {
  kind: BookSearchMatchKind;
  label: "Name" | "Primary email" | "Company or role" | "Profile";
  score: number;
};

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasTokenPrefix(value: string, query: string) {
  return value
    .split(/[^a-z0-9@.+-]+/)
    .some((token) => token.startsWith(query));
}

function structuredScore(value: string, query: string, base: number) {
  if (!value) return 0;
  if (value === query) return base + 60;
  if (value.startsWith(query)) return base + 40;
  if (hasTokenPrefix(value, query)) return base + 20;
  return query.length >= 3 && value.includes(query) ? base : 0;
}

/**
 * Ranks stable identity fields first. Narrative fields such as private notes,
 * asks, and recent activity are intentionally excluded from Book search.
 */
export function rankBookSearchContact(
  contact: BookSearchContact,
  rawQuery: string,
): BookSearchMatch | null {
  const query = normalize(rawQuery);
  if (!query) return null;

  const name = normalize(contact.full_name);
  if (name === query) return { kind: "name", label: "Name", score: 1_000 };
  if (name.startsWith(query)) return { kind: "name", label: "Name", score: 960 };
  if (hasTokenPrefix(name, query)) return { kind: "name", label: "Name", score: 940 };
  if (name.includes(query)) return { kind: "name", label: "Name", score: 900 };

  const email = normalize(contact.email);
  if (email === query) return { kind: "email", label: "Primary email", score: 860 };
  if (email.startsWith(query)) return { kind: "email", label: "Primary email", score: 840 };
  if (email.includes(query)) return { kind: "email", label: "Primary email", score: 820 };

  const companyScore = structuredScore(normalize(contact.company_name), query, 720);
  const roleScore = Math.max(
    0,
    ...(contact.role_title ?? []).map((role) => structuredScore(normalize(role), query, 680)),
  );
  const identityScore = Math.max(companyScore, roleScore);
  if (identityScore > 0) {
    return { kind: "company-role", label: "Company or role", score: identityScore };
  }

  if (query.length < 3) return null;

  const profileValues = [
    ...(contact.primary_category ?? []),
    ...(contact.relationship_type ?? []),
    ...(contact.top_3_tags ?? []),
    ...(contact.keywords ?? []),
  ];
  const profileScore = Math.max(
    0,
    ...profileValues.map((value) => structuredScore(normalize(value), query, 400)),
  );
  return profileScore > 0
    ? { kind: "profile", label: "Profile", score: profileScore }
    : null;
}

export function rankedBookSearch<T extends BookSearchContact>(contacts: T[], query: string) {
  return contacts
    .map((contact) => ({ contact, match: rankBookSearchContact(contact, query) }))
    .filter(
      (result): result is { contact: T; match: BookSearchMatch } =>
        result.match !== null,
    )
    .sort(
      (a, b) =>
        b.match.score - a.match.score ||
        a.contact.full_name.localeCompare(b.contact.full_name),
    );
}

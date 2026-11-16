export type NetworkingEvidenceClaim = {
  contact_id: string;
  source_ref: string;
  excerpt: string;
};

export type PersistedNetworkingEvidence = {
  contactId: string;
  sourceRef: string;
  text: string;
};

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function canonicalExcerpt(text: string, requested: string) {
  const stored = compact(text);
  const excerpt = compact(requested);
  const substantive = excerpt
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !["that", "this", "with", "from", "have", "their"].includes(token));
  if (!stored || excerpt.length < 6 || substantive.length === 0) return null;
  const index = stored.toLocaleLowerCase().indexOf(excerpt.toLocaleLowerCase());
  return index < 0 ? null : stored.slice(index, index + excerpt.length);
}

export function groundNetworkingEvidence(input: {
  contactA: string;
  contactB: string;
  claims: NetworkingEvidenceClaim[];
  persisted: PersistedNetworkingEvidence[];
}) {
  const pair = new Set([input.contactA, input.contactB]);
  if (input.claims.length < 2 || input.claims.length > 8) return null;
  const canonicalClaims: NetworkingEvidenceClaim[] = [];
  for (const claim of input.claims) {
    if (!pair.has(claim.contact_id) || !claim.source_ref || !claim.excerpt) return null;
    const source = input.persisted.find(
      (row) =>
        row.contactId === claim.contact_id &&
        row.sourceRef === claim.source_ref &&
        canonicalExcerpt(row.text, claim.excerpt),
    );
    if (!source) return null;
    const excerpt = canonicalExcerpt(source.text, claim.excerpt);
    if (!excerpt) return null;
    canonicalClaims.push({
      contact_id: claim.contact_id,
      source_ref: claim.source_ref,
      excerpt,
    });
  }
  const coveredContacts = new Set(canonicalClaims.map((claim) => claim.contact_id));
  if (!coveredContacts.has(input.contactA) || !coveredContacts.has(input.contactB)) return null;
  return canonicalClaims;
}

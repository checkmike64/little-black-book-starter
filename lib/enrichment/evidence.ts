// Evidence assembly for the in-app contact-enrichment worker. Everything here is
// pure so the grounding rules can be tested without network or database access.

export type EnrichmentSourceKind =
  | "book_profile"
  | "meeting_notes"
  | "interaction"
  | "calendar"
  | "social_post"
  | "website"
  | "site_health"
  | "linkedin_profile"
  | "instagram_profile"
  | "search_results";

export type EnrichmentSource = {
  id: string;
  kind: EnrichmentSourceKind;
  label: string;
  url: string | null;
  observed_at: string | null;
  text: string;
};

/** Sources the owner already holds (Book records). Public sources need an identity match. */
export const ownerSourceKinds = new Set<EnrichmentSourceKind>([
  "book_profile",
  "meeting_notes",
  "interaction",
  "calendar",
]);

export function isOwnerSource(source: Pick<EnrichmentSource, "kind">) {
  return ownerSourceKinds.has(source.kind);
}

const freeMailDomains = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.ca",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.net",
  "hey.com",
  "fastmail.com",
  "zoho.com",
  "yandex.com",
  "mail.com",
]);

export function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function boundedText(value: unknown, limit: number) {
  if (typeof value !== "string") return "";
  const text = collapseWhitespace(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** The organization domain behind an email address, or null for free-mail providers. */
export function emailOrganizationDomain(email: string | null | undefined) {
  const domain = email?.trim().toLowerCase().split("@")[1]?.replace(/\.$/, "");
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  return freeMailDomains.has(domain) ? null : domain;
}

const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsaquo: "›",
  laquo: "«",
  raquo: "»",
};

export function decodeHtmlEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return namedEntities[lower] ?? match;
  });
}

export type ParsedPage = {
  title: string | null;
  description: string | null;
  text: string;
  links: string[];
};

/** Reduce an HTML document to readable text plus its outbound links. */
export function parseHtmlPage(html: string, baseUrl: string): ParsedPage {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i)?.[1];
  const links = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(decodeHtmlEntities(match[1]), baseUrl);
      if (url.protocol === "https:" || url.protocol === "http:") links.add(url.toString());
    } catch {
      // Ignore malformed links.
    }
    if (links.size >= 200) break;
  }
  const body = html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return {
    title: title ? collapseWhitespace(decodeHtmlEntities(title)) || null : null,
    description: description ? collapseWhitespace(decodeHtmlEntities(description)) || null : null,
    text: collapseWhitespace(decodeHtmlEntities(body)),
    links: [...links],
  };
}

export type ProfileLinks = {
  linkedin: string[];
  instagram: string[];
  x_twitter: string[];
  youtube: string[];
  facebook: string[];
};

const reservedInstagramPaths = new Set(["p", "reel", "reels", "explore", "stories", "accounts", "tv"]);
const reservedXPaths = new Set(["intent", "share", "home", "search", "hashtag", "i"]);
const reservedFacebookPaths = new Set(["sharer", "sharer.php", "share.php", "dialog", "tr", "plugins", "groups", "events"]);

function hostOf(url: URL) {
  return url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
}

/** Canonical public profile URL for a social link, or null when it is not a profile. */
export function canonicalProfileUrl(raw: string): { platform: keyof ProfileLinks; url: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = hostOf(url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    if (parts[0] !== "in" || !parts[1]) return null;
    const slug = decodeURIComponent(parts[1]).toLowerCase();
    if (!/^[\p{L}\p{N}_-]{2,100}$/u.test(slug)) return null;
    return { platform: "linkedin", url: `https://www.linkedin.com/in/${slug}` };
  }
  if (host === "instagram.com") {
    const handle = parts[0]?.toLowerCase();
    if (!handle || reservedInstagramPaths.has(handle) || !/^[a-z0-9._]{1,30}$/.test(handle)) return null;
    return { platform: "instagram", url: `https://www.instagram.com/${handle}/` };
  }
  if (host === "x.com" || host === "twitter.com") {
    const handle = parts[0];
    if (!handle || reservedXPaths.has(handle.toLowerCase()) || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;
    return { platform: "x_twitter", url: `https://x.com/${handle}` };
  }
  if (host === "youtube.com") {
    const first = parts[0];
    if (!first) return null;
    if (first.startsWith("@") && /^@[A-Za-z0-9._-]{2,100}$/.test(first)) {
      return { platform: "youtube", url: `https://www.youtube.com/${first}` };
    }
    if (["c", "channel", "user"].includes(first) && parts[1] && /^[A-Za-z0-9_-]{2,100}$/.test(parts[1])) {
      return { platform: "youtube", url: `https://www.youtube.com/${first}/${parts[1]}` };
    }
    return null;
  }
  if (host === "facebook.com") {
    const page = parts[0];
    if (!page || reservedFacebookPaths.has(page.toLowerCase()) || page === "profile.php") return null;
    if (!/^[A-Za-z0-9.-]{3,80}$/.test(page)) return null;
    return { platform: "facebook", url: `https://www.facebook.com/${page}` };
  }
  return null;
}

const urlPattern = /https?:\/\/[^\s"'<>()[\]{}]+/gi;

/** Social profile URLs mentioned in text or links, deduplicated per platform. */
export function extractProfileLinks(values: Iterable<string>): ProfileLinks {
  const found: ProfileLinks = { linkedin: [], instagram: [], x_twitter: [], youtube: [], facebook: [] };
  for (const value of values) {
    const candidates = value.match(urlPattern) ?? [];
    for (const candidate of candidates) {
      const profile = canonicalProfileUrl(candidate.replace(/[.,;:!?]+$/, ""));
      if (profile && !found[profile.platform].includes(profile.url)) {
        found[profile.platform].push(profile.url);
      }
    }
  }
  return found;
}

/** Normalized comparison key for URLs: no scheme, no www, no trailing slash, lower case. */
export function urlKey(value: string) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  }
}

export function nameTokens(fullName: string) {
  return collapseWhitespace(fullName)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

/** Whether a piece of text names the person (all name tokens present). */
export function textNamesPerson(text: string, fullName: string) {
  const tokens = nameTokens(fullName);
  if (tokens.length === 0) return false;
  const haystack = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  return tokens.every((token) => haystack.includes(token));
}

export type SearchResult = { title: string; url: string; description: string };

export function searchResultsFromApify(items: unknown[]): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const organic = (item as Record<string, unknown>).organicResults;
    if (!Array.isArray(organic)) continue;
    for (const row of organic) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      const url = typeof record.url === "string" ? record.url.trim() : "";
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      results.push({
        title: boundedText(record.title, 200),
        url,
        description: boundedText(record.description, 400),
      });
      if (results.length >= 30) return results;
    }
  }
  return results;
}

/** Name-matched social profiles found across the initial public search. */
export function profileCandidatesFromSearch(
  results: SearchResult[],
  fullName: string,
): ProfileLinks {
  const found: ProfileLinks = {
    linkedin: [],
    instagram: [],
    x_twitter: [],
    youtube: [],
    facebook: [],
  };
  for (const result of results) {
    if (!textNamesPerson(`${result.title} ${result.description} ${result.url}`, fullName)) continue;
    const profile = canonicalProfileUrl(result.url);
    if (profile && !found[profile.platform].includes(profile.url)) {
      found[profile.platform].push(profile.url);
    }
  }
  return found;
}

/** Search hits that look like the person's own LinkedIn profile, best first. */
export function linkedinCandidatesFromSearch(results: SearchResult[], fullName: string) {
  return profileCandidatesFromSearch(results, fullName).linkedin;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Readable text for a harvestapi LinkedIn profile item. */
export function linkedinProfileText(item: unknown) {
  const profile = record(item);
  const lines: string[] = [];
  const name = [profile.firstName, profile.lastName].filter((part) => typeof part === "string").join(" ");
  if (name.trim()) lines.push(`Name: ${boundedText(name, 160)}`);
  if (typeof profile.linkedinUrl === "string") lines.push(`Profile URL: ${profile.linkedinUrl}`);
  if (typeof profile.headline === "string") lines.push(`Headline: ${boundedText(profile.headline, 400)}`);
  const location = record(profile.location);
  const locationText = typeof location.linkedinText === "string" ? location.linkedinText : null;
  if (locationText) lines.push(`Location: ${boundedText(locationText, 160)}`);
  const positions = Array.isArray(profile.currentPosition) ? profile.currentPosition : [];
  for (const position of positions.slice(0, 3)) {
    const row = record(position);
    const title = boundedText(row.position, 160);
    const company = boundedText(row.companyName, 160);
    if (title || company) lines.push(`Current position: ${[title, company].filter(Boolean).join(" at ")}`);
  }
  if (typeof profile.about === "string") lines.push(`About: ${boundedText(profile.about, 1_800)}`);
  const experience = Array.isArray(profile.experience) ? profile.experience : [];
  for (const entry of experience.slice(0, 4)) {
    const row = record(entry);
    const title = boundedText(row.position, 160);
    const company = boundedText(row.companyName, 160);
    const start = boundedText(record(row.startDate).text, 40);
    const end = boundedText(record(row.endDate).text, 40);
    if (title || company) {
      lines.push(`Experience: ${[title, company].filter(Boolean).join(" at ")}${start ? ` (${start} – ${end || "present"})` : ""}`);
    }
  }
  const education = Array.isArray(profile.education) ? profile.education : [];
  for (const entry of education.slice(0, 2)) {
    const row = record(entry);
    const school = boundedText(row.schoolName, 160);
    const degree = boundedText(row.degree, 160);
    if (school) lines.push(`Education: ${[degree, school].filter(Boolean).join(", ")}`);
  }
  return lines.join("\n");
}

/** Readable text for an apify/instagram-profile-scraper item. */
export function instagramProfileText(item: unknown) {
  const profile = record(item);
  const lines: string[] = [];
  if (typeof profile.fullName === "string") lines.push(`Name: ${boundedText(profile.fullName, 160)}`);
  if (typeof profile.username === "string") lines.push(`Handle: @${boundedText(profile.username, 60)}`);
  if (typeof profile.url === "string") lines.push(`Profile URL: ${profile.url}`);
  if (typeof profile.biography === "string") lines.push(`Bio: ${boundedText(profile.biography, 600)}`);
  if (typeof profile.externalUrl === "string") lines.push(`Link in bio: ${profile.externalUrl}`);
  if (typeof profile.businessCategoryName === "string") {
    lines.push(`Category: ${boundedText(profile.businessCategoryName, 120)}`);
  }
  if (typeof profile.followersCount === "number") lines.push(`Followers: ${profile.followersCount}`);
  return lines.join("\n");
}

export function searchResultsText(results: SearchResult[]) {
  return results
    .map((result, index) => `${index + 1}. ${result.title}\n${result.url}\n${result.description}`)
    .join("\n");
}

/**
 * Keep the evidence set inside the model's input budget. Owner sources keep
 * their room first; public sources share what is left in order.
 */
export function boundSources(sources: EnrichmentSource[], totalChars: number, perSourceChars = 6_000) {
  const ordered = [
    ...sources.filter(isOwnerSource),
    ...sources.filter((source) => !isOwnerSource(source)),
  ];
  let remaining = totalChars;
  const kept: EnrichmentSource[] = [];
  for (const source of ordered) {
    if (remaining < 200) break;
    const limit = Math.min(perSourceChars, remaining);
    const text = source.text.length > limit ? `${source.text.slice(0, limit - 1)}…` : source.text;
    if (!text.trim()) continue;
    kept.push({ ...source, text });
    remaining -= text.length;
  }
  return kept;
}

export function normalizedForMatch(value: string) {
  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-");
}

/** Letters and digits only, in order: ignores punctuation, emoji, accents, and spacing. */
function wordKey(value: string) {
  return normalizedForMatch(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Whether `excerpt` appears in the source as the same words in the same order.
 * Punctuation, emoji, quote styles, and spacing may differ; words may not.
 */
export function excerptInSource(excerpt: string, source: Pick<EnrichmentSource, "text">) {
  const needle = wordKey(excerpt);
  return needle.length >= 8 && ` ${wordKey(source.text)} `.includes(` ${needle} `);
}

/** Whether the URL is literally present in some source (as text or as the source's own URL). */
export function urlInSources(value: string, sources: Pick<EnrichmentSource, "text" | "url">[]) {
  const key = urlKey(value);
  if (!key) return false;
  return sources.some((source) => {
    if (source.url && urlKey(source.url) === key) return true;
    const matches = source.text.match(urlPattern) ?? [];
    if (matches.some((match) => urlKey(match.replace(/[.,;:!?]+$/, "")) === key)) return true;
    return normalizedForMatch(source.text).includes(key);
  });
}

const trackingParams = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
]);

function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    ["example.com", "example.net", "example.org"].some(
      (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
    ) ||
    normalized.endsWith(".local") ||
    /^10\./.test(normalized) ||
    /^127\./.test(normalized) ||
    /^192\.168\./.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(normalized) ||
    /^(fc|fd|fe80):/i.test(normalized)
  );
}

export function normalizeExternalContentUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      isPrivateHostname(url.hostname)
    ) {
      return null;
    }

    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.toLowerCase().startsWith("utm_") || trackingParams.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

function hostMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Returns a platform label only when the URL points to a specific public item
 * that supports an on-platform engagement action. Profiles, home pages,
 * articles, newsletters, podcast players, and generic websites are excluded.
 */
export function engageableSocialPostPlatform(value: string) {
  const normalized = normalizeExternalContentUrl(value);
  if (!normalized) return null;

  const url = new URL(normalized);
  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();

  if (
    hostMatches(hostname, "linkedin.com") &&
    (/^\/posts\/[^/]+/.test(pathname) ||
      /^\/feed\/update\/urn(?::|%3a)li(?::|%3a)activity(?::|%3a)[^/]+/.test(
        pathname,
      ))
  ) {
    return "LinkedIn";
  }

  if (
    (hostMatches(hostname, "facebook.com") || hostname === "fb.watch") &&
    (hostname === "fb.watch"
      ? pathname !== "/"
      : /^\/(?:[^/]+\/)?(?:posts|videos|reel)\/[^/]+/.test(pathname) ||
        /^\/share\/[prv]\/[^/]+/.test(pathname) ||
        ((pathname === "/permalink.php" ||
          pathname === "/story.php" ||
          pathname === "/photo.php" ||
          pathname === "/watch/") &&
          (url.searchParams.has("story_fbid") ||
            url.searchParams.has("fbid") ||
            url.searchParams.has("v"))))
  ) {
    return "Facebook";
  }

  if (
    hostMatches(hostname, "instagram.com") &&
    /^\/(?:p|reel|tv)\/[^/]+/.test(pathname)
  ) {
    return "Instagram";
  }

  if (
    (hostMatches(hostname, "x.com") || hostMatches(hostname, "twitter.com")) &&
    /^\/(?:i\/web\/|[^/]+\/)?status\/\d+/.test(pathname)
  ) {
    return "X";
  }

  if (
    hostMatches(hostname, "threads.net") &&
    /^\/@[^/]+\/post\/[^/]+/.test(pathname)
  ) {
    return "Threads";
  }

  if (
    hostMatches(hostname, "tiktok.com") &&
    /^\/@[^/]+\/video\/\d+/.test(pathname)
  ) {
    return "TikTok";
  }

  if (
    (hostMatches(hostname, "youtube.com") &&
      ((pathname === "/watch" && url.searchParams.has("v")) ||
        /^\/(?:shorts|live|post)\/[^/]+/.test(pathname))) ||
    (hostname === "youtu.be" && pathname !== "/")
  ) {
    return "YouTube";
  }

  return null;
}

export function contentPlatformLabel(sourceUrl: string, source?: string | null) {
  const socialPlatform = engageableSocialPostPlatform(sourceUrl);
  if (socialPlatform) return socialPlatform;

  const hostname = new URL(sourceUrl).hostname.replace(/^www\./, "");
  if (hostname.includes("substack.com")) return "Newsletter";

  const normalizedSource = source?.trim();
  if (
    normalizedSource &&
    /^(newsletter|article|blog|podcast)$/i.test(normalizedSource)
  ) {
    return normalizedSource;
  }
  return "Article";
}

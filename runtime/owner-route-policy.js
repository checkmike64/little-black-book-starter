const operatorOnlyRouteFallbacks = [
  { route: "/quality", fallback: "/contacts?view=judgment" },
  { route: "/ops", fallback: "/dashboard" },
  { route: "/contacts/new", fallback: "/contacts" },
  { route: "/claude-setup", fallback: "/dashboard" },
  { route: "/intake", fallback: "/dashboard" },
  { route: "/recordings", fallback: "/changes" },
  { route: "/scoreboard", fallback: "/dashboard" },
  { route: "/launch", fallback: "/dashboard" },
  { route: "/deployment", fallback: "/dashboard" },
  { route: "/export", fallback: "/dashboard" },
  { route: "/settings", fallback: "/dashboard" },
];

export const ownerForbiddenHrefPrefixes = operatorOnlyRouteFallbacks.map(
  (policy) => policy.route,
);

function pathnameFromHref(href) {
  return href.split(/[?#]/)[0] || href;
}

function pathMatchesRoute(href, route) {
  const path = pathnameFromHref(href);
  return path === route || path.startsWith(`${route}/`);
}

export function isOwnerForbiddenHref(href) {
  return operatorOnlyRouteFallbacks.some((policy) =>
    pathMatchesRoute(href, policy.route),
  );
}

export function ownerSafeHref(href, adminMode = false) {
  if (adminMode) return href;

  const fallback = operatorOnlyRouteFallbacks.find((policy) =>
    pathMatchesRoute(href, policy.route),
  );

  return fallback?.fallback ?? href;
}

export function ownerSafeHrefs(hrefs, adminMode = false) {
  return Array.from(new Set(hrefs.map((href) => ownerSafeHref(href, adminMode))));
}

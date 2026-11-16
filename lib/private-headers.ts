export const privateHeaderValues = {
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  "Content-Security-Policy":
    "base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'",
} as const;

export const privateHeaderList = Object.entries(privateHeaderValues).map(
  ([key, value]) => ({ key, value }),
);

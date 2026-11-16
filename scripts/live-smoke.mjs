function normalizeBaseUrl(value) {
  const raw = String(value ?? "").trim().replace(/\/$/, "");
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function targetUrl() {
  const fromArg = process.argv[2];
  const fromEnv = process.env.LBB_SMOKE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  return normalizeBaseUrl(fromArg || fromEnv);
}

function smokeCookie() {
  return String(process.env.LBB_SMOKE_COOKIE ?? "").trim();
}

function pass(label, detail, section = "General") {
  return { label, status: "pass", detail, section };
}

function fail(label, detail, section = "General") {
  return { label, status: "fail", detail, section };
}

function warn(label, detail, section = "General") {
  return { label, status: "warn", detail, section };
}

function statusIcon(status) {
  if (status === "pass") return "PASS";
  if (status === "warn") return "WARN";
  return "FAIL";
}

function hasNoIndex(response) {
  return /noindex/i.test(response.headers.get("x-robots-tag") ?? "");
}

function hasCspGuard(response) {
  const csp = response.headers.get("content-security-policy") ?? "";
  return /frame-ancestors\s+'none'/i.test(csp) && /object-src\s+'none'/i.test(csp);
}

const ownerFlowPaths = [
  { path: "/dashboard", label: "Today" },
  { path: "/contacts", label: "My Book" },
  { path: "/engagement", label: "Engagement" },
  { path: "/ask", label: "Ask the Book" },
  { path: "/movement", label: "Next Moves" },
  { path: "/changes", label: "Review Changes" },
  { path: "/want-to-know", label: "Want-to-Know" },
];

const ownerDetailPaths = [
  { path: "/contacts/00000000-0000-4000-8000-000000000000", label: "Contact profile" },
  { path: "/ask/runs/00000000-0000-4000-8000-000000000000", label: "Saved Ask run" },
  { path: "/changes/00000000-0000-4000-8000-000000000000", label: "Change detail" },
];

const operatorProtectedPaths = [
  "/admin",
  "/claude-setup",
  "/claude-setup/packet",
  "/contacts/new",
  "/deployment",
  "/export",
  "/export/book",
  "/export/handoff",
  "/export/owner-handoff",
  "/intake",
  "/networking",
  "/ops",
  "/ops/jobs/00000000-0000-4000-8000-000000000000",
  "/ops/jobs/00000000-0000-4000-8000-000000000000/handoff",
  "/promises",
  "/quality",
  "/quality/queue",
  "/recordings",
  "/launch",
  "/launch/preview",
  "/settings",
];

const signedInOwnerPaths = [
  { path: "/dashboard", label: "Today", expectedHeading: "Today" },
  { path: "/contacts", label: "My Book", expectedHeading: "My Book" },
  { path: "/engagement", label: "Engagement", expectedHeading: "Engagement" },
  { path: "/ask", label: "Ask the Book", expectedHeading: "Ask the Book" },
  { path: "/movement", label: "Next Moves", expectedHeading: "Next Moves" },
  { path: "/changes", label: "Changes", expectedHeading: "Changes" },
  { path: "/want-to-know", label: "Want to Know", expectedHeading: "Want to Know" },
];

const forbiddenOwnerNavLabels = [
  "Management",
  "Ask",
  "Client Intake",
  "Client Admin",
  "Recordings",
  "Scoreboard",
  "Claude Setup",
  "Ops",
  "Quality",
  "Launch",
  "Deployment",
  "Export",
  "Settings",
];

const signedInOwnerProtectedPaths = ["/admin", "/recordings"];

const claudeGatewayRoutes = [
  { method: "GET", path: "/api/claude/research-context" },
  { method: "POST", path: "/api/claude/calendar" },
  { method: "POST", path: "/api/claude/content" },
  { method: "POST", path: "/api/claude/interactions" },
  { method: "POST", path: "/api/claude/jobs" },
  {
    method: "POST",
    path: "/api/claude/jobs/00000000-0000-4000-8000-000000000000/complete",
  },
  {
    method: "POST",
    path: "/api/claude/jobs/00000000-0000-4000-8000-000000000000/fail",
  },
  { method: "POST", path: "/api/claude/pending-changes" },
  { method: "POST", path: "/api/claude/networking" },
  { method: "POST", path: "/api/claude/signals" },
];

async function fetchNoRedirect(url, init = {}) {
  return fetch(url, {
    ...init,
    redirect: "manual",
    headers: {
      "User-Agent": "little-black-book-live-smoke/1.0",
      ...init.headers,
    },
  });
}

async function fetchSignedIn(baseUrl, path, cookie) {
  return fetchNoRedirect(`${baseUrl}${path}`, {
    headers: {
      Cookie: cookie,
    },
  });
}

async function checkReachable(baseUrl, path, section) {
  const response = await fetchNoRedirect(`${baseUrl}${path}`);
  if (response.status < 200 || response.status >= 400) {
    return fail(`${path} is reachable`, `Expected 2xx or 3xx, got ${response.status}.`, section);
  }

  return pass(`${path} is reachable`, `Returned ${response.status}.`, section);
}

async function checkNoIndex(baseUrl, path, section) {
  const response = await fetchNoRedirect(`${baseUrl}${path}`);
  if (!hasNoIndex(response)) {
    return fail(`${path} sends X-Robots-Tag`, "Missing noindex response header.", section);
  }

  return pass(`${path} sends X-Robots-Tag`, response.headers.get("x-robots-tag"), section);
}

async function checkPrivateHeaders(baseUrl, path, section) {
  const response = await fetchNoRedirect(`${baseUrl}${path}`);
  const missing = [];

  if (!hasNoIndex(response)) missing.push("X-Robots-Tag");
  if (!hasCspGuard(response)) missing.push("Content-Security-Policy");

  if (missing.length > 0) {
    return fail(
      `${path} sends private headers`,
      `Missing or incomplete: ${missing.join(", ")}.`,
      section,
    );
  }

  return pass(
    `${path} sends private headers`,
    "noindex plus anti-embed/object CSP guards are present.",
    section,
  );
}

async function checkRobots(baseUrl) {
  const response = await fetchNoRedirect(`${baseUrl}/robots.txt`);
  const body = await response.text();

  if (!response.ok) {
    return fail("/robots.txt blocks indexing", `Expected 200, got ${response.status}.`);
  }

  if (!/disallow:\s*\//i.test(body)) {
    return fail("/robots.txt blocks indexing", "robots.txt does not disallow all crawlers.");
  }

  return pass("/robots.txt blocks indexing", "Disallow: / is present.");
}

async function checkSitemapPrivateRoutes(baseUrl) {
  const response = await fetchNoRedirect(`${baseUrl}/sitemap.xml`);
  const body = await response.text();

  if (response.status === 404) {
    return pass("/sitemap.xml avoids private routes", "No sitemap is published.");
  }

  if (!response.ok) {
    return fail(
      "/sitemap.xml avoids private routes",
      `Expected 2xx or 404, got ${response.status}.`,
    );
  }

  const privateRoutePattern =
    /\/(ask|changes|claude-setup|contacts|dashboard|deployment|engagement|export|intake|launch|movement|networking|ops|promises|quality|scoreboard|settings|want-to-know)(\/|<|\?|$)/i;

  if (privateRoutePattern.test(body)) {
    return fail("/sitemap.xml avoids private routes", "Sitemap contains private application routes.");
  }

  return pass(
    "/sitemap.xml avoids private routes",
    "No private application routes are advertised.",
  );
}

async function checkProtectedRedirect(baseUrl, path, section = "Private routes") {
  const response = await fetchNoRedirect(`${baseUrl}${path}`);
  const location = response.headers.get("location") ?? "";
  const redirects = [301, 302, 303, 307, 308].includes(response.status);
  const goesToLogin = location.includes("/login");

  if (!redirects || !goesToLogin) {
    return fail(
      `${path} redirects signed-out users`,
      `Expected redirect to /login, got ${response.status} ${location || "(no location)"}.`,
      section,
    );
  }

  if (!hasNoIndex(response)) {
    return fail(`${path} redirect keeps noindex`, "Redirect response is missing noindex.", section);
  }

  if (!hasCspGuard(response)) {
    return fail(`${path} redirect keeps CSP guard`, "Redirect response is missing CSP guard.", section);
  }

  return pass(`${path} redirects signed-out users`, `Returned ${response.status} to ${location}.`, section);
}

async function checkOwnerFlowRedirect(baseUrl, route) {
  const result = await checkProtectedRedirect(baseUrl, route.path, "Owner flow");

  return {
    ...result,
    label: `${route.label} (${route.path}) redirects signed-out users`,
  };
}

async function checkClaudeEndpointRejectsUnsignedRequest(baseUrl, route) {
  const response = await fetchNoRedirect(`${baseUrl}${route.path}`, {
    method: route.method,
    headers: {
      "Content-Type": "application/json",
    },
    ...(route.method === "POST" ? { body: "{}" } : {}),
  });

  if (response.status !== 401) {
    return fail(
      `${route.path} rejects unsigned requests`,
      `Expected 401 without bearer token, got ${response.status}.`,
      "Claude gateway",
    );
  }

  if (!hasNoIndex(response)) {
    return fail(`${route.path} keeps private headers`, "Missing noindex on JSON response.", "Claude gateway");
  }

  if (!hasCspGuard(response)) {
    return fail(`${route.path} keeps private headers`, "Missing CSP guard on JSON response.", "Claude gateway");
  }

  return pass(
    `${route.path} rejects unsigned requests`,
    `${route.method} ${route.path} returned 401.`,
    "Claude gateway",
  );
}

function pageHasHeading(body, expectedHeading) {
  const escaped = expectedHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<h1[^>]*>\\s*${escaped}\\s*</h1>`, "i").test(body);
}

function navBody(body) {
  return body.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0] ?? "";
}

async function checkSignedInOwnerPage(baseUrl, route, cookie) {
  const response = await fetchSignedIn(baseUrl, route.path, cookie);
  const body = await response.text();

  if (!response.ok) {
    return fail(
      `${route.label} (${route.path}) renders for signed-in owner`,
      `Expected 200, got ${response.status}.`,
      "Signed-in owner",
    );
  }

  if (/private access|send sign-in link|you@example\.com/i.test(body)) {
    return fail(
      `${route.label} (${route.path}) does not show login form`,
      "The response looked like the sign-in screen.",
      "Signed-in owner",
    );
  }

  if (!pageHasHeading(body, route.expectedHeading)) {
    return fail(
      `${route.label} (${route.path}) shows expected heading`,
      `Could not find h1 "${route.expectedHeading}".`,
      "Signed-in owner",
    );
  }

  const nav = navBody(body);
  const leakedLabels = forbiddenOwnerNavLabels.filter((label) =>
    new RegExp(`>${label}<`, "i").test(nav),
  );

  if (leakedLabels.length > 0) {
    return fail(
      `${route.label} (${route.path}) hides operator navigation`,
      `Found forbidden nav labels: ${leakedLabels.join(", ")}.`,
      "Signed-in owner",
    );
  }

  return pass(
    `${route.label} (${route.path}) renders owner surface`,
    `Found h1 "${route.expectedHeading}" and no operator nav labels.`,
    "Signed-in owner",
  );
}

async function checkSignedInOwnerProtectedPath(baseUrl, path, cookie) {
  const response = await fetchSignedIn(baseUrl, path, cookie);
  const location = response.headers.get("location") ?? "";
  const redirects = [301, 302, 303, 307, 308].includes(response.status);
  if (!redirects || !location.includes("/dashboard")) {
    return fail(
      `${path} remains operator-only for signed-in owner`,
      `Expected redirect to /dashboard, got ${response.status} ${location || "(no location)"}.`,
      "Signed-in owner",
    );
  }
  return pass(
    `${path} remains operator-only for signed-in owner`,
    `Returned ${response.status} to ${location}.`,
    "Signed-in owner",
  );
}

function printResultsBySection(results) {
  const sections = [...new Set(results.map((result) => result.section ?? "General"))];

  for (const section of sections) {
    const sectionResults = results.filter((result) => (result.section ?? "General") === section);
    const failCount = sectionResults.filter((result) => result.status === "fail").length;
    const warnCount = sectionResults.filter((result) => result.status === "warn").length;

    console.log(`\n${section}: ${failCount} fail, ${warnCount} warn, ${sectionResults.length} checks`);
    for (const result of sectionResults) {
      console.log(`[${statusIcon(result.status)}] ${result.label}`);
      console.log(`       ${result.detail}`);
    }
  }
}

async function main() {
  const baseUrl = targetUrl();
  const cookie = smokeCookie();
  if (!baseUrl) {
    console.error(
      "Usage: pnpm smoke:live https://your-app.vercel.app\n\nOr set LBB_SMOKE_URL / NEXT_PUBLIC_SITE_URL.",
    );
    process.exit(1);
  }

  const checks = [
    () => checkReachable(baseUrl, "/login", "Public entry"),
    () => checkPrivateHeaders(baseUrl, "/login", "Public entry"),
    () => checkRobots(baseUrl),
    () => checkSitemapPrivateRoutes(baseUrl),
    ...ownerFlowPaths.map((route) => () => checkOwnerFlowRedirect(baseUrl, route)),
    ...ownerDetailPaths.map((route) => () => checkOwnerFlowRedirect(baseUrl, route)),
    ...claudeGatewayRoutes.map(
      (route) => () => checkClaudeEndpointRejectsUnsignedRequest(baseUrl, route),
    ),
    ...operatorProtectedPaths.map((path) => () => checkProtectedRedirect(baseUrl, path)),
    ...(cookie
      ? signedInOwnerPaths.map(
          (route) => () => checkSignedInOwnerPage(baseUrl, route, cookie),
        )
      : []),
    ...(cookie
      ? signedInOwnerProtectedPaths.map(
          (path) => () => checkSignedInOwnerProtectedPath(baseUrl, path, cookie),
        )
      : []),
  ];

  const results = [];
  for (const check of checks) {
    try {
      results.push(await check());
    } catch (error) {
      results.push(
        warn(
          "Live smoke request failed",
          error instanceof Error ? error.message : "Unknown request error.",
          "Request errors",
        ),
      );
    }
  }

  console.log(`\nLittle Black Book live smoke\nTarget: ${baseUrl}\n`);
  printResultsBySection(results);

  const failCount = results.filter((result) => result.status === "fail").length;
  const warnCount = results.filter((result) => result.status === "warn").length;
  console.log(`\nSummary: ${failCount} fail, ${warnCount} warn, ${results.length} total checks.\n`);

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

await main();

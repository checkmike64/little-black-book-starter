import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  isInvalidRefreshTokenError,
  isMachineAuthenticatedPath,
  isSupabaseAuthCookieName,
} from "../lib/proxy-routing.js";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("portal performance and interaction contract", () => {
  test("memoizes the cookie-bound server client and tenant context per render", () => {
    const serverClient = source("lib/supabase/server.ts");
    const tenantContext = source("lib/tenant-context.ts");

    assert.match(serverClient, /import \{ cache \} from "react"/);
    assert.match(serverClient, /export const createSupabaseServerClient = cache\(/);
    assert.match(tenantContext, /export const getTenantContext = cache\(/);
  });

  test("avoids a duplicate healthy-path auth lookup in the portal layout", () => {
    const layout = source("app/(portal)/layout.tsx");
    const contextIndex = layout.indexOf("await getTenantContext()");
    const authIndex = layout.indexOf("await supabase.auth.getUser()");

    assert.ok(contextIndex >= 0);
    assert.ok(authIndex > contextIndex);
    assert.match(layout, /if \(supabase && !tenantContext\)[\s\S]*?supabase\.auth\.getUser\(\)/);
  });

  test("uses verified claims for browser routing and bypasses browser auth for machine routes", () => {
    const proxy = source("proxy.ts");
    const routing = source("lib/proxy-routing.ts");

    assert.match(proxy, /supabase\.auth\.getClaims\(\)/);
    assert.doesNotMatch(proxy, /supabase\.auth\.getUser\(\)/);
    assert.match(proxy, /if \(isMachineAuthenticatedPath\(request\.nextUrl\.pathname\)\) \{\s*return response;/);
    assert.match(routing, /pathname === "\/auth\/callback"/);
    assert.match(proxy, /isInvalidRefreshTokenError/);
    assert.match(proxy, /isSupabaseAuthCookieName/);
  });

  test("recognizes only scoped machine routes and stale Supabase sessions", () => {
    assert.equal(isMachineAuthenticatedPath("/api/automation/recordings"), true);
    assert.equal(isMachineAuthenticatedPath("/api/automation/enrichment"), true);
    assert.equal(isMachineAuthenticatedPath("/api/claude/jobs"), true);
    assert.equal(isMachineAuthenticatedPath("/api/integrations/notion/webhook"), true);
    assert.equal(
      isMachineAuthenticatedPath("/api/integrations/recordings/fathom/connection-id"),
      true,
    );
    assert.equal(isMachineAuthenticatedPath("/api/integrations/recordings/admin"), false);
    assert.equal(isMachineAuthenticatedPath("/api/integrations/notion/connect"), false);
    assert.equal(
      isMachineAuthenticatedPath(
        "/api/introduction-drafts/11111111-1111-4111-8111-111111111111/status",
      ),
      false,
    );
    assert.equal(isMachineAuthenticatedPath("/dashboard"), false);
    assert.equal(isSupabaseAuthCookieName("sb-project-auth-token.1"), true);
    assert.equal(isSupabaseAuthCookieName("lbb_admin_mode"), false);
    assert.equal(
      isInvalidRefreshTokenError({ code: "refresh_token_already_used" }),
      true,
    );
    assert.equal(
      isInvalidRefreshTokenError({ message: "Invalid Refresh Token" }),
      true,
    );
    assert.equal(isInvalidRefreshTokenError({ code: "network_error" }), false);
  });

  test("keeps Book promise signals scoped and parallelizes contact-detail reads", () => {
    const contacts = source("lib/contacts/data.ts");
    const detail = source("lib/contact-detail/data.ts");

    assert.match(contacts, /\.in\("contact_id", contactIds\)/);
    assert.match(detail, /\[interactionsResult, transcriptsResult, calendarEventsResult\][\s\S]*?await Promise\.all/);
  });

  test("does not duplicate full contact profiles inside Networking connections", () => {
    const networking = source("lib/networking/data.ts");
    const connectionQuery = networking.match(
      /\.from\("connections"\)\s*\.select\(\s*"id, contact_a, contact_b,[\s\S]*?\{ count: "exact" \},\s*\)/,
    )?.[0] ?? "";

    assert.ok(connectionQuery.length > 0);
    assert.doesNotMatch(connectionQuery, /contact_a_record|contact_b_record/);
    assert.match(
      networking,
      /networkingContactOptionSelect = "id, full_name, company_name"/,
    );
    assert.match(networking, /networkingConnectionContactSelect/);
    assert.match(networking, /recommendationContactIds/);
    assert.match(networking, /recommendationContactBatchSize = 100/);
    assert.match(networking, /chunkContactIds\(recommendationContactIds\)/);
    assert.match(networking, /\.in\("id", contactIdBatch\)/);
    assert.doesNotMatch(networking, /contactOptionIds/);
    assert.match(
      networking,
      /confirmed_memberships:relationship_context_memberships\(contact_id\)/,
    );
    assert.doesNotMatch(
      networking,
      /\.from\("relationship_context_memberships"\)/,
    );
    assert.doesNotMatch(networking, /\.limit\(10000\)/);
    assert.match(networking, /contactsById\.has\(connection\.contact_a\)/);
    assert.match(networking, /contact_a_record: contactsById\.get\(connection\.contact_a\)/);
  });

  test("loads a selected Ask run with the main evidence reads", () => {
    const ask = source("lib/ask/data.ts");
    const allStart = ask.indexOf("selectedRunResult,\n  ] = await Promise.all");
    const selectedQuery = ask.indexOf("selectedRunId && isValidUuid(selectedRunId)", allStart);
    const allEnd = ask.indexOf("  ]);", selectedQuery);

    assert.ok(allStart >= 0);
    assert.ok(selectedQuery > allStart);
    assert.ok(allEnd > selectedQuery);
  });

  test("keeps the empty Ask landing page off the full evidence fan-out", () => {
    const ask = source("lib/ask/data.ts");
    const branchStart = ask.indexOf("if (isAskLandingRequest(query, mode, selectedRunId))");
    const fullLoadStart = ask.indexOf("const [\n    contactsResult,", branchStart);
    const landingBranch = ask.slice(branchStart, fullLoadStart);

    assert.ok(branchStart >= 0);
    assert.ok(fullLoadStart > branchStart);
    assert.match(landingBranch, /\.from\("contacts"\)/);
    assert.match(landingBranch, /\.from\("ask_runs"\)/);
    assert.match(landingBranch, /\.limit\(8\)/);
    assert.match(landingBranch, /count: "exact", head: true/);
    assert.match(landingBranch, /contacts: activeContactCountResult\.count \?\? 0/);
    assert.doesNotMatch(
      landingBranch,
      /\.from\("(interactions|promises|pending_changes|jobs|connections|relationship_contexts|transcripts|relationship_actions|field_provenance)"\)/,
    );
  });

  test("scopes every Ask database read to the active tenant", () => {
    const ask = source("lib/ask/data.ts");
    const queryStarts = [...ask.matchAll(/\.from\("([a-z_]+)"\)/g)];

    assert.ok(queryStarts.length >= 14);
    for (const [index, queryStart] of queryStarts.entries()) {
      const currentStart = queryStart.index ?? 0;
      const nextStart = queryStarts[index + 1]?.index ?? ask.length;
      const query = ask.slice(currentStart, nextStart);
      assert.match(
        query,
        /\.eq\("tenant_id", context\.tenantId\)/,
        `${queryStart[1]} read must be scoped to the active tenant`,
      );
    }
  });

  test("gives navigation and server actions immediate pending feedback", () => {
    const nav = source("app/(portal)/portal-nav.tsx");
    const pendingButton = source("app/(portal)/pending-submit-button.tsx");
    const ownerActions = [
      "app/(portal)/changes/page.tsx",
      "app/(portal)/engagement/page.tsx",
      "app/(portal)/networking/page.tsx",
      "app/(portal)/promises/promise-status-controls.tsx",
      "app/(portal)/movement/movement-action-panel.tsx",
    ].map(source).join("\n");

    assert.match(nav, /useLinkStatus/);
    assert.match(nav, /Opening page/);
    assert.match(pendingButton, /useFormStatus/);
    assert.match(pendingButton, /disabled=\{disabled \|\| pending\}/);
    assert.ok((ownerActions.match(/<PendingSubmitButton/g) ?? []).length >= 10);
  });

  test("uses a stable folio skeleton and restrained motion", () => {
    const loading = source("app/(portal)/loading.tsx");
    const globalCss = source("app/globals.css");
    const ledgerCss = source("app/private-ledger.css");
    const design = source("DESIGN.md");

    assert.match(loading, /route-loading-header/);
    assert.match(loading, /route-loading-folio/);
    assert.doesNotMatch(loading, /Opening your private Book|Bringing the latest/);
    assert.match(globalCss, /\.route-state \{/);
    assert.match(globalCss, /@media \(max-width: 860px\)[\s\S]*?\.route-loading-header \{[\s\S]*?margin: 0 -20px 24px/);
    assert.match(globalCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.connection-context-dialog \{[\s\S]*?animation-name: dialog-backdrop-enter/);
    assert.match(ledgerCss, /--motion-state: 160ms/);
    assert.match(ledgerCss, /@media \(pointer: coarse\)/);
    assert.doesNotMatch(ledgerCss, /transition-duration: 0\.01ms/);
    assert.match(design, /The Interface Answers Immediately Rule/);
    assert.match(design, /Do not choreograph full-page slides/);
  });

  test("does not preload fallback font files before the platform stack needs them", () => {
    const rootLayout = source("app/layout.tsx");
    assert.equal((rootLayout.match(/preload: false/g) ?? []).length, 3);
    assert.equal((rootLayout.match(/display: "optional"/g) ?? []).length, 3);
  });

  test("keeps quality navigation inside the app shell", () => {
    const quality = source("app/(portal)/quality/quality-cleanup-queue-button.tsx");

    assert.match(quality, /useRouter/);
    assert.match(quality, /router\.replace/);
    assert.doesNotMatch(quality, /window\.location\.assign/);
  });
});

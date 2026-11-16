import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const wantToKnow = readFileSync("app/(portal)/want-to-know/page.tsx", "utf8");
const ownerWorkspace = readFileSync("app/(portal)/want-to-know/owner-workspace.tsx", "utf8");
const contactPage = readFileSync("app/(portal)/contacts/[id]/page.tsx", "utf8");
const contactActions = readFileSync("app/(portal)/contacts/[id]/actions.ts", "utf8");
const layout = readFileSync("app/(portal)/layout.tsx", "utf8");

describe("concierge owner boundaries", () => {
  test("renders only activated Want to Know buckets for owners", () => {
    const ownerBranch = wantToKnow.slice(
      wantToKnow.indexOf("if (!adminMode)"),
      wantToKnow.indexOf("const pendingProposals"),
    );
    assert.match(ownerBranch, /OwnerWantToKnowWorkspace/);
    assert.match(ownerWorkspace, /program\.status === "active"/);
    assert.match(ownerWorkspace, /candidate\.program_id === selectedProgram\.id/);
    assert.match(ownerWorkspace, /getWantToKnowCategoryWorkspace/);
    assert.match(ownerWorkspace, /createManualWantToKnow/);
    assert.match(ownerWorkspace, /name="program_id" required/);
    assert.doesNotMatch(ownerWorkspace, /clientProspects/);
    assert.match(ownerWorkspace, /<Link href=\{`\/want-to-know\/\$\{candidate\.id\}`\}>/);
    assert.doesNotMatch(ownerWorkspace, />\s*Engage\s*</);
  });

  test("limits owner profile writes to factual fields", () => {
    assert.match(contactPage, /value=\{adminMode \? "operator" : "owner_facts"\}/);
    assert.match(contactPage, /\{adminMode \? \(/);
    assert.match(contactActions, /if \(editScope === "operator"\)/);
    assert.match(contactActions, /await requireOperatorAccess\(\)/);
    assert.match(contactActions, /ownerFactFields/);
  });

  test("keeps help in the persistent portal shell", () => {
    assert.match(layout, /href="\/support"/);
    assert.match(layout, /Get help/);
  });

  test("loads hidden settings through the server boundary for owner navigation", () => {
    assert.match(layout, /await getTenantContext\(\)/);
    assert.match(layout, /if \(supabase && !tenantContext\)/);
    assert.match(layout, /await supabase\.auth\.getUser\(\)/);
    assert.match(layout, /authenticatedUser \? "\/access-pending" : "\/login"/);
    assert.match(layout, /tenantContext\?\.settings/);
    assert.match(layout, /getEnabledModuleKeys\(tenantSettings\)/);
    assert.doesNotMatch(layout, /tenants\(settings\)/);
  });
});

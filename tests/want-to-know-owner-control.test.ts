import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  ownerWantToKnowPurpose,
  ownerWantToKnowPurposes,
} from "../lib/want-to-know-purposes.js";
import { isOwnerActionableChange } from "../lib/pending-change-types.js";

const dashboard = readFileSync("app/(portal)/dashboard/page.tsx", "utf8");
const dashboardActions = readFileSync("app/(portal)/dashboard/actions.ts", "utf8");
const wantToKnow = readFileSync("app/(portal)/want-to-know/page.tsx", "utf8");
const ownerWorkspace = readFileSync("app/(portal)/want-to-know/owner-workspace.tsx", "utf8");
const profilePage = readFileSync("app/(portal)/want-to-know/[id]/page.tsx", "utf8");
const wantToKnowActions = readFileSync("app/(portal)/want-to-know/actions.ts", "utf8");
const pendingChangeRoute = readFileSync("app/api/claude/pending-changes/route.ts", "utf8");
const setupPackage = readFileSync("lib/claude-setup-package.ts", "utf8");
const portalLayout = readFileSync("app/(portal)/layout.tsx", "utf8");
const portalNav = readFileSync("app/(portal)/portal-nav.tsx", "utf8");

describe("owner-controlled Want to Know", () => {
  test("supplies stable default purposes and preserves enabled client purposes", () => {
    const purposes = ownerWantToKnowPurposes([
      {
        name: "Founders to interview",
        goal: "",
        look_for: "",
        intensity: "Low",
        lane: "interview",
        enabled: true,
      },
      {
        name: "Hidden lane",
        goal: "",
        look_for: "",
        intensity: "Low",
        lane: "hidden",
        enabled: false,
      },
    ]);
    assert.deepEqual(purposes[0], { label: "Founders to interview", lane: "interview" });
    assert.equal(purposes.some((purpose) => purpose.label === "Hidden lane"), false);
    assert.equal(ownerWantToKnowPurpose("Referral partner")?.lane, "referral");
    assert.equal(ownerWantToKnowPurpose("Unknown purpose"), null);
  });

  test("requires an explicit purpose for a meeting attendee", () => {
    assert.match(dashboard, /name="purpose" required/);
    assert.match(dashboard, /Choose purpose/);
    assert.match(dashboardActions, /Choose why you want to know this person/);
    assert.match(dashboardActions, /bucket: purpose\?\.label/);
    assert.match(dashboardActions, /lane: purpose\?\.lane/);
  });

  test("lets the owner add a categorized person manually with duplicate checks", () => {
    assert.match(ownerWorkspace, /label="Add person" tone="accent"/);
    assert.match(ownerWorkspace, /action=\{createManualWantToKnow\}/);
    assert.match(ownerWorkspace, /name="program_id" required/);
    assert.match(wantToKnowActions, /export async function createManualWantToKnow/);
    assert.match(wantToKnowActions, /That person is already in the Book/);
    assert.match(wantToKnowActions, /That person is already in Want to Know/);
    assert.match(wantToKnowActions, /action: "want_to_know.created_by_owner"/);
    assert.match(wantToKnowActions, /owner_selected_at: new Date\(\)\.toISOString\(\)/);
    assert.match(wantToKnowActions, /relationship_priority: relationshipPriority/);
    assert.match(wantToKnowActions, /engagement_target_per_month: engagementTarget/);
    assert.match(wantToKnowActions, /startOwnerSelectedContentScan/);
    assert.match(wantToKnowActions, /priorityWantToKnowIds: \[wantToKnowId\]/);
    assert.match(wantToKnowActions, /Added to Want to Know\./);
    assert.match(wantToKnowActions, /Content scan started\./);
  });

  test("shows only deliberately selected people and exposes a relationship plan", () => {
    assert.match(wantToKnow, /OwnerWantToKnowWorkspace/);
    assert.match(ownerWorkspace, /Choose the relationship programme/);
    assert.match(ownerWorkspace, /getWantToKnowCategoryWorkspace/);
    assert.match(profilePage, /updateWantToKnowProfile/);
    assert.match(profilePage, /Touches per month/);
    assert.match(profilePage, /Engagement focus/);
    assert.match(profilePage, /action=\{scanWantToKnowContent\}/);
    assert.match(profilePage, /label="Scan for posts"/);
    const scanAction = wantToKnowActions.match(
      /export async function scanWantToKnowContent[\s\S]*?(?=export async function updateWantToKnowProfile)/,
    )?.[0] ?? "";
    assert.doesNotMatch(scanAction, /requireOwner/);
    assert.match(ownerWorkspace, /incidental meetings never place a person here automatically/);
  });

  test("makes profile and Book actions direct without exposing LinkedIn on the register", () => {
    assert.match(ownerWorkspace, />Open profile</);
    assert.match(ownerWorkspace, /label="Add to Book"/);
    assert.doesNotMatch(ownerWorkspace, /Open LinkedIn/);
    assert.doesNotMatch(ownerWorkspace, /RelationshipActionRail/);
  });

  test("uses the owner-approved cadence and stage model", () => {
    assert.match(ownerWorkspace, /defaultValue="1" name="engagement_target_per_month"/);
    assert.match(ownerWorkspace, /<option value="0">Watch<\/option>/);
    for (const value of ["1", "2", "3", "4", "5"]) {
      assert.match(ownerWorkspace, new RegExp(`<option value="${value}">${value}<\\/option>`));
    }
    assert.doesNotMatch(profilePage, /<option value="researching">/);
    assert.match(profilePage, /<option value="watching">Watching<\/option>/);
    assert.match(profilePage, /<option value="warming">Warming<\/option>/);
    assert.match(profilePage, /<option value="ready">Add to Book<\/option>/);
    assert.match(wantToKnowActions, /engagementTarget > 5/);
  });

  test("keeps relevant stored content on the relationship profile", () => {
    assert.match(profilePage, /Posts and releases to engage with/);
    assert.match(profilePage, /match_status === "matched"/);
    assert.match(profilePage, /Open post ↗/);
    assert.match(profilePage, /No relevant posts have been captured yet/);
  });

  test("rejects automated candidate proposals at the Claude write boundary", () => {
    assert.match(
      pendingChangeRoute,
      /changeType === "want_to_know_candidate"[\s\S]*Want to Know is owner-controlled/,
    );
    assert.doesNotMatch(setupPackage, /"change_type": "want_to_know_candidate"/);
    assert.match(setupPackage, /Do not create or propose Want to Know candidates/);
  });

  test("does not count retired candidate proposals as owner Changes", () => {
    assert.equal(
      isOwnerActionableChange({
        change_type: "want_to_know_candidate",
        contact_id: null,
        source: "claude_daily_briefing",
      }),
      false,
    );
    assert.equal(
      isOwnerActionableChange({
        change_type: "contact_candidate",
        contact_id: null,
        source: "claude_daily_briefing",
      }),
      true,
    );
  });

  test("puts promise and change work counts on their navigation tabs", () => {
    assert.match(portalLayout, /const promisesCount =/);
    assert.match(portalLayout, /const changesCount =/);
    assert.match(portalLayout, /promisesCount=\{promisesCount\}/);
    assert.match(portalLayout, /changesCount=\{changesCount\}/);
    assert.match(portalNav, /item\.href === "\/promises"/);
    assert.match(portalNav, /item\.href === "\/changes"/);
  });
});

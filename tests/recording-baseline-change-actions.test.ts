import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const actions = readFileSync("app/(portal)/changes/actions.ts", "utf8");
const pendingChangeApi = readFileSync("app/api/claude/pending-changes/route.ts", "utf8");

function actionBody(name: string, nextName: string) {
  const start = actions.indexOf(`export async function ${name}`);
  const end = actions.indexOf(`export async function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} must exist`);
  assert.ok(end > start, `${name} must end before ${nextName}`);
  return actions.slice(start, end);
}

describe("recording baseline change server actions", () => {
  test("reserves both internal recording proposal sources from Claude write callers", () => {
    const reservation = pendingChangeApi.indexOf(
      '["recording_baseline", "recording_operator"].includes(source)',
    );
    const createRpc = pendingChangeApi.indexOf('admin.rpc("lbb_create_pending_change"');
    assert.ok(reservation >= 0);
    assert.ok(createRpc > reservation);
    assert.match(
      pendingChangeApi.slice(reservation, createRpc),
      /reserved for the internal meeting workflow/,
    );
  });

  test("calls the dedicated owner-scoped atomic review RPC with the exact contract", () => {
    assert.match(actions, /admin\.rpc\("lbb_review_recording_baseline_change", \{/);
    assert.match(actions, /p_tenant_id: change\.tenant_id/);
    assert.match(actions, /p_change_id: change\.id/);
    assert.match(actions, /p_actor_user_id: userId/);
    assert.match(actions, /p_decision: decision/);
    assert.match(actions, /decision: "approve" \| "dismiss"/);
    assert.match(actions, /result\.change_id !== change\.id/);
    assert.match(actions, /contactId !== change\.contact_id/);
  });

  test("single approval exits through the RPC before any generic contact update", () => {
    const body = actionBody("approvePendingChange", "approveVisibleLowRiskChanges");
    const baselineBranch = body.indexOf('change.source === "recording_baseline"');
    const atomicReview = body.indexOf("reviewRecordingBaselineChange", baselineBranch);
    const genericReview = body.indexOf("approveContactFieldChange", atomicReview);
    assert.ok(baselineBranch >= 0);
    assert.ok(atomicReview > baselineBranch);
    assert.ok(genericReview > atomicReview);
    assert.match(body.slice(baselineBranch, genericReview), /reviewFormRedirect\(formData, "Approved and written to the book\."\)/);
    assert.match(body.slice(baselineBranch, genericReview), /Nothing was changed/);
  });

  test("bulk approval handles baseline rows atomically and cannot fall through", () => {
    const body = actionBody("approveVisibleLowRiskChanges", "mergeNewContactProposal");
    const baselineBranch = body.indexOf('change.source === "recording_baseline"');
    const atomicReview = body.indexOf("reviewRecordingBaselineChange", baselineBranch);
    const continueIndex = body.indexOf("continue;", atomicReview);
    const genericReview = body.indexOf("approveContactFieldChange", atomicReview);
    assert.ok(baselineBranch >= 0);
    assert.ok(atomicReview > baselineBranch);
    assert.ok(continueIndex > atomicReview);
    assert.ok(genericReview > continueIndex);
  });

  test("dismissal uses the atomic RPC before the generic status update", () => {
    const body = actionBody("dismissPendingChange", "markOwnerContextRequested");
    const baselineBranch = body.indexOf('change.source === "recording_baseline"');
    const atomicReview = body.indexOf("reviewRecordingBaselineChange", baselineBranch);
    const genericUpdate = body.indexOf('.from("pending_changes")', atomicReview);
    assert.ok(baselineBranch >= 0);
    assert.ok(atomicReview > baselineBranch);
    assert.ok(genericUpdate > atomicReview);
    assert.match(body.slice(baselineBranch, genericUpdate), /decision: "dismiss"/);
    assert.match(body.slice(baselineBranch, genericUpdate), /reviewFormRedirect\(formData, "Declined\."\)/);
    assert.match(body.slice(baselineBranch, genericUpdate), /Nothing was changed/);
  });

  test("the generic field updater defensively refuses baseline proposals", () => {
    const start = actions.indexOf("async function approveContactFieldChange");
    const end = actions.indexOf("export async function approvePendingChange", start);
    const body = actions.slice(start, end);
    const refusal = body.indexOf('change.source === "recording_baseline"');
    const contactWrite = body.indexOf('.from("contacts")');
    assert.ok(refusal >= 0);
    assert.ok(contactWrite > refusal);
  });
});

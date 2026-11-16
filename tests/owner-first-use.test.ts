import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildOwnerFirstUseState,
  type OwnerFirstUseSurface,
} from "../lib/owner-first-use.js";
import { isOwnerForbiddenHref } from "../runtime/owner-route-policy.js";

const surfaces: OwnerFirstUseSurface[] = [
  "contacts",
  "ask",
  "changes",
  "want_to_know",
  "launch_preview",
];

const setupHeavyCopy =
  /\b(admin|operator|claude setup|intake|deployment|export|settings|ops|quality)\b/i;

function copyFor(surface: OwnerFirstUseSurface, filtered: boolean) {
  const state = buildOwnerFirstUseState(surface, {
    askRunCount: filtered ? 2 : 0,
    bucketCount: filtered ? 3 : 0,
    candidateCount: filtered ? 5 : 0,
    contactCount: filtered ? 12 : 0,
    pendingReviewCount: filtered ? 4 : 0,
    filtered,
  });

  return [
    state.eyebrow,
    state.title,
    state.detail,
    state.primaryLabel,
    state.primaryHref,
    state.secondaryLabel,
    state.secondaryHref,
    ...state.proof,
  ]
    .filter(Boolean)
    .join(" ");
}

describe("owner first-use states", () => {
  test("do not link normal owners into forbidden operator surfaces", () => {
    for (const surface of surfaces) {
      for (const filtered of [false, true]) {
        const state = buildOwnerFirstUseState(surface, { filtered });
        assert.equal(isOwnerForbiddenHref(state.primaryHref), false, surface);
        if (state.secondaryHref) {
          assert.equal(isOwnerForbiddenHref(state.secondaryHref), false, surface);
        }
      }
    }
  });

  test("avoid setup-heavy language in owner first-use copy", () => {
    for (const surface of surfaces) {
      assert.equal(setupHeavyCopy.test(copyFor(surface, false)), false, surface);
      assert.equal(setupHeavyCopy.test(copyFor(surface, true)), false, surface);
    }
  });

  test("keeps prospecting buckets flexible and purpose-specific", () => {
    const state = buildOwnerFirstUseState("want_to_know", {
      bucketCount: 2,
      candidateCount: 0,
      filtered: true,
    });

    assert.match(state.detail, /podcast hosts, investors, acquisition targets, partners/i);
    assert.doesNotMatch(`${state.detail} ${state.proof.join(" ")}`, /client-specific|client brief|concierge/i);
    assert.equal(state.primaryHref, "/want-to-know");
    assert.equal(state.secondaryHref, "/ask?mode=search&q=who%20should%20I%20meet%20next");
  });

  test("describes the Ask count as stored contacts rather than search capacity", () => {
    const state = buildOwnerFirstUseState("ask", { contactCount: 640 });
    assert.match(state.proof.join(" "), /640 contacts stored in this Book/);
    assert.doesNotMatch(state.proof.join(" "), /available to Ask/);
  });
});

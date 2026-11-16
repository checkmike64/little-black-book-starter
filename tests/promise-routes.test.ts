import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  promiseLaneHref,
  promiseMovementHref,
  promisePrimaryHref,
  type PromiseRouteRow,
} from "../runtime/promise-routes.js";

const now = new Date("2026-07-22T12:00:00Z");

function promise(overrides: Partial<PromiseRouteRow> = {}): PromiseRouteRow {
  return {
    direction: "owner_owes_contact",
    due_on: "2026-07-22",
    contacts: {
      id: "contact-1",
    },
    ...overrides,
  };
}

describe("promise routes", () => {
  test("routes owner and contact promise lanes distinctly", () => {
    assert.equal(promiseLaneHref(promise()), "/promises?filter=owner");
    assert.equal(
      promiseLaneHref(promise({ direction: "contact_owes_owner" })),
      "/promises?filter=contact",
    );
  });

  test("routes due or overdue promises to hot movement", () => {
    assert.equal(promiseMovementHref(promise({ due_on: "2026-07-21" }), now), "/movement?view=hot");
    assert.equal(promiseMovementHref(promise({ due_on: "2026-07-22" }), now), "/movement?view=hot");
    assert.equal(promiseMovementHref(promise({ due_on: "2026-07-23" }), now), "/movement");
  });

  test("uses the contact profile as the primary promise route when linked", () => {
    assert.equal(promisePrimaryHref(promise()), "/contacts/contact-1");
    assert.equal(
      promisePrimaryHref(promise({ contacts: null })),
      "/promises?filter=owner",
    );
  });
});

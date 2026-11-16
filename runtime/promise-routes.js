const MS_PER_DAY = 86_400_000;

function utcDay(value) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function promiseLaneHref(promise) {
  return promise.direction === "owner_owes_contact"
    ? "/promises?filter=owner"
    : "/promises?filter=contact";
}

export function promiseMovementHref(promise, now = new Date()) {
  if (!promise.due_on) return "/movement";

  const due = new Date(`${promise.due_on}T00:00:00Z`);
  if (!Number.isFinite(due.getTime())) return "/movement";

  const delta = Math.round((utcDay(due) - utcDay(now)) / MS_PER_DAY);
  return delta <= 0 ? "/movement?view=hot" : "/movement";
}

export function promisePrimaryHref(promise) {
  return promise.contacts?.id ? `/contacts/${promise.contacts.id}` : promiseLaneHref(promise);
}

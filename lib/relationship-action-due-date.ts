export function dateInDays(days: number, now = new Date()) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function suggestedRelationshipActionDueDate({
  now,
  priority,
  type,
}: {
  now?: Date;
  priority?: string | null;
  type?: string | null;
}) {
  if (priority === "high") return dateInDays(2, now);
  if (type === "promise" || type === "owner_verification") return dateInDays(3, now);
  if (type === "introduction" || type === "podcast" || type === "referral") {
    return dateInDays(7, now);
  }
  if (type === "reconnect") return dateInDays(14, now);
  if (priority === "low") return dateInDays(21, now);
  return dateInDays(7, now);
}

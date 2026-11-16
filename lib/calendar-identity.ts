export function normalizeCalendarEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes("@")) return null;
  return email;
}

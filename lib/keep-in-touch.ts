export type KeepInTouchSettings = {
  tier_1_days: number;
  tier_2_days: number;
  tier_3_days: number;
};

export const defaultKeepInTouchSettings: KeepInTouchSettings = {
  tier_1_days: 30,
  tier_2_days: 60,
  tier_3_days: 90,
};

export function normalizeKeepInTouchSettings(value: unknown): KeepInTouchSettings {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(defaultKeepInTouchSettings).map(([key, fallback]) => {
    const raw = input[key];
    return [key, typeof raw === "number" && Number.isFinite(raw)
      ? Math.min(3650, Math.max(1, Math.round(raw))) : fallback];
  })) as KeepInTouchSettings;
}

export function contactTier(value: string | null | undefined): 1 | 2 | 3 | null {
  const match = (value ?? "").trim().match(/^(?:tier\s*)?([123])(?:\b|$)/i);
  return match ? Number(match[1]) as 1 | 2 | 3 : null;
}

// Explicit contact choices take precedence over the install's tier defaults.
export function explicitCadenceDays(value: string | null | undefined): number | null {
  const cadence = (value ?? "").trim().toLowerCase();
  if (/dormant|no active cadence|ad[ -]?hoc|as needed|never/.test(cadence)) return Infinity;
  const numeric = cadence.match(/^(?:every\s+)?(\d+)\s*(days?|weeks?|months?|years?)$/);
  if (numeric) {
    const amount = Number(numeric[1]);
    const unit = numeric[2];
    return amount > 0 ? amount * (/week/.test(unit) ? 7 : /month/.test(unit) ? 30 : /year/.test(unit) ? 365 : 1) : null;
  }
  if (/biweekly|fortnight|two weeks|2 weeks/.test(cadence)) return 14;
  if (/semiannual|semi-annual|biannual|twice a year|6 months/.test(cadence)) return 180;
  if (/quarter/.test(cadence)) return 90;
  if (/month/.test(cadence)) return 30;
  if (/week/.test(cadence)) return 7;
  if (/annual|year/.test(cadence)) return 365;
  if (/daily/.test(cadence)) return 1;
  return null;
}

export type KeepInTouchContact = {
  id: string;
  full_name: string | null;
  trust_level: string | null;
  touch_cadence?: string | null;
  last_spoke: string | null;
};

export function resolveContactCadence(contact: KeepInTouchContact, settings: KeepInTouchSettings) {
  const override = explicitCadenceDays(contact.touch_cadence);
  const tier = contactTier(contact.trust_level);
  return {
    days: override ?? (tier ? settings[`tier_${tier}_days`] : null),
    label: override !== null ? contact.touch_cadence! : tier ? `Tier ${tier}` : "No cadence",
  };
}

function calendarDay(value: string, timeZone: string): number | null {
  // Date-only last_spoke values are calendar dates, not UTC timestamps.
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
      ? parsed.getTime() / 86400000 : null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(parsed);
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day")) / 86400000;
}

export function buildKeepInTouchQueue<T extends KeepInTouchContact>(
  contacts: T[],
  settings: KeepInTouchSettings,
  timeZone = "UTC",
  now = new Date(),
) {
  const today = calendarDay(now.toISOString(), timeZone)!;
  return contacts.flatMap(contact => {
    const cadence = resolveContactCadence(contact, settings);
    if (cadence.days === null || !Number.isFinite(cadence.days)) return [];
    const lastDay = contact.last_spoke ? calendarDay(contact.last_spoke, timeZone) : null;
    const elapsed = lastDay === null ? null : today - lastDay;
    if (elapsed !== null && elapsed < cadence.days) return [];
    return [{ contact, cadenceDays: cadence.days, cadenceLabel: cadence.label,
      daysOverdue: elapsed === null ? null : elapsed - cadence.days,
      reason: elapsed === null ? "No conversation date logged — check in or record your last conversation."
        : elapsed === cadence.days ? `Due today · every ${cadence.days} days`
        : `${elapsed - cadence.days} days overdue · every ${cadence.days} days`,
    }];
  }).sort((a, b) => (b.daysOverdue ?? Infinity) - (a.daysOverdue ?? Infinity)
    || a.cadenceDays - b.cadenceDays || (a.contact.full_name ?? "").localeCompare(b.contact.full_name ?? ""));
}

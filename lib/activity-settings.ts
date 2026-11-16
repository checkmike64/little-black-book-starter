export type ActivitySettings = {
  engagement_daily_floor: number;
  engagement_daily_limit: number;
  networking_daily_limit: number;
  engagement_more_batch: number;
  networking_more_batch: number;
  want_to_know_daily_limit: number;
  want_to_know_engagements_monthly: number;
  time_zone: string;
};

export const defaultActivitySettings: ActivitySettings = {
  engagement_daily_floor: 3,
  engagement_daily_limit: 3,
  networking_daily_limit: 3,
  engagement_more_batch: 3,
  networking_more_batch: 3,
  want_to_know_daily_limit: 6,
  want_to_know_engagements_monthly: 4,
  time_zone: "UTC",
};

function clamp(value: unknown, fallback: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), 0), max);
}

function normalizeTimeZone(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return defaultActivitySettings.time_zone;
  }

  const candidate = value.trim().slice(0, 80);
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return defaultActivitySettings.time_zone;
  }
}

export function normalizeActivitySettings(value: unknown): ActivitySettings {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    engagement_daily_floor: clamp(
      input.engagement_daily_floor,
      defaultActivitySettings.engagement_daily_floor,
      10,
    ),
    engagement_daily_limit: clamp(
      input.engagement_daily_limit,
      defaultActivitySettings.engagement_daily_limit,
      25,
    ),
    networking_daily_limit: clamp(
      input.networking_daily_limit,
      defaultActivitySettings.networking_daily_limit,
      15,
    ),
    engagement_more_batch: clamp(
      input.engagement_more_batch,
      defaultActivitySettings.engagement_more_batch,
      25,
    ),
    networking_more_batch: clamp(
      input.networking_more_batch,
      defaultActivitySettings.networking_more_batch,
      15,
    ),
    want_to_know_daily_limit: clamp(
      input.want_to_know_daily_limit,
      defaultActivitySettings.want_to_know_daily_limit,
      25,
    ),
    want_to_know_engagements_monthly: clamp(
      input.want_to_know_engagements_monthly,
      defaultActivitySettings.want_to_know_engagements_monthly,
      8,
    ),
    time_zone: normalizeTimeZone(input.time_zone),
  };
}

export function effectiveDailyLimit({
  base,
  extra,
  resolved,
}: {
  base: number;
  extra: number;
  resolved: number;
}) {
  return Math.max(0, base + extra - resolved);
}

function dateParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);

  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
  };
}

function zonedMidnightUtc(
  date: { year: number; month: number; day: number },
  timeZone: string,
) {
  const target = Date.UTC(date.year, date.month - 1, date.day);
  let candidate = target;

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const rendered = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone,
      year: "numeric",
    }).formatToParts(new Date(candidate));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(rendered.find((item) => item.type === type)?.value ?? 0);
    const renderedAsUtc = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour") % 24,
      part("minute"),
      part("second"),
    );
    candidate += target - renderedAsUtc;
  }

  return new Date(candidate).toISOString();
}

export function activityDayWindow(
  timeZone: string,
  now = new Date(),
) {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const localDate = dateParts(now, normalizedTimeZone);

  return {
    date: [
      localDate.year,
      String(localDate.month).padStart(2, "0"),
      String(localDate.day).padStart(2, "0"),
    ].join("-"),
    startIso: zonedMidnightUtc(localDate, normalizedTimeZone),
  };
}

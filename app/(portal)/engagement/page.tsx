import {
  Ban,
  Check,
  ExternalLink,
  Info,
} from "lucide-react";
import { PendingSubmitButton } from "@/app/(portal)/pending-submit-button";
import {
  doNotEngageSignal,
  markEngagementSignalEngaged,
  restoreEngagementSignal,
} from "@/app/(portal)/engagement/actions";
import { requestMoreEngagementActivity } from "@/app/(portal)/recommendation-actions";
import {
  getEngagementData,
  type EngagementLane,
  type EngagementSignalRow,
} from "@/lib/engagement/data";
import {
  contentPlatformLabel,
  normalizeExternalContentUrl,
} from "@/lib/engagement-source";
import { engagementPlacementReason } from "@/lib/engagement/factual-reason";
import { requireEnabledModule } from "@/lib/module-gate";
import { getEngagementFeedHealth } from "./feed-health";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const laneDetails: Array<{ key: EngagementLane; label: string }> = [
  { key: "active", label: "Active Pursuits" },
  { key: "partners", label: "Referral Partners" },
  { key: "rescue", label: "Relationship Rescue" },
];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatAge(value: string) {
  const observed = Date.parse(value);
  if (!Number.isFinite(observed)) return "Recently";

  const days = Math.max(
    0,
    Math.floor((Date.now() - observed) / 1000 / 60 / 60 / 24),
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function shortText(value: string, maxLength = 280) {
  const normalized = value
    .replace(/\s+/g, " ")
    .replace(/^[—–-]\s*/, "")
    .trim();
  if (normalized.length <= maxLength) return normalized;

  const clipped = normalized.slice(0, maxLength + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped
    .slice(0, lastSpace > maxLength * 0.7 ? lastSpace : maxLength)
    .trim()}…`;
}

function identity(signal: EngagementSignalRow) {
  if (signal.want_to_know) {
    return {
      name: signal.want_to_know.full_name,
      subtitle:
        [signal.want_to_know.company, signal.want_to_know.bucket]
          .filter(Boolean)
          .join(" · ") || "Prospect",
      tags: ["Want to Know", signal.want_to_know.stage].filter(Boolean),
    };
  }

  const contact = signal.contacts;
  const roles = contact?.role_title?.join(", ");
  const primaryRelationship = contact?.relationship_type?.[0] ?? null;
  const strength = contact?.relationship_strength ?? null;
  const contextualTag =
    signal.engagement_lane === "rescue" &&
    strength &&
    /(cold|cooling)/i.test(strength)
      ? strength
      : primaryRelationship ?? strength;

  return {
    name: contact?.full_name ?? "New person",
    subtitle:
      [roles, contact?.company_name].filter(Boolean).join(" · ") ||
      "Private relationship",
    tags: [contact?.trust_level, contextualTag].filter(
      (value): value is string => Boolean(value),
    ),
  };
}

function actionLabel(value: string | null) {
  if (value === "like") return "Like";
  if (value === "share") return "Share";
  if (value === "support") return "Be useful";
  return "Comment";
}

function laneLabel(value: EngagementLane | null) {
  return laneDetails.find((lane) => lane.key === value)?.label ?? "Relationship";
}

function EngagementPostCard({
  signal,
  returnTo,
}: {
  signal: EngagementSignalRow;
  returnTo: string;
}) {
  const person = identity(signal);
  const sourceUrl = normalizeExternalContentUrl(signal.source_url);
  if (!sourceUrl) return null;
  const lane = signal.engagement_lane ?? "active";
  const rationale = engagementPlacementReason({
    lane,
    isProspect: Boolean(signal.want_to_know_id),
    prospectPurpose: signal.want_to_know?.bucket ?? signal.want_to_know?.lane,
  });

  return (
    <article
      aria-labelledby={`engagement-item-${signal.id}`}
      className="engagement-post-card"
    >
      <div className="engagement-post-head">
        <div>
          <span className="section-kicker">{laneLabel(signal.engagement_lane)}</span>
          <h2 id={`engagement-item-${signal.id}`}>{person.name}</h2>
          <p>{person.subtitle}</p>
        </div>
        <div className="person-tags">
          {person.tags.slice(0, 2).map((tag, index) => (
            <span className={index === 0 ? "pill gold" : "pill cool"} key={tag}>
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="engagement-post-meta">
        <span>
          {contentPlatformLabel(sourceUrl, signal.source)}
          {" · "}
          {formatAge(signal.published_at ?? signal.observed_at)}
        </span>
        <span className="pill">{actionLabel(signal.recommended_action)}</span>
      </div>

      <p className="engagement-post-excerpt">{shortText(signal.summary)}</p>

      {rationale ? (
        <details className="engagement-rationale">
          <summary>
            <Info aria-hidden="true" size={14} />
            Why it appears
          </summary>
          <p>{rationale}</p>
        </details>
      ) : null}

      <div className="actions">
        <a
          className={`button ${signal.opened_at ? "ghost" : "hot"}`}
          href={`/engagement/open/${signal.id}`}
          rel="noreferrer"
          target="_blank"
        >
          {signal.opened_at ? "Open again" : "Open post"}
          <ExternalLink aria-hidden="true" size={14} />
        </a>
        <form action={markEngagementSignalEngaged}>
          <input name="signal_id" type="hidden" value={signal.id} />
          <input name="return_to" type="hidden" value={returnTo} />
          <PendingSubmitButton
            className={`button ${signal.opened_at ? "hot" : "ghost"}`}
            pendingLabel="Saving…"
          >
            <Check aria-hidden="true" size={14} />
            I engaged
          </PendingSubmitButton>
        </form>
        <form action={doNotEngageSignal}>
          <input name="signal_id" type="hidden" value={signal.id} />
          <input name="return_to" type="hidden" value={returnTo} />
          <PendingSubmitButton className="button quiet" pendingLabel="Saving…">
            <Ban aria-hidden="true" size={14} />
            Do not engage
          </PendingSubmitButton>
        </form>
      </div>
    </article>
  );
}

function EngagementGroup({
  description,
  emptyDetail,
  label,
  resolved,
  signals,
  target,
  returnTo,
}: {
  description: string;
  emptyDetail: string;
  label: string;
  resolved: number;
  signals: EngagementSignalRow[];
  target: number;
  returnTo: string;
}) {
  return (
    <section className="engagement-group" aria-labelledby={`engagement-${label.replace(/\s+/g, "-").toLowerCase()}`}>
      <div className="engagement-group-head">
        <div>
          <h2 id={`engagement-${label.replace(/\s+/g, "-").toLowerCase()}`}>{label}</h2>
          <p>{description}</p>
        </div>
        <span>{resolved} of {target} handled</span>
      </div>
      {signals.length > 0 ? (
        <div className="engagement-daily-set" aria-label={`${label} recommendations`}>
          {signals.map((signal) => (
            <div className="engagement-daily-item" key={signal.id}>
              <EngagementPostCard signal={signal} returnTo={returnTo} />
            </div>
          ))}
        </div>
      ) : (
        <p className="engagement-group-empty">{emptyDetail}</p>
      )}
    </section>
  );
}

export default async function EngagementPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  await requireEnabledModule("engagement");
  const params = searchParams ? await searchParams : {};
  const message = firstParam(params.message);
  const undoSignalId = firstParam(params.undo_signal);
  const undoKind = firstParam(params.undo_kind);
  const [engagementData, feedHealth] = await Promise.all([
    getEngagementData(),
    getEngagementFeedHealth(),
  ]);
  const {
    setupMode,
    loadError,
    signals,
    networkSignals,
    wantToKnowSignals,
    networkResolvedToday,
    wantToKnowResolvedToday,
    dailyLimit,
    wantToKnowDailyLimit,
    moreBatch,
  } = engagementData;

  const returnTo = "/engagement";
  const feedWaiting =
    !feedHealth.loadError && !feedHealth.receivedToday;
  const waitingDetail = feedWaiting
    ? feedHealth.latestReceivedAt
      ? `The last feed update was ${formatAge(feedHealth.latestReceivedAt)}.`
      : "Today’s research has not reached the feed yet."
    : "Nothing else has passed the relevance checks yet.";

  return (
    <>
      <header className="engagement-page-head">
        <div>
          <h1 className="portal-title">Engagement</h1>
          <p className="lede">Two different relationship jobs, kept deliberately separate.</p>
        </div>
        <span className="engagement-total">{signals.length} ready</span>
      </header>

      {message ? (
        <div className="notice networking-notice" role="status">
          <span>{message}</span>
          {undoSignalId ? (
            <form action={restoreEngagementSignal}>
              <input name="signal_id" type="hidden" value={undoSignalId} />
              <input name="undo_kind" type="hidden" value={undoKind ?? ""} />
              <input name="return_to" type="hidden" value={returnTo} />
              <PendingSubmitButton className="button small quiet" pendingLabel="Restoring…">
                Undo
              </PendingSubmitButton>
            </form>
          ) : null}
        </div>
      ) : null}
      {setupMode ? (
        <div className="notice" role="status">Your engagement feed is still being prepared.</div>
      ) : null}
      {loadError ? (
        <div className="notice" role="alert">
          Engagement recommendations could not be loaded. Nothing was removed; please refresh shortly.
        </div>
      ) : null}

      {!loadError ? (
        <div className="engagement-groups">
          <EngagementGroup
            description="Maintain the people already in your Book. Three thoughtful touches is enough."
            emptyDetail={networkResolvedToday >= dailyLimit ? "Your in-network set is complete for today." : waitingDetail}
            label="In your network"
            resolved={networkResolvedToday}
            returnTo={returnTo}
            signals={networkSignals}
            target={dailyLimit}
          />
          {networkSignals.length === 0 && moreBatch > 0 ? (
            <form action={requestMoreEngagementActivity}>
              <PendingSubmitButton className="button ghost" pendingLabel="Loading…">
                Find {moreBatch} more in-network posts
              </PendingSubmitButton>
            </form>
          ) : null}
          <EngagementGroup
            description="Build familiarity with people you deliberately chose, using signals that match the purpose of the relationship."
            emptyDetail={wantToKnowResolvedToday >= wantToKnowDailyLimit ? "Your Want to Know set is complete for today." : waitingDetail}
            label="Want to Know"
            resolved={wantToKnowResolvedToday}
            returnTo={returnTo}
            signals={wantToKnowSignals}
            target={wantToKnowDailyLimit}
          />
        </div>
      ) : null}

    </>
  );
}

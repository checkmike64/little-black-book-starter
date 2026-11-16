import { cookies } from "next/headers";
import { PendingSubmitButton } from "@/app/(portal)/pending-submit-button";
import {
  createIntroduction,
  regenerateIntroductionDraft,
  updateIntroduction,
  updateIntroductionFeedback,
} from "@/app/(portal)/introductions/actions";
import {
  blockConnectionRecommendation,
  restoreConnectionRecommendation,
  snoozeConnectionRecommendation,
} from "@/app/(portal)/networking/actions";
import { requestMoreNetworkingActivity } from "@/app/(portal)/recommendation-actions";
import { AlreadyConnectedDialog } from "@/app/(portal)/networking/already-connected-dialog";
import { RelationshipContextCapture } from "@/app/(portal)/networking/relationship-context-capture";
import { RelationshipGroupEditor } from "@/app/(portal)/networking/relationship-group-editor";
import { IntroductionDraftRefresh } from "@/app/(portal)/networking/introduction-draft-refresh";
import { NetworkingBasisDialog } from "@/app/(portal)/networking/networking-basis-dialog";
import {
  introductionDraftIsActive,
  introductionDraftState,
} from "@/lib/introduction-draft-state";
import { requireEnabledModule } from "@/lib/module-gate";
import { adminToolsCookieName, shouldUseAdminTools } from "@/lib/admin-mode";
import {
  getNetworkingData,
  type NetworkingConnectionRow,
} from "@/lib/networking/data";
import { networkingProfileBasis } from "@/lib/networking/factual-basis";
import { getTenantContext } from "@/lib/tenant-context";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const maxDuration = 60;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function shortText(value: string, maxLength = 260) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, maxLength + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > maxLength * 0.7 ? lastSpace : maxLength).trim()}…`;
}

function evidenceList(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => shortText(item, 180))
    : [];
}

function storedRelationshipContext(
  connection: NetworkingConnectionRow,
  contactId: string,
) {
  const root = connection.evidence.relationship_context;
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  const value = (root as Record<string, unknown>)[contactId];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function howKnown(
  connection: NetworkingConnectionRow,
  contact: NetworkingConnectionRow["contact_a_record"],
) {
  if (!contact) return "Relationship context is missing.";
  const stored = storedRelationshipContext(connection, contact.id);
  const storedHow = stored?.how_known;
  if (typeof storedHow === "string" && storedHow.trim()) return shortText(storedHow, 190);
  if (contact.how_we_met?.trim()) return shortText(contact.how_we_met, 190);
  const recentInteraction = evidenceList(stored?.recent_interactions)[0];
  if (recentInteraction) return `Recent context: ${recentInteraction}`;
  if (contact.relationship_type?.length) {
    const lastSpoke = contact.last_spoke ? ` Last spoke ${contact.last_spoke}.` : "";
    return `${contact.relationship_type.join(", ")} relationship in your Book.${lastSpoke}`;
  }
  return "This relationship needs more context before the introduction is sent.";
}

function fitSummary(connection: NetworkingConnectionRow) {
  const storedSummary = connection.evidence.model_summary ?? connection.evidence.summary;
  if (typeof storedSummary === "string" && storedSummary.trim()) {
    return shortText(storedSummary, 420);
  }
  return networkingProfileBasis(
    connection.contact_a_record,
    connection.contact_b_record,
  );
}

function sourceBackedTiming(connection: NetworkingConnectionRow) {
  const claims = Array.isArray(connection.evidence.claims)
    ? connection.evidence.claims
    : [];
  const recentClaim = claims.find((claim) => {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) return false;
    const value = claim as Record<string, unknown>;
    return (
      typeof value.observed_at === "string" &&
      typeof value.excerpt === "string" &&
      value.source_kind !== "profile"
    );
  }) as Record<string, unknown> | undefined;
  if (!recentClaim) return null;
  const observedAt = String(recentClaim.observed_at);
  const excerpt = shortText(String(recentClaim.excerpt), 210);
  const date = Number.isNaN(Date.parse(observedAt))
    ? null
    : new Date(observedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${date ? `${date}: ` : ""}${excerpt}`;
}

function feedbackCounterpart(
  feedback: Awaited<ReturnType<typeof getNetworkingData>>["feedbackRequests"][number],
) {
  const introduction = feedback.introductions;
  if (!introduction) return "the other person";
  return introduction.person_a === feedback.contact_id
    ? introduction.person_b_contact?.full_name ?? "the other person"
    : introduction.person_a_contact?.full_name ?? "the other person";
}

function introductionReason(connection: NetworkingConnectionRow) {
  const personA = connection.contact_a_record;
  const personB = connection.contact_b_record;
  return [
    `${personA?.full_name ?? "Person A"}: ${howKnown(connection, personA)}`,
    `${personB?.full_name ?? "Person B"}: ${howKnown(connection, personB)}`,
    `Profile basis: ${fitSummary(connection)}`,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 2000);
}

export default async function NetworkingPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  await requireEnabledModule("networking");
  const params = searchParams ? await searchParams : {};
  const tenantContext = await getTenantContext();
  const cookieStore = await cookies();
  const adminMode = shouldUseAdminTools({
    cookieValue: cookieStore.get(adminToolsCookieName)?.value,
    role: tenantContext?.role,
  });
  const message = firstParam(params.message);
  const undoConnectionId = firstParam(params.undo_connection);
  const {
    setupMode,
    loadError,
    contacts,
    introductions,
    connections,
    relationshipContexts,
    connectionCount,
    reserveCount,
    moreBatch,
    feedbackRequests,
    inboxConnected,
    asOf,
  } =
    await getNetworkingData();
  const now = Date.parse(asOf ?? "1970-01-01T00:00:00.000Z");
  const dueFeedback = feedbackRequests.filter(
    (feedback) =>
      ["scheduled", "draft_ready"].includes(feedback.status) &&
      Date.parse(feedback.due_at) <= now,
  );
  const awaitingFeedback = feedbackRequests.filter(
    (feedback) => feedback.status === "sent",
  );
  const scheduledFeedback = feedbackRequests.filter(
    (feedback) =>
      ["scheduled", "draft_ready"].includes(feedback.status) &&
      Date.parse(feedback.due_at) > now,
  );
  const recommendation = connections[0] ?? null;
  const sharedContexts = recommendation?.shared_contexts ?? [];
  const likelyAlreadyConnected = sharedContexts.some(
    (relationshipContext) =>
      relationshipContext.connection_prior === "strong" ||
      relationshipContext.connection_prior === "moderate",
  );
  const latestProposed = introductions.find((intro) => intro.status === "proposed") ?? null;
  const latestDraftState = latestProposed
    ? introductionDraftState({
        evidence: latestProposed.draft_evidence,
        hasDraft: Boolean(latestProposed.draft_body && latestProposed.draft_subject),
      })
    : null;
  const draftIsActive = latestDraftState
    ? introductionDraftIsActive(latestDraftState.status)
    : false;
  const draftNeedsAttention =
    latestDraftState?.status === "failed" || latestDraftState?.status === "stale";
  const showApproval = Boolean(
    latestProposed &&
      (latestProposed.draft_body ||
        latestDraftState?.status !== "idle" ||
        message?.toLowerCase().includes("created") ||
        message?.toLowerCase().includes("ready")),
  );
  return (
    <div className="minimal-page networking-minimal">
      <header className="minimal-page-header">
        <div className="minimal-title-line"><h1>Networking</h1><span>{connectionCount} suggestion{connectionCount === 1 ? "" : "s"}</span></div>
        <a className="button quiet" href="#create-introduction">Create manually</a>
      </header>

      {message ? (
        <div className="notice networking-notice" role="status">
          <span>{message}</span>
          {undoConnectionId ? (
            <form action={restoreConnectionRecommendation}>
              <input name="connection_id" type="hidden" value={undoConnectionId} />
              <input name="return_to" type="hidden" value="/networking" />
              <PendingSubmitButton className="button small quiet" pendingLabel="Restoring…">
                Undo
              </PendingSubmitButton>
            </form>
          ) : null}
        </div>
      ) : null}
      {setupMode ? <div className="notice" role="status">Your networking data is still being prepared.</div> : null}
      {loadError ? (
        <div className="notice" role="alert">
          Networking couldn’t load. Refresh the page to try again.
        </div>
      ) : null}

      {!loadError && showApproval && latestProposed ? (
        <section
          className={`decision-card ${latestDraftState?.status === "ready" ? "approved-card" : ""}`.trim()}
        >
          <span className={`pill ${draftNeedsAttention ? "warn" : "cool"}`}>
            {draftIsActive ? "Preparing" : draftNeedsAttention ? "Needs attention" : "Ready"}
          </span>
          <h2>
            {latestProposed.person_a_contact?.full_name ?? "Person A"} ↔ {latestProposed.person_b_contact?.full_name ?? "Person B"}
          </h2>
          {draftIsActive && latestProposed.draft_body ? (
            <div className="notice introduction-draft-inline-status" role="status">
              An updated draft is being prepared. The current draft will stay here until it is ready.
            </div>
          ) : draftNeedsAttention && latestProposed.draft_body ? (
            <div className="notice introduction-draft-inline-status" role="status">
              The draft update could not be completed. The previous draft is still available.
            </div>
          ) : null}
          {latestProposed.draft_body && latestProposed.draft_subject ? (
            <div className="introduction-draft-form">
              <label className="field">
                <span>Subject</span>
                <input
                  aria-readonly="true"
                  readOnly
                  value={latestProposed.draft_subject}
                />
              </label>
              <label className="field">
                <span>Email</span>
                <textarea
                  aria-readonly="true"
                  readOnly
                  rows={9}
                  value={latestProposed.draft_body}
                />
              </label>
              <p className="subtle-note">Copy this draft into the email service you use.</p>
            </div>
          ) : draftIsActive ? (
            <div className="introduction-draft-preparing">
              <p>The introduction is saved. The draft is being prepared.</p>
            </div>
          ) : draftNeedsAttention ? (
            <p>The introduction is saved. The draft could not be prepared.</p>
          ) : (
            <p>The introduction is saved. No draft is available.</p>
          )}
          {latestDraftState?.requestId ? (
            <IntroductionDraftRefresh
              initialStatus={latestDraftState.status}
              introductionId={latestProposed.id}
              key={latestDraftState.requestId}
              requestId={latestDraftState.requestId}
            />
          ) : null}
          {!draftIsActive && latestProposed.draft_body ? (
            <form action={regenerateIntroductionDraft} className="introduction-redraft-form">
              <input name="introduction_id" type="hidden" value={latestProposed.id} />
              <label className="field">
                <span>Change anything?</span>
                <input
                  maxLength={700}
                  name="revision_guidance"
                  placeholder="Make it shorter, warmer, or focus on a different reason."
                />
              </label>
              <PendingSubmitButton className="button ghost" pendingLabel="Starting…">
                Rewrite draft
              </PendingSubmitButton>
            </form>
          ) : null}
          {draftNeedsAttention && !latestProposed.draft_body ? (
            <form action={regenerateIntroductionDraft} className="introduction-draft-retry">
              <input name="introduction_id" type="hidden" value={latestProposed.id} />
              <PendingSubmitButton className="button ghost" pendingLabel="Starting…">
                Try draft again
              </PendingSubmitButton>
            </form>
          ) : null}
          {latestProposed.draft_body && !draftIsActive ? (
            <div className="actions introduction-status-actions">
              <form action={updateIntroduction}>
                <input name="introduction_id" type="hidden" value={latestProposed.id} />
                <input name="return_to" type="hidden" value="/networking" />
                <input name="status" type="hidden" value="made" />
                <PendingSubmitButton className="button ghost" pendingLabel="Saving…">
                  Mark sent
                </PendingSubmitButton>
              </form>
            </div>
          ) : null}
        </section>
      ) : recommendation ? (
        <section className="decision-card" aria-labelledby="networking-recommendation">
          <span className="minimal-row-label">{likelyAlreadyConnected ? "Check first" : "Suggested introduction"}</span>
          <h2 id="networking-recommendation">
            {recommendation.contact_a_record?.full_name ?? "Person A"} ↔ {recommendation.contact_b_record?.full_name ?? "Person B"}
          </h2>
          <div className="networking-basis-line">
            <div>
              <p>{likelyAlreadyConnected ? `Both are in ${sharedContexts[0].name}. Confirm whether they already know each other.` : fitSummary(recommendation)}</p>
              {!likelyAlreadyConnected && sourceBackedTiming(recommendation) ? (
                <p className="networking-why-now">
                  <strong>Why now:</strong> {sourceBackedTiming(recommendation)}
                </p>
              ) : null}
            </div>
            <NetworkingBasisDialog
              fit={fitSummary(recommendation)}
              personA={recommendation.contact_a_record?.full_name ?? "Person A"}
              personABasis={howKnown(recommendation, recommendation.contact_a_record)}
              personB={recommendation.contact_b_record?.full_name ?? "Person B"}
              personBBasis={howKnown(recommendation, recommendation.contact_b_record)}
              sharedGroups={sharedContexts.map((context) => context.name)}
            />
          </div>
          <div className="actions">
            <form action={createIntroduction}>
              <input name="return_to" type="hidden" value="/networking" />
              <input name="connection_id" type="hidden" value={recommendation.id} />
              <input name="person_a" type="hidden" value={recommendation.contact_a} />
              <input name="person_b" type="hidden" value={recommendation.contact_b} />
              <input name="why_context" type="hidden" value={introductionReason(recommendation)} />
              <PendingSubmitButton
                className={likelyAlreadyConnected ? "button ghost" : "button hot"}
                pendingLabel="Preparing…"
              >
                {likelyAlreadyConnected ? "Introduce them" : "Create introduction"}
              </PendingSubmitButton>
            </form>
            <AlreadyConnectedDialog
              connectionId={recommendation.id}
              personA={recommendation.contact_a_record?.full_name ?? "Person A"}
              personB={recommendation.contact_b_record?.full_name ?? "Person B"}
              relationshipContexts={relationshipContexts}
              sharedContexts={sharedContexts}
            />
            <form action={snoozeConnectionRecommendation}>
              <input name="connection_id" type="hidden" value={recommendation.id} />
              <PendingSubmitButton className="button quiet" pendingLabel="Saving…">
                Not useful now
              </PendingSubmitButton>
            </form>
            <details className="decision-more">
              <summary>More</summary>
              <div>
                <form action={blockConnectionRecommendation}>
                  <input name="connection_id" type="hidden" value={recommendation.id} />
                  <input
                    name="owner_note"
                    type="hidden"
                    value="I do not want these people connected."
                  />
                  <PendingSubmitButton className="button quiet" pendingLabel="Saving…">
                    Do not suggest again
                  </PendingSubmitButton>
                </form>
              </div>
            </details>
          </div>
        </section>
      ) : !loadError ? (
        <div className="empty-state">
          <b>
            {reserveCount > 0
              ? "You’re done for today."
              : "You’re caught up."}
          </b>
          <p>
            {reserveCount > 0
              ? "Keep going, or leave the rest for tomorrow."
              : "New recommendations will appear automatically."}
          </p>
          {reserveCount > 0 ? (
            <form action={requestMoreNetworkingActivity}>
              <PendingSubmitButton className="button ghost" pendingLabel="Loading…">
                Show me {moreBatch} more
              </PendingSubmitButton>
            </form>
          ) : null}
        </div>
      ) : null}

      {feedbackRequests.length > 0 ? (
        <section className="introduction-followups" aria-labelledby="introduction-followups-title">
          <header className="introduction-followups-head">
            <div>
              <h2 id="introduction-followups-title">Introduction follow-up</h2>
              <p>
                {dueFeedback.length > 0
                  ? `${dueFeedback.length} feedback email${dueFeedback.length === 1 ? " is" : "s are"} ready.`
                  : awaitingFeedback.length > 0
                    ? `Waiting for ${awaitingFeedback.length} repl${awaitingFeedback.length === 1 ? "y" : "ies"}.`
                    : `${scheduledFeedback.length} follow-up${scheduledFeedback.length === 1 ? " is" : "s are"} scheduled.`}
              </p>
            </div>
            {!inboxConnected ? (
              <span className="introduction-inbox-state">Inbox connection required for automatic drafts</span>
            ) : null}
          </header>

          <div className="introduction-followup-list">
            {[...dueFeedback, ...awaitingFeedback].map((feedback) => (
              <article className="introduction-followup-row" key={feedback.id}>
                <div className="introduction-followup-identity">
                  <b>{feedback.contacts?.full_name ?? "Contact"}</b>
                  <span>
                    About the introduction to {feedbackCounterpart(feedback)}
                  </span>
                  <small>
                    {feedback.status === "sent"
                      ? "Awaiting a reply"
                      : `Due ${new Date(feedback.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                  </small>
                </div>

                {feedback.status !== "sent" && feedback.draft_subject && feedback.draft_body ? (
                  <details className="introduction-feedback-draft">
                    <summary>Review email</summary>
                    <div className="introduction-feedback-copy">
                      <label className="field compact">
                        <span>Subject</span>
                        <input readOnly value={feedback.draft_subject} />
                      </label>
                      <label className="field compact">
                        <span>Email</span>
                        <textarea readOnly rows={7} value={feedback.draft_body} />
                      </label>
                      <form action={updateIntroductionFeedback}>
                        <input name="feedback_id" type="hidden" value={feedback.id} />
                        <input name="feedback_action" type="hidden" value="sent" />
                        <input name="return_to" type="hidden" value="/networking" />
                        <PendingSubmitButton className="button ghost" pendingLabel="Saving…">
                          Mark feedback email sent
                        </PendingSubmitButton>
                      </form>
                    </div>
                  </details>
                ) : null}

                <details className="introduction-feedback-response">
                  <summary>Record their response</summary>
                  <form action={updateIntroductionFeedback} className="introduction-feedback-form">
                    <input name="feedback_id" type="hidden" value={feedback.id} />
                    <input name="feedback_action" type="hidden" value="responded" />
                    <input name="return_to" type="hidden" value="/networking" />
                    <div className="form-grid three">
                      <label className="field compact">
                        <span>Useful</span>
                        <select name="usefulness_rating" required defaultValue="">
                          <option value="" disabled>1–5</option>
                          {[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating}</option>)}
                        </select>
                      </label>
                      <label className="field compact">
                        <span>Fit</span>
                        <select name="fit_rating" required defaultValue="">
                          <option value="" disabled>1–5</option>
                          {[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating}</option>)}
                        </select>
                      </label>
                      <label className="field compact">
                        <span>Connect again?</span>
                        <select name="would_recommend" defaultValue="">
                          <option value="">Not said</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </label>
                    </div>
                    <label className="field compact">
                      <span>What they said</span>
                      <textarea name="response_text" required rows={3} />
                    </label>
                    <label className="field compact">
                      <span>What we should learn from it</span>
                      <textarea name="response_reasoning" rows={2} />
                    </label>
                    <input name="response_source" type="hidden" value="owner" />
                    <PendingSubmitButton className="button ghost" pendingLabel="Saving…">
                      Save feedback
                    </PendingSubmitButton>
                  </form>
                </details>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <details className="secondary-workflow" id="create-introduction">
        <summary>Create an introduction</summary>
        <form action={createIntroduction} className="settings-form">
          <input name="return_to" type="hidden" value="/networking" />
          <div className="form-grid two-fields">
            <label className="field">
              <span>First person</span>
              <select name="person_a" required>
                <option value="">Choose someone</option>
                {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.full_name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Second person</span>
              <select name="person_b" required>
                <option value="">Choose someone</option>
                {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.full_name}</option>)}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Connection context</span>
            <textarea
              name="why_context"
              placeholder="Relevant saved context for this introduction"
              required
              rows={3}
            />
          </label>
          <PendingSubmitButton className="button ghost" pendingLabel="Preparing…">
            Create introduction
          </PendingSubmitButton>
        </form>
      </details>

      {adminMode ? (
      <details className="secondary-workflow relationship-context-workflow">
        <summary>My Groups ({relationshipContexts.length})</summary>
        {relationshipContexts.length > 0 ? (
          <div className="simple-row-list relationship-context-list">
            {relationshipContexts.map((relationshipContext) => (
              <details className="relationship-group" key={relationshipContext.id}>
                <summary>
                  <span>
                    <b>{relationshipContext.name}</b>
                    <small>
                      {relationshipContext.member_ids.length} {relationshipContext.member_ids.length === 1 ? "person" : "people"}
                    </small>
                  </span>
                </summary>
                <RelationshipGroupEditor
                  contacts={contacts}
                  relationshipContext={relationshipContext}
                />
              </details>
            ))}
          </div>
        ) : (
          <p className="empty-copy">No groups yet.</p>
        )}
        <details className="relationship-group-create">
          <summary>Create a group</summary>
          <RelationshipContextCapture contacts={contacts} />
        </details>
      </details>
      ) : null}

    </div>
  );
}

import { randomUUID } from "node:crypto";
import { Clock3 } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import {
  logContactActivity,
  requestContactEnrichment,
  updateContactProfile,
} from "@/app/(portal)/contacts/[id]/actions";
import { DataLoadNotice } from "@/app/(portal)/data-load-notice";
import { PendingSubmitButton } from "@/app/(portal)/pending-submit-button";
import { saveRelationshipContext } from "@/app/(portal)/networking/actions";
import { adminToolsCookieName, shouldUseAdminTools } from "@/lib/admin-mode";
import {
  getContactData,
  type Contact,
  type PromiseRow,
} from "@/lib/contact-detail/data";
import { buildContactActivityTimeline } from "@/lib/contact-detail/activity";
import { buildContactConversations } from "@/lib/contact-detail/conversations";
import { buildContactRelationshipHistory } from "@/lib/contact-detail/history";
import { activityDayWindow } from "@/lib/activity-settings";
import { getTenantContext } from "@/lib/tenant-context";
import { contactEnrichmentStatus } from "@/lib/contact-enrichment-status";
import { resolveContactCadence } from "@/lib/keep-in-touch";
import { normalizeTenantSettings } from "@/lib/tenant-settings";

type ContactPageParams = Promise<{ id: string }>;
type ContactPageSearchParams = Promise<Record<string, string | string[] | undefined>>;
type ContactView = "overview" | "activity" | "details" | "edit" | "admin";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeView(value: string | undefined, adminMode: boolean): ContactView {
  if (value === "activity" || value === "details" || value === "edit") return value;
  if (value === "admin" && adminMode) return value;
  return "overview";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function normalizeExternalUrl(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function compactList(values: string[] | null | undefined) {
  return values?.filter(Boolean).join(" · ") ?? "";
}

function compactCopy(value: string, maxLength = 190) {
  const normalized = value.replace(/\s+/g, " ").replace(/^[—–-]\s*/, "").trim();
  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, maxLength + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > maxLength * 0.7 ? lastSpace : maxLength).trim()}…`;
}

function CompactCopy({ value, maxLength = 190 }: { value: string; maxLength?: number }) {
  const summary = compactCopy(value, maxLength);
  if (summary === value.replace(/\s+/g, " ").trim()) return <>{summary}</>;

  return (
    <span className="compact-copy">
      <span>{summary}</span>
      <details>
        <summary>More</summary>
        <p>{value}</p>
      </details>
    </span>
  );
}

function promiseDirection(direction: string) {
  if (direction === "owner_owes_contact") return "You owe";
  if (direction === "contact_owes_owner") return "They owe";
  return direction.replaceAll("_", " ");
}

function primaryMove(
  contact: Contact,
  promises: PromiseRow[],
  actions: Array<{ title: string; status: string; due_on: string | null }>,
) {
  const action = actions.find((item) => item.status === "open" || item.status === "deferred");
  if (action) {
    return {
      title: action.title,
      detail: action.due_on ? `Due ${formatDate(action.due_on)}` : "Saved as your next move",
    };
  }

  const ownerPromise = promises.find(
    (promise) => promise.status === "open" && promise.direction === "owner_owes_contact",
  );
  if (ownerPromise) {
    return {
      title: ownerPromise.promise_text,
      detail: ownerPromise.due_on ? `You promised this by ${formatDate(ownerPromise.due_on)}` : "You owe this",
    };
  }

  if (contact.current_asks) {
    return { title: "Respond to their current ask", detail: compactCopy(contact.current_asks, 180) };
  }
  if (contact.wants_help_with) {
    return { title: "Help with what they are working on", detail: compactCopy(contact.wants_help_with, 180) };
  }
  if (contact.why_stay_in_touch) {
    return { title: "Reconnect with context", detail: contact.why_stay_in_touch };
  }

  return {
    title: "Decide the next useful touchpoint",
    detail: "Review the saved relationship details before deciding whether to reconnect.",
  };
}

function ProfileTabs({
  active,
  adminMode,
  contactId,
}: {
  active: ContactView;
  adminMode: boolean;
  contactId: string;
}) {
  const tabs: Array<{ key: ContactView; label: string }> = [
    { key: "overview", label: "Overview" },
    { key: "activity", label: "History" },
    { key: "details", label: "Details" },
  ];
  if (adminMode) tabs.push({ key: "admin", label: "Management" });

  return (
    <nav className="profile-tabs" aria-label="Contact profile views">
      {tabs.map((tab) => (
        <Link
          aria-current={active === tab.key ? "page" : undefined}
          className={active === tab.key ? "active" : undefined}
          href={`/contacts/${contactId}?view=${tab.key}`}
          key={tab.key}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

function ReachLink({
  href,
  label,
  value,
}: {
  href: string;
  label: string;
  value: string;
}) {
  const external = href.startsWith("http");
  return (
    <a
      className="reach-link"
      href={href}
      rel={external ? "noreferrer" : undefined}
      target={external ? "_blank" : undefined}
    >
      <span>
        <small>{label}</small>
        <b>{value}</b>
      </span>
    </a>
  );
}

export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: ContactPageParams;
  searchParams?: ContactPageSearchParams;
}) {
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const message = firstParam(query.message);
  const tenantContext = await getTenantContext();
  const cookieStore = await cookies();
  const adminMode = shouldUseAdminTools({
    cookieValue: cookieStore.get(adminToolsCookieName)?.value,
    role: tenantContext?.role,
  });
  const activeView = normalizeView(firstParam(query.view), adminMode);
  const {
    contact,
    promises,
    interactions,
    transcripts,
    calendarEvents,
    introductions,
    provenance,
    pendingChanges,
    relationshipActions,
    activeRelationshipActions,
    relationshipContexts,
    availableRelationshipContexts,
    commandJobs,
    activeEnrichmentJob,
    latestEnrichmentJob,
    loadHealth,
    error,
  } = await getContactData(id);

  if (!contact) {
    return (
      <>
        <Link className="button ghost" href="/contacts">
          Back to My Book
        </Link>
        <DataLoadNotice health={loadHealth} />
        <div className="notice">{error}</div>
      </>
    );
  }

  const roleLine = [compactList(contact.role_title), contact.company_name]
    .filter(Boolean)
    .join(" · ");
  const openPromises = promises.filter((promise) => promise.status === "open");
  const openActions = activeRelationshipActions;
  const keepInTouchCadence = resolveContactCadence(contact, normalizeTenantSettings(tenantContext?.settings).keep_in_touch);
  const recentInteractions = interactions
    .map((row) => row.interactions)
    .filter((interaction): interaction is NonNullable<typeof interaction> => Boolean(interaction));
  const activityTimeline = buildContactActivityTimeline({
    calendarEvents,
    interactions: recentInteractions,
    lastSpoke: contact.last_spoke,
    legacyNoteEvidence: /\b(call|meeting|recording|transcript|spoke|conversation)\b/i.test(
      [contact.personal_notes, contact.private_notes].filter(Boolean).join(" "),
    ),
    recentActivity: contact.recent_activity,
  });
  const conversations = buildContactConversations({
    actions: relationshipActions,
    interactions: recentInteractions,
    promises,
    transcripts,
  });
  const relationshipHistory = buildContactRelationshipHistory({
    activities: activityTimeline,
    contactId: contact.id,
    conversations,
    introductions,
    promises,
  });
  const ownerToday = activityDayWindow(
    normalizeTenantSettings(tenantContext?.settings).activity.time_zone,
  ).date;
  const hasUnlinkedActivityEvidence = relationshipHistory.some(
    (activity) => activity.source === "profile_context",
  );
  const move = primaryMove(contact, openPromises, openActions);
  const askHref = `/ask?q=${encodeURIComponent(
    `${contact.full_name}: what is the best next move and why?`,
  )}`;
  const hasReferralContext = Boolean(
    contact.ideal_referral ||
      contact.do_not_refer_for ||
      contact.wants_help_with ||
      contact.what_they_want_more_of ||
      contact.services_offered?.length ||
      contact.referral_intro_blurb ||
      contact.could_refer_me_for?.length ||
      contact.podcast_fit ||
      contact.primary_category?.length ||
      contact.top_3_tags?.length ||
      contact.keywords?.length,
  );
  const missingProfileDetails = [
    contact.role_title?.length,
    contact.company_name,
    contact.email,
    contact.phone,
    contact.linkedin,
    contact.website,
    contact.relationship_type?.length,
    contact.why_stay_in_touch,
  ].filter((value) => !value).length;
  const socialProfiles = [
    ["LinkedIn", contact.linkedin],
    ["Instagram", contact.instagram],
    ["Facebook", contact.facebook],
    ["X", contact.x_twitter],
    ["YouTube", contact.youtube],
  ].filter((profile): profile is [string, string] => Boolean(profile[1]));
  const unresolvedResearchGapCount = [
    !contact.email,
    !contact.company_name && !contact.role_title?.length,
    !contact.one_line_summary,
    !contact.website,
    socialProfiles.length === 0,
  ].filter(Boolean).length;
  const missingResearchFields = [
    ...(!contact.email ? ["primary_email"] : []),
    ...(!contact.company_name ? ["company_name"] : []),
    ...(!contact.role_title?.length ? ["role_title"] : []),
    ...(!contact.one_line_summary ? ["one_line_summary"] : []),
    ...(!contact.website ? ["website"] : []),
    ...(!contact.linkedin ? ["linkedin"] : []),
    ...(!contact.instagram ? ["instagram"] : []),
    ...(!contact.facebook ? ["facebook"] : []),
    ...(!contact.x_twitter ? ["x_twitter"] : []),
    ...(!contact.youtube ? ["youtube"] : []),
  ];
  const enrichmentStatus = contactEnrichmentStatus({
    activeJob: activeEnrichmentJob,
    latestJob: latestEnrichmentJob,
    pendingChangeCount: pendingChanges.length,
    unresolvedGapCount: unresolvedResearchGapCount,
  });

  return (
    <div className="minimal-page minimal-profile">
      <div className="person-topline">
        <Link className="back-link" href="/contacts">
          My Book
        </Link>
      </div>

      <header className="minimal-page-header person-header">
        <div className="person-identity">
          <h1>{contact.full_name}</h1>
          <p className="person-role">{roleLine || "No role or company saved"}</p>
        </div>
        <div className="profile-header-actions">
          {contact.email ? (
            <a className="button hot" href={`mailto:${contact.email}`}>Email</a>
          ) : contact.phone ? (
            <a className="button hot" href={`tel:${contact.phone}`}>Call</a>
          ) : null}
          <Link
            className="button ghost"
            href={`/contacts/${contact.id}?view=activity#log-touchpoint`}
          >
            Log touchpoint
          </Link>
          <Link className="person-header-link" href={`/contacts/${contact.id}?view=edit`}>{adminMode ? "Edit" : "Correct details"}</Link>
        </div>
      </header>

      {message ? <div className="notice">{message}</div> : null}
      <DataLoadNotice health={loadHealth} />
      <ProfileTabs active={activeView} adminMode={adminMode} contactId={contact.id} />

      {activeView === "overview" ? (
        <div className="person-overview">
          <section className="person-next-move" aria-labelledby="next-move-title">
            <div>
              <span className="section-label">Next move</span>
              <h2 id="next-move-title">{move.title}</h2>
              <p>{move.detail}</p>
            </div>
            <div className="actions">
              <Link className="button hot" href={askHref}>Draft a note</Link>
              <Link className="button ghost" href="/movement">Open next moves</Link>
            </div>
          </section>

          {missingProfileDetails > 0 ? (
            <p className="profile-missing-line">
              {missingProfileDetails} profile detail{missingProfileDetails === 1 ? " is" : "s are"} missing.{" "}
              <Link href={`/contacts/${contact.id}?view=edit`}>Add details</Link>
            </p>
          ) : null}

          <div className="person-grid">
            <section className="card person-card contact-card">
              <div className="card-heading">
                <h2>Contact</h2>
                {adminMode ? <span className={`profile-research-status ${enrichmentStatus.tone}`}>{enrichmentStatus.label}</span> : null}
              </div>
              <div className="reach-list">
                {contact.email ? <ReachLink href={`mailto:${contact.email}`} label="Email" value={contact.email} /> : null}
                {contact.phone ? <ReachLink href={`tel:${contact.phone}`} label="Phone" value={contact.phone} /> : null}
                {socialProfiles.map(([label, value]) => (
                  <ReachLink href={normalizeExternalUrl(value)} key={label} label={label} value="Open profile" />
                ))}
                {contact.website ? <ReachLink href={normalizeExternalUrl(contact.website)} label="Website" value={contact.website.replace(/^https?:\/\//, "")} /> : null}
                {!contact.email && !contact.phone && socialProfiles.length === 0 && !contact.website ? <p className="muted">No contact details are stored yet.</p> : null}
              </div>
              {adminMode ? (
                <div className="profile-research">
                  <p role="status">{enrichmentStatus.detail}</p>
                  <form action={requestContactEnrichment}>
                    <input name="contact_id" type="hidden" value={contact.id} />
                    <input name="missing_fields" type="hidden" value={missingResearchFields.join("|")} />
                    <input name="research_request_id" type="hidden" value={randomUUID()} />
                    <button className="button ghost small" disabled={Boolean(activeEnrichmentJob)} type="submit">
                      {activeEnrichmentJob
                        ? "Search in progress"
                        : latestEnrichmentJob && unresolvedResearchGapCount > 0
                          ? "Search again"
                          : "Search for profiles"}
                    </button>
                  </form>
                </div>
              ) : null}
            </section>
            <section className="card person-card">
              <div className="card-heading"><h2>Recent history</h2><Link className="text-link" href={`/contacts/${contact.id}?view=activity`}>View history</Link></div>
              {relationshipHistory.length > 0 ? (
                <div className="profile-list">{relationshipHistory.slice(0, 2).map((activity) => <div className="profile-row" key={activity.id}><span className="profile-key">{formatDate(activity.occurredAt)}</span><span><b>{activity.title}</b>{activity.summary ? <p><CompactCopy maxLength={180} value={activity.summary} /></p> : null}</span></div>)}</div>
              ) : <p className="muted">No relationship history yet.</p>}
            </section>
          </div>
          {(openActions.length > 0 || openPromises.length > 0 || pendingChanges.length > 0) ? (
            <section className="card person-card profile-open-loops">
              <div className="card-heading"><h2>Open loops</h2><span className="card-meta">{openPromises.length + openActions.length} open</span></div>
              <div className="open-loop-list">
                {openActions.slice(0, 3).map((action) => <div className="open-loop" key={action.id}><span className="open-loop-kind">Next move</span><span><b>{action.title}</b>{action.due_on ? <small>Due {formatDate(action.due_on)}</small> : null}</span></div>)}
                {openPromises.slice(0, 3).map((promise) => <div className="open-loop" key={promise.id}><span className="open-loop-kind">{promiseDirection(promise.direction)}</span><span><b>{promise.promise_text}</b>{promise.due_on ? <small>Due {formatDate(promise.due_on)}</small> : null}</span></div>)}
              </div>
              {pendingChanges.length > 0 ? <Link className="pending-profile-link" href="/changes">Review proposed profile changes</Link> : null}
            </section>
          ) : null}
        </div>
      ) : null}

      {activeView === "details" ? (
        <div className="profile-tab-content person-details">
          <div className="person-grid">
            <section className="card person-card">
              <h2>Referral context</h2>
              {hasReferralContext ? <div className="profile-list">
                {contact.primary_category?.length || contact.top_3_tags?.length ? <div className="profile-row"><span className="profile-key">Known for</span><span>{Array.from(new Set([...(contact.primary_category ?? []), ...(contact.top_3_tags ?? [])])).slice(0, 6).join(" · ")}</span></div> : null}
                {contact.ideal_referral ? <div className="profile-row"><span className="profile-key">Send them</span><span><CompactCopy value={contact.ideal_referral} /></span></div> : null}
                {contact.services_offered?.length ? <div className="profile-row"><span className="profile-key">They help with</span><span>{compactList(contact.services_offered)}</span></div> : null}
                {contact.could_refer_me_for?.length ? <div className="profile-row"><span className="profile-key">They can refer me for</span><span>{compactList(contact.could_refer_me_for)}</span></div> : null}
                {contact.do_not_refer_for ? <div className="profile-row"><span className="profile-key">Avoid</span><span><CompactCopy value={contact.do_not_refer_for} /></span></div> : null}
                {contact.wants_help_with ? <div className="profile-row"><span className="profile-key">Help with</span><span><CompactCopy value={contact.wants_help_with} /></span></div> : null}
                {contact.what_they_want_more_of ? <div className="profile-row"><span className="profile-key">Wants more</span><span><CompactCopy value={contact.what_they_want_more_of} /></span></div> : null}
                {contact.podcast_fit ? <div className="profile-row"><span className="profile-key">Podcast</span><span><CompactCopy value={contact.podcast_fit} /></span></div> : null}
                {contact.referral_intro_blurb ? <div className="profile-row"><span className="profile-key">Intro language</span><span><CompactCopy value={contact.referral_intro_blurb} /></span></div> : null}
              </div> : <p className="muted">No referral context is stored yet.</p>}
            </section>
            <section className="card person-card">
              <h2>Relationship</h2>
              <p className="muted">Keep in touch: {keepInTouchCadence.days === null ? "assign a tier or cadence" : !Number.isFinite(keepInTouchCadence.days) ? "no recurring reminder" : `every ${keepInTouchCadence.days} days (${keepInTouchCadence.label})`}.</p>
              <div className="profile-list">
                {contact.company_description ? <div className="profile-row"><span className="profile-key">What they do</span><span><CompactCopy value={contact.company_description} /></span></div> : null}
                <div className="profile-row"><span className="profile-key">Met</span><span>{contact.how_we_met ? <CompactCopy value={contact.how_we_met} /> : "Not captured yet"}</span></div>
                <div className="profile-row"><span className="profile-key">Stay in touch</span><span>{contact.why_stay_in_touch ? <CompactCopy value={contact.why_stay_in_touch} /> : contact.one_line_summary ? <CompactCopy value={contact.one_line_summary} /> : "Not captured yet"}</span></div>
                {contact.location?.length ? <div className="profile-row"><span className="profile-key">Location</span><span>{compactList(contact.location)}</span></div> : null}
                {relationshipContexts.length > 0 ? <div className="profile-row"><span className="profile-key">Groups</span><span>{relationshipContexts.map((context) => context.name).join(" · ")}</span></div> : null}
              </div>
              {contact.personal_notes || contact.private_notes ? <details className="person-notes"><summary>Notes</summary><div>{contact.personal_notes ? <p>{contact.personal_notes}</p> : null}{contact.private_notes ? <p>{contact.private_notes}</p> : null}</div></details> : null}
            </section>
          </div>
        </div>
      ) : null}

      {activeView === "activity" ? (
        <div className="profile-tab-content">
          <section className="card person-card activity-capture" id="log-touchpoint">
            <div className="activity-capture-heading">
              <div>
                <h2>Log a touchpoint</h2>
                <p>Use this when email, calendar, or a recording did not capture the conversation.</p>
              </div>
            </div>
            <form action={logContactActivity} className="activity-capture-form">
              <input name="contact_id" type="hidden" value={contact.id} />
              <input name="activity_request_id" type="hidden" value={randomUUID()} />
              <input name="return_to" type="hidden" value={`/contacts/${contact.id}?view=activity#log-touchpoint`} />
              <div className="editor-grid three-up">
                <label className="field">
                  <span>Date</span>
                  <input defaultValue={ownerToday} max={ownerToday} name="activity_date" required type="date" />
                </label>
                <label className="field">
                  <span>Type</span>
                  <select defaultValue="manual_touch" name="interaction_type">
                    <option value="manual_touch">Other touch</option>
                    <option value="call">Call</option>
                    <option value="meeting">Meeting</option>
                    <option value="email">Email</option>
                    <option value="message">Message</option>
                    <option value="note">Note</option>
                  </select>
                </label>
                <label className="field">
                  <span>Title</span>
                  <input name="activity_title" placeholder="Optional short title" />
                </label>
              </div>
              <label className="field">
                <span>What happened?</span>
                <textarea
                  maxLength={4000}
                  name="activity_summary"
                  placeholder="What happened, what matters, and any next step."
                  required
                  rows={3}
                />
              </label>
              <div className="activity-capture-actions">
                <PendingSubmitButton className="button hot" pendingLabel="Saving…">
                  Save touchpoint
                </PendingSubmitButton>
              </div>
            </form>
          </section>

          {hasUnlinkedActivityEvidence ? (
            <div className="notice activity-evidence-notice">
              <span>
                Imported relationship context is stored below as an unverified note.
                It has not been converted into a logged touchpoint.
              </span>
            </div>
          ) : null}

          <section className="card person-card relationship-history">
            <div className="card-heading">
              <h2>Relationship history</h2>
              <span className="card-meta">
                {relationshipHistory.length} record{relationshipHistory.length === 1 ? "" : "s"}
              </span>
            </div>
            {relationshipHistory.length > 0 ? (
              <div className="timeline-clean">
                {relationshipHistory.map((activity) => {
                  const conversation = activity.conversation;
                  const hasEvidence = Boolean(
                    conversation &&
                      (conversation.topics.length > 0 ||
                        conversation.transcripts.length > 0 ||
                        conversation.promises.length > 0 ||
                        conversation.actions.length > 0 ||
                        conversation.storedInterpretation.length > 0),
                  );
                  const dateOnly =
                    activity.source === "profile_context" ||
                    activity.source === "introduction" ||
                    conversation?.source === "owner_profile";
                  const normalizedSummary = activity.summary?.replace(/\s+/g, " ").trim() ?? "";

                  return (
                    <article key={activity.id}>
                      <time dateTime={activity.occurredAt}>
                        {dateOnly
                          ? formatDate(activity.occurredAt)
                          : formatDateTime(activity.occurredAt)}
                      </time>
                      <div>
                        <div className="activity-title-row">
                          <h3>{activity.title}</h3>
                          <span className={`history-kind ${activity.source === "profile_context" ? "unverified" : ""}`}>
                            {activity.activityType.replaceAll("_", " ")}
                          </span>
                        </div>
                        {normalizedSummary ? (
                          <div className="history-summary">
                            <p>{compactCopy(normalizedSummary, 420)}</p>
                            {normalizedSummary.length > 420 ? (
                              <details className="history-full-copy">
                                <summary>Read full note</summary>
                                <p>{activity.summary}</p>
                              </details>
                            ) : null}
                          </div>
                        ) : (
                          <p className="muted">No summary was saved.</p>
                        )}
                        {conversation && hasEvidence ? (
                          <details className="person-notes history-evidence">
                            <summary>Review saved context</summary>
                            <div className="profile-list">
                              {conversation.topics.length > 0 ? (
                                <div className="profile-row">
                                  <span className="profile-key">Topics</span>
                                  <span>{conversation.topics.join(" · ")}</span>
                                </div>
                              ) : null}
                              {conversation.transcripts.length > 0 ? (
                                <div className="profile-row">
                                  <span className="profile-key">Transcript</span>
                                  <div>
                                    {conversation.transcripts.map((transcript) => (
                                      <div key={transcript.id}>
                                        <b>{transcript.title ?? "Distilled conversation"}</b>
                                        <p>{transcript.distilled_summary ?? "Transcript stored without a distilled summary."}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              {conversation.promises.length > 0 ? (
                                <div className="profile-row">
                                  <span className="profile-key">Commitments</span>
                                  <div>
                                    {conversation.promises.map((promise) => (
                                      <div key={promise.id}>
                                        <b>{promiseDirection(promise.direction)}</b>
                                        <p>{promise.promise_text} · {promise.status}{promise.due_on ? ` · due ${formatDate(promise.due_on)}` : ""}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              {conversation.actions.length > 0 ? (
                                <div className="profile-row">
                                  <span className="profile-key">Follow-up</span>
                                  <div>
                                    {conversation.actions.map((action) => (
                                      <div key={action.id}>
                                        <b>{action.title}</b>
                                        <p>{action.status.replaceAll("_", " ")}{action.due_on ? ` · due ${formatDate(action.due_on)}` : ""}{action.notes ? ` · ${action.notes}` : ""}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              {conversation.storedInterpretation.length > 0 ? (
                                <div className="profile-row">
                                  <span className="profile-key">Book interpretation</span>
                                  <div>{conversation.storedInterpretation.map((item) => <p key={item}>{item}</p>)}</div>
                                </div>
                              ) : null}
                              <div className="profile-row">
                                <span className="profile-key">Source</span>
                                <span>{conversation.provenance.join(" · ")}</span>
                              </div>
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="muted">
                No communication is logged yet. Use the form above after the next touchpoint.
              </p>
            )}
          </section>
        </div>
      ) : null}

      {activeView === "edit" ? (
        <div className="profile-tab-content">
          <form action={updateContactProfile} className="card profile-editor">
            <input name="contact_id" type="hidden" value={contact.id} />
            <input name="edit_scope" type="hidden" value={adminMode ? "operator" : "owner_facts"} />
            <input name="return_to" type="hidden" value={`/contacts/${contact.id}`} />
            <div className="editor-heading">
              <div>
                <span className="section-label">
                  {adminMode ? "Edit profile" : "Correct details"}
                </span>
                <h2>
                  {adminMode
                    ? "Keep the useful context accurate"
                    : "Update facts and add your own notes"}
                </h2>
              </div>
              <button className="button hot" type="submit">Save changes</button>
            </div>

            <section className="editor-section" aria-labelledby="profile-basics-heading">
              <div className="editor-section-heading">
                <h3 id="profile-basics-heading">Profile basics</h3>
                <p>Identity and contact details.</p>
              </div>
              <div className="editor-grid">
                <label className="field"><span>Name</span><input defaultValue={contact.full_name} name="full_name" required /></label>
                <label className="field"><span>Company</span><input defaultValue={contact.company_name ?? ""} name="company_name" /></label>
                <label className="field"><span>Role <small>use | for more than one</small></span><input defaultValue={compactList(contact.role_title).replaceAll(" · ", " | ")} name="role_title" /></label>
                <label className="field"><span>Location <small>use | for more than one</small></span><input defaultValue={compactList(contact.location).replaceAll(" · ", " | ")} name="location" /></label>
                <label className="field"><span>Email</span><input defaultValue={contact.email ?? ""} name="email" type="email" /></label>
                <label className="field"><span>Phone</span><input defaultValue={contact.phone ?? ""} name="phone" /></label>
                <label className="field"><span>LinkedIn</span><input defaultValue={contact.linkedin ?? ""} name="linkedin" /></label>
                <label className="field"><span>Instagram</span><input defaultValue={contact.instagram ?? ""} name="instagram" /></label>
                <label className="field"><span>Facebook</span><input defaultValue={contact.facebook ?? ""} name="facebook" /></label>
                <label className="field"><span>X</span><input defaultValue={contact.x_twitter ?? ""} name="x_twitter" /></label>
                <label className="field"><span>YouTube</span><input defaultValue={contact.youtube ?? ""} name="youtube" /></label>
                <label className="field"><span>Podcast</span><input defaultValue={contact.podcast_url ?? ""} name="podcast_url" /></label>
                <label className="field"><span>Website</span><input defaultValue={contact.website ?? ""} name="website" /></label>
              </div>
              <label className="field"><span>What they or their company do</span><textarea defaultValue={contact.company_description ?? ""} name="company_description" rows={3} /></label>
              <label className="field"><span>One-line summary</span><textarea defaultValue={contact.one_line_summary ?? ""} name="one_line_summary" rows={2} /></label>
            </section>

            {adminMode ? (
            <section className="editor-section" aria-labelledby="relationship-heading">
              <div className="editor-section-heading">
                <h3 id="relationship-heading">Relationship</h3>
                <p>Controls communication rhythm and recommendation priority.</p>
              </div>
              <div className="editor-grid">
                <label className="field"><span>Relationship roles <small>peer | friend | referral partner</small></span><input defaultValue={compactList(contact.relationship_type).replaceAll(" · ", " | ")} name="relationship_type" /></label>
                <label className="field">
                  <span>Trust tier</span>
                  <select defaultValue={contact.trust_level ?? ""} name="trust_level">
                    <option value="">Not set</option>
                    <option value="Tier 1 - Deep Trust">Tier 1 - Deep Trust</option>
                    <option value="Tier 2 - Working Trust">Tier 2 - Working Trust</option>
                    <option value="Tier 3 - Acquaintance">Tier 3 - Acquaintance</option>
                  </select>
                </label>
                <label className="field">
                  <span>Relationship strength</span>
                  <select defaultValue={contact.relationship_strength ?? ""} name="relationship_strength">
                    <option value="">Automatic</option>
                    <option value="Hot">Hot</option>
                    <option value="Warm">Warm</option>
                    <option value="Cooling">Cooling</option>
                    <option value="Cold">Cold</option>
                    <option value="Unknown">Unknown</option>
                  </select>
                </label>
                <label className="field">
                  <span>Touch cadence</span>
                  <select defaultValue={contact.touch_cadence ?? ""} name="touch_cadence">
                    <option value="">Use tier default</option>
                    <option value="Weekly">Weekly</option>
                    <option value="Biweekly">Every two weeks</option>
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                    <option value="Biannual">Twice a year</option>
                    <option value="Dormant">No active cadence</option>
                  </select>
                </label>
                <label className="field">
                  <span>Engagements per month <small>blank uses automatic pacing</small></span>
                  <input defaultValue={contact.engagement_target_per_month ?? ""} max={8} min={0} name="engagement_target_per_month" step="0.25" type="number" />
                </label>
              </div>
              <label className="field"><span>How we met</span><textarea defaultValue={contact.how_we_met ?? ""} name="how_we_met" rows={3} /></label>
              <label className="field"><span>Why stay in touch</span><textarea defaultValue={contact.why_stay_in_touch ?? ""} name="why_stay_in_touch" rows={3} /></label>
              <details className="person-notes editor-context-capture">
                <summary>Add to a group</summary>
                <div className="editor-context-fields">
                  <div className="editor-grid">
                    <label className="field">
                      <span>Existing group</span>
                      <select defaultValue="" form="contact-context-form" name="relationship_context_id">
                        <option value="">Create a new one</option>
                        {availableRelationshipContexts.map((relationshipContext) => (
                          <option key={relationshipContext.id} value={relationshipContext.id}>
                            {relationshipContext.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field"><span>New group</span><input form="contact-context-form" maxLength={160} name="relationship_context_name" /></label>
                    <label className="field">
                      <span>Type</span>
                      <select defaultValue="mastermind" form="contact-context-form" name="relationship_context_type">
                        <option value="mastermind">Mastermind</option>
                        <option value="conference">Conference</option>
                        <option value="board">Board</option>
                        <option value="community">Community</option>
                        <option value="company">Company</option>
                        <option value="cohort">Cohort</option>
                        <option value="school">School</option>
                        <option value="event">Event</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="field"><span>Note</span><input form="contact-context-form" maxLength={1200} name="relationship_context_description" /></label>
                  </div>
                  <button className="button ghost small" form="contact-context-form" type="submit">Save group</button>
                </div>
              </details>
            </section>
            ) : null}

            {adminMode ? (
            <section className="editor-section" aria-labelledby="network-fit-heading">
              <div className="editor-section-heading">
                <h3 id="network-fit-heading">Network fit</h3>
                <p>Structured context used for search, referrals, and introductions.</p>
              </div>
              <div className="editor-grid">
                <label className="field"><span>Work categories <small>use | for more than one</small></span><input defaultValue={compactList(contact.primary_category).replaceAll(" · ", " | ")} name="primary_category" /></label>
                <label className="field"><span>Top tags <small>up to three, separated with |</small></span><input defaultValue={compactList(contact.top_3_tags).replaceAll(" · ", " | ")} name="top_3_tags" /></label>
                <label className="field"><span>Search keywords <small>separate with |</small></span><input defaultValue={compactList(contact.keywords).replaceAll(" · ", " | ")} name="keywords" /></label>
              </div>
              <div className="editor-grid two-up">
                <label className="field"><span>Their current ask</span><textarea defaultValue={contact.current_asks ?? ""} name="current_asks" rows={4} /></label>
                <label className="field"><span>What they want help with</span><textarea defaultValue={contact.wants_help_with ?? ""} name="wants_help_with" rows={4} /></label>
                <label className="field"><span>What they want more of</span><textarea defaultValue={contact.what_they_want_more_of ?? ""} name="what_they_want_more_of" rows={4} /></label>
                <label className="field"><span>What they help with <small>separate with |</small></span><textarea defaultValue={compactList(contact.services_offered).replaceAll(" · ", " | ")} name="services_offered" rows={4} /></label>
                <label className="field"><span>Good referrals</span><textarea defaultValue={contact.ideal_referral ?? ""} name="ideal_referral" rows={4} /></label>
                <label className="field"><span>What they could refer me for <small>separate with |</small></span><textarea defaultValue={compactList(contact.could_refer_me_for).replaceAll(" · ", " | ")} name="could_refer_me_for" rows={4} /></label>
                <label className="field"><span>Do not refer for</span><textarea defaultValue={contact.do_not_refer_for ?? ""} name="do_not_refer_for" rows={4} /></label>
                <label className="field"><span>Introduction blurb</span><textarea defaultValue={contact.referral_intro_blurb ?? ""} name="referral_intro_blurb" rows={4} /></label>
                <label className="field"><span>Podcast fit</span><textarea defaultValue={contact.podcast_fit ?? ""} name="podcast_fit" rows={4} /></label>
              </div>
            </section>
            ) : null}

            <section className="editor-section" aria-labelledby="private-context-heading">
              <div className="editor-section-heading">
                <h3 id="private-context-heading">Private context</h3>
                <p>Useful memory, not a substitute for dated Activity.</p>
              </div>
              {adminMode ? (
                <label className="field"><span>Imported activity context</span><textarea defaultValue={contact.recent_activity ?? ""} name="recent_activity" rows={4} /></label>
              ) : null}
              <label className="field"><span>Personal notes</span><textarea defaultValue={contact.personal_notes ?? ""} name="personal_notes" rows={5} /></label>
              <label className="field"><span>Private notes</span><textarea defaultValue={contact.private_notes ?? ""} name="private_notes" rows={6} /></label>
            </section>

            <div className="actions editor-actions">
              <button className="button hot" type="submit">Save changes</button>
              <Link className="button ghost" href={`/contacts/${contact.id}`}>Cancel</Link>
            </div>
          </form>
          <form action={saveRelationshipContext} id="contact-context-form">
            <input name="contact_ids" type="hidden" value={contact.id} />
            <input name="return_to" type="hidden" value={`/contacts/${contact.id}?view=edit`} />
          </form>
        </div>
      ) : null}

      {activeView === "admin" && adminMode ? (
        <div className="profile-tab-content admin-profile-tools">
          <div className="person-grid">
            <section className="card person-card">
              <h2>Suggested updates</h2>
              <p>{pendingChanges.length} update{pendingChanges.length === 1 ? "" : "s"} waiting for review.</p>
              <Link className="button ghost small" href="/changes">Open Changes</Link>
            </section>
            <section className="card person-card">
              <h2>Source history</h2>
              <p>{provenance.length} saved source record{provenance.length === 1 ? "" : "s"} support this profile.</p>
              <details className="person-notes">
                <summary>View source history</summary>
                <div className="source-history">
                  {provenance.map((source) => (
                    <p key={source.id}><b>{source.field_name.replaceAll("_", " ")}</b><span>{source.source_type.replaceAll("_", " ")} · {formatDate(source.created_at)}</span></p>
                  ))}
                </div>
              </details>
            </section>
          </div>

          <section className="card person-card">
            <h2>Claude history</h2>
            <p>{commandJobs.length} command run{commandJobs.length === 1 ? "" : "s"} saved for this person.</p>
            {commandJobs.length > 0 ? (
              <div className="timeline-clean compact">
                {commandJobs.slice(0, 8).map((job) => (
                  <article key={job.id}>
                    <Clock3 aria-hidden="true" size={15} />
                    <div><h3>{job.status}</h3><p>{formatDateTime(job.updated_at)}</p></div>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

import Link from "next/link";
import { cookies } from "next/headers";
import { PendingSubmitButton } from "@/app/(portal)/pending-submit-button";
import { adminToolsCookieName, shouldUseAdminTools } from "@/lib/admin-mode";
import {
  contactDuplicateInputFromPayload,
  findDuplicateCandidates,
  recommendedExistingContact,
} from "@/lib/contact-duplicate-detection";
import {
  duplicateCandidates,
  formatInspectionValue,
  objectEntries,
  pendingChangeSupportedFieldNames,
  pendingChangeUnsupportedKeys,
  proposedFieldRows,
} from "@/lib/pending-change-inspection";
import {
  getReviewDetail,
  type PendingChangeDetail,
} from "@/lib/changes/data";
import {
  approveSelectedProfileFields,
  attachOwnerContextAnswer,
  approvePendingChange,
  correctProfileField,
  dismissProfileField,
  dismissPendingChange,
  mergeNewContactProposal,
  queueOwnerContextRevisionJob,
} from "../actions";
import { pendingChangeNeedsDetailedReview } from "@/lib/pending-change-risk";
import { reviewPosture } from "@/lib/pending-change-review";
import { getTenantContext } from "@/lib/tenant-context";
import {
  changeApprovalLabel,
  changeCardIdentity,
  changeRationale,
  changeRecommendationLines,
  recordingActionPresentation,
  type ChangeCardInput,
} from "@/lib/change-card-presentation";
import { isNewPersonChangeType } from "@/lib/pending-change-types";
import { isRetiredAlternateEmailChange } from "@/lib/pending-change-field-policy";
import { isGroupableProfileChange } from "@/lib/change-review-groups";
import { safeReturnPath } from "@/lib/server-action-redirect";

function payloadRecord(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function payloadString(payload: Record<string, unknown>, key: string, nestedKey: string) {
  const value = payloadRecord(payload, key)[nestedKey];
  return typeof value === "string" ? value : "";
}

function readableMeetingDate(value: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}

function cleanContactIdentity(currentContact: Record<string, unknown> | null) {
  return {
    full_name:
      typeof currentContact?.full_name === "string"
        ? currentContact.full_name
        : "New person",
    company_name:
      typeof currentContact?.company_name === "string"
        ? currentContact.company_name
        : null,
  };
}

function correctionDefaultValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function GroupedProfileReview({
  changes,
  currentContact,
  message,
  returnTo,
}: {
  changes: PendingChangeDetail[];
  currentContact: Record<string, unknown>;
  message?: string;
  returnTo: string;
}) {
  const identity = cleanContactIdentity(currentContact);
  const fieldRows = changes.flatMap((change) => {
    const rationale = changeRationale({
      ...change,
      contact: identity,
    } as ChangeCardInput);

    return proposedFieldRows({ before: currentContact, change })
      .filter((field) => field.supported)
      .map((field) => ({ change, field, rationale }));
  });
  const fieldCount = fieldRows.length;
  const reviewChangeIds = [...new Set(changes.map((change) => change.id))];
  const reviewFormId = "grouped-profile-review-form";

  return (
    <div className="grouped-profile-review">
      <div className="crumb">Changes</div>
      <h1 className="portal-title">{identity.full_name}</h1>
      <p className="lede">
        {fieldCount} proposed profile field{fieldCount === 1 ? "" : "s"}. Select what
        belongs in the Book. When you finish, anything unchecked is dismissed.
      </p>
      {message ? <div className="notice">{message}</div> : null}

      <div className="card profile-change-review-form">
        <div className="profile-change-review-head">
          <div>
            <h2>Profile review</h2>
            <p>Current information is shown first. The proposed value is underneath.</p>
          </div>
          <span>{fieldCount} fields</span>
        </div>

        <div className="profile-change-review-list">
          {fieldRows.map(({ change: proposedChange, field, rationale }) => {
            const fieldId = `profile-field-${proposedChange.id}-${field.key}`;
            const fieldsFromThisChange = fieldRows.filter(
              ({ change }) => change.id === proposedChange.id,
            ).length;
            const returnId = fieldsFromThisChange > 1
              ? proposedChange.id
              : changes.find(({ id }) => id !== proposedChange.id)?.id ?? "";

            return (
              <div className="profile-field-choice" key={`${proposedChange.id}:${field.key}`}>
                <input
                  defaultChecked
                  form={reviewFormId}
                  id={fieldId}
                  name="fields"
                  type="checkbox"
                  value={`${proposedChange.id}:${field.key}`}
                />
                <span className="profile-field-choice-copy">
                  <label className="profile-field-choice-label" htmlFor={fieldId}>
                    <span className="profile-field-name">
                      <b>{field.label}</b>
                      <small>
                        {proposedChange.risk_level === "high" ? "Needs judgment" : "Factual"}
                      </small>
                    </span>
                    <span className="profile-field-values">
                      <span>
                        <small>Current</small>
                        {formatInspectionValue(field.before)}
                      </span>
                      <span>
                        <small>Proposed</small>
                        {formatInspectionValue(field.value)}
                      </span>
                    </span>
                  </label>
                  <details className="focused-rationale">
                    <summary>Why this was proposed</summary>
                    <p>{rationale.summary}</p>
                    {rationale.source ? <span>Source: {rationale.source}</span> : null}
                    {rationale.confidence ? <span>Confidence: {rationale.confidence}</span> : null}
                  </details>
                  <details className="profile-field-correction">
                    <summary>Correct this</summary>
                    <form action={correctProfileField}>
                      <input
                        name="correction_field"
                        type="hidden"
                        value={`${proposedChange.id}:${field.key}:${returnId}`}
                      />
                      <input name="return_to" type="hidden" value={returnTo} />
                      <label className="field">
                        <span>Correct value</span>
                        <textarea
                          defaultValue={correctionDefaultValue(field.value)}
                          name="corrected_value"
                          required
                          rows={2}
                        />
                      </label>
                      <label className="field">
                        <span>What was wrong?</span>
                        <textarea
                          name="correction_reason"
                          placeholder="For example: He attended a webinar I hosted; this was not a one-to-one calendar meeting."
                          required
                          rows={2}
                        />
                      </label>
                      <PendingSubmitButton
                        className="button quiet small"
                        pendingLabel="Saving…"
                      >
                        Save correction
                      </PendingSubmitButton>
                    </form>
                  </details>
                </span>
                <form action={dismissProfileField} className="profile-field-dismiss-form">
                  <input
                    name="dismiss_field"
                    type="hidden"
                    value={`${proposedChange.id}:${field.key}:${returnId}`}
                  />
                  <input name="return_to" type="hidden" value={returnTo} />
                  <PendingSubmitButton
                    aria-label={`Dismiss ${field.label} recommendation`}
                    className="button quiet small profile-field-dismiss"
                    pendingLabel="Dismissing…"
                  >
                    Dismiss
                  </PendingSubmitButton>
                </form>
              </div>
            );
          })}
        </div>

        <form
          action={approveSelectedProfileFields}
          className="review-actions profile-change-review-actions"
          id={reviewFormId}
        >
          {reviewChangeIds.map((changeId) => (
            <input key={changeId} name="review_change_ids" type="hidden" value={changeId} />
          ))}
          <input name="return_to" type="hidden" value={returnTo} />
          <PendingSubmitButton
            aria-label="Apply selected fields and dismiss unchecked fields"
            className="button hot"
            pendingLabel="Applying…"
          >
            Apply selected and finish
          </PendingSubmitButton>
          <Link className="button ghost" href={returnTo}>Back</Link>
        </form>
      </div>
    </div>
  );
}

export default async function PendingChangeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const message = Array.isArray(query.message) ? query.message[0] : query.message;
  const requestedReturnTo = Array.isArray(query.return_to)
    ? query.return_to[0]
    : query.return_to;
  const returnTo = safeReturnPath(requestedReturnTo, "/changes?view=profile");
  const tenantContext = await getTenantContext();
  const cookieStore = await cookies();
  const adminMode = shouldUseAdminTools({
    cookieValue: cookieStore.get(adminToolsCookieName)?.value,
    role: tenantContext?.role,
  });
  const {
    change,
    relatedChanges,
    contacts,
    currentContact,
    provenance,
    audit,
    setupMode,
    loadError,
  } =
    await getReviewDetail(id);

  if (setupMode) {
    return (
      <>
        <div className="crumb">Changes</div>
        <h1 className="portal-title">Review change</h1>
        <div className="notice">Your private Book is still being prepared.</div>
      </>
    );
  }

  if (!change) {
    return (
      <>
        <div className="crumb">Changes</div>
        <h1 className="portal-title">Review change</h1>
        <div className="empty-state">
          <b>This change is no longer waiting.</b>
          <p>It may already be approved, dismissed, or returned for revision.</p>
        </div>
        <div className="actions">
          <Link className="button ghost" href={returnTo}>
            Back to changes
          </Link>
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <div className="crumb">Changes</div>
        <h1 className="portal-title">Review change</h1>
        <div className="notice" role="status">
          Existing people could not be checked. Nothing can be added or updated until
          the Book loads completely. Refresh this page and try again.
        </div>
        <div className="actions">
          <Link className="button ghost" href={`/changes/${change.id}`}>
            Refresh
          </Link>
          <Link className="button quiet" href={returnTo}>
            Back to changes
          </Link>
        </div>
      </>
    );
  }

  if (
    isGroupableProfileChange(change)
    && currentContact
    && relatedChanges.length > 0
  ) {
    return (
      <GroupedProfileReview
        changes={relatedChanges}
        currentContact={currentContact}
        message={message}
        returnTo={returnTo}
      />
    );
  }

  const presentation: ChangeCardInput = {
    ...change,
    contact: change.contact_id ? cleanContactIdentity(currentContact) : null,
  };
  const identity = changeCardIdentity(presentation);
  const recommendations = changeRecommendationLines(presentation);
  const rationale = changeRationale(presentation);
  const evidence = objectEntries(change.payload, "evidence");
  const ownerContext = objectEntries(change.payload, "owner_context");
  const ownerAnswer = payloadString(change.payload, "owner_context", "answer");
  const ownerContextStatus = payloadString(change.payload, "owner_context", "status");
  const claudeDuplicates = duplicateCandidates(change.payload);
  const appDuplicates =
    isNewPersonChangeType(change.change_type)
      ? findDuplicateCandidates(
          contactDuplicateInputFromPayload(change.payload),
          contacts,
          { minimumScore: 30, limit: 5 },
        )
      : [];
  const recommendedDuplicate = recommendedExistingContact(appDuplicates);
  const comparisonContact = recommendedDuplicate?.contact ?? currentContact;
  const fields = proposedFieldRows({ before: comparisonContact, change }).filter(
    (field) => !(recommendedDuplicate && field.key === "full_name"),
  );
  const needsDetailedReview = pendingChangeNeedsDetailedReview(change);
  const supportedFieldNames = pendingChangeSupportedFieldNames(change);
  const unsupportedKeys = pendingChangeUnsupportedKeys(change);
  const hasOnlyUnsupportedFields =
    supportedFieldNames.length === 0 && unsupportedKeys.length > 0;
  const posture = reviewPosture(change, {
    detailedReview: needsDetailedReview,
    duplicateCount: Math.max(claudeDuplicates.length, appDuplicates.length),
    supportedFieldCount: supportedFieldNames.length,
    unsupportedKeyCount: unsupportedKeys.length,
  });
  const isOperatorRecordingAction =
    change.source === "recording_operator" && change.change_type === "recording_action";
  const recordingAction = recordingActionPresentation(presentation);
  const hasRecommendedExistingPerson = Boolean(recommendedDuplicate);
  const retiredAlternateEmail = isRetiredAlternateEmailChange(change);
  const displayedRecommendations = recommendedDuplicate
    ? [`Update ${recommendedDuplicate.contact.full_name} with the new information below.`]
    : recommendations;

  return (
    <>
      <div className="crumb">Changes</div>
      <h1 className="portal-title">
        {recommendedDuplicate?.contact.full_name ?? identity.name}
      </h1>
      <p className="lede">
        {identity.company ? `${identity.company}. ` : ""}Review the recommendation
        before it changes your Book.
      </p>
      {message ? <div className="notice">{message}</div> : null}

      {retiredAlternateEmail ? (
        <section className="card retired-change-card" aria-labelledby="retired-change-title">
          <div>
            <span className="section-label">Old suggestion</span>
            <h2 id="retired-change-title">This email suggestion cannot update the Book</h2>
            <p>
              The Book stores one primary email. Alternate-email suggestions are no
              longer accepted, so there is no Update action for this item.
            </p>
          </div>
          <div className="review-actions">
            <form action={dismissPendingChange}>
              <input name="id" type="hidden" value={change.id} />
              <input name="return_to" type="hidden" value={returnTo} />
              <PendingSubmitButton className="button hot" pendingLabel="Removing…">
                Remove suggestion
              </PendingSubmitButton>
            </form>
            <Link className="button ghost" href={returnTo}>
              Back
            </Link>
          </div>
        </section>
      ) : null}

      {!retiredAlternateEmail && isNewPersonChangeType(change.change_type) ? (
        <section className="card identity-resolution-card">
          {recommendedDuplicate ? (
            <>
              <div className="identity-resolution-copy">
                <h2>We think this person is already in your Book</h2>
                <p>
                  Update <b>{recommendedDuplicate.contact.full_name}</b> with the new
                  information below.
                </p>
                <span>{recommendedDuplicate.reasons.join(" · ")}</span>
              </div>
              <form action={mergeNewContactProposal} className="identity-resolution-primary">
                <input name="id" type="hidden" value={change.id} />
                <input name="return_to" type="hidden" value={returnTo} />
                <input name="review_scope" type="hidden" value="detailed" />
                <input
                  name="target_contact_id"
                  type="hidden"
                  value={recommendedDuplicate.contact.id}
                />
                <PendingSubmitButton className="button hot" pendingLabel="Updating…">
                  Update {recommendedDuplicate.contact.full_name}
                </PendingSubmitButton>
              </form>
              <details className="identity-resolution-alternative">
                <summary>This is a different person</summary>
                <p>
                  Add a separate record only when the matching identity belongs to
                  someone else.
                </p>
                <form action={approvePendingChange}>
                  <input name="id" type="hidden" value={change.id} />
                  <input name="return_to" type="hidden" value={returnTo} />
                  <input name="review_scope" type="hidden" value="detailed" />
                  <input name="identity_resolution" type="hidden" value="create_separate" />
                  <PendingSubmitButton className="button quiet" pendingLabel="Adding…">
                    Add as a different person
                  </PendingSubmitButton>
                </form>
              </details>
            </>
          ) : appDuplicates.length > 0 ? (
            <>
              <div className="identity-resolution-copy">
                <h2>This may be someone already in your Book</h2>
                <p>Choose the existing person to update, or add a separate record.</p>
              </div>
              <form action={mergeNewContactProposal} className="identity-resolution-form">
                <input name="id" type="hidden" value={change.id} />
                <input name="return_to" type="hidden" value={returnTo} />
                <input name="review_scope" type="hidden" value="detailed" />
                <fieldset>
                  <legend>Possible matches</legend>
                  {appDuplicates.map((match) => (
                    <label className="identity-match-option" key={match.contact.id}>
                      <input
                        name="target_contact_id"
                        required
                        type="radio"
                        value={match.contact.id}
                      />
                      <span>
                        <b>{match.contact.full_name}</b>
                        <small>
                          {[match.contact.company_name, ...match.reasons]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <PendingSubmitButton className="button hot" pendingLabel="Updating…">
                  Update selected person
                </PendingSubmitButton>
              </form>
              <details className="identity-resolution-alternative">
                <summary>This is a different person</summary>
                <form action={approvePendingChange}>
                  <input name="id" type="hidden" value={change.id} />
                  <input name="return_to" type="hidden" value={returnTo} />
                  <input name="review_scope" type="hidden" value="detailed" />
                  <input name="identity_resolution" type="hidden" value="create_separate" />
                  <PendingSubmitButton className="button quiet" pendingLabel="Adding…">
                    Add as a new person
                  </PendingSubmitButton>
                </form>
              </details>
            </>
          ) : (
            <>
              <div className="identity-resolution-copy">
                <h2>New person</h2>
                <p>No existing person was found in your Book.</p>
              </div>
              <form action={approvePendingChange} className="identity-resolution-primary">
                <input name="id" type="hidden" value={change.id} />
                <input name="return_to" type="hidden" value={returnTo} />
                <input name="review_scope" type="hidden" value="detailed" />
                <PendingSubmitButton className="button hot" pendingLabel="Adding…">
                  Add to Book
                </PendingSubmitButton>
              </form>
            </>
          )}
        </section>
      ) : null}

      {!retiredAlternateEmail ? <section className="card focused-change-review">
        <h2>Recommended change</h2>
        {displayedRecommendations.length === 1 ? (
          <p className="change-recommendation">{displayedRecommendations[0]}</p>
        ) : (
          <ul className="change-recommendation-list">
            {displayedRecommendations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        {fields.length > 0 ? (
          <div className="focused-field-list">
            {fields.map((field) => (
              <div className="focused-field" key={field.key}>
                <span>{field.label}</span>
                <div>
                  {formatInspectionValue(field.before) ===
                  formatInspectionValue(field.value) ? (
                    <span className="focused-field-status">Already stored</span>
                  ) : (
                    <p>{formatInspectionValue(field.before)}</p>
                  )}
                  <b>{formatInspectionValue(field.value)}</b>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {recordingAction ? (
          <p className="change-source-line">
            From {[recordingAction.meetingTitle, readableMeetingDate(recordingAction.meetingOccurredAt)]
              .filter(Boolean)
              .join(" · ") || "meeting notes"}
          </p>
        ) : null}

        <details className="focused-rationale">
          <summary>Evidence for this update</summary>
          <p>{rationale.summary}</p>
          {rationale.source ? <span>Source: {rationale.source}</span> : null}
          {rationale.confidence ? <span>Confidence: {rationale.confidence}</span> : null}
        </details>

        <div className="review-actions">
          {(posture.canApprove || isOperatorRecordingAction) &&
          !hasRecommendedExistingPerson &&
          !isNewPersonChangeType(change.change_type) ? (
            <form action={approvePendingChange}>
              <input name="id" type="hidden" value={change.id} />
              <input name="return_to" type="hidden" value={returnTo} />
              <input name="review_scope" type="hidden" value="detailed" />
              <input name="approval_surface" type="hidden" value="owner_change_detail" />
              <PendingSubmitButton className="button hot" pendingLabel="Approving…">
                {changeApprovalLabel(presentation)}
              </PendingSubmitButton>
            </form>
          ) : !isNewPersonChangeType(change.change_type) ? (
            <span className="muted">
              {hasOnlyUnsupportedFields
                ? "This legacy field cannot be written safely. Decline it or save a correction below."
                : "Add the missing context before approval."}
            </span>
          ) : null}
          <form action={dismissPendingChange}>
            <input name="id" type="hidden" value={change.id} />
            <input name="return_to" type="hidden" value={returnTo} />
            <PendingSubmitButton className="button quiet" pendingLabel="Dismissing…">
              {isNewPersonChangeType(change.change_type) ||
              change.change_type === "want_to_know_candidate"
                ? "Not now"
                : "Dismiss"}
            </PendingSubmitButton>
          </form>
          <Link className="button ghost" href={returnTo}>
            Back
          </Link>
        </div>
      </section> : null}

      {!retiredAlternateEmail ? <form action={attachOwnerContextAnswer} className="card focused-change-edit">
        <h2>Change the recommendation</h2>
        <p className="muted">
          Tell your concierge team what is wrong or missing. Your note is saved as owner context;
          it does not update the Book by itself.
        </p>
        <input name="id" type="hidden" value={change.id} />
        <label className="field">
          <span>What should change?</span>
          <textarea
            defaultValue={ownerAnswer}
            name="owner_answer"
            placeholder="For example: He is a peer, not a referral partner. We are close friends from my men's mastermind."
            rows={4}
          />
        </label>
        <div className="actions">
          <button className="button primary small" type="submit">
            Save correction
          </button>
          {ownerAnswer && ownerContextStatus === "answered" ? (
            <button
              className="button hot small"
              formAction={queueOwnerContextRevisionJob}
              type="submit"
            >
              Request revised change
            </button>
          ) : null}
        </div>
      </form> : null}

      {adminMode ? (
        <details className="card operator-evidence">
          <summary>Administrative record</summary>
          <div className="grid two">
            <div>
              <h3>Evidence</h3>
              {evidence.length > 0 ? (
                evidence.map(([key, value]) => (
                  <div className="kv" key={key}>
                    <span className="k">{key.replaceAll("_", " ")}</span>
                    <span>{formatInspectionValue(value)}</span>
                  </div>
                ))
              ) : (
                <p className="muted">No structured evidence.</p>
              )}
            </div>
            <div>
              <h3>Owner context</h3>
              {ownerContext.length > 0 ? (
                ownerContext.map(([key, value]) => (
                  <div className="kv" key={key}>
                    <span className="k">{key.replaceAll("_", " ")}</span>
                    <span>{formatInspectionValue(value)}</span>
                  </div>
                ))
              ) : (
                <p className="muted">No owner context attached.</p>
              )}
            </div>
          </div>
          <p className="source-note">
            {audit.length} audit record{audit.length === 1 ? "" : "s"} and {provenance.length}{" "}
            field-source record{provenance.length === 1 ? "" : "s"} are linked.
          </p>
        </details>
      ) : null}
    </>
  );
}

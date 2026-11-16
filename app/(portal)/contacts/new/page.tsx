import { ArrowLeft, Search } from "lucide-react";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import {
  createContactFromIntake,
  enrichContactFromIntake,
} from "@/app/(portal)/contacts/new/actions";
import {
  blankContact,
  getContactIntakeData,
  type EditableContact,
} from "@/lib/contacts/intake-data";
import { scoreContactQuality } from "@/lib/data-quality";
import { requireOperatorAccess } from "@/lib/operator-access";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanQuery(value: string | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, 90);
}

function arrayValue(values: string[] | null) {
  return values?.join(", ") ?? "";
}

function selectDefault(value: string | null) {
  return value ?? "";
}

function ContextPreview({ contact }: { contact: EditableContact | null }) {
  if (!contact) return null;

  return (
    <div className="notice">
      Enriching <b>{contact.full_name}</b>
      {contact.company_name ? ` · ${contact.company_name}` : ""}. Blank fields below
      are ignored so existing context is not wiped out.
    </div>
  );
}

function QualityPreview({ contact }: { contact: EditableContact | null }) {
  if (!contact) return null;

  const quality = scoreContactQuality(contact);

  return (
    <div className="card">
      <h2>Quality gaps</h2>
      <div className="kv">
        <span className="k">Readiness</span>
        <span
          className={
            quality.readiness < 60
              ? "pill warn"
              : quality.readiness < 80
                ? "pill gold"
                : "pill cool"
          }
        >
          {quality.readiness}% ready
        </span>
      </div>
      <div className="kv">
        <span className="k">Missing</span>
        <span>
          {quality.missing.length > 0
            ? quality.missing.slice(0, 6).join(", ")
            : "Nothing critical"}
        </span>
      </div>
      <div className="kv">
        <span className="k">Next</span>
        <span>{quality.nextStep}</span>
      </div>
      <p className="source-note">
        Use the fields below only for verified facts. Your concierge team handles deeper
        enrichment and route judgment changes through review.
      </p>
    </div>
  );
}

function ContactIntakeFields({
  contact,
  mode,
}: {
  contact: EditableContact;
  mode: "create" | "enrich";
}) {
  const required = mode === "create";
  const inputValue = (value: string | null) => (mode === "create" ? value ?? "" : "");
  const listValue = (value: string[] | null) =>
    mode === "create" ? arrayValue(value) : "";
  const selectedValue = (value: string | null) =>
    mode === "create" ? selectDefault(value) : "";

  return (
    <>
      <div className="section-label">Identity</div>
      <div className="form-grid three">
        <label className="field">
          <span>Full name</span>
          <input
            defaultValue={inputValue(contact.full_name)}
            name="full_name"
            placeholder={mode === "enrich" ? `Current: ${contact.full_name}` : undefined}
            required={required}
          />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            defaultValue={inputValue(contact.email)}
            name="email"
            placeholder={contact.email ?? undefined}
            type="email"
          />
        </label>
        <label className="field">
          <span>Phone</span>
          <input
            defaultValue={inputValue(contact.phone)}
            name="phone"
            placeholder={contact.phone ?? undefined}
          />
        </label>
      </div>

      <div className="form-grid two-fields">
        <label className="field">
          <span>Company</span>
          <input
            defaultValue={inputValue(contact.company_name)}
            name="company_name"
            placeholder={contact.company_name ?? undefined}
          />
        </label>
        <label className="field">
          <span>Role title</span>
          <input
            defaultValue={listValue(contact.role_title)}
            name="role_title"
            placeholder={arrayValue(contact.role_title) || "Founder, investor, operator"}
          />
        </label>
      </div>

      <label className="field">
        <span>One-line summary</span>
        <textarea
          defaultValue={inputValue(contact.one_line_summary)}
          name="one_line_summary"
          placeholder={contact.one_line_summary ?? undefined}
        />
      </label>

      <div className="form-grid three">
        <label className="field">
          <span>LinkedIn</span>
          <input
            defaultValue={inputValue(contact.linkedin)}
            name="linkedin"
            placeholder={contact.linkedin ?? undefined}
          />
        </label>
        <label className="field">
          <span>Website</span>
          <input
            defaultValue={inputValue(contact.website)}
            name="website"
            placeholder={contact.website ?? undefined}
          />
        </label>
        <label className="field">
          <span>Location</span>
          <input
            defaultValue={listValue(contact.location)}
            name="location"
            placeholder={arrayValue(contact.location)}
          />
        </label>
      </div>

      <div className="section-label">Relationship</div>
      <div className="form-grid three">
        <label className="field">
          <span>Trust tier</span>
          <select defaultValue={selectedValue(contact.trust_level)} name="trust_level">
            <option value="">Leave unset</option>
            <option>Tier 1 - Deep Trust</option>
            <option>Tier 2 - Working Trust</option>
            <option>Tier 3 - Acquaintance</option>
          </select>
        </label>
        <label className="field">
          <span>Touch cadence</span>
          <select defaultValue={selectedValue(contact.touch_cadence)} name="touch_cadence">
            <option value="">Leave unset</option>
            <option>Monthly</option>
            <option>Quarterly</option>
            <option>Biannual</option>
            <option>Annual</option>
            <option>Ad hoc</option>
          </select>
        </label>
        <label className="field">
          <span>Strength override</span>
          <select
            defaultValue={selectedValue(contact.relationship_strength)}
            name="relationship_strength"
          >
            <option value="">Let system compute</option>
            <option>Hot</option>
            <option>Warm</option>
            <option>Cooling</option>
            <option>Cold</option>
            <option>Unknown</option>
          </select>
        </label>
      </div>

      <div className="form-grid three">
        <label className="field">
          <span>Relationship type</span>
          <input
            defaultValue={listValue(contact.relationship_type)}
            name="relationship_type"
            placeholder={arrayValue(contact.relationship_type) || "Investor, referral partner"}
          />
        </label>
        <label className="field">
          <span>Last spoke</span>
          <input defaultValue={inputValue(contact.last_spoke)} name="last_spoke" type="date" />
        </label>
        <label className="field">
          <span>Met date</span>
          <input defaultValue={inputValue(contact.met_date)} name="met_date" type="date" />
        </label>
      </div>

      <label className="field">
        <span>How we met</span>
        <textarea
          defaultValue={inputValue(contact.how_we_met)}
          name="how_we_met"
          placeholder={contact.how_we_met ?? undefined}
        />
      </label>
      <label className="field">
        <span>Why stay in touch</span>
        <textarea
          defaultValue={inputValue(contact.why_stay_in_touch)}
          name="why_stay_in_touch"
          placeholder={contact.why_stay_in_touch ?? undefined}
        />
      </label>
      <label className="field">
        <span>Strength reason</span>
        <textarea
          defaultValue={inputValue(contact.relationship_strength_reason)}
          name="relationship_strength_reason"
          placeholder={contact.relationship_strength_reason ?? undefined}
        />
      </label>

      <div className="section-label">Usefulness</div>
      <div className="form-grid two-fields">
        <label className="field">
          <span>Current asks</span>
          <textarea
            defaultValue={inputValue(contact.current_asks)}
            name="current_asks"
            placeholder={contact.current_asks ?? undefined}
          />
        </label>
        <label className="field">
          <span>Wants help with</span>
          <textarea
            defaultValue={inputValue(contact.wants_help_with)}
            name="wants_help_with"
            placeholder={contact.wants_help_with ?? undefined}
          />
        </label>
      </div>
      <div className="form-grid two-fields">
        <label className="field">
          <span>Ideal referral</span>
          <textarea
            defaultValue={inputValue(contact.ideal_referral)}
            name="ideal_referral"
            placeholder={contact.ideal_referral ?? undefined}
          />
        </label>
        <label className="field">
          <span>Do not refer for</span>
          <textarea
            defaultValue={inputValue(contact.do_not_refer_for)}
            name="do_not_refer_for"
            placeholder={contact.do_not_refer_for ?? undefined}
          />
        </label>
      </div>
      <div className="form-grid two-fields">
        <label className="field">
          <span>Services offered</span>
          <input
            defaultValue={listValue(contact.services_offered)}
            name="services_offered"
            placeholder={arrayValue(contact.services_offered)}
          />
        </label>
        <label className="field">
          <span>Could refer me for</span>
          <input
            defaultValue={listValue(contact.could_refer_me_for)}
            name="could_refer_me_for"
            placeholder={arrayValue(contact.could_refer_me_for)}
          />
        </label>
      </div>
      <label className="field">
        <span>Podcast fit</span>
        <textarea
          defaultValue={inputValue(contact.podcast_fit)}
          name="podcast_fit"
          placeholder={contact.podcast_fit ?? undefined}
        />
      </label>
      <label className="field">
        <span>Referral intro blurb</span>
        <textarea
          defaultValue={inputValue(contact.referral_intro_blurb)}
          name="referral_intro_blurb"
          placeholder={contact.referral_intro_blurb ?? undefined}
        />
      </label>

      <div className="section-label">Tags and notes</div>
      <div className="form-grid three">
        <label className="field">
          <span>Primary categories</span>
          <input
            defaultValue={listValue(contact.primary_category)}
            name="primary_category"
            placeholder={arrayValue(contact.primary_category)}
          />
        </label>
        <label className="field">
          <span>Top tags</span>
          <input
            defaultValue={listValue(contact.top_3_tags)}
            name="top_3_tags"
            placeholder={arrayValue(contact.top_3_tags)}
          />
        </label>
        <label className="field">
          <span>Keywords</span>
          <input
            defaultValue={listValue(contact.keywords)}
            name="keywords"
            placeholder={arrayValue(contact.keywords)}
          />
        </label>
      </div>
      <label className="field">
        <span>Recent activity</span>
        <textarea
          defaultValue={inputValue(contact.recent_activity)}
          name="recent_activity"
          placeholder={contact.recent_activity ?? undefined}
        />
      </label>
      <label className="field">
        <span>Private notes</span>
        <textarea
          defaultValue={inputValue(contact.private_notes)}
          name="private_notes"
          placeholder={contact.private_notes ?? undefined}
        />
      </label>
      <label className="field">
        <span>Personal notes</span>
        <textarea
          defaultValue={inputValue(contact.personal_notes)}
          name="personal_notes"
          placeholder={contact.personal_notes ?? undefined}
        />
      </label>
    </>
  );
}

export default async function NewContactPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  await requireOperatorAccess();

  const params = searchParams ? await searchParams : {};
  const q = cleanQuery(firstParam(params.q));
  const contactId = firstParam(params.contact_id);
  const message = firstParam(params.message);
  const { candidates, selected, setupMode, error } = await getContactIntakeData(q, contactId);
  const formContact = selected ?? blankContact;
  const mode = selected ? "enrich" : "create";

  return (
    <>
      <div className="topbar">
        <div>
          <div className="crumb">My Book / Intake</div>
          <h1 className="portal-title">Add or Enrich Person</h1>
          <p className="lede">
            Your concierge team can create most people from calls, transcripts, and trusted
            source notes. Use this only for a seed record, duplicate check, or a
            small correction that still needs enrichment.
          </p>
        </div>
        <Link className="button ghost" href="/contacts">
          <ArrowLeft aria-hidden="true" size={15} />
          My Book
        </Link>
      </div>

      {message ? <div className="notice">{message}</div> : null}
      {setupMode ? (
        <div className="notice">Setup mode is waiting for the private database.</div>
      ) : null}
      {error ? <div className="notice">{error}</div> : null}

      <div className="grid two">
        <section>
          <div className="section-label">Duplicate check</div>
          <form action="/contacts/new" className="card settings-form">
            <label className="field">
              <span>Search existing book</span>
              <input
                autoComplete="off"
                defaultValue={q}
                name="q"
                placeholder="Name, company, or email"
                type="search"
              />
            </label>
            <button className="button hot" type="submit">
              <Search aria-hidden="true" size={15} />
              Check
            </button>
          </form>
        </section>

        <section>
          <div className="section-label">Verification gate</div>
          <div className="card">
            <p className="muted">
              Start with the lightest trusted version of the record. A new person
              only needs a name and source context; an existing person only needs
              the fields you are intentionally correcting.
            </p>
            <p className="source-note">
              Saving here creates a research request. Findings should be verified
              with the user and send judgment updates through Changes.
            </p>
          </div>
        </section>
      </div>

      {q ? (
        <>
          <div className="section-label">
            Possible matches · {candidates.length}
          </div>
          {candidates.length > 0 ? (
            <div className="grid two">
              {candidates.map((candidate) => (
                <article className="card" key={candidate.id}>
                  <div className="mini-item-head">
                    <h2>{candidate.full_name}</h2>
                    {candidate.duplicate_confidence ? (
                      <span className="pill cool">
                        {candidate.duplicate_confidence} match
                      </span>
                    ) : null}
                  </div>
                  <p className="muted">
                    {candidate.role_title?.join(", ") ?? "No role stored"} ·{" "}
                    {candidate.company_name ?? "No company stored"}
                  </p>
                  {candidate.duplicate_reasons?.length ? (
                    <p className="source-note">
                      {candidate.duplicate_reasons.join(" · ")}
                      {candidate.duplicate_score ? ` · Score ${candidate.duplicate_score}` : ""}
                    </p>
                  ) : null}
                  <div className="kv">
                    <span className="k">Relationship</span>
                    <span>{candidate.relationship_type?.join(" · ") ?? "Unset"}</span>
                  </div>
                  <div className="kv">
                    <span className="k">Summary</span>
                    <span>{candidate.one_line_summary ?? "No summary stored."}</span>
                  </div>
                  <div className="actions">
                    <Link className="button ghost" href={`/contacts/${candidate.id}`}>
                      Open
                    </Link>
                    <Link
                      className="button ghost"
                      href={`/contacts/new?contact_id=${candidate.id}`}
                    >
                      Enrich
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              No obvious match. If you have checked spelling and company aliases,
              this can be saved as a new person.
            </div>
          )}
        </>
      ) : null}

      <ContextPreview contact={selected} />
      <QualityPreview contact={selected} />

      <form
        action={mode === "create" ? createContactFromIntake : enrichContactFromIntake}
        className="card settings-form"
      >
        {mode === "create" ? (
          <input name="creation_request_id" type="hidden" value={randomUUID()} />
        ) : null}
        {selected ? <input name="contact_id" type="hidden" value={selected.id} /> : null}
        <div className="notice">
          Keep this sparse. Blank fields are fine; research and user
          verification are queued after save.
        </div>
        <ContactIntakeFields contact={formContact} mode={mode} />

        <div className="section-label">Source and save</div>
        <div className="notice">
          Manual saves are seed data. Research and user verification will
          be queued automatically after this is saved.
        </div>
        <label className="field">
          <span>Source notes</span>
          <textarea
            name="source_notes"
            placeholder="Transcript, email summary, interview note, or reason this update is trusted."
          />
        </label>
        <label className="toggle-row compact">
          <input name="duplicate_reviewed" type="checkbox" />
          <span>
            <b>I checked for existing matches</b>
            <small>
              This keeps the book curated and avoids duplicate relationship records.
            </small>
          </span>
        </label>
        <div className="actions">
          <button className="button hot" type="submit">
            {mode === "create" ? "Add seed + queue enrichment" : "Save + queue enrichment"}
          </button>
          {selected ? (
            <Link className="button ghost" href="/contacts/new">
              Start new person
            </Link>
          ) : null}
        </div>
      </form>
    </>
  );
}

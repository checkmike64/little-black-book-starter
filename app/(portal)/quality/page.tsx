import { ClipboardList, Search } from "lucide-react";
import Link from "next/link";
import {
  qualityStats,
  scoreContactQuality,
  type ContactQuality,
  type QualityContact,
} from "@/lib/data-quality";
import { requireOperatorAccess } from "@/lib/operator-access";
import {
  getQualityContacts,
  type ActiveQualityJob,
} from "@/lib/quality/data";
import { QualityCleanupQueueButton } from "./quality-cleanup-queue-button";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type QualityView =
  | "priority"
  | "high_value"
  | "weak"
  | "judgment"
  | "use_case"
  | "podcast"
  | "all";

const views: Array<{ label: string; value: QualityView }> = [
  { label: "Priority", value: "priority" },
  { label: "High value gaps", value: "high_value" },
  { label: "Weak records", value: "weak" },
  { label: "Judgment gaps", value: "judgment" },
  { label: "Use case gaps", value: "use_case" },
  { label: "Podcast gaps", value: "podcast" },
  { label: "All", value: "all" },
];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function validView(value: string | undefined): QualityView {
  return views.some((view) => view.value === value) ? (value as QualityView) : "priority";
}

function searchText(contact: ContactQuality) {
  return [
    contact.full_name,
    contact.company_name,
    contact.role_title?.join(" "),
    contact.one_line_summary,
    contact.trust_level,
    contact.relationship_strength,
    contact.relationship_type?.join(" "),
    contact.current_asks,
    contact.wants_help_with,
    contact.ideal_referral,
    contact.podcast_fit,
    contact.recent_activity,
    contact.private_notes,
    contact.missing.join(" "),
    contact.strengths.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isHighValue(contact: ContactQuality) {
  return /tier 1|tier 2|trusted|hot|warm|strong|investor|advisor|referral|partner|m&a|deal/i.test(
    [
      contact.trust_level,
      contact.relationship_strength,
      contact.relationship_type?.join(" "),
      contact.current_asks,
      contact.ideal_referral,
      contact.podcast_fit,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function matchesView(contact: ContactQuality, view: QualityView) {
  if (view === "all") return true;
  if (view === "high_value") return isHighValue(contact) && contact.readiness < 80;
  if (view === "weak") return contact.readiness < 60;
  if (view === "judgment") {
    return (
      contact.missing.includes("trust tier") ||
      contact.missing.includes("relationship strength")
    );
  }
  if (view === "use_case") {
    return contact.missing.includes("ask, help lane, referral lane, or podcast fit");
  }
  if (view === "podcast") {
    return (
      contact.missing.includes("current podcast or publishing signal") ||
      (contact.strengths.includes("Current publishing signal") &&
        contact.readiness < 80)
    );
  }
  return contact.readiness < 80 || (isHighValue(contact) && contact.missing.length > 0);
}

function filteredContacts({
  contacts,
  query,
  view,
}: {
  contacts: ContactQuality[];
  query: string;
  view: QualityView;
}) {
  const normalizedQuery = query.trim().toLowerCase();

  return contacts
    .filter((contact) => matchesView(contact, view))
    .filter((contact) => !normalizedQuery || searchText(contact).includes(normalizedQuery))
    .sort((a, b) => {
      const highValueDelta = Number(isHighValue(b)) - Number(isHighValue(a));
      if (highValueDelta !== 0) return highValueDelta;
      return a.readiness - b.readiness || a.full_name.localeCompare(b.full_name);
    });
}

function readinessClass(readiness: number) {
  if (readiness < 60) return "pill warn";
  if (readiness < 80) return "pill gold";
  return "pill cool";
}

function missingCounts(contacts: ContactQuality[]) {
  const counts = new Map<string, number>();

  contacts.forEach((contact) => {
    contact.missing.forEach((item) => counts.set(item, (counts.get(item) ?? 0) + 1));
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8);
}

function buildAuditPrompt(contacts: ContactQuality[]) {
  const weak = contacts
    .filter((contact) => contact.readiness < 80)
    .slice(0, 12);

  return [
    "Run a Little Black Book data-quality audit for operator review.",
    "",
    "Book membership rule: every record below is an existing relationship the owner knows. Missing context creates enrichment work; it never moves a person into Want to Know or removes them from the Book.",
    "",
    "Goal: identify the smallest set of source-backed enrichments or owner-verification questions needed before this client install is trusted for referrals, outreach, and relationship decisions.",
    "",
    "Weak or incomplete records:",
    ...(weak.length
      ? weak.map((contact, index) => {
          return `${index + 1}. ${contact.full_name}${
            contact.company_name ? `, ${contact.company_name}` : ""
          } - ${contact.readiness}% ready; missing ${contact.missing.join(
            ", ",
          )}; next step: ${contact.nextStep}`;
        })
      : ["No weak records are visible."]),
    "",
    "Return:",
    "- records that need owner judgment",
    "- records that can be enriched from source material",
    "- records that should not be used for referrals yet",
    "- exact pending changes to propose when judgment fields need updates",
    "",
    "Do not fabricate missing history. If source evidence is thin, ask one precise owner question.",
  ].join("\n");
}

function activeJobMap(jobs: ActiveQualityJob[]) {
  const map = new Map<string, ActiveQualityJob>();

  jobs.forEach((job) => {
    const contactId = job.payload.contact_id;
    if (typeof contactId === "string" && !map.has(contactId)) {
      map.set(contactId, job);
    }
  });

  return map;
}

export default async function QualityPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const context = await requireOperatorAccess();

  const params = searchParams ? await searchParams : {};
  const view = validView(firstParam(params.view));
  const query = firstParam(params.q) ?? "";
  const message = firstParam(params.message);
  const { activeJobs, contacts, count, setupMode } = await getQualityContacts(
    context?.tenantId,
  );
  const scored = contacts.map((contact) =>
    "readiness" in contact ? contact : scoreContactQuality(contact as QualityContact),
  );
  const stats = qualityStats(scored as QualityContact[]);
  const visibleContacts = filteredContacts({
    contacts: stats.scored,
    query,
    view,
  });
  const missing = missingCounts(stats.scored);
  const prompt = buildAuditPrompt(stats.scored);
  const jobsByContact = activeJobMap(activeJobs);
  const batchContacts = visibleContacts
    .filter((contact) => !jobsByContact.has(contact.id))
    .slice(0, 10);

  return (
    <>
      <div className="crumb">Operator Quality</div>
      <h1 className="portal-title">Data Quality</h1>
      <p className="lede">
        A private operator workspace for enriching known relationships before a
        client relies on the Book for referrals, outreach, or relationship
        judgment.
      </p>

      <div className="notice">
        Book membership is authoritative. Incomplete records stay in My Book and
        enter this enrichment queue; only owner-approved future prospects belong
        in Want to Know.
      </div>

      {setupMode ? (
        <div className="notice">
          Setup mode is showing sample records until the private database is
          connected.
        </div>
      ) : null}

      {message ? <div className="notice">{message}</div> : null}

      <section className="statband" aria-label="Data quality stats">
        <div className="stat">
          <div className="number">{stats.average}%</div>
          <div className="label">Average readiness</div>
        </div>
        <div className="stat">
          <div className="number">{stats.ready}</div>
          <div className="label">Ready records</div>
        </div>
        <div className="stat">
          <div className="number">{stats.weak}</div>
          <div className="label">Weak records</div>
        </div>
        <div className="stat">
          <div className="number">{stats.highValueWeak}</div>
          <div className="label">High-value gaps</div>
        </div>
        <div className="stat">
          <div className="number">{count}</div>
          <div className="label">Contacts audited</div>
        </div>
      </section>

      <form className="ask-bar" action="/quality">
        <label className="field">
          <span>View</span>
          <select defaultValue={view} name="view">
            {views.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Search</span>
          <input
            defaultValue={query}
            name="q"
            placeholder="Name, company, missing field, category"
          />
        </label>
        <button className="button hot" type="submit">
          <Search aria-hidden={true} size={15} /> Filter
        </button>
      </form>

      <div className="grid two">
        <section>
          <div className="section-label">Common missing fields</div>
          <div className="card">
            {missing.length > 0 ? (
              <ul className="security-list">
                {missing.map(([label, value]) => (
                  <li key={label}>
                    <span>{label}</span>
                    <span className="status-neutral">{value}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-state">
                <b>No missing fields found.</b>
                <p>All audited records have the expected operating context.</p>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="section-label">Operator triage</div>
          <div className="card">
            <div className="mini-list">
              <div className="mini-item dense">
                <b>Preserve Book membership</b>
                <span>
                  Sparse context does not make someone a prospect. Every record
                  here remains a known relationship while enrichment fills the
                  useful gaps.
                </span>
              </div>
              <div className="mini-item dense">
                <b>Owner judgment first</b>
                <span>
                  Trust tier, relationship strength, referral safety, and
                  private notes should stay review-gated.
                </span>
              </div>
              <div className="mini-item dense">
                <b>Source-backed enrichment second</b>
                <span>
                  Company, role, origin story, useful lanes, and recent activity
                  can come from transcripts and correspondence summaries.
                </span>
              </div>
              <div className="mini-item dense">
                <b>Do not overfill</b>
                <span>
                  Empty fields are better than invented context. Weak records
                  should be marked as weak until source material supports them.
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="section-label">Records to clean · {visibleContacts.length}</div>
      <div className="card">
        {batchContacts.length > 0 ? (
          <div className="actions">
            <QualityCleanupQueueButton
              contactIds={batchContacts.map((contact) => contact.id)}
              label={`Queue top ${batchContacts.length} cleanup jobs`}
              note="Uses existing Claude enrichment jobs and keeps all judgment changes in review."
            />
          </div>
        ) : null}
        {visibleContacts.length > 0 ? (
          <div className="mini-list">
            {visibleContacts.map((contact) => (
              <QualityContactCard
                activeJob={jobsByContact.get(contact.id)}
                contact={contact}
                key={contact.id}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <b>No records match this quality view.</b>
            <p>Try a broader view or clear the search filter.</p>
          </div>
        )}
      </div>

      <div className="section-label">Claude audit packet</div>
      <section className="ask-brief" aria-label="Data quality Claude audit packet">
        <label className="field">
          <span>
            <ClipboardList aria-hidden={true} size={14} /> Cleanup prompt
          </span>
          <textarea readOnly value={prompt} />
        </label>
        <p className="source-note">
          This packet is for operator-led cleanup. The executive does not need
          to see onboarding intake; they should see a useful Book after you
          resolve or intentionally leave these gaps.
        </p>
      </section>
    </>
  );
}

function QualityContactCard({
  activeJob,
  contact,
}: {
  activeJob?: ActiveQualityJob;
  contact: ContactQuality;
}) {
  return (
    <div className="mini-item dense">
      <div className="mini-item-head">
        <b>{contact.full_name}</b>
        <span>
          <span className={readinessClass(contact.readiness)}>
            {contact.readiness}% ready
          </span>
          {isHighValue(contact) ? <span className="pill hot">High value</span> : null}
          {activeJob ? <span className="pill cool">{activeJob.status}</span> : null}
        </span>
      </div>
      <span>
        {contact.company_name ?? contact.role_title?.join(", ") ?? "No company stored"}
      </span>
      <span>
        Missing:{" "}
        {contact.missing.length > 0
          ? contact.missing.slice(0, 5).join(", ")
          : "Nothing critical"}
      </span>
      <span>{contact.nextStep}</span>
      <div className="actions">
        <Link className="button small hot" href={`/contacts/${contact.id}`}>
          Open profile
        </Link>
        <Link
          className="button small ghost"
          href={`/contacts/new?contact_id=${contact.id}`}
        >
          Enrich
        </Link>
        <Link
          className="button small ghost"
          href={`/ask?mode=search&q=${encodeURIComponent(
            `${contact.full_name} ${contact.missing.join(" ")}`,
          )}`}
        >
          Ask
        </Link>
        {activeJob ? (
          <Link className="button small ghost" href={`/ops/jobs/${activeJob.id}`}>
            Job {activeJob.id.slice(0, 8)}
          </Link>
        ) : (
          <QualityCleanupQueueButton
            className="button small ghost"
            contactIds={[contact.id]}
            label="Queue Claude cleanup"
          />
        )}
      </div>
    </div>
  );
}

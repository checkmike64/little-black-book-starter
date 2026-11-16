import Link from "next/link";

export default function PrivacyPage() {
  return (
    <>
      <div className="crumb">Privacy &amp; data</div>
      <h1 className="portal-title">Your relationship data</h1>
      <p className="lede">
        A plain-language view of what enters this Book, who can review it, and
        how to request a copy or removal.
      </p>

      <div className="grid two privacy-data-grid">
        <section className="card">
          <h2>What is stored</h2>
          <p>
            Contact details, relationship notes, meetings, reviewed
            correspondence summaries, explicit promises, social signals, and
            the evidence used for recommendations.
          </p>
        </section>
        <section className="card">
          <h2>Who can see it</h2>
          <p>
            You and the authorized service team assigned to configure and
            maintain this private Book. Tenant boundaries are enforced in the
            database and operator activity is audited.
          </p>
        </section>
        <section className="card">
          <h2>What automation may do</h2>
          <p>
            Automation can prepare research, propose changes, and surface
            actions. It does not send messages, make introductions, or silently
            change owner-judgment fields.
          </p>
        </section>
        <section className="card">
          <h2>Copies and removal</h2>
          <p>
            Ask your service team for a portable export of applicable relationship
            data, a correction, or a deletion review. Exports are generated on
            demand and are not stored by the app.
          </p>
        </section>
      </div>

      <div className="actions">
        <Link className="button hot" href="/changes">
          Review proposed changes
        </Link>
        <Link className="button ghost" href="/dashboard">
          Return to Today
        </Link>
      </div>
    </>
  );
}

import { LifeBuoy, Mail } from "lucide-react";
import Link from "next/link";
import { getSupportEmail } from "@/lib/env";

export default function SupportPage() {
  const supportEmail = getSupportEmail();
  const subject = encodeURIComponent("Little Black Book support request");

  return (
    <>
      <div className="crumb">Support</div>
      <h1 className="portal-title">Get help</h1>
      <p className="lede">
        Your concierge team can help with corrections, connections, meeting
        information, and anything that does not look right.
      </p>

      <section className="card support-card" aria-labelledby="support-title">
        <LifeBuoy aria-hidden="true" size={28} />
        <div>
          <h2 id="support-title">Contact your concierge team</h2>
          <p>
            Include the page or feature, the date and time, what you expected,
            and what happened. Do not include contact names, relationship details,
            passwords, access keys, or other credentials.
          </p>
          <p>
            Service invoices are handled privately. Use this same support contact
            for invoice questions.
          </p>
        </div>
        {supportEmail ? (
          <a
            className="button hot"
            href={`mailto:${supportEmail}?subject=${subject}`}
          >
            <Mail aria-hidden="true" size={15} />
            Email support
          </a>
        ) : (
          <p className="notice" role="status">
            Support contact details are being prepared. Please contact the team
            member who set up your Book.
          </p>
        )}
      </section>

      <div className="actions">
        <Link className="button ghost" href="/dashboard">
          Return to Today
        </Link>
      </div>
    </>
  );
}

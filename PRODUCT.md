# Little Black Book — Product Contract

## Product

Little Black Book is a private relationship operating system for one concierge client install at a time. It helps an executive owner keep a curated personal network useful and current, while an operator supports setup, enrichment, quality, and deployment.

The product is not a generic CRM. It is a private working book: a daily view of people entering the owner's orbit, upcoming meetings, useful context, promises, introductions, relationship movement, and changes that need human judgment.

## Users

- Executive owner: uses Today, My Book, Networking, Engagement, Want to Know, Promises, and Changes. Ask the Book remains available on demand without occupying the primary navigation.
- Operator or administrator: configures the install, manages data quality and integrations, processes raw meeting notes into owner-review proposals, and supports launches without taking final relationship decisions away from the owner.

## Core behavior

- Supabase provides authentication, tenant-isolated relationship data, and row-level security.
- Claude can enrich and propose work only through guarded application endpoints.
- Meeting context reaches the app through the scoped Claude intake. The app does
  not connect directly to Google, Gmail, or Calendar accounts.
- Sensitive or uncertain relationship changes enter a human review flow.
- The owner retains explicit control over relationship judgments and follow-up decisions.
- Recording administration is operator-only. Operator-classified promises, actions, and profile updates remain pending until the owner approves, marks done, or declines them in Promises or Changes.
- Scoreboard is retired; `/scoreboard` redirects to Today for compatibility with saved links.
- The application is private, no-index, and designed around one client install rather than a multi-tenant public SaaS experience.

## Product principles

1. Private by default.
2. Context before volume.
3. AI proposes; the owner decides.
4. The useful next move matters more than dashboard theatre.
5. Concierge operations stay capable but visually subordinate to the owner's Book.

## Approved visual direction

Black Morocco is the selected visual system. Its world is a tactile black bookcloth binding around pale mineral-blue working leaves: precise rules, serif-led typography, text-only navigation, and lightly embossed square controls. The binding should read as a real material at ordinary viewing size, while information surfaces remain quiet, flat, and free of decorative texture.

Preserve the approved type pairing, generous header spacing, cobalt accent, and delicate control depth. Navigation is label-only, with a small count only when the owner has work waiting; do not pair chapter numbers with icons. Black bookcloth belongs to the application binding and signed-out surround, not behind relationship content. Avoid beige and gold palettes, generic AI or Claude-like surfaces, pill-heavy dashboards, stock icon navigation, hard-edged brutalism, and Squarespace-style underlined or boxed template patterns.

## Constraints

- Preserve the intentional owner/operator surface boundary, compatibility redirects, guarded actions, authentication behavior, and tenant-isolated data semantics.
- Do not expose service-role credentials or move relationship data into the separate brand second brain.
- Keep owner-sensitive changes in the existing approval flow.
- Maintain accessible contrast, keyboard focus, reduced-motion behavior, and responsive use down to 320px.

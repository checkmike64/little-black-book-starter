# Little Black Book: Claude Engagement Pulse Instructions

## How to Install This in Claude

Add this entire file to the client Claude Project knowledge. In the recurring
social-content pulse task, tell Claude:

> Follow `claude-engagement-pulse-instructions.md` for every Engagement pulse.
> These instructions supersede any older rules about selecting or writing
> Engagement recommendations. Keep the existing authorized source connections
> and Little Black Book gateway credentials unchanged.

Before installing it, replace `{LBB_APP_URL}` with that client's exact HTTPS
production origin. Do not reuse another install's URL.

Do not paste the Little Black Book write token into this file. Keep it in the
Claude Project's existing private configuration.

## Purpose

Use these instructions for the recurring social-content and publication scan that
supplies the Little Black Book Engagement queue.

Claude is responsible for finding, matching, and describing worthwhile content.
Little Black Book is responsible for cadence, ranking, daily limits, queue order,
and what the user sees next.

Do not try to fill a daily quota. Quality beats volume.

## Non-Negotiable Boundary

The Engagement queue is only for a specific, publicly engageable social-media
post that the user can open and like, comment on, or share on the platform.
Eligible platforms are LinkedIn, Facebook, Instagram, X, Threads, TikTok, and
YouTube. Bluesky and Reddit are out of scope.

Do not send any of the following to Engagement:

- Introductions or networking recommendations
- General follow-up reminders
- Promises or meeting actions
- Contact biographies or profile snapshots
- Raw database notes
- General relationship summaries
- A social profile URL instead of a specific post URL
- A website, article, newsletter, podcast page or episode, Apple Podcasts link,
  Spotify link, or other off-platform publication
- Content without a working source link
- The owner's own posts
- Competitor research, advertisements, or unrelated research feeds

Introductions belong in Networking. Relationship facts and correspondence belong
in Interactions. Inferred contact changes belong in Changes.

## System of Record

Submit approved content through the Little Black Book gateway:

```text
POST {LBB_APP_URL}/api/claude/signals
Authorization: Bearer {LBB_WRITE_TOKEN}
Content-Type: application/json
```

Never place a Supabase service-role key in Claude. Do not insert directly into
the `engagements`, `signals`, or other Supabase tables.

If the Claude Project has a configured default tenant, omit `tenant_id`. If the
operator explicitly provides a tenant ID, use that exact value. Never invent one.

## Scan and Selection Process

For every recurring pulse:

1. Scan the authorized sources.
2. Reconcile recent authorized calendar, transcript, and correspondence evidence
   through `/api/claude/interactions`.
3. Confirm that `last_spoke` reflects those interaction writes.
4. Match the author to an existing Book contact or Want to Know record.
5. Reject anything that does not have one confident relationship match.
6. Review the actual content, not only the headline or profile.
7. Keep no more than one current recommendation per person in a single scan.
8. Submit only content that gives the user a credible reason to engage now.
9. Let Little Black Book decide whether the item should enter today's queue.

The raw Apify or source dataset may contain hundreds of posts. That does not mean
hundreds of posts belong in Little Black Book.

## Recency Rules

- Engagement recommendations may use content published anytime in the last 30 days.
- Never submit a social engagement recommendation more than 30 days old.
- Select a post only when the owner can contribute a thoughtful response grounded
  in their expertise, celebrate or amplify a meaningful milestone,
  or offer concrete help such as an introduction, resource, recommendation, or
  service.
- Always consider hiring, launches, podcast guest appearances, company news,
  partnerships, funding, promotions, and other concrete milestones. Reject
  generic observations and vague praise.
- `observed_at` must contain the content's publication timestamp, not the time
  Claude ran the scan.
- A profile update with no specific publication should not become an Engagement
  item.

For an unusually important post, `exceptional_reason` may explain why it should
outrank other eligible posts from the same 30-day window.

## Relationship Priority

Little Black Book applies the final pacing rules. Claude should use these
priorities when deciding which content is worth submitting:

1. Want to Know prospects and active pursuits where thoughtful engagement can
   build familiarity.
2. Referral partners or people the owner is actively developing as referral
   partners.
3. Important Book contacts whose current content creates a timely, authentic
   reason to stay connected.
4. Cooling relationships when the content offers a natural re-entry point.
5. Lower-priority contacts only when the content is unusually relevant.

Do not reduce Networking activity because a person has Engagement content.
Networking and Engagement are separate operating lanes.

The app currently defaults to:

- Five Engagement recommendations per day
- Three Networking recommendations per day

Those are display and pacing limits, not targets Claude must fill.

## Engagement Lanes

Set `engagement_lane` to exactly one of:

- `active`: Want to Know prospects, active pursuits, or relationships currently
  being developed.
- `partners`: Existing or developing referral partners and important connectors.
- `rescue`: A Book relationship already known to be cooling, where this content
  creates a natural way to reconnect.

Do not infer that a relationship is cooling from the post itself. Use `rescue`
only when the existing relationship context supports it. Before assigning
`rescue`, check the latest calendar, transcript, correspondence, interaction
history, `last_spoke`, and communication cadence. A person contacted within their
expected cadence is not a Rescue candidate, even if an older field still says
`Cooling`. Log the interaction first, then classify the content.

## Content Classification

Set `content_classification` to exactly one of:

- `STRUCTURAL`: A durable business, role, offer, or strategic change.
- `CONTINUITY`: Useful current thinking, activity, or relationship context.
- `HIRING`: A role, team, hiring, or employment signal.
- `NOISE`: Low-value content.

Do not submit `NOISE` items. The label exists for source analysis, not for filling
the Engagement queue.

## Recommended Action

Set `recommended_action` to exactly one of:

- `like`: A lightweight acknowledgment is sufficient.
- `comment`: A thoughtful public response would move the relationship forward.
- `share`: Sharing is genuinely useful to the owner's audience and appropriate
  for the relationship.
- `support`: The person is announcing something where visible support matters.

Default to `comment` only when there is a real point the owner could respond to.
Do not recommend a comment on generic promotional content.

## Priority Score

Use a score from 0 to 100:

- 90-100: Rare, highly timely, and directly connected to a current relationship
  objective, ask, promise, or meaningful milestone.
- 75-89: Strong relationship relevance and a clear reason to engage now.
- 60-74: Useful and current, but not urgent.
- Below 60: Do not submit.

The score represents relationship value, not the post's popularity. Likes and
comments can be supporting evidence, but they do not make an item relevant.

## Writing Requirements

### `summary`

Write one concise, factual description of the content. State what the person
actually said, announced, published, or asked.

Good:

> Karan argues that strong masterminds create better questions rather than
> canned answers and shares the prompt he is developing for his August group.

Bad:

> Karan shared an insightful and thought-provoking post that presents a great
> opportunity for meaningful engagement.

### `why_now`

Write one relationship-specific sentence explaining why this person and this
content matter to the owner now.

Good:

> The owner is actively strengthening this referral relationship, and Karan's
> point about mastermind design gives them a specific topic on which to reconnect.

Bad:

> Engaging with this post could strengthen the relationship and increase
> visibility.

Avoid generic phrases such as:

- "This is a great opportunity to engage."
- "This aligns with their interests."
- "Thought leadership"
- "Meaningful connection"
- "Could strengthen the relationship"

If the sentence would work for any contact or any post, it is not specific
enough.

## Required Request Shape

Provide exactly one of `contact_id` or `want_to_know_id`.

```json
{
  "idempotency_key": "linkedin-post-CONTACT_OR_PROSPECT_ID-PLATFORM_POST_ID",
  "contact_id": "CONTACT_UUID",
  "signal_type": "social_post",
  "classification": "REFERRAL_PARTNER",
  "content_classification": "CONTINUITY",
  "engagement_lane": "partners",
  "summary": "One concise factual description of the actual content.",
  "why_now": "One specific sentence connecting the content to this relationship.",
  "recommended_action": "comment",
  "priority_score": 82,
  "source": "linkedin",
  "source_url": "https://www.linkedin.com/posts/REAL_POST",
  "observed_at": "2026-07-29T10:00:00-06:00",
  "exceptional_reason": ""
}
```

For a prospect, omit `contact_id` and provide:

```json
{
  "want_to_know_id": "WANT_TO_KNOW_UUID"
}
```

For `/api/claude/signals`, `signal_type` must be `social_post`. Articles,
newsletters, videos without an on-platform engagement action, and podcast
episodes belong only in the `/api/claude/content` research reservoir; they must
not become Engagement recommendations.

## Link Quality

Before submitting:

- Confirm the URL opens the specific content.
- Prefer the canonical public URL.
- Remove unnecessary tracking parameters.
- Reject local, private, malformed, redirect-only, or profile-only URLs.
- Do not replace a missing post link with the person's LinkedIn profile.

## Idempotency and Retries

Every request requires a stable `idempotency_key`.

- Base it on the platform, relationship target, and source post ID or canonical
  URL identity.
- Reuse the same key when retrying the same content item.
- Do not generate a new key to force a duplicate through.
- A response with `"duplicate": true` is a successful no-op, not an error.

## Unmatched People

If a valuable post belongs to someone who is not confidently matched to a Book
contact or Want to Know record:

1. Do not create an Engagement signal without a relationship target.
2. Do not silently create a contact.
3. Include the person in the end-of-run unmatched list.
4. Include the unmatched person in the report without recommending membership.
5. Wait for the owner to add and categorize the person manually in Want to Know.

## Failure Handling

- Keep processing independent items when one item fails.
- Retry transient endpoint failures using the same idempotency key.
- Do not retry validation failures without correcting the payload.
- Never bypass the gateway by writing directly to Supabase.
- Report authentication or tenant errors clearly and stop further writes if the
  gateway cannot confirm the correct tenant.

## End-of-Run Report

Return only this concise report after a pulse:

```text
Engagement pulse complete

Sources scanned:
- LinkedIn: {count}
- Instagram: {count}
- Newsletters/articles: {count}
- Other: {count}

Qualified and submitted: {count}
Already recorded: {count}
Rejected as too old: {count}
Rejected as low relevance/noise: {count}
Rejected for missing or invalid links: {count}
Unmatched people: {count}
Errors requiring attention: {count}

Top submitted items:
1. {person} - {short factual topic} - {lane} - {priority score}
2. ...

Unmatched people requiring review:
- {person} - {source URL} - {possible prospecting bucket or "unknown"}

Errors:
- {specific error and affected item}
```

Do not paste every scanned post into the report. The app is the review surface.

## Final Check Before Every Write

Ask:

1. Is this one specific piece of content?
2. Does it have a working public link?
3. Is it current enough?
4. Is the person confidently matched?
5. Is the summary factual and concise?
6. Is `why_now` specific to this relationship?
7. Would engaging now feel natural rather than forced?
8. Is this Engagement rather than Networking, Changes, or an Interaction?

If any answer is no, do not submit the item.

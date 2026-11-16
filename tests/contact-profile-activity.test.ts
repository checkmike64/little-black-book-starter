import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { buildContactActivityTimeline } from "../lib/contact-detail/activity.js";
import { buildContactRelationshipHistory } from "../lib/contact-detail/history.js";

describe("contact profile activity", () => {
  test("keeps imported profile context visibly separate from normalized interactions", () => {
    const timeline = buildContactActivityTimeline({
      calendarEvents: [],
      interactions: [
        {
          id: "interaction-1",
          occurred_at: "2026-07-16T12:00:00Z",
          interaction_type: "call",
          title: "Monthly call",
          summary: "Reviewed the new offer.",
          source: "calendar_transcript",
          source_ref: null,
        },
      ],
      lastSpoke: "2026-07-16",
      now: new Date("2026-08-01T12:00:00Z"),
      recentActivity: "2026-07-16 call transcript context",
    });

    assert.equal(timeline.length, 2);
    assert.equal(timeline[0].source, "interaction");
    assert.equal(timeline[0].title, "Monthly call");
    assert.equal(timeline[1].source, "profile_context");
    assert.equal(timeline[1].activityType, "unverified");
  });

  test("shows matched past calendar events without duplicating a logged call", () => {
    const calendarEvents = [
      {
        id: "event-1",
        title: "Strategy call",
        starts_at: "2026-07-16T15:00:00Z",
        ends_at: "2026-07-16T16:00:00Z",
        status: "confirmed",
        html_url: "https://calendar.google.com/event?eid=one",
        external_event_id: "google-event-1",
      },
      {
        id: "event-2",
        title: "Mastermind",
        starts_at: "2026-07-23T15:00:00Z",
        ends_at: "2026-07-23T16:00:00Z",
        status: "confirmed",
        html_url: "https://calendar.google.com/event?eid=two",
        external_event_id: "google-event-2",
      },
    ];
    const timeline = buildContactActivityTimeline({
      calendarEvents,
      interactions: [
        {
          id: "interaction-1",
          occurred_at: "2026-07-16T18:00:00Z",
          interaction_type: "call",
          title: "Strategy call",
          summary: null,
          source: "calendar_transcript",
          source_ref: "google-event-1",
        },
      ],
      lastSpoke: null,
      now: new Date("2026-08-01T12:00:00Z"),
      recentActivity: null,
    });

    assert.deepEqual(
      timeline.map((item) => item.id),
      ["calendar:event-2", "interaction:interaction-1"],
    );
  });

  test("keeps explicitly dated imported context visible until it is normalized", () => {
    const timeline = buildContactActivityTimeline({
      calendarEvents: [],
      interactions: [],
      lastSpoke: null,
      now: new Date("2026-08-01T12:00:00Z"),
      recentActivity: "2026-07-16 call transcript ingested. Discussed the new venture.",
    });

    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].activityType, "unverified");
    assert.equal(timeline[0].source, "profile_context");
    assert.equal(timeline[0].occurredAt.slice(0, 10), "2026-07-16");
  });

  test("enriches one canonical history row instead of repeating an interaction", () => {
    const history = buildContactRelationshipHistory({
      activities: [
        {
          id: "interaction:interaction-1",
          occurredAt: "2026-07-16T12:00:00Z",
          activityType: "call",
          title: "Monthly call",
          summary: "Reviewed the new offer.",
          source: "interaction",
          sourceUrl: null,
        },
      ],
      conversations: [
        {
          id: "interaction-1",
          occurredAt: "2026-07-16T12:00:00Z",
          interactionType: "call",
          title: "Monthly call",
          summary: "Reviewed the new offer.",
          source: "calendar_transcript",
          sourceRef: null,
          transcripts: [],
          promises: [],
          actions: [],
          storedInterpretation: ["The new offer needs a narrower promise."],
          topics: ["Offer design"],
          provenance: ["Interaction source: calendar transcript"],
        },
      ],
    });

    assert.equal(history.length, 1);
    assert.equal(history[0].conversation?.id, "interaction-1");
    assert.deepEqual(history[0].conversation?.topics, ["Offer design"]);
  });

  test("keeps standalone promises and introductions in the unified history", () => {
    const history = buildContactRelationshipHistory({
      activities: [],
      contactId: "contact-1",
      conversations: [],
      introductions: [
        {
          id: "intro-1",
          person_a: "contact-1",
          person_b: "contact-2",
          date_proposed: "2026-09-20",
          date_made: "2026-09-22",
          why_context: "Their partnerships are complementary.",
          status: "made",
          outcome: null,
          follow_up_on: null,
          person_a_contact: { full_name: "Avery" },
          person_b_contact: { full_name: "Jordan" },
        },
      ],
      promises: [
        {
          id: "promise-1",
          interaction_id: null,
          promise_text: "Send the brief",
          direction: "owner_owes_contact",
          status: "completed",
          due_on: null,
          completed_at: "2026-09-21T18:00:00Z",
          created_at: "2026-09-19T18:00:00Z",
          source: "manual",
          evidence: {},
        },
      ],
    });

    assert.deepEqual(history.map((item) => item.source), [
      "introduction",
      "promise",
    ]);
    assert.equal(history[0].title, "Introduction with Jordan");
  });

  test("shows saved note evidence without pretending it is verified activity", () => {
    const timeline = buildContactActivityTimeline({
      calendarEvents: [],
      interactions: [],
      lastSpoke: "2026-07-16",
      legacyNoteEvidence: true,
      now: new Date("2026-08-01T12:00:00Z"),
      recentActivity: null,
    });

    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].title, "Saved call context");
    assert.equal(timeline[0].activityType, "unverified");
    assert.equal(timeline[0].source, "profile_context");
  });

  test("keeps a separate meeting on the same day", () => {
    const timeline = buildContactActivityTimeline({
      calendarEvents: [
        {
          id: "event-2",
          external_event_id: "google-event-2",
          title: "Mastermind",
          starts_at: "2026-07-16T20:00:00Z",
          ends_at: "2026-07-16T21:00:00Z",
          status: "confirmed",
          html_url: null,
        },
      ],
      interactions: [
        {
          id: "interaction-1",
          occurred_at: "2026-07-16T15:00:00Z",
          interaction_type: "call",
          title: "Strategy call",
          summary: null,
          source: "manual",
          source_ref: null,
        },
      ],
      lastSpoke: null,
      now: new Date("2026-08-01T12:00:00Z"),
      recentActivity: null,
    });

    assert.equal(timeline.length, 2);
  });

  test("keeps profile logging audited and network fields structured", () => {
    const page = readFileSync(
      join(process.cwd(), "app/(portal)/contacts/[id]/page.tsx"),
      "utf8",
    );
    const actions = readFileSync(
      join(process.cwd(), "app/(portal)/contacts/[id]/actions.ts"),
      "utf8",
    );
    assert.match(page, /action=\{logContactActivity\}/);
    assert.match(page, /<h2>Relationship history<\/h2>/);
    assert.match(page, /<h2>Log a touchpoint<\/h2>/);
    assert.match(page, /defaultValue=\{ownerToday\} max=\{ownerToday\}/);
    assert.match(page, /defaultValue="manual_touch"/);
    assert.doesNotMatch(
      page,
      /defaultValue=\{contact\.recent_activity[\s\S]{0,200}name="activity_summary"/,
    );
    assert.doesNotMatch(page, /Conversation memory/);
    assert.doesNotMatch(page, /All dated activity/);
    assert.match(page, /PendingSubmitButton[\s\S]*pendingLabel="Saving…"/);
    assert.match(page, /Work categories/);
    assert.match(page, /Top tags/);
    assert.match(page, /Search keywords/);
    assert.match(actions, /admin\.rpc\("lbb_log_interaction"/);
    assert.match(actions, /activity_request_id/);
    assert.match(actions, /interaction\.owner_logged/);
    assert.match(actions, /activityDate > ownerToday/);
    assert.match(actions, /buildManualFieldProvenanceRows/);
    assert.match(actions, /relationship_strength_override: Boolean\(relationshipStrength\)/);
    assert.match(page, /What they could refer me for/);
    assert.match(page, /Save group/);
    assert.doesNotMatch(actions, /parse(?:Private|Legacy)NotesIntoInteraction/);
  });

  test("normalizes Claude meeting snapshots into the activity ledger", () => {
    const route = readFileSync(
      join(process.cwd(), "app/api/claude/calendar/route.ts"),
      "utf8",
    );
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260822130430_canonical_production_baseline.sql"),
      "utf8",
    );
    assert.match(route, /admin\.rpc\(\s*"lbb_record_claude_calendar_snapshot"/);
    assert.match(migration, /select public\.lbb_log_interaction\(/);
    assert.match(migration, /'claude_calendar'/);
    assert.match(migration, /p_update_last_spoke/);
  });
});

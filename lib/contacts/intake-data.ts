import { findDuplicateCandidates } from "@/lib/contact-duplicate-detection";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ContactIntakeCandidate = {
  id: string;
  full_name: string;
  company_name: string | null;
  role_title: string[] | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  website: string | null;
  relationship_type: string[] | null;
  one_line_summary: string | null;
  last_spoke: string | null;
  duplicate_score?: number;
  duplicate_confidence?: string;
  duplicate_reasons?: string[];
};

export type EditableContact = ContactIntakeCandidate & {
  company_description: string | null;
  trust_level: string | null;
  touch_cadence: string | null;
  relationship_strength: string | null;
  relationship_strength_reason: string | null;
  met_date: string | null;
  how_we_met: string | null;
  why_stay_in_touch: string | null;
  location: string[] | null;
  current_asks: string | null;
  wants_help_with: string | null;
  what_they_want_more_of: string | null;
  services_offered: string[] | null;
  ideal_referral: string | null;
  do_not_refer_for: string | null;
  could_refer_me_for: string[] | null;
  referral_intro_blurb: string | null;
  podcast_fit: string | null;
  primary_category: string[] | null;
  top_3_tags: string[] | null;
  keywords: string[] | null;
  recent_activity: string | null;
  personal_notes: string | null;
  private_notes: string | null;
};

export const blankContact: EditableContact = {
  id: "",
  full_name: "",
  company_name: null,
  role_title: null,
  email: null,
  phone: null,
  company_description: null,
  trust_level: null,
  touch_cadence: null,
  relationship_strength: null,
  relationship_strength_reason: null,
  relationship_type: null,
  one_line_summary: null,
  last_spoke: null,
  met_date: null,
  how_we_met: null,
  why_stay_in_touch: null,
  location: null,
  linkedin: null,
  website: null,
  current_asks: null,
  wants_help_with: null,
  what_they_want_more_of: null,
  services_offered: null,
  ideal_referral: null,
  do_not_refer_for: null,
  could_refer_me_for: null,
  referral_intro_blurb: null,
  podcast_fit: null,
  primary_category: null,
  top_3_tags: null,
  keywords: null,
  recent_activity: null,
  personal_notes: null,
  private_notes: null,
};

function sanitizeForOrFilter(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function getContactIntakeData(
  query: string,
  contactId: string | undefined,
) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      setupMode: true,
      candidates: [] as ContactIntakeCandidate[],
      selected: null as EditableContact | null,
      error: null as string | null,
    };
  }

  const selectedPromise = contactId
    ? supabase
        .from("contacts")
        .select(
          "id, full_name, email, phone, company_name, company_description, role_title, one_line_summary, trust_level, touch_cadence, relationship_strength, relationship_strength_reason, relationship_type, last_spoke, met_date, how_we_met, why_stay_in_touch, location, linkedin, website, current_asks, wants_help_with, what_they_want_more_of, services_offered, ideal_referral, do_not_refer_for, could_refer_me_for, referral_intro_blurb, podcast_fit, primary_category, top_3_tags, keywords, recent_activity, personal_notes, private_notes",
        )
        .eq("id", contactId)
        .is("archived_at", null)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const safeQuery = sanitizeForOrFilter(query);
  const candidatesPromise = safeQuery
    ? supabase
        .from("contacts")
        .select(
          "id, full_name, company_name, role_title, email, phone, linkedin, website, relationship_type, one_line_summary, last_spoke",
        )
        .is("archived_at", null)
        .order("full_name")
        .limit(750)
    : Promise.resolve({ data: [] as ContactIntakeCandidate[], error: null });

  const [selectedResult, candidatesResult] = await Promise.all([
    selectedPromise,
    candidatesPromise,
  ]);

  return {
    setupMode: false,
    candidates: findDuplicateCandidates(
      {
        full_name: safeQuery,
        email: safeQuery.includes("@") ? safeQuery : null,
        phone: safeQuery,
        company_name: safeQuery,
      },
      (candidatesResult.data ?? []) as ContactIntakeCandidate[],
      { minimumScore: 8, limit: 8 },
    ).map((match) => ({
      ...match.contact,
      duplicate_score: match.score,
      duplicate_confidence: match.confidence,
      duplicate_reasons: match.reasons,
    })),
    selected: (selectedResult.data ?? null) as EditableContact | null,
    error:
      selectedResult.error || candidatesResult.error
        ? "The private database is connected, but the intake workflow could not load all contact context."
        : null,
  };
}

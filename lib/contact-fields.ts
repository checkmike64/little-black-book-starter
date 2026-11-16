export const contactFieldTypes = {
  full_name: "text",
  email: "text",
  phone: "text",
  company_name: "text",
  company_description: "text",
  role_title: "text_array",
  one_line_summary: "text",
  trust_level: "text",
  touch_cadence: "text",
  relationship_strength: "text",
  relationship_type: "text_array",
  last_spoke: "date",
  met_date: "date",
  how_we_met: "text",
  how_i_know_them: "text_array",
  why_stay_in_touch: "text",
  location: "text_array",
  time_zone: "text",
  linkedin: "text",
  instagram: "text",
  facebook: "text",
  x_twitter: "text",
  youtube: "text",
  podcast_url: "text",
  website: "text",
  birthday: "date",
  spouse_partner: "text",
  children: "text",
  important_dates: "text",
  current_asks: "text",
  wants_help_with: "text",
  what_they_want_more_of: "text",
  services_offered: "text_array",
  ideal_referral: "text",
  do_not_refer_for: "text",
  could_refer_me_for: "text_array",
  referral_intro_blurb: "text",
  podcast_fit: "text",
  primary_category: "text_array",
  top_3_tags: "text_array",
  keywords: "text_array",
  recent_activity: "text",
  personal_notes: "text",
  private_notes: "text",
  relationship_strength_computed: "text",
  relationship_strength_override: "boolean",
  relationship_strength_reason: "text",
} as const;

export type ContactField = keyof typeof contactFieldTypes;

export type ContactUpdates = Record<string, string | string[] | boolean | null>;

export function isContactField(field: string): field is ContactField {
  return field in contactFieldTypes;
}

export function contactFieldLabel(field: string) {
  return field.replaceAll("_", " ");
}


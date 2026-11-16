import { sampleContacts } from "@/lib/sample-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ContactsListContactRow = {
  id: string;
  full_name: string;
  company_name: string | null;
  role_title: string[] | null;
  trust_level: string | null;
  relationship_strength: string | null;
  relationship_strength_reason: string | null;
  relationship_strength_override: boolean;
  relationship_type: string[] | null;
  email: string | null;
  last_spoke: string | null;
  current_asks?: string | null;
  wants_help_with?: string | null;
  recent_activity?: string | null;
  private_notes?: string | null;
  primary_category: string[] | null;
  top_3_tags: string[] | null;
  keywords: string[] | null;
  location: string[] | null;
};

export type ContactsListPromiseRow = {
  id: string;
  contact_id: string | null;
  direction: string;
  due_on: string | null;
  promise_text: string;
};

export async function getContactsListData(tenantId: string | null) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      contacts: sampleContacts as unknown as ContactsListContactRow[],
      openPromises: [] as ContactsListPromiseRow[],
      count: sampleContacts.length,
      setupMode: true,
      error: null,
      promisesError: null,
    };
  }
  if (!tenantId) {
    return {
      contacts: [] as ContactsListContactRow[],
      openPromises: [] as ContactsListPromiseRow[],
      count: 0,
      setupMode: false,
      error: "Contacts could not be scoped to this Book.",
      promisesError: null,
    };
  }

  const { data, count, error } = await supabase
    .from("contacts")
    .select(
      "id, full_name, company_name, role_title, trust_level, relationship_strength, relationship_strength_reason, relationship_strength_override, relationship_type, email, last_spoke, current_asks, wants_help_with, recent_activity, private_notes, primary_category, top_3_tags, keywords, location",
      { count: "exact" },
    )
    .eq("tenant_id", tenantId)
    .order("full_name")
    .limit(200);

  if (error || !data) {
    return {
      contacts: [],
      openPromises: [] as ContactsListPromiseRow[],
      count: 0,
      setupMode: false,
      error:
        "The private database is connected, but contacts could not be loaded for this signed-in user.",
      promisesError: null,
    };
  }

  const contactIds = data.map((contact) => contact.id);
  const promisesResult =
    contactIds.length > 0
      ? await supabase
          .from("promises")
          .select("id, contact_id, direction, due_on, promise_text")
          .eq("tenant_id", tenantId)
          .eq("status", "open")
          .in("contact_id", contactIds)
          .limit(400)
      : { data: [] as ContactsListPromiseRow[] };

  return {
    contacts: data as ContactsListContactRow[],
    openPromises:
      ((promisesResult.data ?? []) as unknown) as ContactsListPromiseRow[],
    count: count ?? data.length,
    setupMode: false,
    error: null,
    promisesError: "error" in promisesResult && promisesResult.error
      ? "Promise risk signals could not be loaded."
      : null,
  };
}

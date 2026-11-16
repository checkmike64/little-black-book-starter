import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PromiseLedgerRow = {
  id: string;
  contact_id: string | null;
  interaction_id: string | null;
  direction: string;
  promise_text: string;
  status: string;
  review_status: "pending_owner" | "accepted" | "declined";
  owner_user_id: string | null;
  due_on: string | null;
  completed_at: string | null;
  source: string | null;
  evidence: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  contacts?: {
    id: string;
    full_name: string | null;
    company_name: string | null;
  } | null;
  interactions?: {
    id: string;
    title: string | null;
    occurred_at: string | null;
    source: string | null;
  } | null;
};

export type PromiseContactOption = {
  id: string;
  full_name: string;
  company_name: string | null;
};

export async function getPromiseLedgerData(tenantId: string | null) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      promises: [] as PromiseLedgerRow[],
      contacts: [] as PromiseContactOption[],
      error: "The private promise ledger is not connected.",
      contactsError: null,
    };
  }
  if (!tenantId) {
    return {
      promises: [] as PromiseLedgerRow[],
      contacts: [] as PromiseContactOption[],
      error: "Promise data could not be scoped to this Book.",
      contactsError: "People could not be scoped to this Book.",
    };
  }

  const [promiseResult, contactResult] = await Promise.all([
    supabase
      .from("promises")
      .select(
        "id, contact_id, interaction_id, direction, promise_text, status, review_status, owner_user_id, due_on, completed_at, source, evidence, created_at, updated_at, contacts(id, full_name, company_name), interactions(id, title, occurred_at, source)",
      )
      .eq("tenant_id", tenantId)
      .order("status", { ascending: false })
      .order("due_on", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("contacts")
      .select("id, full_name, company_name")
      .eq("tenant_id", tenantId)
      .is("archived_at", null)
      .order("full_name")
      .limit(500),
  ]);

  return {
    promises: ((promiseResult.data ?? []) as unknown) as PromiseLedgerRow[],
    contacts: ((contactResult.data ?? []) as unknown) as PromiseContactOption[],
    error: promiseResult.error ? "Promise data could not be loaded." : null,
    contactsError: contactResult.error ? "People could not be loaded for manual entry." : null,
  };
}

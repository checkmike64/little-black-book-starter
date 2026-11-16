-- Little Black Book canonical schema baseline.
-- Generated from the authoritative production schema immediately after hosted migration 20260822130429.
-- Schema only: this file contains no application rows, Auth users, provider credentials, or Vault secrets.

-- source: _cluster/extensions/pgcrypto.sql
create extension if not exists "pgcrypto" schema "extensions";

comment on extension "pgcrypto" is 'cryptographic functions';

-- source: _cluster/extensions/uuid-ossp.sql
create extension if not exists "uuid-ossp" schema "extensions";

comment on extension "uuid-ossp" is 'generate universally unique identifiers (UUIDs)';

-- source: _cluster/extensions/postgres_fdw.sql
create extension if not exists "postgres_fdw" schema "extensions";

comment on extension "postgres_fdw" is 'foreign-data wrapper for remote PostgreSQL servers';

-- source: app_private/schema.sql
create schema if not exists "app_private";

grant usage on schema "app_private" to "authenticated";

grant create, usage on schema "app_private" to "postgres";

-- source: public/schema.sql
comment on schema "public" is 'standard public schema';

revoke all on schema "public" from public;

grant usage on schema "public" to public;

revoke all on schema "public" from "anon";

grant usage on schema "public" to "anon";

revoke all on schema "public" from "authenticated";

grant usage on schema "public" to "authenticated";

revoke all on schema "public" from "pg_database_owner";

grant create, usage on schema "public" to "pg_database_owner";

revoke all on schema "public" from "postgres";

grant usage on schema "public" to "postgres";

revoke all on schema "public" from "service_role";

grant usage on schema "public" to "service_role";

-- Temporary fail-closed membership helpers allow policies to be created before tenant_members exists.
create or replace function app_private.has_tenant_role(target_tenant_id uuid, allowed_roles text[])
returns boolean language sql security definer set search_path to 'public', 'app_private' as $$ select false $$;
create or replace function app_private.is_tenant_member(target_tenant_id uuid)
returns boolean language sql security definer set search_path to 'public', 'app_private' as $$ select false $$;

-- source: public/functions/set_updated_at.sql
create or replace function public.set_updated_at()
  returns trigger
  language plpgsql
  set search_path to 'public'
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

grant execute on function "public"."set_updated_at"() to "postgres", "service_role";

revoke all on function "public"."set_updated_at"() from public;

-- source: app_private/functions/canonicalize_connection_pair.sql
create or replace function app_private.canonicalize_connection_pair()
  returns trigger
  language plpgsql
  set search_path to 'pg_catalog', 'public'
  AS $function$
declare
  original_a uuid;
begin
  if new.contact_a > new.contact_b then
    original_a := new.contact_a;
    new.contact_a := new.contact_b;
    new.contact_b := original_a;
  end if;

  return new;
end;
$function$;

grant execute on function "app_private"."canonicalize_connection_pair"() to "postgres";

revoke all on function "app_private"."canonicalize_connection_pair"() from public;

-- source: app_private/functions/relationship_context_key.sql
create or replace function app_private.relationship_context_key (
  value text
)
  returns text
  language sql
  immutable
  set search_path to 'pg_catalog'
  AS $function$
  select lower(regexp_replace(trim(coalesce(value, '')), '\s+', ' ', 'g'));
$function$;

grant execute on function "app_private"."relationship_context_key"(text) to "postgres";

revoke all on function "app_private"."relationship_context_key"(text) from public;

-- source: public/tables/tenants.sql
create table "public"."tenants" (
  "id"            uuid                     not null default gen_random_uuid(),
  "name"          text                     not null,
  "slug"          text,
  "owner_user_id" uuid,
  "settings"      jsonb                    not null default '{}'::jsonb,
  "created_at"    timestamp with time zone not null default now(),
  "updated_at"    timestamp with time zone not null default now(),
  constraint "tenants_owner_user_id_fkey" foreign key (owner_user_id) references auth.users(id) on delete set null,
  constraint "tenants_pkey" primary key (id),
  constraint "tenants_slug_key" unique (slug)
);

alter table "public"."tenants"
  enable row level security;

create index tenants_owner_user_idx on public.tenants using btree (owner_user_id)
  where (owner_user_id is not null);

create trigger set_tenants_updated_at
  before update on public.tenants
  for each row
  execute function public.set_updated_at();

create policy "members read tenant" on "public"."tenants"
  for select
  to "authenticated"
  using (app_private.is_tenant_member(id));

create policy "owners update tenant" on "public"."tenants"
  for update
  to "authenticated"
  using (app_private.has_tenant_role(id, ARRAY['owner'::text]))
  with check (app_private.has_tenant_role(id, ARRAY['owner'::text]));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."tenants" to "authenticated", "postgres", "service_role";

-- source: app_private/tables/calendar_snapshot_receipts.sql
create table "app_private"."calendar_snapshot_receipts" (
  "tenant_id"      uuid                     not null,
  "snapshot_id"    text                     not null,
  "payload_hash"   text                     not null,
  "generated_at"   timestamp with time zone not null,
  "window_start"   timestamp with time zone not null,
  "window_end"     timestamp with time zone not null,
  "event_count"    integer                  not null,
  "attendee_count" integer                  not null,
  "created_at"     timestamp with time zone not null default now(),
  constraint "calendar_snapshot_receipts_pkey" primary key (tenant_id, snapshot_id),
  constraint "calendar_snapshot_receipts_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

grant delete, insert, maintain, references, select, trigger, truncate, update on table "app_private"."calendar_snapshot_receipts" to "postgres";

-- source: public/tables/ask_runs.sql
create table "public"."ask_runs" (
  "id"           uuid                     not null default gen_random_uuid(),
  "tenant_id"    uuid                     not null,
  "mode"         text                     not null,
  "query"        text                     not null default ''::text,
  "title"        text                     not null,
  "answer"       jsonb                    not null default '{}'::jsonb,
  "shortlist"    jsonb                    not null default '[]'::jsonb,
  "context_hits" jsonb                    not null default '[]'::jsonb,
  "snapshot"     jsonb                    not null default '{}'::jsonb,
  "source"       text                     not null default 'ask_page'::text,
  "saved_by"     uuid,
  "created_at"   timestamp with time zone not null default now(),
  constraint "ask_runs_mode_check" check ((mode = ANY (ARRAY['search'::text, 'referrals'::text, 'podcasts'::text, 'investors'::text, 'ma'::text, 'stale'::text, 'asks'::text]))),
  constraint "ask_runs_pkey" primary key (id),
  constraint "ask_runs_saved_by_fkey" foreign key (saved_by) references auth.users(id) on delete set null,
  constraint "ask_runs_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."ask_runs"
  enable row level security;

create index ask_runs_mode_time_idx on public.ask_runs using btree (tenant_id, mode, created_at desc);

create index ask_runs_saved_by_idx on public.ask_runs using btree (saved_by);

create index ask_runs_tenant_time_idx on public.ask_runs using btree (tenant_id, created_at desc);

create policy "members delete ask runs" on "public"."ask_runs"
  for delete
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

create policy "members insert ask runs" on "public"."ask_runs"
  for insert
  to "authenticated"
  with check (app_private.is_tenant_member(tenant_id));

create policy "members read ask runs" on "public"."ask_runs"
  for select
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

create policy "members update ask runs" on "public"."ask_runs"
  for update
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id))
  with check (app_private.is_tenant_member(tenant_id));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."ask_runs" to "authenticated", "postgres", "service_role";

-- source: public/tables/audit_log.sql
create table "public"."audit_log" (
  "id"            uuid                     not null default gen_random_uuid(),
  "tenant_id"     uuid,
  "actor_user_id" uuid,
  "actor_type"    text                     not null default 'system'::text,
  "action"        text                     not null,
  "table_name"    text,
  "record_id"     uuid,
  "before"        jsonb,
  "after"         jsonb,
  "metadata"      jsonb                    not null default '{}'::jsonb,
  "created_at"    timestamp with time zone not null default now(),
  constraint "audit_log_actor_type_check" check ((actor_type = ANY (ARRAY['client'::text, 'operator'::text, 'claude'::text, 'system'::text, 'gateway'::text]))),
  constraint "audit_log_actor_user_id_fkey" foreign key (actor_user_id) references auth.users(id) on delete set null,
  constraint "audit_log_pkey" primary key (id),
  constraint "audit_log_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."audit_log"
  enable row level security;

create index audit_log_actor_user_id_idx on public.audit_log using btree (actor_user_id)
  where (actor_user_id is not null);

create index audit_log_tenant_time_idx on public.audit_log using btree (tenant_id, created_at desc);

create policy "gateway append audit log" on "public"."audit_log"
  for insert
  to "authenticated"
  with check (((tenant_id IS NULL) OR app_private.is_tenant_member(tenant_id)));

create policy "members read audit log" on "public"."audit_log"
  for select
  to "authenticated"
  using (((tenant_id is null) or app_private.is_tenant_member(tenant_id)));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."audit_log" to "authenticated", "postgres", "service_role";

-- source: public/tables/contacts.sql
create table "public"."contacts" (
  "id"                             uuid                     not null default gen_random_uuid(),
  "tenant_id"                      uuid                     not null,
  "notion_id"                      text,
  "notion_url"                     text,
  "full_name"                      text                     not null,
  "email"                          text,
  "phone"                          text,
  "company_name"                   text,
  "company_description"            text,
  "role_title"                     text[],
  "one_line_summary"               text,
  "trust_level"                    text,
  "touch_cadence"                  text,
  "relationship_type"              text[],
  "relationship_strength"          text,
  "relationship_strength_computed" text,
  "relationship_strength_override" boolean                  not null default false,
  "relationship_strength_reason"   text,
  "strength_updated"               date,
  "last_spoke"                     date,
  "met_date"                       date,
  "how_we_met"                     text,
  "how_i_know_them"                text[],
  "why_stay_in_touch"              text,
  "location"                       text[],
  "time_zone"                      text,
  "linkedin"                       text,
  "instagram"                      text,
  "facebook"                       text,
  "x_twitter"                      text,
  "youtube"                        text,
  "podcast_url"                    text,
  "website"                        text,
  "birthday"                       date,
  "spouse_partner"                 text,
  "children"                       text,
  "important_dates"                text,
  "current_asks"                   text,
  "wants_help_with"                text,
  "what_they_want_more_of"         text,
  "services_offered"               text[],
  "ideal_referral"                 text,
  "do_not_refer_for"               text,
  "could_refer_me_for"             text[],
  "referral_intro_blurb"           text,
  "podcast_fit"                    text,
  "primary_category"               text[],
  "top_3_tags"                     text[],
  "keywords"                       text[],
  "recent_activity"                text,
  "personal_notes"                 text,
  "private_notes"                  text,
  "extra"                          jsonb                    not null default '{}'::jsonb,
  "created_by"                     uuid,
  "source"                         text                     not null default 'manual'::text,
  "archived_at"                    timestamp with time zone,
  "created_at"                     timestamp with time zone not null default now(),
  "updated_at"                     timestamp with time zone not null default now(),
  "engagement_target_per_month"    numeric(4,2),
  constraint "contacts_created_by_fkey" foreign key (created_by) references auth.users(id) on delete set null,
  constraint "contacts_engagement_target_per_month_check"
    check (((engagement_target_per_month IS NULL) OR ((engagement_target_per_month >= (0)::numeric) AND (engagement_target_per_month <= (8)::numeric)))),
  constraint "contacts_notion_id_key" unique (notion_id),
  constraint "contacts_pkey" primary key (id),
  constraint "contacts_tenant_id_id_key" unique (tenant_id, id),
  constraint "contacts_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."contacts"
  enable row level security;

create index contacts_created_by_idx on public.contacts using btree (created_by)
  where (created_by is not null);

create index contacts_extra_gin on public.contacts using gin (extra);

create index contacts_name_idx on public.contacts using gin (to_tsvector('english'::regconfig, ((COALESCE(full_name, ''::text) || ' '::text) || COALESCE(company_name, ''::text))));

create index contacts_tenant_idx on public.contacts using btree (tenant_id);

create trigger set_contacts_updated_at
  before update on public.contacts
  for each row
  execute function public.set_updated_at();

create policy "members insert contacts" on "public"."contacts"
  for insert
  to "authenticated"
  with check (((tenant_id IS NOT NULL) AND app_private.is_tenant_member(tenant_id)));

create policy "members read contacts" on "public"."contacts"
  for select
  to "authenticated"
  using (((tenant_id is not null) AND app_private.is_tenant_member(tenant_id)));

create policy "members update contacts" on "public"."contacts"
  for update
  to "authenticated"
  using (((tenant_id is not null) AND app_private.is_tenant_member(tenant_id)))
  with check (((tenant_id IS NOT NULL) AND app_private.is_tenant_member(tenant_id)));

create policy "owner and operator delete contacts" on "public"."contacts"
  for delete
  to "authenticated"
  using (((tenant_id is not null) AND app_private.has_tenant_role(tenant_id, ARRAY['owner'::text, 'operator'::text])));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."contacts" to "authenticated", "postgres", "service_role";

-- source: public/tables/field_provenance.sql
create table "public"."field_provenance" (
  "id"          uuid                     not null default gen_random_uuid(),
  "tenant_id"   uuid                     not null,
  "table_name"  text                     not null,
  "record_id"   uuid                     not null,
  "field_name"  text                     not null,
  "source_type" text                     not null,
  "source_ref"  text,
  "summary"     text,
  "confidence"  numeric(4,3),
  "metadata"    jsonb                    not null default '{}'::jsonb,
  "created_at"  timestamp with time zone not null default now(),
  constraint "field_provenance_pkey" primary key (id),
  constraint "field_provenance_source_type_check"
    check ((source_type = ANY (ARRAY['claude'::text, 'transcript'::text, 'correspondence'::text, 'social_pulse'::text, 'manual'::text, 'import'::text]))),
  constraint "field_provenance_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."field_provenance"
  enable row level security;

create index field_provenance_lookup_idx on public.field_provenance using btree (tenant_id, table_name, record_id, field_name);

create policy "members read field provenance" on "public"."field_provenance"
  for select
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."field_provenance" to "authenticated", "postgres", "service_role";

-- source: public/tables/google_oauth_transactions.sql
create table "public"."google_oauth_transactions" (
  "id"                 uuid                     not null default gen_random_uuid(),
  "tenant_id"          uuid                     not null,
  "user_id"            uuid                     not null,
  "provider"           text                     not null,
  "state_hash"         text                     not null,
  "verifier_secret_id" uuid                     not null,
  "expires_at"         timestamp with time zone not null,
  "created_at"         timestamp with time zone not null default now(),
  constraint "google_oauth_transactions_pkey" primary key (id),
  constraint "google_oauth_transactions_provider_check" check ((provider = ANY (ARRAY['google_calendar'::text, 'google_gmail'::text]))),
  constraint "google_oauth_transactions_state_hash_key" unique (state_hash),
  constraint "google_oauth_transactions_user_id_fkey" foreign key (user_id) references auth.users(id) on delete cascade,
  constraint "google_oauth_transactions_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."google_oauth_transactions"
  enable row level security;

create index google_oauth_transactions_actor_idx on public.google_oauth_transactions using btree (tenant_id, user_id, provider, expires_at);

create index google_oauth_transactions_user_idx on public.google_oauth_transactions using btree (user_id);

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."google_oauth_transactions" to "postgres", "service_role";

-- source: public/tables/integration_connections.sql
create table "public"."integration_connections" (
  "id"                      uuid                     not null default gen_random_uuid(),
  "tenant_id"               uuid                     not null,
  "user_id"                 uuid                     not null,
  "provider"                text                     not null,
  "status"                  text                     not null default 'active'::text,
  "external_account_email"  text,
  "scopes"                  text[]                   not null default '{}'::text[],
  "refresh_token_secret_id" uuid,
  "sync_cursor"             text,
  "last_synced_at"          timestamp with time zone,
  "last_error"              text,
  "metadata"                jsonb                    not null default '{}'::jsonb,
  "created_at"              timestamp with time zone not null default now(),
  "updated_at"              timestamp with time zone not null default now(),
  constraint "integration_connections_pkey" primary key (id),
  constraint "integration_connections_provider_check" check ((provider = ANY (ARRAY['google_calendar'::text, 'claude_calendar'::text, 'google_gmail'::text]))),
  constraint "integration_connections_status_check" check ((status = ANY (ARRAY['active'::text, 'needs_attention'::text, 'disconnected'::text]))),
  constraint "integration_connections_tenant_id_user_id_provider_key" unique (tenant_id, user_id, provider),
  constraint "integration_connections_tenant_id_user_key" unique (tenant_id, id, user_id),
  constraint "integration_connections_user_id_fkey" foreign key (user_id) references auth.users(id) on delete cascade,
  constraint "integration_connections_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."integration_connections"
  enable row level security;

create index integration_connections_tenant_status_idx on public.integration_connections using btree (tenant_id, status);

create index integration_connections_user_idx on public.integration_connections using btree (user_id);

create trigger set_integration_connections_updated_at
  before update on public.integration_connections
  for each row
  execute function public.set_updated_at();

create policy "owners read integration connections" on "public"."integration_connections"
  for select
  to "authenticated"
  using (((user_id = ( select auth.uid() as uid)) AND app_private.is_tenant_member(tenant_id)));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."integration_connections" to "authenticated", "postgres", "service_role";

-- source: public/tables/interactions.sql
create table "public"."interactions" (
  "id"               uuid                     not null default gen_random_uuid(),
  "tenant_id"        uuid                     not null,
  "occurred_at"      timestamp with time zone not null,
  "interaction_type" text                     not null,
  "title"            text,
  "summary"          text,
  "source"           text                     not null default 'manual'::text,
  "source_ref"       text,
  "metadata"         jsonb                    not null default '{}'::jsonb,
  "created_by"       uuid,
  "created_at"       timestamp with time zone not null default now(),
  "idempotency_key"  text,
  constraint "interactions_created_by_fkey" foreign key (created_by) references auth.users(id) on delete set null,
  constraint "interactions_interaction_type_check"
    check ((interaction_type = ANY (ARRAY['meeting'::text, 'call'::text, 'email'::text, 'message'::text, 'note'::text, 'manual_touch'::text]))),
  constraint "interactions_pkey" primary key (id),
  constraint "interactions_tenant_id_id_key" unique (tenant_id, id),
  constraint "interactions_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."interactions"
  enable row level security;

create index interactions_created_by_idx on public.interactions using btree (created_by)
  where (created_by is not null);

create index interactions_summary_fts_idx on public.interactions
  using gin (to_tsvector('english'::regconfig, ((COALESCE(title, ''::text) || ' '::text) || COALESCE(summary, ''::text))));

create unique index interactions_tenant_idempotency_key_idx on public.interactions using btree (tenant_id, idempotency_key)
  where (idempotency_key is not null);

create index interactions_tenant_time_idx on public.interactions using btree (tenant_id, occurred_at desc);

create policy "members insert interactions" on "public"."interactions"
  for insert
  to "authenticated"
  with check (app_private.is_tenant_member(tenant_id));

create policy "members read interactions" on "public"."interactions"
  for select
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."interactions" to "authenticated", "postgres", "service_role";

-- source: public/tables/jobs.sql
create table "public"."jobs" (
  "id"         uuid                     not null default gen_random_uuid(),
  "tenant_id"  uuid,
  "job_type"   text                     not null,
  "status"     text                     not null default 'queued'::text,
  "payload"    jsonb                    not null default '{}'::jsonb,
  "result"     jsonb                    not null default '{}'::jsonb,
  "attempts"   integer                  not null default 0,
  "run_after"  timestamp with time zone not null default now(),
  "locked_at"  timestamp with time zone,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  constraint "jobs_pkey" primary key (id),
  constraint "jobs_status_check" check ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text]))),
  constraint "jobs_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."jobs"
  enable row level security;

create index jobs_due_idx on public.jobs using btree (status, run_after);

create index jobs_tenant_id_idx on public.jobs using btree (tenant_id)
  where (tenant_id is not null);

create trigger set_jobs_updated_at
  before update on public.jobs
  for each row
  execute function public.set_updated_at();

create policy "owner and operator read jobs" on "public"."jobs"
  for select
  to "authenticated"
  using (((tenant_id is null) or app_private.has_tenant_role(tenant_id, ARRAY['owner'::text, 'operator'::text])));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."jobs" to "postgres", "service_role";

revoke all on table "public"."jobs" from "authenticated";

grant select on table "public"."jobs" to "authenticated";

-- source: public/tables/recommendation_day_overrides.sql
create table "public"."recommendation_day_overrides" (
  "tenant_id"        uuid                     not null,
  "user_id"          uuid                     not null,
  "activity_date"    date                     not null default CURRENT_DATE,
  "engagement_extra" integer                  not null default 0,
  "networking_extra" integer                  not null default 0,
  "created_at"       timestamp with time zone not null default now(),
  "updated_at"       timestamp with time zone not null default now(),
  constraint "recommendation_day_engagement_extra_check" check (((engagement_extra >= 0) AND (engagement_extra <= 100))),
  constraint "recommendation_day_networking_extra_check" check (((networking_extra >= 0) AND (networking_extra <= 100))),
  constraint "recommendation_day_overrides_pkey" primary key (tenant_id, user_id, activity_date),
  constraint "recommendation_day_overrides_user_id_fkey" foreign key (user_id) references auth.users(id) on delete cascade,
  constraint "recommendation_day_overrides_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."recommendation_day_overrides"
  enable row level security;

create index recommendation_day_overrides_user_id_idx on public.recommendation_day_overrides using btree (user_id);

create policy "members read own recommendation day overrides" on "public"."recommendation_day_overrides"
  for select
  to "authenticated"
  using (((user_id = ( select auth.uid() as uid)) AND app_private.is_tenant_member(tenant_id)));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."recommendation_day_overrides" to "authenticated", "postgres", "service_role";

-- source: public/tables/relationship_contexts.sql
create table "public"."relationship_contexts" (
  "id"               uuid                     not null default gen_random_uuid(),
  "tenant_id"        uuid                     not null,
  "name"             text                     not null,
  "canonical_key"    text                     not null,
  "context_type"     text                     not null default 'other'::text,
  "connection_prior" text                     not null default 'moderate'::text,
  "description"      text,
  "starts_on"        date,
  "ends_on"          date,
  "source"           text                     not null default 'owner'::text,
  "created_by"       uuid,
  "archived_at"      timestamp with time zone,
  "created_at"       timestamp with time zone not null default now(),
  "updated_at"       timestamp with time zone not null default now(),
  constraint "relationship_contexts_created_by_fkey" foreign key (created_by) references auth.users(id) on delete set null,
  constraint "relationship_contexts_dates_check" check (((ends_on IS NULL) OR (starts_on IS NULL) OR (ends_on >= starts_on))),
  constraint "relationship_contexts_name_check" check (((length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 160))),
  constraint "relationship_contexts_pkey" primary key (id),
  constraint "relationship_contexts_prior_check" check ((connection_prior = ANY (ARRAY['strong'::text, 'moderate'::text, 'weak'::text, 'none'::text]))),
  constraint "relationship_contexts_tenant_id_canonical_key_key" unique (tenant_id, canonical_key),
  constraint "relationship_contexts_tenant_id_id_key" unique (tenant_id, id),
  constraint "relationship_contexts_type_check"
    check
    ((context_type = ANY (ARRAY['mastermind'::text, 'conference'::text, 'board'::text, 'community'::text, 'company'::text, 'cohort'::text, 'school'::text, 'event'::text,
    'other'::text]))),
  constraint "relationship_contexts_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint "relationship_contexts_key_check" check ((canonical_key = app_private.relationship_context_key(name)))
);

alter table "public"."relationship_contexts"
  enable row level security;

create index relationship_contexts_active_name_idx on public.relationship_contexts using btree (tenant_id, name)
  where (archived_at is null);

create index relationship_contexts_created_by_idx on public.relationship_contexts using btree (created_by)
  where (created_by is not null);

create trigger set_relationship_contexts_updated_at
  before update on public.relationship_contexts
  for each row
  execute function public.set_updated_at();

create policy "members read relationship contexts" on "public"."relationship_contexts"
  for select
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."relationship_contexts" to "postgres", "service_role";

revoke all on table "public"."relationship_contexts" from "authenticated";

grant select on table "public"."relationship_contexts" to "authenticated";

-- source: public/tables/tenant_config.sql
create table "public"."tenant_config" (
  "tenant_id"       uuid                     not null,
  "modules"         jsonb                    not null default '{}'::jsonb,
  "quotas"          jsonb                    not null default '{}'::jsonb,
  "write_rules"     jsonb                    not null default '{}'::jsonb,
  "voice_profile"   jsonb                    not null default '{}'::jsonb,
  "onboarding"      jsonb                    not null default '{}'::jsonb,
  "retention"       jsonb                    not null default '{}'::jsonb,
  "prompt_versions" jsonb                    not null default '{}'::jsonb,
  "created_at"      timestamp with time zone not null default now(),
  "updated_at"      timestamp with time zone not null default now(),
  constraint "tenant_config_pkey" primary key (tenant_id),
  constraint "tenant_config_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."tenant_config"
  enable row level security;

create trigger set_tenant_config_updated_at
  before update on public.tenant_config
  for each row
  execute function public.set_updated_at();

create policy "members read config" on "public"."tenant_config"
  for select
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

create policy "owner and operator update config" on "public"."tenant_config"
  for update
  to "authenticated"
  using (app_private.has_tenant_role(tenant_id, ARRAY['owner'::text, 'operator'::text]))
  with check (app_private.has_tenant_role(tenant_id, ARRAY['owner'::text, 'operator'::text]));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."tenant_config" to "authenticated", "postgres", "service_role";

-- source: public/tables/tenant_members.sql
create table "public"."tenant_members" (
  "tenant_id"  uuid                     not null,
  "user_id"    uuid                     not null,
  "role"       text                     not null,
  "status"     text                     not null default 'active'::text,
  "created_at" timestamp with time zone not null default now(),
  constraint "tenant_members_pkey" primary key (tenant_id, user_id),
  constraint "tenant_members_role_check" check ((role = ANY (ARRAY['owner'::text, 'operator'::text]))),
  constraint "tenant_members_status_check" check ((status = ANY (ARRAY['active'::text, 'invited'::text, 'disabled'::text]))),
  constraint "tenant_members_user_id_fkey" foreign key (user_id) references auth.users(id) on delete cascade,
  constraint "tenant_members_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."tenant_members"
  enable row level security;

create index tenant_members_user_idx on public.tenant_members using btree (user_id);

create policy "members read memberships" on "public"."tenant_members"
  for select
  to "authenticated"
  using (((user_id = ( select auth.uid() as uid)) or app_private.has_tenant_role(tenant_id, ARRAY['owner'::text, 'operator'::text])));

create policy "owners delete memberships" on "public"."tenant_members"
  for delete
  to "authenticated"
  using (app_private.has_tenant_role(tenant_id, ARRAY['owner'::text]));

create policy "owners insert memberships" on "public"."tenant_members"
  for insert
  to "authenticated"
  with check (app_private.has_tenant_role(tenant_id, ARRAY['owner'::text]));

create policy "owners update memberships" on "public"."tenant_members"
  for update
  to "authenticated"
  using (app_private.has_tenant_role(tenant_id, ARRAY['owner'::text]))
  with check (app_private.has_tenant_role(tenant_id, ARRAY['owner'::text]));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."tenant_members" to "authenticated", "postgres", "service_role";

-- source: public/tables/usage_events.sql
create table "public"."usage_events" (
  "id"                  uuid                     not null default gen_random_uuid(),
  "tenant_id"           uuid,
  "actor_user_id"       uuid,
  "actor_type"          text                     not null default 'system'::text,
  "event_type"          text                     not null,
  "quantity"            numeric                  not null default 1,
  "unit"                text                     not null default 'event'::text,
  "cost_cents"          integer,
  "metadata"            jsonb                    not null default '{}'::jsonb,
  "created_at"          timestamp with time zone not null default now(),
  "provider"            text,
  "provider_operation"  text,
  "external_ref"        text,
  "provider_cost_cents" integer,
  "billable_cents"      integer,
  "billing_status"      text,
  "pricing_snapshot"    jsonb                    not null default '{}'::jsonb,
  "settled_at"          timestamp with time zone,
  constraint "usage_events_actor_type_check" check ((actor_type = ANY (ARRAY['client'::text, 'operator'::text, 'claude'::text, 'system'::text, 'gateway'::text]))),
  constraint "usage_events_actor_user_id_fkey" foreign key (actor_user_id) references auth.users(id) on delete set null,
  constraint "usage_events_billable_nonnegative" check (((billable_cents IS NULL) OR (billable_cents >= 0))),
  constraint "usage_events_billing_status_check" check (((billing_status IS NULL) OR (billing_status = ANY (ARRAY['estimated'::text, 'final'::text, 'credited'::text])))),
  constraint "usage_events_pkey" primary key (id),
  constraint "usage_events_provider_cost_nonnegative" check (((provider_cost_cents IS NULL) OR (provider_cost_cents >= 0))),
  constraint "usage_events_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."usage_events"
  enable row level security;

create index usage_events_actor_user_id_idx on public.usage_events using btree (actor_user_id)
  where (actor_user_id is not null);

create unique index usage_events_provider_external_idx on public.usage_events using btree (tenant_id, provider, external_ref, event_type)
  where ((provider is not null) AND (external_ref is not null));

create index usage_events_provider_month_idx on public.usage_events using btree (tenant_id, provider, created_at desc)
  where (provider is not null);

create index usage_events_tenant_time_idx on public.usage_events using btree (tenant_id, created_at desc);

create policy "owner and operator read usage" on "public"."usage_events"
  for select
  to "authenticated"
  using (((tenant_id is null) or app_private.has_tenant_role(tenant_id, ARRAY['owner'::text, 'operator'::text])));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."usage_events" to "postgres", "service_role";

revoke all on table "public"."usage_events" from "authenticated";

grant select on table "public"."usage_events" to "authenticated";

-- source: public/tables/calendar_events.sql
create table "public"."calendar_events" (
  "id"                uuid                     not null default gen_random_uuid(),
  "tenant_id"         uuid                     not null,
  "connection_id"     uuid                     not null,
  "owner_user_id"     uuid                     not null,
  "provider"          text                     not null default 'google_calendar'::text,
  "external_event_id" text                     not null,
  "title"             text,
  "starts_at"         timestamp with time zone not null,
  "ends_at"           timestamp with time zone,
  "status"            text,
  "html_url"          text,
  "organizer_email"   text,
  "is_all_day"        boolean                  not null default false,
  "metadata"          jsonb                    not null default '{}'::jsonb,
  "created_at"        timestamp with time zone not null default now(),
  "updated_at"        timestamp with time zone not null default now(),
  constraint "calendar_events_owner_user_id_fkey" foreign key (owner_user_id) references auth.users(id) on delete cascade,
  constraint "calendar_events_pkey" primary key (id),
  constraint "calendar_events_tenant_id_connection_id_external_event_id_key" unique (tenant_id, connection_id, external_event_id),
  constraint "calendar_events_tenant_id_owner_key" unique (tenant_id, id, owner_user_id),
  constraint "calendar_events_tenant_connection_owner_fkey" foreign key (tenant_id, connection_id, owner_user_id) references public.integration_connections(tenant_id, id, user_id)
    on delete cascade,
  constraint "calendar_events_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."calendar_events"
  enable row level security;

create index calendar_events_connection_idx on public.calendar_events using btree (connection_id);

create index calendar_events_owner_start_idx on public.calendar_events using btree (tenant_id, owner_user_id, starts_at);

create index calendar_events_owner_user_idx on public.calendar_events using btree (owner_user_id);

create index calendar_events_tenant_connection_owner_idx on public.calendar_events using btree (tenant_id, connection_id, owner_user_id);

create trigger set_calendar_events_updated_at
  before update on public.calendar_events
  for each row
  execute function public.set_updated_at();

create policy "members read calendar events" on "public"."calendar_events"
  for select
  to "authenticated"
  using (((owner_user_id = ( select auth.uid() as uid)) AND app_private.is_tenant_member(tenant_id)));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."calendar_events" to "authenticated", "postgres", "service_role";

-- source: public/tables/connections.sql
create table "public"."connections" (
  "id"            uuid                     not null default gen_random_uuid(),
  "tenant_id"     uuid                     not null,
  "contact_a"     uuid                     not null,
  "contact_b"     uuid                     not null,
  "source"        text,
  "evidence"      jsonb                    not null default '{}'::jsonb,
  "confidence"    numeric(4,3),
  "created_at"    timestamp with time zone not null default now(),
  "status"        text                     not null default 'suggested'::text,
  "owner_note"    text,
  "confirmed_at"  timestamp with time zone,
  "confirmed_by"  uuid,
  "updated_at"    timestamp with time zone not null default now(),
  "snoozed_until" timestamp with time zone,
  "snoozed_at"    timestamp with time zone,
  "snoozed_by"    uuid,
  constraint "connections_canonical_pair_check" check ((contact_a < contact_b)),
  constraint "connections_confirmed_by_fkey" foreign key (confirmed_by) references auth.users(id) on delete set null,
  constraint "connections_no_self_link" check ((contact_a <> contact_b)),
  constraint "connections_pkey" primary key (id),
  constraint "connections_snoozed_by_fkey" foreign key (snoozed_by) references auth.users(id) on delete set null,
  constraint "connections_status_check" check ((status = ANY (ARRAY['suggested'::text, 'already_connected'::text, 'dismissed'::text]))),
  constraint "connections_tenant_id_id_key" unique (tenant_id, id),
  constraint "connections_unique_pair" unique (tenant_id, contact_a, contact_b),
  constraint "connections_contact_a_fkey" foreign key (tenant_id, contact_a) references public.contacts(tenant_id, id) on delete cascade,
  constraint "connections_contact_b_fkey" foreign key (tenant_id, contact_b) references public.contacts(tenant_id, id) on delete cascade,
  constraint "connections_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."connections"
  enable row level security;

create index connections_confirmed_by_idx on public.connections using btree (confirmed_by)
  where (confirmed_by is not null);

create index connections_contact_a_idx on public.connections using btree (contact_a);

create index connections_contact_b_idx on public.connections using btree (contact_b);

create index connections_snoozed_by_idx on public.connections using btree (snoozed_by)
  where (snoozed_by is not null);

create index connections_tenant_contact_a_idx on public.connections using btree (tenant_id, contact_a);

create index connections_tenant_contact_b_idx on public.connections using btree (tenant_id, contact_b);

create index connections_tenant_status_snoozed_created_idx on public.connections using btree (tenant_id, status, snoozed_until, created_at desc);

create trigger connections_canonicalize_pair
  before insert or update of contact_a, contact_b on public.connections
  for each row
  execute function app_private.canonicalize_connection_pair();

create policy "members read connections" on "public"."connections"
  for select
  to "authenticated"
  using (((tenant_id is not null) AND app_private.is_tenant_member(tenant_id)));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."connections" to "postgres", "service_role";

revoke all on table "public"."connections" from "authenticated";

grant select on table "public"."connections" to "authenticated";

-- source: public/tables/interaction_contacts.sql
create table "public"."interaction_contacts" (
  "interaction_id" uuid not null,
  "contact_id"     uuid not null,
  "tenant_id"      uuid not null,
  "role"           text,
  constraint "interaction_contacts_contact_id_fkey" foreign key (contact_id) references public.contacts(id) on delete cascade,
  constraint "interaction_contacts_pkey" primary key (interaction_id, contact_id),
  constraint "interaction_contacts_tenant_contact_fkey" foreign key (tenant_id, contact_id) references public.contacts(tenant_id, id) on delete cascade,
  constraint "interaction_contacts_interaction_id_fkey" foreign key (interaction_id) references public.interactions(id) on delete cascade,
  constraint "interaction_contacts_tenant_interaction_fkey" foreign key (tenant_id, interaction_id) references public.interactions(tenant_id, id) on delete cascade,
  constraint "interaction_contacts_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."interaction_contacts"
  enable row level security;

create index interaction_contacts_contact_id_idx on public.interaction_contacts using btree (contact_id);

create index interaction_contacts_tenant_contact_idx on public.interaction_contacts using btree (tenant_id, contact_id);

create index interaction_contacts_tenant_id_idx on public.interaction_contacts using btree (tenant_id);

create index interaction_contacts_tenant_interaction_idx on public.interaction_contacts using btree (tenant_id, interaction_id);

create policy "members delete interaction contacts" on "public"."interaction_contacts"
  for delete
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

create policy "members insert interaction contacts" on "public"."interaction_contacts"
  for insert
  to "authenticated"
  with check (app_private.is_tenant_member(tenant_id));

create policy "members read interaction contacts" on "public"."interaction_contacts"
  for select
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

create policy "members update interaction contacts" on "public"."interaction_contacts"
  for update
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id))
  with check (app_private.is_tenant_member(tenant_id));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."interaction_contacts" to "authenticated", "postgres", "service_role";

-- source: public/tables/introductions.sql
create table "public"."introductions" (
  "id"                     uuid                     not null default gen_random_uuid(),
  "tenant_id"              uuid                     not null,
  "notion_url"             text,
  "person_a"               uuid,
  "person_b"               uuid,
  "date_proposed"          date,
  "date_made"              date,
  "why_context"            text,
  "status"                 text                     not null default 'proposed'::text,
  "outcome"                text,
  "follow_up_on"           date,
  "created_by"             uuid,
  "created_at"             timestamp with time zone not null default now(),
  "updated_at"             timestamp with time zone not null default now(),
  "draft_subject"          text,
  "draft_body"             text,
  "draft_generated_at"     timestamp with time zone,
  "draft_provider"         text,
  "draft_model"            text,
  "draft_evidence"         jsonb                    not null default '{}'::jsonb,
  "gmail_draft_id"         text,
  "gmail_draft_created_at" timestamp with time zone,
  constraint "introductions_created_by_fkey" foreign key (created_by) references auth.users(id) on delete set null,
  constraint "introductions_person_a_fkey" foreign key (tenant_id, person_a) references public.contacts(tenant_id, id) on delete set null (person_a),
  constraint "introductions_person_b_fkey" foreign key (tenant_id, person_b) references public.contacts(tenant_id, id) on delete set null (person_b),
  constraint "introductions_pkey" primary key (id),
  constraint "introductions_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."introductions"
  enable row level security;

create index introductions_created_by_idx on public.introductions using btree (created_by)
  where (created_by is not null);

create index introductions_person_a_idx on public.introductions using btree (person_a)
  where (person_a is not null);

create index introductions_person_b_idx on public.introductions using btree (person_b)
  where (person_b is not null);

create index introductions_tenant_idx on public.introductions using btree (tenant_id)
  where (tenant_id is not null);

create index introductions_tenant_person_a_idx on public.introductions using btree (tenant_id, person_a)
  where (person_a is not null);

create index introductions_tenant_person_b_idx on public.introductions using btree (tenant_id, person_b)
  where (person_b is not null);

create trigger set_introductions_updated_at
  before update on public.introductions
  for each row
  execute function public.set_updated_at();

create policy "members delete introductions" on "public"."introductions"
  for delete
  to "authenticated"
  using (((tenant_id is not null) AND app_private.is_tenant_member(tenant_id)));

create policy "members insert introductions" on "public"."introductions"
  for insert
  to "authenticated"
  with check (((tenant_id IS NOT NULL) AND app_private.is_tenant_member(tenant_id)));

create policy "members read introductions" on "public"."introductions"
  for select
  to "authenticated"
  using (((tenant_id is not null) AND app_private.is_tenant_member(tenant_id)));

create policy "members update introductions" on "public"."introductions"
  for update
  to "authenticated"
  using (((tenant_id is not null) AND app_private.is_tenant_member(tenant_id)))
  with check (((tenant_id IS NOT NULL) AND app_private.is_tenant_member(tenant_id)));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."introductions" to "authenticated", "postgres", "service_role";

-- source: public/tables/pending_changes.sql
create table "public"."pending_changes" (
  "id"                            uuid                     not null default gen_random_uuid(),
  "tenant_id"                     uuid,
  "contact_id"                    uuid,
  "change_type"                   text                     not null,
  "summary"                       text                     not null,
  "payload"                       jsonb                    not null default '{}'::jsonb,
  "status"                        text                     not null default 'pending'::text,
  "risk_level"                    text                     not null default 'low'::text,
  "source"                        text,
  "proposed_by"                   text                     not null default 'claude'::text,
  "reviewed_by"                   uuid,
  "reviewed_at"                   timestamp with time zone,
  "created_at"                    timestamp with time zone not null default now(),
  "idempotency_key"               text,
  "replaces_pending_change_id"    uuid,
  "replaced_by_pending_change_id" uuid,
  "superseded_at"                 timestamp with time zone,
  constraint "pending_changes_contact_id_fkey" foreign key (contact_id) references public.contacts(id) on delete set null,
  constraint "pending_changes_pkey" primary key (id),
  constraint "pending_changes_replaced_by_pending_change_id_fkey" foreign key (replaced_by_pending_change_id) references public.pending_changes(id) on delete set null,
  constraint "pending_changes_replaces_pending_change_id_fkey" foreign key (replaces_pending_change_id) references public.pending_changes(id) on delete set null,
  constraint "pending_changes_reviewed_by_fkey" foreign key (reviewed_by) references auth.users(id) on delete set null,
  constraint "pending_changes_risk_level_check" check ((risk_level = ANY (ARRAY['low'::text, 'high'::text]))),
  constraint "pending_changes_status_check" check ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'dismissed'::text, 'edited'::text]))),
  constraint "pending_changes_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."pending_changes"
  enable row level security;

create index pending_changes_contact_id_idx on public.pending_changes using btree (contact_id)
  where (contact_id is not null);

create index pending_changes_replaced_by_idx on public.pending_changes using btree (tenant_id, replaced_by_pending_change_id)
  where (replaced_by_pending_change_id is not null);

create index pending_changes_replaced_by_pending_change_id_idx on public.pending_changes using btree (replaced_by_pending_change_id);

create index pending_changes_replaces_idx on public.pending_changes using btree (tenant_id, replaces_pending_change_id)
  where (replaces_pending_change_id is not null);

create index pending_changes_replaces_pending_change_id_idx on public.pending_changes using btree (replaces_pending_change_id);

create index pending_changes_reviewed_by_idx on public.pending_changes using btree (reviewed_by)
  where (reviewed_by is not null);

create index pending_changes_superseded_idx on public.pending_changes using btree (tenant_id, superseded_at desc)
  where (superseded_at is not null);

create unique index pending_changes_tenant_idempotency_key_idx on public.pending_changes using btree (tenant_id, idempotency_key)
  where (idempotency_key is not null);

create index pending_changes_tenant_status_idx on public.pending_changes using btree (tenant_id, status, created_at desc);

create policy "members read pending changes" on "public"."pending_changes"
  for select
  to "authenticated"
  using (((tenant_id is not null) AND app_private.is_tenant_member(tenant_id)));

create policy "members review pending changes" on "public"."pending_changes"
  for update
  to "authenticated"
  using (((tenant_id is not null) AND app_private.is_tenant_member(tenant_id)))
  with check (((tenant_id IS NOT NULL) AND app_private.is_tenant_member(tenant_id)));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."pending_changes" to "authenticated", "postgres", "service_role";

comment on column "public"."pending_changes"."replaced_by_pending_change_id" is 'For stale original proposals, points to the newer pending change that superseded this row.';

comment on column "public"."pending_changes"."replaces_pending_change_id" is 'For revised Claude proposals, points to the original pending change this row replaces.';

comment on column "public"."pending_changes"."superseded_at" is 'Timestamp when this pending change was superseded by a replacement proposal.';

-- source: public/tables/promises.sql
create table "public"."promises" (
  "id"             uuid                     not null default gen_random_uuid(),
  "tenant_id"      uuid                     not null,
  "contact_id"     uuid,
  "interaction_id" uuid,
  "direction"      text                     not null,
  "promise_text"   text                     not null,
  "status"         text                     not null default 'open'::text,
  "due_on"         date,
  "completed_at"   timestamp with time zone,
  "source"         text                     not null default 'claude'::text,
  "evidence"       jsonb                    not null default '{}'::jsonb,
  "created_at"     timestamp with time zone not null default now(),
  "updated_at"     timestamp with time zone not null default now(),
  constraint "promises_contact_id_fkey" foreign key (contact_id) references public.contacts(id) on delete set null,
  constraint "promises_direction_check" check ((direction = ANY (ARRAY['owner_owes_contact'::text, 'contact_owes_owner'::text]))),
  constraint "promises_interaction_id_fkey" foreign key (interaction_id) references public.interactions(id) on delete set null,
  constraint "promises_pkey" primary key (id),
  constraint "promises_status_check" check ((status = ANY (ARRAY['open'::text, 'completed'::text, 'skipped'::text, 'stopped'::text]))),
  constraint "promises_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."promises"
  enable row level security;

create index promises_contact_id_idx on public.promises using btree (contact_id)
  where (contact_id is not null);

create index promises_interaction_id_idx on public.promises using btree (interaction_id)
  where (interaction_id is not null);

create index promises_tenant_status_idx on public.promises using btree (tenant_id, status, due_on);

create trigger set_promises_updated_at
  before update on public.promises
  for each row
  execute function public.set_updated_at();

create policy "members delete promises" on "public"."promises"
  for delete
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

create policy "members insert promises" on "public"."promises"
  for insert
  to "authenticated"
  with check (app_private.is_tenant_member(tenant_id));

create policy "members read promises" on "public"."promises"
  for select
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

create policy "members update promises" on "public"."promises"
  for update
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id))
  with check (app_private.is_tenant_member(tenant_id));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."promises" to "authenticated", "postgres", "service_role";

-- source: public/tables/relationship_actions.sql
create table "public"."relationship_actions" (
  "id"           uuid                     not null default gen_random_uuid(),
  "tenant_id"    uuid                     not null,
  "contact_id"   uuid,
  "title"        text                     not null,
  "action_type"  text                     not null default 'follow_up'::text,
  "status"       text                     not null default 'open'::text,
  "priority"     text                     not null default 'normal'::text,
  "due_on"       date,
  "source"       text,
  "notes"        text,
  "metadata"     jsonb                    not null default '{}'::jsonb,
  "created_by"   uuid,
  "completed_at" timestamp with time zone,
  "created_at"   timestamp with time zone not null default now(),
  "updated_at"   timestamp with time zone not null default now(),
  constraint "relationship_actions_action_type_check"
    check
    ((action_type = ANY (ARRAY['follow_up'::text, 'reconnect'::text, 'promise'::text, 'introduction'::text, 'referral'::text, 'podcast'::text, 'owner_verification'::text,
    'claude_draft'::text, 'other'::text]))),
  constraint "relationship_actions_created_by_fkey" foreign key (created_by) references auth.users(id) on delete set null,
  constraint "relationship_actions_pkey" primary key (id),
  constraint "relationship_actions_priority_check" check ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text]))),
  constraint "relationship_actions_status_check" check ((status = ANY (ARRAY['open'::text, 'deferred'::text, 'done'::text, 'skipped'::text]))),
  constraint "relationship_actions_tenant_contact_fkey" foreign key (tenant_id, contact_id) references public.contacts(tenant_id, id) on delete cascade,
  constraint "relationship_actions_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."relationship_actions"
  enable row level security;

create index relationship_actions_contact_idx on public.relationship_actions using btree (contact_id);

create index relationship_actions_created_by_idx on public.relationship_actions using btree (created_by);

create index relationship_actions_tenant_contact_idx on public.relationship_actions using btree (tenant_id, contact_id)
  where (contact_id is not null);

create index relationship_actions_tenant_status_due_idx on public.relationship_actions using btree (tenant_id, status, due_on, created_at desc);

create trigger set_relationship_actions_updated_at
  before update on public.relationship_actions
  for each row
  execute function public.set_updated_at();

create policy "members delete relationship actions" on "public"."relationship_actions"
  for delete
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

create policy "members insert relationship actions" on "public"."relationship_actions"
  for insert
  to "authenticated"
  with check (app_private.is_tenant_member(tenant_id));

create policy "members read relationship actions" on "public"."relationship_actions"
  for select
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

create policy "members update relationship actions" on "public"."relationship_actions"
  for update
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id))
  with check (app_private.is_tenant_member(tenant_id));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."relationship_actions" to "authenticated", "postgres", "service_role";

-- source: public/tables/relationship_context_memberships.sql
create table "public"."relationship_context_memberships" (
  "tenant_id"            uuid                     not null,
  "context_id"           uuid                     not null,
  "contact_id"           uuid                     not null,
  "role_note"            text,
  "verification_state"   text                     not null default 'confirmed'::text,
  "source"               text                     not null default 'owner'::text,
  "evidence"             jsonb                    not null default '{}'::jsonb,
  "source_connection_id" uuid,
  "created_by"           uuid,
  "created_at"           timestamp with time zone not null default now(),
  "updated_at"           timestamp with time zone not null default now(),
  constraint "relationship_context_memberships_created_by_fkey" foreign key (created_by) references auth.users(id) on delete set null,
  constraint "relationship_context_memberships_pkey" primary key (tenant_id, context_id, contact_id),
  constraint "relationship_context_memberships_tenant_id_contact_id_fkey" foreign key (tenant_id, contact_id) references public.contacts(tenant_id, id) on delete cascade,
  constraint "relationship_context_memberships_verification_check" check ((verification_state = ANY (ARRAY['confirmed'::text, 'inferred'::text]))),
  constraint "relationship_context_memberships_tenant_id_context_id_fkey" foreign key (tenant_id, context_id) references public.relationship_contexts(tenant_id, id)
    on delete cascade
);

alter table "public"."relationship_context_memberships"
  enable row level security;

create index relationship_context_memberships_contact_idx on public.relationship_context_memberships using btree (tenant_id, contact_id, context_id);

create index relationship_context_memberships_created_by_idx on public.relationship_context_memberships using btree (created_by)
  where (created_by is not null);

create trigger set_relationship_context_memberships_updated_at
  before update on public.relationship_context_memberships
  for each row
  execute function public.set_updated_at();

create policy "members read relationship context memberships" on "public"."relationship_context_memberships"
  for select
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."relationship_context_memberships" to "postgres", "service_role";

revoke all on table "public"."relationship_context_memberships" from "authenticated";

grant select on table "public"."relationship_context_memberships" to "authenticated";

-- source: public/tables/transcripts.sql
create table "public"."transcripts" (
  "id"                uuid                     not null default gen_random_uuid(),
  "tenant_id"         uuid                     not null,
  "interaction_id"    uuid,
  "storage_path"      text,
  "title"             text,
  "source"            text,
  "source_ref"        text,
  "transcript_sha256" text,
  "retention_until"   date,
  "distilled_summary" text,
  "metadata"          jsonb                    not null default '{}'::jsonb,
  "created_at"        timestamp with time zone not null default now(),
  constraint "transcripts_interaction_id_fkey" foreign key (interaction_id) references public.interactions(id) on delete set null,
  constraint "transcripts_pkey" primary key (id),
  constraint "transcripts_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade
);

alter table "public"."transcripts"
  enable row level security;

create index transcripts_interaction_id_idx on public.transcripts using btree (interaction_id)
  where (interaction_id is not null);

create index transcripts_tenant_id_idx on public.transcripts using btree (tenant_id);

create policy "members read transcript metadata" on "public"."transcripts"
  for select
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

create policy "owner and operator delete transcript metadata" on "public"."transcripts"
  for delete
  to "authenticated"
  using (app_private.has_tenant_role(tenant_id, ARRAY['owner'::text, 'operator'::text]));

create policy "owner and operator insert transcript metadata" on "public"."transcripts"
  for insert
  to "authenticated"
  with check (app_private.has_tenant_role(tenant_id, ARRAY['owner'::text, 'operator'::text]));

create policy "owner and operator update transcript metadata" on "public"."transcripts"
  for update
  to "authenticated"
  using (app_private.has_tenant_role(tenant_id, ARRAY['owner'::text, 'operator'::text]))
  with check (app_private.has_tenant_role(tenant_id, ARRAY['owner'::text, 'operator'::text]));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."transcripts" to "authenticated", "postgres", "service_role";

-- source: public/tables/want_to_know.sql
create table "public"."want_to_know" (
  "id"                          uuid                     not null default gen_random_uuid(),
  "tenant_id"                   uuid                     not null,
  "full_name"                   text                     not null,
  "lane"                        text,
  "stage"                       text                     not null default 'watching'::text,
  "bucket"                      text,
  "source"                      text,
  "why"                         text,
  "company"                     text,
  "linkedin"                    text,
  "dossier"                     jsonb                    not null default '{}'::jsonb,
  "engagement_count"            integer                  not null default 0,
  "last_touch"                  date,
  "added_at"                    timestamp with time zone not null default now(),
  "updated_at"                  timestamp with time zone not null default now(),
  "engagement_target_per_month" numeric(4,2),
  "email"                       text,
  "graduated_contact_id"        uuid,
  "graduated_at"                timestamp with time zone,
  constraint "want_to_know_engagement_target_per_month_check"
    check (((engagement_target_per_month IS NULL) OR ((engagement_target_per_month >= (0)::numeric) AND (engagement_target_per_month <= (8)::numeric)))),
  constraint "want_to_know_graduated_contact_fkey" foreign key (tenant_id, graduated_contact_id) references public.contacts(tenant_id, id) on delete
    set null (graduated_contact_id),
  constraint "want_to_know_graduation_state_check" check (((graduated_contact_id IS NULL) OR ((stage = 'graduated'::text) AND (graduated_at IS NOT NULL)))),
  constraint "want_to_know_pkey" primary key (id),
  constraint "want_to_know_stage_check" check ((stage = ANY (ARRAY['watching'::text, 'researching'::text, 'warming'::text, 'ready'::text, 'graduated'::text]))),
  constraint "want_to_know_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint "want_to_know_tenant_id_id_key" unique (tenant_id, id)
);

alter table "public"."want_to_know"
  enable row level security;

create index want_to_know_tenant_graduated_contact_idx on public.want_to_know using btree (tenant_id, graduated_contact_id)
  where (graduated_contact_id is not null);

create index want_to_know_tenant_id_idx on public.want_to_know using btree (tenant_id)
  where (tenant_id is not null);

create trigger set_want_to_know_updated_at
  before update on public.want_to_know
  for each row
  execute function public.set_updated_at();

create policy "members delete want to know" on "public"."want_to_know"
  for delete
  to "authenticated"
  using (((tenant_id is not null) AND app_private.is_tenant_member(tenant_id)));

create policy "members insert want to know" on "public"."want_to_know"
  for insert
  to "authenticated"
  with check (((tenant_id IS NOT NULL) AND app_private.is_tenant_member(tenant_id)));

create policy "members read want to know" on "public"."want_to_know"
  for select
  to "authenticated"
  using (((tenant_id is not null) AND app_private.is_tenant_member(tenant_id)));

create policy "members update want to know" on "public"."want_to_know"
  for update
  to "authenticated"
  using (((tenant_id is not null) AND app_private.is_tenant_member(tenant_id)))
  with check (((tenant_id IS NOT NULL) AND app_private.is_tenant_member(tenant_id)));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."want_to_know" to "authenticated", "postgres", "service_role";

comment on column "public"."want_to_know"."lane" is 'Client-specific prospecting lane such as podcast, investor, M&A, partner, referral, or client.';

-- source: public/tables/calendar_attendee_preferences.sql
create table "public"."calendar_attendee_preferences" (
  "tenant_id"        uuid                     not null,
  "user_id"          uuid                     not null,
  "normalized_email" text                     not null,
  "decision"         text                     not null,
  "contact_id"       uuid,
  "want_to_know_id"  uuid,
  "decided_at"       timestamp with time zone not null default now(),
  "metadata"         jsonb                    not null default '{}'::jsonb,
  "updated_at"       timestamp with time zone not null default now(),
  constraint "calendar_attendee_preferences_decision_check" check ((decision = ANY (ARRAY['ignore'::text, 'book'::text, 'want_to_know'::text]))),
  constraint "calendar_attendee_preferences_pkey" primary key (tenant_id, user_id, normalized_email),
  constraint "calendar_attendee_preferences_user_id_fkey" foreign key (user_id) references auth.users(id) on delete cascade,
  constraint "calendar_preferences_one_match" check ((num_nonnulls(contact_id, want_to_know_id) <= 1)),
  constraint "calendar_preferences_tenant_contact_fkey" foreign key (tenant_id, contact_id) references public.contacts(tenant_id, id) on delete set null,
  constraint "calendar_attendee_preferences_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint "calendar_preferences_tenant_want_fkey" foreign key (tenant_id, want_to_know_id) references public.want_to_know(tenant_id, id) on delete set null
);

alter table "public"."calendar_attendee_preferences"
  enable row level security;

create index calendar_preferences_tenant_contact_idx on public.calendar_attendee_preferences using btree (tenant_id, contact_id)
  where (contact_id is not null);

create index calendar_preferences_tenant_want_idx on public.calendar_attendee_preferences using btree (tenant_id, want_to_know_id)
  where (want_to_know_id is not null);

create index calendar_preferences_user_idx on public.calendar_attendee_preferences using btree (user_id);

create trigger set_calendar_preferences_updated_at
  before update on public.calendar_attendee_preferences
  for each row
  execute function public.set_updated_at();

create policy "members read own calendar preferences" on "public"."calendar_attendee_preferences"
  for select
  to "authenticated"
  using (((user_id = ( select auth.uid() as uid)) AND app_private.is_tenant_member(tenant_id)));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."calendar_attendee_preferences" to "authenticated", "postgres", "service_role";

-- source: public/tables/calendar_attendees.sql
create table "public"."calendar_attendees" (
  "id"                      uuid                     not null default gen_random_uuid(),
  "tenant_id"               uuid                     not null,
  "event_id"                uuid                     not null,
  "owner_user_id"           uuid                     not null,
  "normalized_email"        text                     not null,
  "display_name"            text,
  "response_status"         text,
  "is_organizer"            boolean                  not null default false,
  "matched_contact_id"      uuid,
  "matched_want_to_know_id" uuid,
  "created_at"              timestamp with time zone not null default now(),
  "updated_at"              timestamp with time zone not null default now(),
  "metadata"                jsonb                    not null default '{}'::jsonb,
  constraint "calendar_attendees_event_id_normalized_email_key" unique (event_id, normalized_email),
  constraint "calendar_attendees_one_match" check ((num_nonnulls(matched_contact_id, matched_want_to_know_id) <= 1)),
  constraint "calendar_attendees_owner_user_id_fkey" foreign key (owner_user_id) references auth.users(id) on delete cascade,
  constraint "calendar_attendees_pkey" primary key (id),
  constraint "calendar_attendees_tenant_event_owner_fkey" foreign key (tenant_id, event_id, owner_user_id) references public.calendar_events(tenant_id, id, owner_user_id)
    on delete cascade,
  constraint "calendar_attendees_tenant_contact_fkey" foreign key (tenant_id, matched_contact_id) references public.contacts(tenant_id, id) on delete set null,
  constraint "calendar_attendees_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint "calendar_attendees_tenant_want_fkey" foreign key (tenant_id, matched_want_to_know_id) references public.want_to_know(tenant_id, id) on delete set null
);

alter table "public"."calendar_attendees"
  enable row level security;

create index calendar_attendees_owner_user_idx on public.calendar_attendees using btree (owner_user_id);

create index calendar_attendees_tenant_contact_idx on public.calendar_attendees using btree (tenant_id, matched_contact_id)
  where (matched_contact_id is not null);

create index calendar_attendees_tenant_event_owner_idx on public.calendar_attendees using btree (tenant_id, event_id, owner_user_id);

create index calendar_attendees_tenant_want_idx on public.calendar_attendees using btree (tenant_id, matched_want_to_know_id)
  where (matched_want_to_know_id is not null);

create index calendar_attendees_unmatched_idx on public.calendar_attendees using btree (tenant_id, owner_user_id, normalized_email)
  where ((matched_contact_id is null) AND (matched_want_to_know_id is null));

create trigger set_calendar_attendees_updated_at
  before update on public.calendar_attendees
  for each row
  execute function public.set_updated_at();

create policy "members read calendar attendees" on "public"."calendar_attendees"
  for select
  to "authenticated"
  using (((owner_user_id = ( select auth.uid() as uid)) AND app_private.is_tenant_member(tenant_id)));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."calendar_attendees" to "authenticated", "postgres", "service_role";

-- source: public/tables/connection_contexts.sql
create table "public"."connection_contexts" (
  "tenant_id"     uuid                     not null,
  "connection_id" uuid                     not null,
  "context_id"    uuid                     not null,
  "note"          text,
  "created_by"    uuid,
  "created_at"    timestamp with time zone not null default now(),
  constraint "connection_contexts_created_by_fkey" foreign key (created_by) references auth.users(id) on delete set null,
  constraint "connection_contexts_pkey" primary key (tenant_id, connection_id, context_id),
  constraint "connection_contexts_tenant_id_connection_id_fkey" foreign key (tenant_id, connection_id) references public.connections(tenant_id, id) on delete cascade,
  constraint "connection_contexts_tenant_id_context_id_fkey" foreign key (tenant_id, context_id) references public.relationship_contexts(tenant_id, id) on delete cascade
);

alter table "public"."connection_contexts"
  enable row level security;

create index connection_contexts_context_idx on public.connection_contexts using btree (tenant_id, context_id, connection_id);

create index connection_contexts_created_by_idx on public.connection_contexts using btree (created_by)
  where (created_by is not null);

create policy "members read connection contexts" on "public"."connection_contexts"
  for select
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."connection_contexts" to "postgres", "service_role";

revoke all on table "public"."connection_contexts" from "authenticated";

grant select on table "public"."connection_contexts" to "authenticated";

-- source: public/tables/content_scan_sources.sql
create table "public"."content_scan_sources" (
  "id"                uuid                     not null default gen_random_uuid(),
  "tenant_id"         uuid                     not null,
  "contact_id"        uuid,
  "want_to_know_id"   uuid,
  "platform"          text                     not null,
  "source_url"        text                     not null,
  "enabled"           boolean                  not null default true,
  "next_scan_at"      timestamp with time zone not null default now(),
  "last_started_at"   timestamp with time zone,
  "last_completed_at" timestamp with time zone,
  "last_error"        text,
  "created_at"        timestamp with time zone not null default now(),
  "updated_at"        timestamp with time zone not null default now(),
  constraint "content_scan_sources_one_target" check ((num_nonnulls(contact_id, want_to_know_id) = 1)),
  constraint "content_scan_sources_pkey" primary key (id),
  constraint "content_scan_sources_platform_check" check ((platform = ANY (ARRAY['linkedin'::text, 'instagram'::text, 'facebook'::text, 'website'::text]))),
  constraint "content_scan_sources_tenant_contact_fkey" foreign key (tenant_id, contact_id) references public.contacts(tenant_id, id) on delete cascade,
  constraint "content_scan_sources_tenant_id_id_key" unique (tenant_id, id),
  constraint "content_scan_sources_tenant_id_platform_source_url_key" unique (tenant_id, platform, source_url),
  constraint "content_scan_sources_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint "content_scan_sources_tenant_want_fkey" foreign key (tenant_id, want_to_know_id) references public.want_to_know(tenant_id, id) on delete cascade
);

alter table "public"."content_scan_sources"
  enable row level security;

create index content_scan_sources_contact_idx on public.content_scan_sources using btree (tenant_id, contact_id)
  where (contact_id is not null);

create index content_scan_sources_due_idx on public.content_scan_sources using btree (tenant_id, next_scan_at)
  where enabled;

create index content_scan_sources_want_idx on public.content_scan_sources using btree (tenant_id, want_to_know_id)
  where (want_to_know_id is not null);

create trigger set_content_scan_sources_updated_at
  before update on public.content_scan_sources
  for each row
  execute function public.set_updated_at();

create policy "members read content scan sources" on "public"."content_scan_sources"
  for select
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."content_scan_sources" to "postgres", "service_role";

revoke all on table "public"."content_scan_sources" from "authenticated";

grant select on table "public"."content_scan_sources" to "authenticated";

-- source: public/tables/signals.sql
create table "public"."signals" (
  "id"                     uuid                     not null default gen_random_uuid(),
  "tenant_id"              uuid                     not null,
  "contact_id"             uuid,
  "signal_type"            text                     not null,
  "classification"         text,
  "summary"                text                     not null,
  "source"                 text,
  "source_url"             text,
  "payload"                jsonb                    not null default '{}'::jsonb,
  "observed_at"            timestamp with time zone not null default now(),
  "created_at"             timestamp with time zone not null default now(),
  "dismissed_at"           timestamp with time zone,
  "dismissed_by"           uuid,
  "want_to_know_id"        uuid,
  "published_at"           timestamp with time zone default now(),
  "expires_at"             timestamp with time zone,
  "engagement_lane"        text,
  "content_classification" text,
  "recommended_action"     text,
  "why_now"                text,
  "priority_score"         integer                  not null default 0,
  "exceptional_reason"     text,
  "opened_at"              timestamp with time zone,
  "opened_by"              uuid,
  "engaged_at"             timestamp with time zone,
  "engaged_by"             uuid,
  constraint "signals_contact_id_fkey" foreign key (contact_id) references public.contacts(id) on delete cascade,
  constraint "signals_dismissed_by_fkey" foreign key (dismissed_by) references auth.users(id) on delete set null,
  constraint "signals_engaged_by_fkey" foreign key (engaged_by) references auth.users(id) on delete set null,
  constraint "signals_engagement_lane_check" check (((engagement_lane IS NULL) OR (engagement_lane = ANY (ARRAY['active'::text, 'partners'::text, 'rescue'::text])))),
  constraint "signals_one_relationship_target_check" check ((num_nonnulls(contact_id, want_to_know_id) = 1)),
  constraint "signals_opened_by_fkey" foreign key (opened_by) references auth.users(id) on delete set null,
  constraint "signals_pkey" primary key (id),
  constraint "signals_recommended_action_check"
    check (((recommended_action IS NULL) OR (recommended_action = ANY (ARRAY['like'::text, 'comment'::text, 'share'::text, 'support'::text])))),
  constraint "signals_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint "signals_want_to_know_id_fkey" foreign key (want_to_know_id) references public.want_to_know(id) on delete set null
);

alter table "public"."signals"
  enable row level security;

create index signals_active_content_feed_idx on public.signals using btree (tenant_id, observed_at desc)
  where ((dismissed_at is null) AND (source_url is not null));

create index signals_contact_engaged_idx on public.signals using btree (tenant_id, contact_id, engaged_at desc)
  where ((engaged_at is not null) AND (contact_id is not null));

create index signals_contact_id_idx on public.signals using btree (contact_id)
  where (contact_id is not null);

create index signals_dismissed_by_idx on public.signals using btree (dismissed_by)
  where (dismissed_by is not null);

create index signals_engaged_by_idx on public.signals using btree (engaged_by)
  where (engaged_by is not null);

create index signals_engagement_queue_idx on public.signals using btree (tenant_id, engagement_lane, priority_score desc, published_at desc)
  where ((dismissed_at is null) AND (engaged_at is null) AND (source_url is not null));

create index signals_opened_by_idx on public.signals using btree (opened_by)
  where (opened_by is not null);

create index signals_summary_fts_idx on public.signals using gin (to_tsvector('english'::regconfig, COALESCE(summary, ''::text)));

create index signals_tenant_engaged_by_time_idx on public.signals using btree (tenant_id, engaged_by, engaged_at desc)
  where (engaged_by is not null);

create unique index signals_tenant_source_url_key on public.signals using btree (tenant_id, source_url)
  where (source_url is not null);

create index signals_tenant_time_idx on public.signals using btree (tenant_id, observed_at desc);

create index signals_want_to_know_idx on public.signals using btree (want_to_know_id, published_at desc)
  where (want_to_know_id is not null);

create policy "members read signals" on "public"."signals"
  for select
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."signals" to "authenticated", "postgres", "service_role";

-- source: public/tables/content_items.sql
create table "public"."content_items" (
  "id"                     uuid                     not null default gen_random_uuid(),
  "tenant_id"              uuid                     not null,
  "contact_id"             uuid,
  "want_to_know_id"        uuid,
  "target_name"            text,
  "platform"               text,
  "content_type"           text                     not null default 'social_post'::text,
  "source_url"             text                     not null,
  "title"                  text,
  "content"                text,
  "classification"         text,
  "relevance"              text,
  "published_at"           timestamp with time zone not null,
  "observed_at"            timestamp with time zone not null default now(),
  "metrics"                jsonb                    not null default '{}'::jsonb,
  "source_payload"         jsonb                    not null default '{}'::jsonb,
  "status"                 text                     not null default 'available'::text,
  "promoted_signal_id"     uuid,
  "created_at"             timestamp with time zone not null default now(),
  "updated_at"             timestamp with time zone not null default now(),
  "content_scan_source_id" uuid,
  "provider"               text,
  "provider_item_id"       text,
  "provider_run_id"        text,
  "match_status"           text                     not null default 'matched'::text,
  "match_method"           text,
  constraint "content_items_match_status_check" check ((match_status = ANY (ARRAY['matched'::text, 'unmatched'::text, 'conflict'::text, 'rejected'::text]))),
  constraint "content_items_one_target" check ((num_nonnulls(contact_id, want_to_know_id) <= 1)),
  constraint "content_items_pkey" primary key (id),
  constraint "content_items_status_check" check ((status = ANY (ARRAY['available'::text, 'promoted'::text, 'dismissed'::text, 'expired'::text]))),
  constraint "content_items_tenant_contact_fkey" foreign key (tenant_id, contact_id) references public.contacts(tenant_id, id) on delete set null,
  constraint "content_items_tenant_id_source_url_key" unique (tenant_id, source_url),
  constraint "content_items_tenant_scan_source_fkey" foreign key (tenant_id, content_scan_source_id) references public.content_scan_sources(tenant_id, id) on delete set null,
  constraint "content_items_promoted_signal_id_fkey" foreign key (promoted_signal_id) references public.signals(id) on delete set null,
  constraint "content_items_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint "content_items_tenant_want_fkey" foreign key (tenant_id, want_to_know_id) references public.want_to_know(tenant_id, id) on delete set null
);

alter table "public"."content_items"
  enable row level security;

create index content_items_available_idx on public.content_items using btree (tenant_id, status, published_at desc);

create index content_items_contact_idx on public.content_items using btree (tenant_id, contact_id, published_at desc)
  where (contact_id is not null);

create index content_items_promoted_signal_idx on public.content_items using btree (promoted_signal_id)
  where (promoted_signal_id is not null);

create unique index content_items_provider_item_idx on public.content_items using btree (tenant_id, provider, platform, provider_item_id)
  where ((provider is not null) AND (provider_item_id is not null));

create index content_items_scan_source_idx on public.content_items using btree (tenant_id, content_scan_source_id, published_at desc)
  where (content_scan_source_id is not null);

create index content_items_want_idx on public.content_items using btree (tenant_id, want_to_know_id, published_at desc)
  where (want_to_know_id is not null);

create trigger set_content_items_updated_at
  before update on public.content_items
  for each row
  execute function public.set_updated_at();

create policy "members read content reservoir" on "public"."content_items"
  for select
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."content_items" to "postgres", "service_role";

revoke all on table "public"."content_items" from "authenticated";

grant select on table "public"."content_items" to "authenticated";

-- source: public/tables/content_scan_runs.sql
create table "public"."content_scan_runs" (
  "id"                  uuid                     not null default gen_random_uuid(),
  "tenant_id"           uuid                     not null,
  "source_id"           uuid                     not null,
  "provider"            text                     not null default 'apify'::text,
  "provider_run_id"     text,
  "provider_dataset_id" text,
  "provider_task_id"    text                     not null,
  "provider_user_id"    text,
  "webhook_dispatch_id" text,
  "status"              text                     not null default 'starting'::text,
  "accepted_items"      integer                  not null default 0,
  "inserted_items"      integer                  not null default 0,
  "rejected_items"      integer                  not null default 0,
  "unmatched_items"     integer                  not null default 0,
  "reserved_cost_usd"   numeric(8,2)             not null default 0,
  "actual_cost_usd"     numeric(8,2),
  "retry_count"         integer                  not null default 0,
  "error_message"       text,
  "metadata"            jsonb                    not null default '{}'::jsonb,
  "started_at"          timestamp with time zone not null default now(),
  "heartbeat_at"        timestamp with time zone,
  "finished_at"         timestamp with time zone,
  "created_at"          timestamp with time zone not null default now(),
  "updated_at"          timestamp with time zone not null default now(),
  "pricing_snapshot"    jsonb                    not null default '{}'::jsonb,
  "billable_cost_usd"   numeric(10,2),
  "usage_event_id"      uuid,
  "cost_finalized_at"   timestamp with time zone,
  constraint "content_scan_runs_accepted_items_check" check ((accepted_items >= 0)),
  constraint "content_scan_runs_actual_cost_usd_check" check (((actual_cost_usd IS NULL) OR ((actual_cost_usd >= (0)::numeric) AND (actual_cost_usd <= (100)::numeric)))),
  constraint "content_scan_runs_inserted_items_check" check ((inserted_items >= 0)),
  constraint "content_scan_runs_pkey" primary key (id),
  constraint "content_scan_runs_provider_check" check ((provider = 'apify'::text)),
  constraint "content_scan_runs_rejected_items_check" check ((rejected_items >= 0)),
  constraint "content_scan_runs_reserved_cost_usd_check" check (((reserved_cost_usd >= (0)::numeric) AND (reserved_cost_usd <= (100)::numeric))),
  constraint "content_scan_runs_retry_count_check" check (((retry_count >= 0) AND (retry_count <= 10))),
  constraint "content_scan_runs_status_check"
    check ((status = ANY (ARRAY['starting'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'aborted'::text, 'timed_out'::text]))),
  constraint "content_scan_runs_tenant_id_provider_run_id_key" unique (tenant_id, provider_run_id),
  constraint "content_scan_runs_unmatched_items_check" check ((unmatched_items >= 0)),
  constraint "content_scan_runs_tenant_source_fkey" foreign key (tenant_id, source_id) references public.content_scan_sources(tenant_id, id) on delete cascade,
  constraint "content_scan_runs_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint "content_scan_runs_usage_event_id_fkey" foreign key (usage_event_id) references public.usage_events(id) on delete set null
);

alter table "public"."content_scan_runs"
  enable row level security;

create index content_scan_runs_active_idx on public.content_scan_runs using btree (tenant_id, status, started_at)
  where (status = ANY (ARRAY['starting'::text, 'running'::text]));

create unique index content_scan_runs_dispatch_idx on public.content_scan_runs using btree (webhook_dispatch_id)
  where (webhook_dispatch_id is not null);

create unique index content_scan_runs_one_active_source_idx on public.content_scan_runs using btree (tenant_id, source_id)
  where (status = ANY (ARRAY['starting'::text, 'running'::text]));

create index content_scan_runs_source_started_idx on public.content_scan_runs using btree (source_id, started_at desc);

create index content_scan_runs_unsettled_cost_idx on public.content_scan_runs using btree (tenant_id, finished_at)
  where ((provider_run_id is not null) AND (cost_finalized_at is null));

create index content_scan_runs_usage_event_idx on public.content_scan_runs using btree (usage_event_id)
  where (usage_event_id is not null);

create trigger set_content_scan_runs_updated_at
  before update on public.content_scan_runs
  for each row
  execute function public.set_updated_at();

create policy "members read content scan runs" on "public"."content_scan_runs"
  for select
  to "authenticated"
  using (app_private.is_tenant_member(tenant_id));

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."content_scan_runs" to "postgres", "service_role";

revoke all on table "public"."content_scan_runs" from "authenticated";

grant select on table "public"."content_scan_runs" to "authenticated";

-- source: app_private/functions/has_tenant_role.sql
create or replace function app_private.has_tenant_role (
  target_tenant_id uuid,
  allowed_roles    text[]
)
  returns boolean
  language sql
  security definer
  set search_path to 'public', 'app_private'
  AS $function$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = target_tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role = any(allowed_roles)
  );
$function$;

grant execute on function "app_private"."has_tenant_role"(uuid, text[]) to "authenticated", "postgres";

revoke all on function "app_private"."has_tenant_role"(uuid, text[]) from public;

-- source: app_private/functions/is_tenant_member.sql
create or replace function app_private.is_tenant_member (
  target_tenant_id uuid
)
  returns boolean
  language sql
  security definer
  set search_path to 'public', 'app_private'
  AS $function$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = target_tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  );
$function$;

grant execute on function "app_private"."is_tenant_member"(uuid) to "authenticated", "postgres";

revoke all on function "app_private"."is_tenant_member"(uuid) from public;

-- source: public/functions/block_connection_recommendation.sql
create or replace function public.block_connection_recommendation (
  p_connection_id uuid,
  p_tenant_id     uuid,
  p_actor_user_id uuid,
  p_owner_note    text default null::text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
  AS $function$
declare
  before_row public.connections%rowtype;
  after_row public.connections%rowtype;
  normalized_note text;
  changed boolean;
begin
  if not exists (
    select 1
    from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and status = 'active'
  ) then
    raise exception 'Actor is not an active tenant member';
  end if;

  select *
  into before_row
  from public.connections
  where id = p_connection_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Connection recommendation not found';
  end if;

  if before_row.status not in ('suggested', 'dismissed') then
    raise exception 'Only suggested connections can be blocked';
  end if;

  normalized_note :=
    coalesce(
      nullif(left(trim(coalesce(p_owner_note, '')), 500), ''),
      'Do not recommend connecting these people.'
    );
  changed :=
    before_row.status is distinct from 'dismissed'
    or before_row.owner_note is distinct from normalized_note
    or before_row.snoozed_until is not null
    or before_row.confirmed_at is not null;

  if changed then
    update public.connections
    set
      status = 'dismissed',
      owner_note = normalized_note,
      confirmed_at = null,
      confirmed_by = null,
      snoozed_until = null,
      snoozed_at = null,
      snoozed_by = null,
      updated_at = now()
    where id = p_connection_id
      and tenant_id = p_tenant_id
    returning * into after_row;

    insert into public.audit_log (
      tenant_id,
      actor_user_id,
      actor_type,
      action,
      table_name,
      record_id,
      before,
      after
    ) values (
      p_tenant_id,
      p_actor_user_id,
      'client',
      'connection.do_not_connect_confirmed',
      'connections',
      p_connection_id,
      to_jsonb(before_row),
      to_jsonb(after_row)
    );
  else
    after_row := before_row;
  end if;

  return jsonb_build_object(
    'changed', changed,
    'connection_id', after_row.id,
    'contact_a', after_row.contact_a,
    'contact_b', after_row.contact_b,
    'status', after_row.status
  );
end;
$function$;

grant execute on function "public"."block_connection_recommendation"(uuid, uuid, uuid, text) to "postgres", "service_role";

revoke all on function "public"."block_connection_recommendation"(uuid, uuid, uuid, text) from public;

-- source: public/functions/lbb_adjust_recommendation_day_limit.sql
create or replace function public.lbb_adjust_recommendation_day_limit (
  p_tenant_id     uuid,
  p_actor_user_id uuid,
  p_kind          text,
  p_amount        integer,
  p_activity_date date
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
  AS $function$
declare
  result_row public.recommendation_day_overrides%rowtype;
  safe_amount integer := greatest(0, least(coalesce(p_amount, 0), 25));
begin
  if not exists (
    select 1
    from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and status = 'active'
  ) then
    raise exception 'Actor is not an active tenant member';
  end if;

  if p_kind not in ('engagement', 'networking') then
    raise exception 'Unsupported recommendation kind';
  end if;

  insert into public.recommendation_day_overrides (
    tenant_id,
    user_id,
    activity_date,
    engagement_extra,
    networking_extra
  ) values (
    p_tenant_id,
    p_actor_user_id,
    coalesce(p_activity_date, current_date),
    case when p_kind = 'engagement' then safe_amount else 0 end,
    case when p_kind = 'networking' then safe_amount else 0 end
  )
  on conflict (tenant_id, user_id, activity_date)
  do update set
    engagement_extra = least(
      100,
      public.recommendation_day_overrides.engagement_extra +
        case when p_kind = 'engagement' then safe_amount else 0 end
    ),
    networking_extra = least(
      100,
      public.recommendation_day_overrides.networking_extra +
        case when p_kind = 'networking' then safe_amount else 0 end
    ),
    updated_at = now()
  returning * into result_row;

  insert into public.audit_log (
    tenant_id,
    actor_user_id,
    actor_type,
    action,
    table_name,
    metadata
  ) values (
    p_tenant_id,
    p_actor_user_id,
    'client',
    'recommendations.more_requested',
    'recommendation_day_overrides',
    jsonb_build_object('kind', p_kind, 'amount', safe_amount)
  );

  return jsonb_build_object(
    'engagement_extra', result_row.engagement_extra,
    'networking_extra', result_row.networking_extra
  );
end;
$function$;

grant execute on function "public"."lbb_adjust_recommendation_day_limit"(uuid, uuid, text, integer, date) to "postgres", "service_role";

revoke all on function "public"."lbb_adjust_recommendation_day_limit"(uuid, uuid, text, integer, date) from public;

-- source: public/functions/lbb_confirm_connection_context.sql
create or replace function public.lbb_confirm_connection_context (
  p_connection_id uuid,
  p_tenant_id     uuid,
  p_actor_user_id uuid,
  p_owner_note    text default null::text,
  p_context_id    uuid default null::uuid,
  p_context_name  text default null::text,
  p_context_type  text default 'other'::text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'app_private'
  AS $function$
declare
  before_row public.connections%rowtype;
  after_row public.connections%rowtype;
  context_row public.relationship_contexts%rowtype;
  normalized_name text := left(trim(coalesce(p_context_name, '')), 160);
  normalized_type text := lower(trim(coalesce(p_context_type, 'other')));
  normalized_note text := nullif(left(trim(coalesce(p_owner_note, '')), 500), '');
  prior text;
begin
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and status = 'active'
  ) then
    raise exception 'Actor is not an active tenant member';
  end if;

  select * into before_row
  from public.connections
  where id = p_connection_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Connection recommendation not found';
  end if;

  if before_row.status not in ('suggested', 'already_connected') then
    raise exception 'Only an active or confirmed connection can be updated';
  end if;

  if p_context_id is not null then
    select * into context_row
    from public.relationship_contexts
    where id = p_context_id
      and tenant_id = p_tenant_id
      and archived_at is null;

    if not found then
      raise exception 'Relationship context not found';
    end if;
  elsif normalized_name <> '' then
    if normalized_type not in (
      'mastermind', 'conference', 'board', 'community', 'company',
      'cohort', 'school', 'event', 'other'
    ) then
      raise exception 'Unsupported relationship context type';
    end if;

    prior := case
      when normalized_type in ('mastermind', 'board', 'company', 'cohort') then 'strong'
      when normalized_type in ('community', 'school') then 'moderate'
      when normalized_type in ('conference', 'event') then 'weak'
      else 'moderate'
    end;

    insert into public.relationship_contexts (
      tenant_id,
      name,
      canonical_key,
      context_type,
      connection_prior,
      source,
      created_by
    ) values (
      p_tenant_id,
      normalized_name,
      app_private.relationship_context_key(normalized_name),
      normalized_type,
      prior,
      'owner_confirmation',
      p_actor_user_id
    )
    on conflict (tenant_id, canonical_key) do update set archived_at = null
    returning * into context_row;
  end if;

  if context_row.id is not null then
    insert into public.relationship_context_memberships (
      tenant_id,
      context_id,
      contact_id,
      verification_state,
      source,
      source_connection_id,
      created_by
    ) values
      (
        p_tenant_id, context_row.id, before_row.contact_a, 'confirmed',
        'connection_confirmation', before_row.id, p_actor_user_id
      ),
      (
        p_tenant_id, context_row.id, before_row.contact_b, 'confirmed',
        'connection_confirmation', before_row.id, p_actor_user_id
      )
    on conflict (tenant_id, context_id, contact_id) do update set
      verification_state = 'confirmed',
      evidence = public.relationship_context_memberships.evidence ||
        jsonb_build_object('confirmed_connection_id', before_row.id),
      created_by = p_actor_user_id;

    insert into public.connection_contexts (
      tenant_id,
      connection_id,
      context_id,
      note,
      created_by
    ) values (
      p_tenant_id,
      before_row.id,
      context_row.id,
      normalized_note,
      p_actor_user_id
    )
    on conflict (tenant_id, connection_id, context_id) do update set
      note = coalesce(excluded.note, public.connection_contexts.note),
      created_by = p_actor_user_id;
  end if;

  update public.connections
  set
    status = 'already_connected',
    owner_note = coalesce(
      normalized_note,
      case
        when context_row.id is not null then 'Already connected through ' || context_row.name || '.'
        else 'They already know each other.'
      end
    ),
    confirmed_at = now(),
    confirmed_by = p_actor_user_id,
    snoozed_until = null,
    snoozed_at = null,
    snoozed_by = null,
    updated_at = now()
  where id = before_row.id
    and tenant_id = p_tenant_id
  returning * into after_row;

  insert into public.audit_log (
    tenant_id,
    actor_user_id,
    actor_type,
    action,
    table_name,
    record_id,
    before,
    after
  ) values (
    p_tenant_id,
    p_actor_user_id,
    'client',
    'connection.already_connected_confirmed',
    'connections',
    before_row.id,
    to_jsonb(before_row),
    to_jsonb(after_row) || jsonb_build_object(
      'relationship_context_id', context_row.id,
      'relationship_context_name', context_row.name
    )
  );

  return jsonb_build_object(
    'changed', to_jsonb(before_row) is distinct from to_jsonb(after_row),
    'connection_id', after_row.id,
    'contact_a', after_row.contact_a,
    'contact_b', after_row.contact_b,
    'status', after_row.status,
    'relationship_context_id', context_row.id,
    'relationship_context_name', context_row.name
  );
end;
$function$;

grant execute on function "public"."lbb_confirm_connection_context"(uuid, uuid, uuid, text, uuid, text, text) to "postgres", "service_role";

revoke all on function "public"."lbb_confirm_connection_context"(uuid, uuid, uuid, text, uuid, text, text) from public;

-- source: public/functions/lbb_consume_google_gmail_oauth_transaction.sql
create or replace function public.lbb_consume_google_gmail_oauth_transaction (
  p_tenant_id  uuid,
  p_user_id    uuid,
  p_state_hash text
)
  returns text
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'vault'
  AS $function$
declare
  transaction_row public.google_oauth_transactions%rowtype;
  verifier text;
begin
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_user_id
      and status = 'active'
  ) then
    raise exception 'Actor is not an active tenant member';
  end if;

  select * into transaction_row
  from public.google_oauth_transactions
  where tenant_id = p_tenant_id
    and user_id = p_user_id
    and provider = 'google_gmail'
    and state_hash = p_state_hash
    and expires_at > now()
  for update;

  if transaction_row.id is null then return null; end if;

  select decrypted_secret into verifier
  from vault.decrypted_secrets
  where id = transaction_row.verifier_secret_id;

  if nullif(verifier, '') is null then
    raise exception 'OAuth verifier is unavailable';
  end if;

  delete from public.google_oauth_transactions where id = transaction_row.id;
  delete from vault.secrets where id = transaction_row.verifier_secret_id;
  return verifier;
end;
$function$;

grant execute on function "public"."lbb_consume_google_gmail_oauth_transaction"(uuid, uuid, text) to "postgres", "service_role";

revoke all on function "public"."lbb_consume_google_gmail_oauth_transaction"(uuid, uuid, text) from public;

-- source: public/functions/lbb_consume_google_oauth_transaction.sql
create or replace function public.lbb_consume_google_oauth_transaction (
  p_tenant_id  uuid,
  p_user_id    uuid,
  p_state_hash text
)
  returns text
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'vault'
  AS $function$
declare
  transaction_row public.google_oauth_transactions%rowtype;
  verifier text;
begin
  if not exists (
    select 1
    from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_user_id
      and status = 'active'
  ) then
    raise exception 'Actor is not an active tenant member';
  end if;

  select *
  into transaction_row
  from public.google_oauth_transactions
  where tenant_id = p_tenant_id
    and user_id = p_user_id
    and provider = 'google_calendar'
    and state_hash = p_state_hash
    and expires_at > now()
  for update;

  if transaction_row.id is null then
    return null;
  end if;

  select decrypted_secret
  into verifier
  from vault.decrypted_secrets
  where id = transaction_row.verifier_secret_id;

  if nullif(verifier, '') is null then
    raise exception 'OAuth verifier is unavailable';
  end if;

  delete from public.google_oauth_transactions
  where id = transaction_row.id;

  delete from vault.secrets
  where id = transaction_row.verifier_secret_id;

  return verifier;
end;
$function$;

grant execute on function "public"."lbb_consume_google_oauth_transaction"(uuid, uuid, text) to "postgres", "service_role";

revoke all on function "public"."lbb_consume_google_oauth_transaction"(uuid, uuid, text) from public;

-- source: public/functions/lbb_create_google_gmail_oauth_transaction.sql
create or replace function public.lbb_create_google_gmail_oauth_transaction (
  p_tenant_id  uuid,
  p_user_id    uuid,
  p_state_hash text,
  p_verifier   text
)
  returns uuid
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'vault'
  AS $function$
declare
  transaction_id uuid := gen_random_uuid();
  secret_id uuid;
  expired_secret_id uuid;
begin
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_user_id
      and status = 'active'
  ) then
    raise exception 'Actor is not an active tenant member';
  end if;

  if nullif(trim(coalesce(p_state_hash, '')), '') is null
    or length(p_state_hash) > 128
    or nullif(trim(coalesce(p_verifier, '')), '') is null
    or length(p_verifier) > 256
  then
    raise exception 'Invalid OAuth transaction';
  end if;

  for expired_secret_id in
    delete from public.google_oauth_transactions
    where tenant_id = p_tenant_id
      and user_id = p_user_id
      and provider = 'google_gmail'
      and expires_at <= now()
    returning verifier_secret_id
  loop
    delete from vault.secrets where id = expired_secret_id;
  end loop;

  secret_id := vault.create_secret(
    p_verifier,
    'lbb-google-gmail-oauth-' || transaction_id::text,
    'Short-lived Little Black Book Gmail OAuth PKCE verifier'
  );

  insert into public.google_oauth_transactions (
    id, tenant_id, user_id, provider, state_hash, verifier_secret_id, expires_at
  ) values (
    transaction_id, p_tenant_id, p_user_id, 'google_gmail', p_state_hash,
    secret_id, now() + interval '10 minutes'
  );

  return transaction_id;
end;
$function$;

grant execute on function "public"."lbb_create_google_gmail_oauth_transaction"(uuid, uuid, text, text) to "postgres", "service_role";

revoke all on function "public"."lbb_create_google_gmail_oauth_transaction"(uuid, uuid, text, text) from public;

-- source: public/functions/lbb_create_google_oauth_transaction.sql
create or replace function public.lbb_create_google_oauth_transaction (
  p_tenant_id  uuid,
  p_user_id    uuid,
  p_state_hash text,
  p_verifier   text
)
  returns uuid
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'vault'
  AS $function$
declare
  transaction_id uuid := gen_random_uuid();
  secret_id uuid;
  expired_secret_id uuid;
begin
  if not exists (
    select 1
    from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_user_id
      and status = 'active'
  ) then
    raise exception 'Actor is not an active tenant member';
  end if;

  if nullif(trim(coalesce(p_state_hash, '')), '') is null
    or length(p_state_hash) > 128
    or nullif(trim(coalesce(p_verifier, '')), '') is null
    or length(p_verifier) > 256
  then
    raise exception 'Invalid OAuth transaction';
  end if;

  for expired_secret_id in
    delete from public.google_oauth_transactions
    where tenant_id = p_tenant_id
      and user_id = p_user_id
      and provider = 'google_calendar'
      and expires_at <= now()
    returning verifier_secret_id
  loop
    delete from vault.secrets where id = expired_secret_id;
  end loop;

  secret_id := vault.create_secret(
    p_verifier,
    'lbb-google-oauth-' || transaction_id::text,
    'Short-lived Little Black Book Google OAuth PKCE verifier'
  );

  insert into public.google_oauth_transactions (
    id,
    tenant_id,
    user_id,
    provider,
    state_hash,
    verifier_secret_id,
    expires_at
  ) values (
    transaction_id,
    p_tenant_id,
    p_user_id,
    'google_calendar',
    p_state_hash,
    secret_id,
    now() + interval '10 minutes'
  );

  return transaction_id;
end;
$function$;

grant execute on function "public"."lbb_create_google_oauth_transaction"(uuid, uuid, text, text) to "postgres", "service_role";

revoke all on function "public"."lbb_create_google_oauth_transaction"(uuid, uuid, text, text) from public;

-- source: public/functions/lbb_create_introduction_from_connection.sql
create or replace function public.lbb_create_introduction_from_connection (
  p_tenant_id     uuid,
  p_actor_user_id uuid,
  p_connection_id uuid,
  p_person_a      uuid,
  p_person_b      uuid,
  p_why_context   text,
  p_follow_up_on  date,
  p_date_proposed date
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
  AS $function$
declare
  connection_row public.connections%rowtype;
  introduction_id uuid;
  safe_context text :=
    nullif(left(trim(coalesce(p_why_context, '')), 2000), '');
begin
  if not exists (
    select 1
    from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and status = 'active'
  ) then
    raise exception 'Actor is not an active tenant member';
  end if;

  if p_person_a = p_person_b or safe_context is null then
    raise exception 'Two different contacts and introduction context are required';
  end if;

  select *
  into connection_row
  from public.connections
  where id = p_connection_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Connection recommendation not found';
  end if;

  if connection_row.status <> 'suggested'
    or (
      connection_row.snoozed_until is not null
      and connection_row.snoozed_until > now()
    )
  then
    raise exception 'Connection recommendation is not active';
  end if;

  if not (
    (connection_row.contact_a = p_person_a and connection_row.contact_b = p_person_b)
    or
    (connection_row.contact_a = p_person_b and connection_row.contact_b = p_person_a)
  ) then
    raise exception 'Contacts do not match the recommendation';
  end if;

  if (
    select count(*)
    from public.contacts
    where tenant_id = p_tenant_id
      and id in (p_person_a, p_person_b)
      and archived_at is null
  ) <> 2 then
    raise exception 'Both contacts must belong to this tenant';
  end if;

  insert into public.introductions (
    tenant_id,
    person_a,
    person_b,
    date_proposed,
    why_context,
    follow_up_on,
    status,
    created_by
  ) values (
    p_tenant_id,
    p_person_a,
    p_person_b,
    coalesce(p_date_proposed, current_date),
    safe_context,
    p_follow_up_on,
    'proposed',
    p_actor_user_id
  )
  returning id into introduction_id;

  update public.connections
  set
    status = 'dismissed',
    confirmed_at = now(),
    confirmed_by = p_actor_user_id,
    owner_note = 'Introduction approved from this recommendation.',
    snoozed_until = null,
    snoozed_at = null,
    snoozed_by = null,
    updated_at = now()
  where id = p_connection_id
    and tenant_id = p_tenant_id;

  insert into public.audit_log (
    tenant_id,
    actor_user_id,
    actor_type,
    action,
    table_name,
    record_id,
    after
  ) values (
    p_tenant_id,
    p_actor_user_id,
    'client',
    'introduction.recommendation_approved',
    'introductions',
    introduction_id,
    jsonb_build_object(
      'person_a', p_person_a,
      'person_b', p_person_b,
      'why_context', safe_context,
      'follow_up_on', p_follow_up_on,
      'status', 'proposed',
      'connection_id', p_connection_id
    )
  );

  return jsonb_build_object(
    'id', introduction_id,
    'connection_id', p_connection_id,
    'person_a', p_person_a,
    'person_b', p_person_b
  );
end;
$function$;

grant execute on function "public"."lbb_create_introduction_from_connection"(uuid, uuid, uuid, uuid, uuid, text, date, date) to "postgres", "service_role";

revoke all on function "public"."lbb_create_introduction_from_connection"(uuid, uuid, uuid, uuid, uuid, text, date, date) from public;

-- source: public/functions/lbb_create_pending_change.sql
create or replace function public.lbb_create_pending_change (
  p_tenant_id       uuid,
  p_idempotency_key text,
  p_contact_id      uuid,
  p_change_type     text,
  p_summary         text,
  p_payload         jsonb,
  p_source          text,
  p_risk_level      text
)
  returns jsonb
  language plpgsql
  set search_path to 'public'
  AS $function$
declare
  existing_id uuid;
  new_id uuid;
  normalized_key text := nullif(trim(p_idempotency_key), '');
  normalized_source text := coalesce(nullif(trim(p_source), ''), 'client_claude_project');
  normalized_risk text := case when p_risk_level = 'high' then 'high' else 'low' end;
begin
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Tenant does not exist.' using errcode = '22023';
  end if;

  if p_contact_id is not null and not exists (
    select 1 from public.contacts where tenant_id = p_tenant_id and id = p_contact_id
  ) then
    raise exception 'contact_id must belong to this tenant.' using errcode = '22023';
  end if;

  if normalized_key is not null then
    select id into existing_id
    from public.pending_changes
    where tenant_id = p_tenant_id and idempotency_key = normalized_key
    limit 1;

    if existing_id is not null then
      return jsonb_build_object('id', existing_id, 'duplicate', true);
    end if;
  end if;

  insert into public.pending_changes (
    tenant_id,
    contact_id,
    change_type,
    summary,
    payload,
    source,
    risk_level,
    proposed_by,
    idempotency_key
  ) values (
    p_tenant_id,
    p_contact_id,
    trim(p_change_type),
    trim(p_summary),
    coalesce(p_payload, '{}'::jsonb),
    normalized_source,
    normalized_risk,
    'claude',
    normalized_key
  )
  returning id into new_id;

  insert into public.audit_log (
    tenant_id,
    actor_type,
    action,
    table_name,
    record_id,
    after
  ) values (
    p_tenant_id,
    'claude',
    'pending_change.created',
    'pending_changes',
    new_id,
    jsonb_build_object(
      'change_type', trim(p_change_type),
      'summary', trim(p_summary),
      'payload', coalesce(p_payload, '{}'::jsonb),
      'source', normalized_source,
      'risk_level', normalized_risk,
      'idempotency_key', normalized_key
    )
  );

  insert into public.usage_events (
    tenant_id,
    actor_type,
    event_type,
    unit,
    metadata
  ) values (
    p_tenant_id,
    'claude',
    'pending_change_created',
    'change',
    jsonb_build_object('source', normalized_source, 'idempotency_key', normalized_key)
  );

  return jsonb_build_object('id', new_id, 'duplicate', false);
end;
$function$;

grant execute on function "public"."lbb_create_pending_change"(uuid, text, uuid, text, text, jsonb, text, text) to "postgres", "service_role";

revoke all on function "public"."lbb_create_pending_change"(uuid, text, uuid, text, text, jsonb, text, text) from public;

-- source: public/functions/lbb_disconnect_google_calendar.sql
create or replace function public.lbb_disconnect_google_calendar (
  p_tenant_id uuid,
  p_user_id   uuid
)
  returns boolean
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'vault'
  AS $function$
declare
  connection_row public.integration_connections%rowtype;
begin
  if not exists (
    select 1
    from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_user_id
      and status = 'active'
  ) then
    raise exception 'Actor is not an active tenant member';
  end if;

  select *
  into connection_row
  from public.integration_connections
  where tenant_id = p_tenant_id
    and user_id = p_user_id
    and provider = 'google_calendar'
  for update;

  if connection_row.id is null then
    return false;
  end if;

  insert into public.audit_log (
    tenant_id,
    actor_user_id,
    actor_type,
    action,
    table_name,
    record_id,
    metadata
  ) values (
    p_tenant_id,
    p_user_id,
    'client',
    'integration.google_calendar.disconnected',
    'integration_connections',
    connection_row.id,
    jsonb_build_object(
      'account_email', connection_row.external_account_email
    )
  );

  delete from public.integration_connections
  where id = connection_row.id;

  if connection_row.refresh_token_secret_id is not null then
    delete from vault.secrets
    where id = connection_row.refresh_token_secret_id;
  end if;

  return true;
end;
$function$;

grant execute on function "public"."lbb_disconnect_google_calendar"(uuid, uuid) to "postgres", "service_role";

revoke all on function "public"."lbb_disconnect_google_calendar"(uuid, uuid) from public;

-- source: public/functions/lbb_google_calendar_refresh_token.sql
create or replace function public.lbb_google_calendar_refresh_token (
  p_connection_id uuid
)
  returns text
  language sql
  security definer
  set search_path to 'pg_catalog', 'public', 'vault'
  AS $function$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (
    select refresh_token_secret_id
    from public.integration_connections
    where id = p_connection_id
      and provider = 'google_calendar'
      and status = 'active'
  );
$function$;

grant execute on function "public"."lbb_google_calendar_refresh_token"(uuid) to "postgres", "service_role";

revoke all on function "public"."lbb_google_calendar_refresh_token"(uuid) from public;

-- source: public/functions/lbb_google_calendar_token_for_disconnect.sql
create or replace function public.lbb_google_calendar_token_for_disconnect (
  p_tenant_id uuid,
  p_user_id   uuid
)
  returns text
  language sql
  security definer
  set search_path to 'pg_catalog', 'public', 'vault'
  AS $function$
  select secrets.decrypted_secret
  from public.integration_connections as connections
  join public.tenant_members as members
    on members.tenant_id = connections.tenant_id
    and members.user_id = connections.user_id
    and members.status = 'active'
  join vault.decrypted_secrets as secrets
    on secrets.id = connections.refresh_token_secret_id
  where connections.tenant_id = p_tenant_id
    and connections.user_id = p_user_id
    and connections.provider = 'google_calendar';
$function$;

grant execute on function "public"."lbb_google_calendar_token_for_disconnect"(uuid, uuid) to "postgres", "service_role";

revoke all on function "public"."lbb_google_calendar_token_for_disconnect"(uuid, uuid) from public;

-- source: public/functions/lbb_google_gmail_refresh_token.sql
create or replace function public.lbb_google_gmail_refresh_token (
  p_connection_id uuid
)
  returns text
  language sql
  security definer
  set search_path to 'pg_catalog', 'public', 'vault'
  AS $function$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (
    select refresh_token_secret_id
    from public.integration_connections
    where id = p_connection_id
      and provider = 'google_gmail'
      and status = 'active'
  );
$function$;

grant execute on function "public"."lbb_google_gmail_refresh_token"(uuid) to "postgres", "service_role";

revoke all on function "public"."lbb_google_gmail_refresh_token"(uuid) from public;

-- source: public/functions/lbb_log_interaction.sql
create or replace function public.lbb_log_interaction (
  p_tenant_id         uuid,
  p_idempotency_key   text,
  p_occurred_at       timestamp with time zone,
  p_interaction_type  text,
  p_title             text,
  p_summary           text,
  p_source            text,
  p_source_ref        text,
  p_metadata          jsonb,
  p_contact_ids       uuid[],
  p_update_last_spoke boolean,
  p_promises          jsonb,
  p_connection_edges  jsonb
)
  returns jsonb
  language plpgsql
  set search_path to ''
  AS $function$
declare
  existing_id uuid;
  interaction_id uuid;
  normalized_key text := nullif(trim(p_idempotency_key), '');
  normalized_source text := coalesce(nullif(trim(p_source), ''), 'client_claude_project');
  occurred_date date := p_occurred_at::date;
  may_advance_last_spoke boolean := coalesce(p_update_last_spoke, true) and p_occurred_at <= now() + interval '5 minutes';
  last_spoke_updated uuid[] := array[]::uuid[];
  promise_count integer := 0;
  connection_count integer := 0;
  strength_refresh jsonb := '{}'::jsonb;
begin
  if normalized_key is not null then
    select id into existing_id from public.interactions where tenant_id = p_tenant_id and idempotency_key = normalized_key limit 1;
    if existing_id is not null then
      return jsonb_build_object('id', existing_id, 'duplicate', true, 'last_spoke_updated', '[]'::jsonb, 'promise_count', 0, 'connection_count', 0, 'strength_updated_count', 0);
    end if;
  end if;

  if array_length(p_contact_ids, 1) is null then
    raise exception 'contact_ids are required.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Tenant does not exist.' using errcode = '22023';
  end if;
  if (select count(*) from public.contacts where tenant_id = p_tenant_id and id = any(p_contact_ids)) <> array_length(p_contact_ids, 1) then
    raise exception 'Every contact_id must belong to this tenant.' using errcode = '22023';
  end if;

  insert into public.interactions (tenant_id, occurred_at, interaction_type, title, summary, source, source_ref, metadata, idempotency_key)
  values (p_tenant_id, p_occurred_at, trim(p_interaction_type), nullif(trim(p_title), ''), trim(p_summary), normalized_source, nullif(trim(p_source_ref), ''), coalesce(p_metadata, '{}'::jsonb), normalized_key)
  returning id into interaction_id;

  insert into public.interaction_contacts (interaction_id, contact_id, tenant_id, role)
  select interaction_id, contact_id, p_tenant_id, 'participant' from unnest(p_contact_ids) as contact_id;

  if may_advance_last_spoke then
    with updated_contacts as (
      update public.contacts set last_spoke = occurred_date, updated_at = now()
      where tenant_id = p_tenant_id and id = any(p_contact_ids) and (last_spoke is null or last_spoke < occurred_date)
      returning id
    )
    select coalesce(array_agg(id), array[]::uuid[]) into last_spoke_updated from updated_contacts;
  end if;

  if jsonb_array_length(coalesce(p_promises, '[]'::jsonb)) > 0 then
    insert into public.promises (tenant_id, contact_id, interaction_id, direction, promise_text, due_on, source, evidence)
    select p_tenant_id, promise.contact_id, interaction_id, promise.direction, promise.promise_text, promise.due_on, normalized_source,
      coalesce(promise.evidence, '{}'::jsonb) || jsonb_build_object('interaction_id', interaction_id)
    from jsonb_to_recordset(p_promises) as promise(contact_id uuid, direction text, promise_text text, due_on date, evidence jsonb);
    get diagnostics promise_count = row_count;
  end if;

  if jsonb_array_length(coalesce(p_connection_edges, '[]'::jsonb)) > 0 then
    insert into public.connections (tenant_id, contact_a, contact_b, source, evidence, confidence)
    select p_tenant_id, edge.contact_a, edge.contact_b, normalized_source,
      coalesce(edge.evidence, '{}'::jsonb) || jsonb_build_object('interaction_id', interaction_id, 'occurred_at', p_occurred_at), edge.confidence
    from jsonb_to_recordset(p_connection_edges) as edge(contact_a uuid, contact_b uuid, evidence jsonb, confidence numeric)
    on conflict (tenant_id, contact_a, contact_b) do update
      set source = excluded.source, evidence = public.connections.evidence || excluded.evidence,
          confidence = coalesce(excluded.confidence, public.connections.confidence);
    get diagnostics connection_count = row_count;
  end if;

  strength_refresh := public.lbb_refresh_relationship_strength(p_tenant_id);

  insert into public.audit_log (tenant_id, actor_type, action, table_name, record_id, after)
  values (p_tenant_id, 'claude', 'interaction.logged', 'interactions', interaction_id,
    jsonb_build_object('contact_ids', to_jsonb(p_contact_ids), 'occurred_at', p_occurred_at,
      'interaction_type', trim(p_interaction_type), 'title', nullif(trim(p_title), ''), 'summary', trim(p_summary),
      'source', normalized_source, 'source_ref', nullif(trim(p_source_ref), ''),
      'last_spoke_update_requested', coalesce(p_update_last_spoke, true),
      'last_spoke_update_suppressed', coalesce(p_update_last_spoke, true) and not may_advance_last_spoke,
      'last_spoke_updated', to_jsonb(last_spoke_updated), 'promise_count', promise_count,
      'connection_count', connection_count, 'relationship_strength_refresh', strength_refresh,
      'idempotency_key', normalized_key));

  insert into public.usage_events (tenant_id, actor_type, event_type, quantity, unit, metadata)
  values (p_tenant_id, 'claude', 'interaction_logged', 1, 'interaction',
    jsonb_build_object('source', normalized_source, 'contact_count', array_length(p_contact_ids, 1),
      'promise_count', promise_count, 'connection_count', connection_count,
      'strength_updated_count', coalesce((strength_refresh->>'updated_count')::integer, 0),
      'last_spoke_update_suppressed', coalesce(p_update_last_spoke, true) and not may_advance_last_spoke,
      'idempotency_key', normalized_key));

  return jsonb_build_object('id', interaction_id, 'duplicate', false, 'last_spoke_updated', to_jsonb(last_spoke_updated),
    'last_spoke_update_suppressed', coalesce(p_update_last_spoke, true) and not may_advance_last_spoke,
    'promise_count', promise_count, 'connection_count', connection_count,
    'strength_updated_count', coalesce((strength_refresh->>'updated_count')::integer, 0));
end;
$function$;

grant execute
  on function "public"."lbb_log_interaction"(uuid, text, timestamp with time zone, text, text, text, text, text, jsonb, uuid[], boolean, jsonb, jsonb)
  to "postgres", "service_role";

revoke all on function "public"."lbb_log_interaction"(uuid, text, timestamp with time zone, text, text, text, text, text, jsonb, uuid[], boolean, jsonb, jsonb) from public;

-- source: public/functions/lbb_record_claude_calendar_snapshot.sql
create or replace function public.lbb_record_claude_calendar_snapshot (
  p_tenant_id    uuid,
  p_snapshot_id  text,
  p_payload_hash text,
  p_generated_at timestamp with time zone,
  p_window_start timestamp with time zone,
  p_window_end   timestamp with time zone,
  p_events       jsonb
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'auth'
  AS $function$
declare
  owner_id uuid;
  owner_email text;
  calendar_connection_id uuid;
  event_item jsonb;
  attendee_item jsonb;
  saved_event_id uuid;
  event_keys text[];
  normalized_attendee_email text;
  supplied_contact_id uuid;
  matched_contact uuid;
  matched_prospect uuid;
  preference_decision text;
  preference_contact uuid;
  preference_prospect uuid;
  matched_contact_ids uuid[];
  prior_receipt app_private.calendar_snapshot_receipts%rowtype;
  interaction_result jsonb;
  event_count integer := 0;
  attendee_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_tenant_id is null
     or nullif(trim(coalesce(p_snapshot_id, '')), '') is null
     or nullif(trim(coalesce(p_payload_hash, '')), '') is null
     or p_generated_at is null
     or p_window_start is null
     or p_window_end is null then
    raise exception 'Tenant, snapshot, generation time, and window are required';
  end if;
  if p_window_end < p_window_start
     or p_window_end - p_window_start > interval '8 days' then
    raise exception 'Invalid calendar snapshot window';
  end if;
  if jsonb_typeof(coalesce(p_events, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_events, '[]'::jsonb)) > 50 then
    raise exception 'Calendar snapshot must contain at most 50 events';
  end if;

  select * into prior_receipt
  from app_private.calendar_snapshot_receipts
  where tenant_id = p_tenant_id
    and snapshot_id = p_snapshot_id;

  if found then
    if prior_receipt.payload_hash <> p_payload_hash then
      raise exception 'Snapshot id has already been used with different calendar data';
    end if;
    return jsonb_build_object(
      'snapshot_id', prior_receipt.snapshot_id,
      'duplicate', true,
      'event_count', prior_receipt.event_count,
      'attendee_count', prior_receipt.attendee_count,
      'last_synced_at', prior_receipt.generated_at
    );
  end if;

  select t.owner_user_id
  into owner_id
  from public.tenants t
  where t.id = p_tenant_id;

  if owner_id is null then
    select tm.user_id
    into owner_id
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.role = 'owner'
      and tm.status = 'active'
    order by tm.created_at
    limit 1;
  end if;

  if owner_id is null then
    raise exception 'This tenant does not have an active owner';
  end if;

  select lower(trim(u.email))
  into owner_email
  from auth.users u
  where u.id = owner_id;

  insert into public.integration_connections (
    tenant_id,
    user_id,
    provider,
    status,
    external_account_email,
    scopes,
    last_synced_at,
    last_error,
    metadata
  ) values (
    p_tenant_id,
    owner_id,
    'claude_calendar',
    'active',
    owner_email,
    '{}'::text[],
    p_generated_at,
    null,
    jsonb_build_object(
      'source', 'claude_daily_briefing',
      'snapshot_id', left(trim(p_snapshot_id), 160),
      'window_start', p_window_start,
      'window_end', p_window_end
    )
  )
  on conflict (tenant_id, user_id, provider) do update
  set
    status = 'active',
    last_synced_at = excluded.last_synced_at,
    last_error = null,
    metadata = excluded.metadata,
    updated_at = now()
  returning id into calendar_connection_id;

  select coalesce(array_agg(item->>'external_event_id'), '{}'::text[])
  into event_keys
  from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) item
  where nullif(trim(item->>'external_event_id'), '') is not null;

  delete from public.calendar_events e
  where e.tenant_id = p_tenant_id
    and e.connection_id = calendar_connection_id
    and e.owner_user_id = owner_id
    and e.starts_at between p_window_start and p_window_end
    and not (e.external_event_id = any(event_keys));

  for event_item in
    select value
    from jsonb_array_elements(coalesce(p_events, '[]'::jsonb))
  loop
    if nullif(trim(event_item->>'external_event_id'), '') is null
       or nullif(trim(event_item->>'starts_at'), '') is null then
      raise exception 'Every calendar event needs an external_event_id and starts_at';
    end if;
    if (event_item->>'starts_at')::timestamptz < p_window_start
       or (event_item->>'starts_at')::timestamptz > p_window_end then
      raise exception 'Calendar event falls outside the snapshot window';
    end if;

    insert into public.calendar_events (
      tenant_id,
      connection_id,
      owner_user_id,
      provider,
      external_event_id,
      title,
      starts_at,
      ends_at,
      status,
      html_url,
      organizer_email,
      is_all_day,
      metadata
    ) values (
      p_tenant_id,
      calendar_connection_id,
      owner_id,
      'claude_calendar',
      left(trim(event_item->>'external_event_id'), 500),
      nullif(left(trim(event_item->>'title'), 500), ''),
      (event_item->>'starts_at')::timestamptz,
      nullif(event_item->>'ends_at', '')::timestamptz,
      coalesce(nullif(left(trim(event_item->>'status'), 40), ''), 'confirmed'),
      nullif(left(trim(event_item->>'html_url'), 2000), ''),
      nullif(lower(left(trim(event_item->>'organizer_email'), 320)), ''),
      coalesce((event_item->>'is_all_day')::boolean, false),
      jsonb_build_object(
        'source', 'claude_daily_briefing',
        'snapshot_id', left(trim(p_snapshot_id), 160),
        'briefing', coalesce(event_item->'briefing', '{}'::jsonb)
      )
    )
    on conflict (tenant_id, connection_id, external_event_id) do update
    set
      title = excluded.title,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      status = excluded.status,
      html_url = excluded.html_url,
      organizer_email = excluded.organizer_email,
      is_all_day = excluded.is_all_day,
      metadata = excluded.metadata,
      updated_at = now()
    returning id into saved_event_id;

    event_count := event_count + 1;
    matched_contact_ids := '{}'::uuid[];

    delete from public.calendar_attendees
    where tenant_id = p_tenant_id
      and event_id = saved_event_id
      and owner_user_id = owner_id;

    for attendee_item in
      select value
      from jsonb_array_elements(coalesce(event_item->'attendees', '[]'::jsonb))
    loop
      normalized_attendee_email := lower(trim(attendee_item->>'normalized_email'));
      if normalized_attendee_email is null
         or normalized_attendee_email = ''
         or normalized_attendee_email = owner_email then
        continue;
      end if;

      matched_contact := null;
      matched_prospect := null;
      preference_decision := null;
      preference_contact := null;
      preference_prospect := null;
      supplied_contact_id := nullif(attendee_item->>'contact_id', '')::uuid;

      if supplied_contact_id is not null then
        select c.id
        into matched_contact
        from public.contacts c
        where c.tenant_id = p_tenant_id
          and c.id = supplied_contact_id
          and c.archived_at is null;
      end if;

      if matched_contact is null then
        select (array_agg(c.id order by c.created_at))[1]
        into matched_contact
        from public.contacts c
        where c.tenant_id = p_tenant_id
          and c.archived_at is null
          and lower(trim(c.email)) = normalized_attendee_email
        having count(*) = 1;
      end if;

      if matched_contact is null then
        select cap.decision, cap.contact_id, cap.want_to_know_id
        into preference_decision, preference_contact, preference_prospect
        from public.calendar_attendee_preferences cap
        where cap.tenant_id = p_tenant_id
          and cap.user_id = owner_id
          and cap.normalized_email = normalized_attendee_email;

        if preference_decision = 'book' and preference_contact is not null then
          matched_contact := preference_contact;
        elsif preference_decision = 'want_to_know' and preference_prospect is not null then
          matched_prospect := preference_prospect;
        elsif preference_decision is null then
          select (array_agg(w.id order by w.added_at))[1]
          into matched_prospect
          from public.want_to_know w
          where w.tenant_id = p_tenant_id
            and w.stage <> 'graduated'
            and lower(trim(w.email)) = normalized_attendee_email
          having count(*) = 1;
        end if;
      end if;

      insert into public.calendar_attendees (
        tenant_id,
        event_id,
        owner_user_id,
        normalized_email,
        display_name,
        response_status,
        is_organizer,
        matched_contact_id,
        matched_want_to_know_id,
        metadata
      ) values (
        p_tenant_id,
        saved_event_id,
        owner_id,
        normalized_attendee_email,
        nullif(left(trim(attendee_item->>'display_name'), 300), ''),
        nullif(left(trim(attendee_item->>'response_status'), 40), ''),
        coalesce((attendee_item->>'is_organizer')::boolean, false),
        matched_contact,
        matched_prospect,
        jsonb_build_object(
          'source', 'claude_daily_briefing',
          'snapshot_id', left(trim(p_snapshot_id), 160),
          'relationship_hint', nullif(left(trim(attendee_item->>'relationship_hint'), 500), '')
        )
      );
      attendee_count := attendee_count + 1;
      if matched_contact is not null
         and not (matched_contact = any(matched_contact_ids)) then
        matched_contact_ids := array_append(matched_contact_ids, matched_contact);
      end if;
    end loop;

    if coalesce(array_length(matched_contact_ids, 1), 0) > 0
       and coalesce(
         nullif(event_item->>'ends_at', '')::timestamptz,
         (event_item->>'starts_at')::timestamptz
       ) <= p_generated_at then
      select public.lbb_log_interaction(
        p_tenant_id,
        concat('claude-calendar:', owner_id, ':', left(trim(event_item->>'external_event_id'), 500)),
        (event_item->>'starts_at')::timestamptz,
        'meeting',
        coalesce(nullif(left(trim(event_item->>'title'), 240), ''), 'Calendar meeting'),
        'Completed meeting recorded from the daily calendar briefing.',
        'claude_calendar',
        left(trim(event_item->>'external_event_id'), 500),
        jsonb_build_object(
          'snapshot_id', left(trim(p_snapshot_id), 160),
          'calendar_event_id', saved_event_id
        ),
        matched_contact_ids,
        true,
        '[]'::jsonb,
        '[]'::jsonb
      ) into interaction_result;
    end if;
  end loop;

  insert into app_private.calendar_snapshot_receipts (
    tenant_id,
    snapshot_id,
    payload_hash,
    generated_at,
    window_start,
    window_end,
    event_count,
    attendee_count
  ) values (
    p_tenant_id,
    left(trim(p_snapshot_id), 160),
    left(trim(p_payload_hash), 128),
    p_generated_at,
    p_window_start,
    p_window_end,
    event_count,
    attendee_count
  );

  insert into public.audit_log (
    tenant_id,
    actor_type,
    action,
    table_name,
    metadata
  ) values (
    p_tenant_id,
    'claude',
    'calendar.snapshot_recorded',
    'calendar_events',
    jsonb_build_object(
      'snapshot_id', left(trim(p_snapshot_id), 160),
      'generated_at', p_generated_at,
      'window_start', p_window_start,
      'window_end', p_window_end,
      'event_count', event_count,
      'attendee_count', attendee_count
    )
  );

  return jsonb_build_object(
    'snapshot_id', left(trim(p_snapshot_id), 160),
    'event_count', event_count,
    'attendee_count', attendee_count,
    'last_synced_at', p_generated_at
  );
end;
$function$;

grant execute
  on function "public"."lbb_record_claude_calendar_snapshot"(uuid, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, jsonb)
  to "postgres", "service_role";

revoke all
  on function "public"."lbb_record_claude_calendar_snapshot"(uuid, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, jsonb)
  from public;

-- source: public/functions/lbb_record_engagement_signal.sql
create or replace function public.lbb_record_engagement_signal (
  p_tenant_id       uuid,
  p_contact_id      uuid,
  p_idempotency_key text,
  p_signal_type     text,
  p_classification  text,
  p_summary         text,
  p_source          text,
  p_source_url      text,
  p_observed_at     timestamp with time zone
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
  AS $function$
declare
  new_id uuid;
  duplicate boolean := false;
  safe_classification text :=
    nullif(left(trim(coalesce(p_classification, '')), 40), '');
  safe_source text := nullif(left(trim(coalesce(p_source, '')), 80), '');
  lane text;
  content_kind text;
  expiry_interval interval;
begin
  if not exists (
    select 1
    from public.contacts
    where id = p_contact_id
      and tenant_id = p_tenant_id
      and archived_at is null
  ) then
    raise exception 'Contact does not belong to this tenant';
  end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Idempotency key is required';
  end if;

  if nullif(trim(coalesce(p_source_url, '')), '') is null
    or p_source_url !~* '^https?://'
  then
    raise exception 'A public HTTP or HTTPS source URL is required';
  end if;

  lane := case
    when safe_classification ~* 'active.?pursuit' then 'active'
    when safe_classification ~* 'relationship.?rescue|rescue|cooling' then 'rescue'
    when safe_classification ~* 'referral|partner' then 'partners'
    else null
  end;
  content_kind := case
    when safe_classification ~* 'structural' then 'STRUCTURAL'
    when safe_classification ~* 'continuity' then 'CONTINUITY'
    when safe_classification ~* 'hiring' then 'HIRING'
    when safe_classification ~* 'noise' then 'NOISE'
    else null
  end;
  expiry_interval := case
    when lower(coalesce(safe_source, '')) in (
      'linkedin',
      'instagram',
      'facebook',
      'x',
      'twitter'
    ) then interval '14 days'
    else interval '30 days'
  end;

  insert into public.signals (
    tenant_id,
    contact_id,
    signal_type,
    classification,
    content_classification,
    engagement_lane,
    summary,
    why_now,
    recommended_action,
    priority_score,
    source,
    source_url,
    payload,
    observed_at,
    published_at,
    expires_at
  ) values (
    p_tenant_id,
    p_contact_id,
    left(trim(p_signal_type), 40),
    safe_classification,
    content_kind,
    lane,
    left(trim(p_summary), 500),
    left(trim(p_summary), 500),
    'comment',
    case lane
      when 'active' then 100
      when 'rescue' then 85
      when 'partners' then 75
      else 50
    end,
    safe_source,
    left(trim(p_source_url), 2000),
    jsonb_build_object('idempotency_key', left(trim(p_idempotency_key), 160)),
    p_observed_at,
    p_observed_at,
    p_observed_at + expiry_interval
  )
  on conflict (tenant_id, source_url)
    where source_url is not null
  do nothing
  returning id into new_id;

  if new_id is null then
    duplicate := true;
    select id into new_id
    from public.signals
    where tenant_id = p_tenant_id
      and source_url = left(trim(p_source_url), 2000)
    limit 1;
  else
    insert into public.audit_log (
      tenant_id,
      actor_type,
      action,
      table_name,
      record_id,
      after
    ) values (
      p_tenant_id,
      'claude',
      'engagement.signal_recorded',
      'signals',
      new_id,
      jsonb_build_object(
        'contact_id', p_contact_id,
        'signal_type', left(trim(p_signal_type), 40),
        'source', safe_source,
        'source_url', left(trim(p_source_url), 2000),
        'published_at', p_observed_at,
        'expires_at', p_observed_at + expiry_interval
      )
    );
  end if;

  return jsonb_build_object(
    'id', new_id,
    'duplicate', duplicate
  );
end;
$function$;

grant execute on function "public"."lbb_record_engagement_signal"(uuid, uuid, text, text, text, text, text, text, timestamp with time zone) to "postgres", "service_role";

revoke all on function "public"."lbb_record_engagement_signal"(uuid, uuid, text, text, text, text, text, text, timestamp with time zone) from public;

-- source: public/functions/lbb_record_engagement_signal_v2.sql
create or replace function public.lbb_record_engagement_signal_v2 (
  p_tenant_id              uuid,
  p_contact_id             uuid,
  p_want_to_know_id        uuid,
  p_idempotency_key        text,
  p_signal_type            text,
  p_classification         text,
  p_summary                text,
  p_why_now                text,
  p_source                 text,
  p_source_url             text,
  p_published_at           timestamp with time zone,
  p_engagement_lane        text,
  p_content_classification text,
  p_recommended_action     text,
  p_priority_score         integer,
  p_exceptional_reason     text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
  AS $function$
declare
  new_id uuid;
  duplicate boolean := false;
  safe_classification text :=
    nullif(left(trim(coalesce(p_classification, '')), 40), '');
  safe_source text := nullif(left(trim(coalesce(p_source, '')), 80), '');
  safe_summary text := left(trim(coalesce(p_summary, '')), 500);
  safe_why text := left(trim(coalesce(p_why_now, p_summary, '')), 500);
  safe_exception text :=
    nullif(left(trim(coalesce(p_exceptional_reason, '')), 500), '');
  lane text;
  content_kind text;
  action_kind text;
  score integer := greatest(0, least(coalesce(p_priority_score, 50), 100));
  post_age interval := now() - p_published_at;
  expiry_interval interval := interval '30 days';
begin
  if num_nonnulls(p_contact_id, p_want_to_know_id) <> 1 then
    raise exception 'Exactly one contact or Want to Know target is required';
  end if;

  if p_contact_id is not null and not exists (
    select 1
    from public.contacts
    where id = p_contact_id
      and tenant_id = p_tenant_id
      and archived_at is null
  ) then
    raise exception 'Contact does not belong to this tenant';
  end if;

  if p_want_to_know_id is not null and not exists (
    select 1
    from public.want_to_know
    where id = p_want_to_know_id
      and tenant_id = p_tenant_id
      and stage <> 'graduated'
  ) then
    raise exception 'Want to Know person does not belong to this tenant';
  end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Idempotency key is required';
  end if;

  if safe_summary = '' or safe_why = '' then
    raise exception 'Summary and relationship rationale are required';
  end if;

  if nullif(trim(coalesce(p_source_url, '')), '') is null
    or p_source_url !~* '^https?://'
  then
    raise exception 'A public HTTP or HTTPS source URL is required';
  end if;

  if p_published_at is null or p_published_at > now() + interval '1 day' then
    raise exception 'A valid publication timestamp is required';
  end if;

  if post_age > interval '30 days' then
    raise exception 'Social engagement recommendations must be from the last 30 days';
  end if;

  lane := case
    when p_engagement_lane in ('active', 'partners', 'rescue')
      then p_engagement_lane
    when p_want_to_know_id is not null then 'active'
    when safe_classification ~* 'active.?pursuit' then 'active'
    when safe_classification ~* 'relationship.?rescue|rescue|cooling' then 'rescue'
    when safe_classification ~* 'referral|partner' then 'partners'
    else 'active'
  end;

  content_kind := case
    when upper(coalesce(p_content_classification, '')) in (
      'STRUCTURAL',
      'CONTINUITY',
      'HIRING',
      'NOISE'
    ) then upper(p_content_classification)
    when safe_classification ~* 'structural' then 'STRUCTURAL'
    when safe_classification ~* 'hiring' then 'HIRING'
    when safe_classification ~* 'noise' then 'NOISE'
    else 'CONTINUITY'
  end;

  action_kind := case
    when lower(coalesce(p_recommended_action, '')) in (
      'like',
      'comment',
      'share',
      'support'
    ) then lower(p_recommended_action)
    else 'comment'
  end;

  insert into public.signals (
    tenant_id,
    contact_id,
    want_to_know_id,
    signal_type,
    classification,
    content_classification,
    engagement_lane,
    summary,
    why_now,
    recommended_action,
    priority_score,
    exceptional_reason,
    source,
    source_url,
    payload,
    observed_at,
    published_at,
    expires_at
  ) values (
    p_tenant_id,
    p_contact_id,
    p_want_to_know_id,
    left(trim(p_signal_type), 40),
    safe_classification,
    content_kind,
    lane,
    safe_summary,
    safe_why,
    action_kind,
    score,
    safe_exception,
    safe_source,
    left(trim(p_source_url), 2000),
    jsonb_build_object('idempotency_key', left(trim(p_idempotency_key), 160)),
    p_published_at,
    p_published_at,
    p_published_at + expiry_interval
  )
  on conflict (tenant_id, source_url)
    where source_url is not null
  do nothing
  returning id into new_id;

  if new_id is null then
    duplicate := true;
    select id into new_id
    from public.signals
    where tenant_id = p_tenant_id
      and source_url = left(trim(p_source_url), 2000)
    limit 1;
  else
    insert into public.audit_log (
      tenant_id,
      actor_type,
      action,
      table_name,
      record_id,
      after
    ) values (
      p_tenant_id,
      'claude',
      'engagement.signal_recorded',
      'signals',
      new_id,
      jsonb_build_object(
        'contact_id', p_contact_id,
        'want_to_know_id', p_want_to_know_id,
        'signal_type', left(trim(p_signal_type), 40),
        'source', safe_source,
        'source_url', left(trim(p_source_url), 2000),
        'published_at', p_published_at,
        'expires_at', p_published_at + expiry_interval,
        'engagement_lane', lane,
        'recommended_action', action_kind
      )
    );
  end if;

  return jsonb_build_object(
    'id', new_id,
    'duplicate', duplicate
  );
end;
$function$;

grant execute
  on function "public"."lbb_record_engagement_signal_v2"(uuid, uuid, uuid, text, text, text, text, text, text, text, timestamp with time zone, text, text, text, integer, text)
  to "postgres", "service_role";

revoke all
  on function "public"."lbb_record_engagement_signal_v2"(uuid, uuid, uuid, text, text, text, text, text, text, text, timestamp with time zone, text, text, text, integer, text)
  from public;

-- source: public/functions/lbb_record_engagement_signal_v3.sql
create or replace function public.lbb_record_engagement_signal_v3 (
  p_tenant_id              uuid,
  p_contact_id             uuid,
  p_want_to_know_id        uuid,
  p_idempotency_key        text,
  p_signal_type            text,
  p_classification         text,
  p_summary                text,
  p_why_now                text,
  p_source                 text,
  p_source_url             text,
  p_published_at           timestamp with time zone,
  p_engagement_lane        text,
  p_content_classification text,
  p_recommended_action     text,
  p_priority_score         integer,
  p_exceptional_reason     text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
  AS $function$
declare
  existing_id uuid;
  entity_lock_key text;
begin
  if num_nonnulls(p_contact_id, p_want_to_know_id) <> 1 then
    raise exception 'Exactly one contact or Want to Know target is required';
  end if;

  entity_lock_key := p_tenant_id::text || ':' || case
    when p_contact_id is not null then 'contact:' || p_contact_id::text
    else 'want:' || p_want_to_know_id::text
  end;
  perform pg_advisory_xact_lock(hashtextextended(entity_lock_key, 0));

  select id
  into existing_id
  from public.signals
  where tenant_id = p_tenant_id
    and (
      (p_contact_id is not null and contact_id = p_contact_id)
      or
      (p_want_to_know_id is not null and want_to_know_id = p_want_to_know_id)
    )
    and dismissed_at is null
    and engaged_at is null
    and (expires_at is null or expires_at > now())
  order by created_at desc
  limit 1;

  if existing_id is not null then
    return jsonb_build_object(
      'id', existing_id,
      'duplicate', true,
      'entity_duplicate', true
    );
  end if;

  return public.lbb_record_engagement_signal_v2(
    p_tenant_id,
    p_contact_id,
    p_want_to_know_id,
    p_idempotency_key,
    p_signal_type,
    p_classification,
    p_summary,
    p_why_now,
    p_source,
    p_source_url,
    p_published_at,
    p_engagement_lane,
    p_content_classification,
    p_recommended_action,
    p_priority_score,
    p_exceptional_reason
  );
end;
$function$;

grant execute
  on function "public"."lbb_record_engagement_signal_v3"(uuid, uuid, uuid, text, text, text, text, text, text, text, timestamp with time zone, text, text, text, integer, text)
  to "postgres", "service_role";

revoke all
  on function "public"."lbb_record_engagement_signal_v3"(uuid, uuid, uuid, text, text, text, text, text, text, text, timestamp with time zone, text, text, text, integer, text)
  from public;

-- source: public/functions/lbb_record_networking_recommendation.sql
create or replace function public.lbb_record_networking_recommendation (
  p_tenant_id       uuid,
  p_idempotency_key text,
  p_contact_a       uuid,
  p_contact_b       uuid,
  p_summary         text,
  p_why_now         text,
  p_match_type      text,
  p_direction       text,
  p_confidence      numeric,
  p_priority_score  integer,
  p_evidence        jsonb   default '[]'::jsonb
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
  AS $function$
declare
  pair_a uuid := least(p_contact_a, p_contact_b);
  pair_b uuid := greatest(p_contact_a, p_contact_b);
  existing_row public.connections%rowtype;
  created_row public.connections%rowtype;
  shared_context text;
  existing_key_pair text;
begin
  if p_tenant_id is null or p_contact_a is null or p_contact_b is null then
    raise exception 'Tenant and both contacts are required';
  end if;
  if p_contact_a = p_contact_b then
    raise exception 'A contact cannot be introduced to themselves';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Idempotency key is required';
  end if;
  if nullif(trim(coalesce(p_summary, '')), '') is null
     or nullif(trim(coalesce(p_why_now, '')), '') is null then
    raise exception 'Summary and why_now are required';
  end if;
  if p_direction not in ('a_to_b', 'b_to_a', 'two_way') then
    raise exception 'Unsupported recommendation direction';
  end if;
  if p_match_type not in ('podcast', 'referral', 'commercial', 'expertise', 'peer', 'other') then
    raise exception 'Unsupported networking match type';
  end if;

  if not exists (
    select 1 from public.contacts
    where tenant_id = p_tenant_id and id = pair_a and archived_at is null
      and coalesce(trust_level, '') !~* 'do not refer'
  ) or not exists (
    select 1 from public.contacts
    where tenant_id = p_tenant_id and id = pair_b and archived_at is null
      and coalesce(trust_level, '') !~* 'do not refer'
  ) then
    raise exception 'Both contacts must be active, referable contacts in this tenant';
  end if;

  select concat(contact_a, ':', contact_b)
  into existing_key_pair
  from public.connections
  where tenant_id = p_tenant_id
    and evidence ->> 'idempotency_key' = p_idempotency_key
  limit 1;

  if existing_key_pair is not null
     and existing_key_pair <> concat(pair_a, ':', pair_b) then
    raise exception 'Idempotency key has already been used for another pair';
  end if;

  select * into existing_row
  from public.connections
  where tenant_id = p_tenant_id and contact_a = pair_a and contact_b = pair_b
  for update;

  if found then
    if existing_row.status = 'suggested'
       and coalesce(existing_row.snoozed_until, '-infinity'::timestamptz) <= now()
       and existing_row.source in ('network_fit_v1', 'network_fit_v2') then
      update public.connections
      set
        source = 'claude_intelligence_v1',
        evidence = jsonb_build_object(
          'idempotency_key', left(trim(p_idempotency_key), 160),
          'summary', left(trim(p_summary), 500),
          'why_now', left(trim(p_why_now), 500),
          'match_type', p_match_type,
          'direction', p_direction,
          'score', greatest(0, least(100, coalesce(p_priority_score, 50))),
          'evidence_refs', coalesce(p_evidence, '[]'::jsonb),
          'generated_at', now(),
          'generator_version', 'claude_intelligence_v1',
          'replaced_generator', existing_row.source
        ),
        confidence = greatest(0, least(0.999, coalesce(p_confidence, 0.5))),
        updated_at = now()
      where id = existing_row.id and tenant_id = p_tenant_id
      returning * into created_row;

      insert into public.audit_log (
        tenant_id, actor_type, action, table_name, record_id, before, after, metadata
      ) values (
        p_tenant_id, 'claude', 'networking.recommendation_upgraded',
        'connections', created_row.id, to_jsonb(existing_row), to_jsonb(created_row),
        jsonb_build_object('idempotency_key', left(trim(p_idempotency_key), 160))
      );

      return jsonb_build_object(
        'id', created_row.id, 'status', 'upgraded',
        'queue_state', created_row.status,
        'reason', 'automatic_recommendation_replaced'
      );
    end if;

    return jsonb_build_object(
      'id', existing_row.id,
      'status', case when existing_row.status = 'suggested' then 'duplicate' else 'preserved' end,
      'queue_state', existing_row.status,
      'reason', case
        when existing_row.status = 'already_connected' then 'already_connected'
        when existing_row.status = 'dismissed' then 'owner_decision_preserved'
        when existing_row.snoozed_until > now() then 'owner_snooze_preserved'
        else 'pair_already_exists'
      end
    );
  end if;

  if exists (
    select 1 from public.introductions
    where tenant_id = p_tenant_id
      and least(person_a, person_b) = pair_a
      and greatest(person_a, person_b) = pair_b
  ) then
    return jsonb_build_object('status', 'suppressed', 'reason', 'prior_introduction');
  end if;

  select rc.name into shared_context
  from public.relationship_context_memberships a
  join public.relationship_context_memberships b
    on b.tenant_id = a.tenant_id and b.context_id = a.context_id
  join public.relationship_contexts rc
    on rc.tenant_id = a.tenant_id and rc.id = a.context_id
  where a.tenant_id = p_tenant_id
    and a.contact_id = pair_a and b.contact_id = pair_b
    and a.verification_state = 'confirmed'
    and b.verification_state = 'confirmed'
    and rc.connection_prior in ('strong', 'moderate')
    and rc.archived_at is null
  limit 1;

  if shared_context is not null then
    return jsonb_build_object(
      'status', 'suppressed', 'reason', 'shared_relationship_context', 'context', shared_context
    );
  end if;

  insert into public.connections (
    tenant_id, contact_a, contact_b, source, evidence, confidence, status, updated_at
  ) values (
    p_tenant_id, pair_a, pair_b, 'claude_intelligence_v1',
    jsonb_build_object(
      'idempotency_key', left(trim(p_idempotency_key), 160),
      'summary', left(trim(p_summary), 500),
      'why_now', left(trim(p_why_now), 500),
      'match_type', p_match_type,
      'direction', p_direction,
      'score', greatest(0, least(100, coalesce(p_priority_score, 50))),
      'evidence_refs', coalesce(p_evidence, '[]'::jsonb),
      'generated_at', now(),
      'generator_version', 'claude_intelligence_v1'
    ),
    greatest(0, least(0.999, coalesce(p_confidence, 0.5))),
    'suggested', now()
  )
  on conflict (tenant_id, contact_a, contact_b) do nothing
  returning * into created_row;

  if not found then
    select * into existing_row
    from public.connections
    where tenant_id = p_tenant_id and contact_a = pair_a and contact_b = pair_b;
    return jsonb_build_object(
      'id', existing_row.id, 'status', 'duplicate',
      'queue_state', existing_row.status, 'reason', 'pair_already_exists'
    );
  end if;

  insert into public.audit_log (
    tenant_id, actor_type, action, table_name, record_id, after, metadata
  ) values (
    p_tenant_id, 'claude', 'networking.recommendation_created',
    'connections', created_row.id, to_jsonb(created_row),
    jsonb_build_object(
      'idempotency_key', left(trim(p_idempotency_key), 160),
      'generator_version', 'claude_intelligence_v1'
    )
  );

  return jsonb_build_object(
    'id', created_row.id, 'status', 'created', 'queue_state', created_row.status
  );
end;
$function$;

grant execute on function "public"."lbb_record_networking_recommendation"(uuid, text, uuid, uuid, text, text, text, text, numeric, integer, jsonb) to "postgres", "service_role";

revoke all on function "public"."lbb_record_networking_recommendation"(uuid, text, uuid, uuid, text, text, text, text, numeric, integer, jsonb) from public;

-- source: public/functions/lbb_record_provider_usage.sql
create or replace function public.lbb_record_provider_usage (
  p_tenant_id           uuid,
  p_provider            text,
  p_event_type          text,
  p_external_ref        text,
  p_quantity            numeric,
  p_unit                text,
  p_provider_cost_cents integer,
  p_billable_cents      integer,
  p_billing_status      text,
  p_pricing_snapshot    jsonb   default '{}'::jsonb,
  p_metadata            jsonb   default '{}'::jsonb
)
  returns uuid
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
  AS $function$
declare
  usage_event_id uuid;
begin
  if p_provider not in ('apify', 'outscraper')
    or p_billing_status not in ('estimated', 'final', 'credited')
    or coalesce(length(trim(p_event_type)), 0) = 0
    or coalesce(length(trim(p_external_ref)), 0) = 0
    or p_provider_cost_cents is null
    or p_billable_cents is null
    or p_provider_cost_cents < 0
    or p_billable_cents < 0
    or not exists (
      select 1 from public.tenants where id = p_tenant_id
    )
  then
    raise exception 'Invalid provider usage event';
  end if;

  insert into public.usage_events (
    tenant_id,
    actor_type,
    event_type,
    quantity,
    unit,
    cost_cents,
    provider,
    provider_operation,
    external_ref,
    provider_cost_cents,
    billable_cents,
    billing_status,
    pricing_snapshot,
    settled_at,
    metadata
  ) values (
    p_tenant_id,
    'gateway',
    left(p_event_type, 160),
    greatest(coalesce(p_quantity, 0), 0),
    left(coalesce(nullif(trim(p_unit), ''), 'event'), 80),
    p_provider_cost_cents,
    p_provider,
    left(p_event_type, 160),
    left(trim(p_external_ref), 300),
    p_provider_cost_cents,
    p_billable_cents,
    p_billing_status,
    coalesce(p_pricing_snapshot, '{}'::jsonb),
    case when p_billing_status = 'final' then now() else null end,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (tenant_id, provider, external_ref, event_type)
    where provider is not null and external_ref is not null
  do update set
    quantity = excluded.quantity,
    unit = excluded.unit,
    cost_cents = case
      when public.usage_events.billing_status in ('final', 'credited')
        and excluded.billing_status = 'estimated'
      then public.usage_events.cost_cents
      else excluded.cost_cents
    end,
    provider_cost_cents = case
      when public.usage_events.billing_status in ('final', 'credited')
        and excluded.billing_status = 'estimated'
      then public.usage_events.provider_cost_cents
      else excluded.provider_cost_cents
    end,
    billable_cents = case
      when public.usage_events.billing_status in ('final', 'credited')
        and excluded.billing_status = 'estimated'
      then public.usage_events.billable_cents
      else excluded.billable_cents
    end,
    billing_status = case
      when public.usage_events.billing_status in ('final', 'credited')
        and excluded.billing_status = 'estimated'
      then public.usage_events.billing_status
      else excluded.billing_status
    end,
    pricing_snapshot = case
      when public.usage_events.billing_status in ('final', 'credited')
        and excluded.billing_status = 'estimated'
      then public.usage_events.pricing_snapshot
      else excluded.pricing_snapshot
    end,
    settled_at = case
      when public.usage_events.billing_status in ('final', 'credited')
        and excluded.billing_status = 'estimated'
      then public.usage_events.settled_at
      else excluded.settled_at
    end,
    metadata = public.usage_events.metadata || excluded.metadata
  returning id into usage_event_id;

  return usage_event_id;
end;
$function$;

grant execute on function "public"."lbb_record_provider_usage"(uuid, text, text, text, numeric, text, integer, integer, text, jsonb, jsonb) to "postgres", "service_role";

revoke all on function "public"."lbb_record_provider_usage"(uuid, text, text, text, numeric, text, integer, integer, text, jsonb, jsonb) from public;

-- source: public/functions/lbb_refresh_relationship_strength.sql
create or replace function public.lbb_refresh_relationship_strength (
  p_tenant_id uuid
)
  returns jsonb
  language plpgsql
  set search_path to ''
  AS $function$
declare
  updated_count integer := 0;
begin
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Tenant does not exist.' using errcode = '22023';
  end if;

  with interaction_stats as (
    select
      c.id as contact_id,
      max(i.occurred_at)::date as last_interaction_date,
      count(i.id) filter (where i.occurred_at >= now() - interval '90 days') as interactions_90,
      count(i.id) filter (where i.occurred_at >= now() - interval '365 days') as interactions_365
    from public.contacts c
    left join public.interaction_contacts ic
      on ic.tenant_id = c.tenant_id
     and ic.contact_id = c.id
    left join public.interactions i
      on i.tenant_id = c.tenant_id
     and i.id = ic.interaction_id
     and i.occurred_at <= now() + interval '5 minutes'
    where c.tenant_id = p_tenant_id
      and c.archived_at is null
    group by c.id
  ), computed as (
    select
      c.id,
      coalesce(interaction_stats.last_interaction_date, c.last_spoke) as last_contact_date,
      interaction_stats.interactions_90,
      interaction_stats.interactions_365
    from public.contacts c
    join interaction_stats on interaction_stats.contact_id = c.id
    where c.tenant_id = p_tenant_id
      and c.archived_at is null
      and c.relationship_strength_override = false
  ), scored as (
    select
      id,
      case
        when last_contact_date is null and interactions_365 = 0 then 'Unknown'
        when last_contact_date is not null and current_date - last_contact_date <= 30 then 'Hot'
        when interactions_90 >= 3 then 'Hot'
        when last_contact_date is not null and current_date - last_contact_date <= 90 then 'Warm'
        when interactions_365 >= 3 then 'Warm'
        when last_contact_date is not null and current_date - last_contact_date <= 180 then 'Cooling'
        when interactions_365 >= 1 then 'Cooling'
        else 'Cold'
      end as strength,
      case
        when last_contact_date is null and interactions_365 = 0 then 'No dated interaction or last-spoke signal is stored yet.'
        when last_contact_date is not null and current_date - last_contact_date <= 30 then 'Recent contact within 30 days.'
        when interactions_90 >= 3 then 'Three or more interactions in the last 90 days.'
        when last_contact_date is not null and current_date - last_contact_date <= 90 then 'Recent contact within 90 days.'
        when interactions_365 >= 3 then 'Three or more interactions in the last year.'
        when last_contact_date is not null and current_date - last_contact_date <= 180 then 'Contact within the last 180 days.'
        when interactions_365 >= 1 then 'At least one interaction in the last year.'
        else 'No recent interaction signal in the last year.'
      end as reason
    from computed
  ), updated as (
    update public.contacts c
    set relationship_strength_computed = scored.strength,
        relationship_strength = scored.strength,
        relationship_strength_reason = scored.reason,
        strength_updated = current_date,
        updated_at = now()
    from scored
    where c.id = scored.id
      and c.tenant_id = p_tenant_id
      and c.relationship_strength_override = false
      and (
        c.relationship_strength_computed is distinct from scored.strength
        or c.relationship_strength is distinct from scored.strength
        or c.relationship_strength_reason is distinct from scored.reason
        or c.strength_updated is distinct from current_date
      )
    returning c.id
  )
  select count(*) into updated_count from updated;

  insert into public.audit_log (tenant_id, actor_type, action, table_name, after)
  values (p_tenant_id, 'system', 'relationship_strength.refreshed', 'contacts', jsonb_build_object('updated_count', updated_count));

  return jsonb_build_object('updated_count', updated_count);
end;
$function$;

grant execute on function "public"."lbb_refresh_relationship_strength"(uuid) to "postgres", "service_role";

revoke all on function "public"."lbb_refresh_relationship_strength"(uuid) from public;

-- source: public/functions/lbb_replace_calendar_attendees.sql
create or replace function public.lbb_replace_calendar_attendees (
  p_tenant_id     uuid,
  p_event_id      uuid,
  p_owner_user_id uuid,
  p_attendees     jsonb
)
  returns integer
  language plpgsql
  security definer
  set search_path to ''
  AS $function$
declare
  inserted_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  if not exists (
    select 1
    from public.calendar_events e
    where e.tenant_id = p_tenant_id
      and e.id = p_event_id
      and e.owner_user_id = p_owner_user_id
  ) then
    raise exception 'calendar event not found';
  end if;

  delete from public.calendar_attendees
  where tenant_id = p_tenant_id
    and event_id = p_event_id
    and owner_user_id = p_owner_user_id;

  insert into public.calendar_attendees (
    tenant_id,
    event_id,
    owner_user_id,
    normalized_email,
    display_name,
    response_status,
    is_organizer,
    matched_contact_id,
    matched_want_to_know_id
  )
  select
    p_tenant_id,
    p_event_id,
    p_owner_user_id,
    lower(trim(item->>'normalized_email')),
    nullif(trim(item->>'display_name'), ''),
    nullif(trim(item->>'response_status'), ''),
    coalesce((item->>'is_organizer')::boolean, false),
    nullif(item->>'matched_contact_id', '')::uuid,
    nullif(item->>'matched_want_to_know_id', '')::uuid
  from jsonb_array_elements(coalesce(p_attendees, '[]'::jsonb)) item;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$;

grant execute on function "public"."lbb_replace_calendar_attendees"(uuid, uuid, uuid, jsonb) to "postgres", "service_role";

revoke all on function "public"."lbb_replace_calendar_attendees"(uuid, uuid, uuid, jsonb) from public;

-- source: public/functions/lbb_replace_relationship_context_members.sql
create or replace function public.lbb_replace_relationship_context_members (
  p_tenant_id     uuid,
  p_actor_user_id uuid,
  p_context_id    uuid,
  p_contact_ids   uuid[]
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'app_private'
  AS $function$
declare
  context_row public.relationship_contexts%rowtype;
  normalized_contacts uuid[];
  previous_contacts uuid[];
  expected_count integer;
  matched_count integer;
begin
  if not exists (
    select 1
    from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and status = 'active'
  ) then
    raise exception 'Actor is not an active tenant member';
  end if;

  select * into context_row
  from public.relationship_contexts
  where tenant_id = p_tenant_id
    and id = p_context_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Relationship context not found';
  end if;

  select coalesce(array_agg(distinct contact_id), '{}'::uuid[])
  into normalized_contacts
  from unnest(coalesce(p_contact_ids, '{}'::uuid[])) as member(contact_id);

  expected_count := cardinality(normalized_contacts);
  if expected_count > 100 then
    raise exception 'A context can contain no more than 100 contacts';
  end if;

  select count(*) into matched_count
  from public.contacts
  where tenant_id = p_tenant_id
    and id = any(normalized_contacts)
    and archived_at is null;

  if matched_count <> expected_count then
    raise exception 'Every context member must belong to this tenant';
  end if;

  select coalesce(array_agg(contact_id order by contact_id), '{}'::uuid[])
  into previous_contacts
  from public.relationship_context_memberships
  where tenant_id = p_tenant_id
    and context_id = p_context_id;

  delete from public.relationship_context_memberships
  where tenant_id = p_tenant_id
    and context_id = p_context_id
    and not (contact_id = any(normalized_contacts));

  insert into public.relationship_context_memberships (
    tenant_id,
    context_id,
    contact_id,
    verification_state,
    source,
    source_connection_id,
    created_by
  )
  select
    p_tenant_id,
    p_context_id,
    contact_id,
    'confirmed',
    'owner',
    null,
    p_actor_user_id
  from unnest(normalized_contacts) as member(contact_id)
  on conflict (tenant_id, context_id, contact_id) do update set
    verification_state = 'confirmed',
    source = 'owner',
    source_connection_id = null,
    created_by = p_actor_user_id;

  insert into public.audit_log (
    tenant_id,
    actor_user_id,
    actor_type,
    action,
    table_name,
    record_id,
    before,
    after
  ) values (
    p_tenant_id,
    p_actor_user_id,
    'client',
    'relationship_context.members_replaced',
    'relationship_contexts',
    p_context_id,
    jsonb_build_object('contact_ids', to_jsonb(previous_contacts)),
    jsonb_build_object('contact_ids', to_jsonb(normalized_contacts))
  );

  return jsonb_build_object(
    'context_id', p_context_id,
    'name', context_row.name,
    'previous_contact_ids', to_jsonb(previous_contacts),
    'contact_ids', to_jsonb(normalized_contacts),
    'member_count', expected_count
  );
end;
$function$;

grant execute on function "public"."lbb_replace_relationship_context_members"(uuid, uuid, uuid, uuid[]) to "postgres", "service_role";

revoke all on function "public"."lbb_replace_relationship_context_members"(uuid, uuid, uuid, uuid[]) from public;

-- source: public/functions/lbb_reserve_content_scan_run.sql
create or replace function public.lbb_reserve_content_scan_run (
  p_tenant_id            uuid,
  p_source_id            uuid,
  p_provider_task_id     text,
  p_reserved_cost_usd    numeric,
  p_daily_run_limit      integer,
  p_concurrent_run_limit integer,
  p_monthly_budget_usd   numeric,
  p_metadata             jsonb   default '{}'::jsonb
)
  returns uuid
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
  AS $function$
declare
  reserved_run_id uuid;
  runs_today integer;
  active_runs integer;
  month_spend numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));

  if not exists (
    select 1
    from public.content_scan_sources
    where tenant_id = p_tenant_id
      and id = p_source_id
      and enabled
  ) then
    return null;
  end if;

  select count(*) into runs_today
  from public.content_scan_runs
  where tenant_id = p_tenant_id
    and started_at >= date_trunc('day', now());

  select count(*) into active_runs
  from public.content_scan_runs
  where tenant_id = p_tenant_id
    and status in ('starting', 'running');

  select coalesce(sum(coalesce(actual_cost_usd, reserved_cost_usd)), 0)
  into month_spend
  from public.content_scan_runs
  where tenant_id = p_tenant_id
    and started_at >= date_trunc('month', now());

  if runs_today >= greatest(1, least(p_daily_run_limit, 25))
    or active_runs >= greatest(1, least(p_concurrent_run_limit, 10))
    or month_spend + p_reserved_cost_usd > greatest(0, p_monthly_budget_usd)
  then
    return null;
  end if;

  insert into public.content_scan_runs (
    tenant_id,
    source_id,
    provider_task_id,
    status,
    reserved_cost_usd,
    metadata
  ) values (
    p_tenant_id,
    p_source_id,
    left(p_provider_task_id, 160),
    'starting',
    least(greatest(p_reserved_cost_usd, 0), 100),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into reserved_run_id;

  return reserved_run_id;
exception
  when unique_violation then
    return null;
end;
$function$;

grant execute on function "public"."lbb_reserve_content_scan_run"(uuid, uuid, text, numeric, integer, integer, numeric, jsonb) to "postgres", "service_role";

revoke all on function "public"."lbb_reserve_content_scan_run"(uuid, uuid, text, numeric, integer, integer, numeric, jsonb) from public;

-- source: public/functions/lbb_restore_connection_recommendation.sql
create or replace function public.lbb_restore_connection_recommendation (
  p_connection_id uuid,
  p_tenant_id     uuid,
  p_actor_user_id uuid
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
  AS $function$
declare
  before_row public.connections%rowtype;
  after_row public.connections%rowtype;
  removed_context_count integer := 0;
begin
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and status = 'active'
  ) then
    raise exception 'Actor is not an active tenant member';
  end if;

  select * into before_row
  from public.connections
  where id = p_connection_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Connection recommendation not found';
  end if;

  delete from public.connection_contexts
  where tenant_id = p_tenant_id
    and connection_id = p_connection_id;
  get diagnostics removed_context_count = row_count;

  update public.connections
  set
    status = 'suggested',
    owner_note = null,
    confirmed_at = null,
    confirmed_by = null,
    snoozed_until = null,
    snoozed_at = null,
    snoozed_by = null,
    updated_at = now()
  where id = p_connection_id
    and tenant_id = p_tenant_id
  returning * into after_row;

  if to_jsonb(before_row) is distinct from to_jsonb(after_row)
    or removed_context_count > 0 then
    insert into public.audit_log (
      tenant_id,
      actor_user_id,
      actor_type,
      action,
      table_name,
      record_id,
      before,
      after
    ) values (
      p_tenant_id,
      p_actor_user_id,
      'client',
      'connection.recommendation_restored',
      'connections',
      p_connection_id,
      to_jsonb(before_row),
      to_jsonb(after_row) || jsonb_build_object(
        'removed_connection_contexts', removed_context_count
      )
    );
  end if;

  return jsonb_build_object(
    'changed', to_jsonb(before_row) is distinct from to_jsonb(after_row)
      or removed_context_count > 0,
    'connection_id', after_row.id,
    'contact_a', after_row.contact_a,
    'contact_b', after_row.contact_b,
    'status', after_row.status
  );
end;
$function$;

grant execute on function "public"."lbb_restore_connection_recommendation"(uuid, uuid, uuid) to "postgres", "service_role";

revoke all on function "public"."lbb_restore_connection_recommendation"(uuid, uuid, uuid) from public;

-- source: public/functions/lbb_save_google_calendar_connection.sql
create or replace function public.lbb_save_google_calendar_connection (
  p_tenant_id     uuid,
  p_user_id       uuid,
  p_account_email text,
  p_scopes        text[],
  p_refresh_token text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'vault'
  AS $function$
declare
  connection_row public.integration_connections%rowtype;
  secret_id uuid;
begin
  if not exists (
    select 1
    from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_user_id
      and status = 'active'
  ) then
    raise exception 'Actor is not an active tenant member';
  end if;

  select *
  into connection_row
  from public.integration_connections
  where tenant_id = p_tenant_id
    and user_id = p_user_id
    and provider = 'google_calendar'
  for update;

  secret_id := connection_row.refresh_token_secret_id;

  if nullif(trim(coalesce(p_refresh_token, '')), '') is not null then
    if secret_id is null then
      secret_id := vault.create_secret(
        p_refresh_token,
        'lbb-google-calendar-' || p_tenant_id::text || '-' || p_user_id::text,
        'Little Black Book Google Calendar refresh token'
      );
    else
      perform vault.update_secret(
        secret_id,
        p_refresh_token,
        'lbb-google-calendar-' || p_tenant_id::text || '-' || p_user_id::text,
        'Little Black Book Google Calendar refresh token'
      );
    end if;
  end if;

  if secret_id is null then
    raise exception 'Google did not provide a reusable refresh token';
  end if;

  insert into public.integration_connections (
    tenant_id,
    user_id,
    provider,
    status,
    external_account_email,
    scopes,
    refresh_token_secret_id,
    last_error
  ) values (
    p_tenant_id,
    p_user_id,
    'google_calendar',
    'active',
    nullif(left(trim(coalesce(p_account_email, '')), 320), ''),
    coalesce(p_scopes, '{}'::text[]),
    secret_id,
    null
  )
  on conflict (tenant_id, user_id, provider)
  do update set
    status = 'active',
    external_account_email = excluded.external_account_email,
    scopes = excluded.scopes,
    refresh_token_secret_id = secret_id,
    last_error = null,
    updated_at = now()
  returning * into connection_row;

  insert into public.audit_log (
    tenant_id,
    actor_user_id,
    actor_type,
    action,
    table_name,
    record_id,
    metadata
  ) values (
    p_tenant_id,
    p_user_id,
    'client',
    'integration.google_calendar.connected',
    'integration_connections',
    connection_row.id,
    jsonb_build_object(
      'account_email', connection_row.external_account_email,
      'scopes', connection_row.scopes
    )
  );

  return jsonb_build_object(
    'id', connection_row.id,
    'account_email', connection_row.external_account_email
  );
end;
$function$;

grant execute on function "public"."lbb_save_google_calendar_connection"(uuid, uuid, text, text[], text) to "postgres", "service_role";

revoke all on function "public"."lbb_save_google_calendar_connection"(uuid, uuid, text, text[], text) from public;

-- source: public/functions/lbb_save_google_gmail_connection.sql
create or replace function public.lbb_save_google_gmail_connection (
  p_tenant_id     uuid,
  p_user_id       uuid,
  p_account_email text,
  p_scopes        text[],
  p_refresh_token text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'vault'
  AS $function$
declare
  connection_row public.integration_connections%rowtype;
  secret_id uuid;
begin
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_user_id
      and status = 'active'
  ) then
    raise exception 'Actor is not an active tenant member';
  end if;

  select * into connection_row
  from public.integration_connections
  where tenant_id = p_tenant_id
    and user_id = p_user_id
    and provider = 'google_gmail'
  for update;

  secret_id := connection_row.refresh_token_secret_id;
  if nullif(trim(coalesce(p_refresh_token, '')), '') is not null then
    if secret_id is null then
      secret_id := vault.create_secret(
        p_refresh_token,
        'lbb-google-gmail-' || p_tenant_id::text || '-' || p_user_id::text,
        'Little Black Book Gmail refresh token'
      );
    else
      perform vault.update_secret(
        secret_id,
        p_refresh_token,
        'lbb-google-gmail-' || p_tenant_id::text || '-' || p_user_id::text,
        'Little Black Book Gmail refresh token'
      );
    end if;
  end if;

  if secret_id is null then
    raise exception 'Google did not provide a reusable refresh token';
  end if;

  insert into public.integration_connections (
    tenant_id, user_id, provider, status, external_account_email, scopes,
    refresh_token_secret_id, last_error
  ) values (
    p_tenant_id, p_user_id, 'google_gmail', 'active',
    nullif(left(trim(coalesce(p_account_email, '')), 320), ''),
    coalesce(p_scopes, '{}'::text[]), secret_id, null
  )
  on conflict (tenant_id, user_id, provider)
  do update set
    status = 'active',
    external_account_email = excluded.external_account_email,
    scopes = excluded.scopes,
    refresh_token_secret_id = secret_id,
    last_error = null,
    updated_at = now()
  returning * into connection_row;

  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action, table_name, record_id, metadata
  ) values (
    p_tenant_id, p_user_id, 'client', 'integration.google_gmail.connected',
    'integration_connections', connection_row.id,
    jsonb_build_object(
      'account_email', connection_row.external_account_email,
      'scopes', connection_row.scopes
    )
  );

  return jsonb_build_object(
    'id', connection_row.id,
    'account_email', connection_row.external_account_email
  );
end;
$function$;

grant execute on function "public"."lbb_save_google_gmail_connection"(uuid, uuid, text, text[], text) to "postgres", "service_role";

revoke all on function "public"."lbb_save_google_gmail_connection"(uuid, uuid, text, text[], text) from public;

-- source: public/functions/lbb_save_relationship_context.sql
create or replace function public.lbb_save_relationship_context (
  p_tenant_id     uuid,
  p_actor_user_id uuid,
  p_context_id    uuid,
  p_name          text,
  p_context_type  text,
  p_description   text,
  p_contact_ids   uuid[]
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'app_private'
  AS $function$
declare
  context_row public.relationship_contexts%rowtype;
  normalized_name text := left(trim(coalesce(p_name, '')), 160);
  normalized_type text := lower(trim(coalesce(p_context_type, 'other')));
  normalized_description text := nullif(left(trim(coalesce(p_description, '')), 1200), '');
  normalized_contacts uuid[];
  expected_count integer;
  matched_count integer;
  prior text;
begin
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and status = 'active'
  ) then
    raise exception 'Actor is not an active tenant member';
  end if;

  if normalized_type not in (
    'mastermind', 'conference', 'board', 'community', 'company',
    'cohort', 'school', 'event', 'other'
  ) then
    raise exception 'Unsupported relationship context type';
  end if;

  select coalesce(array_agg(distinct contact_id), '{}'::uuid[])
  into normalized_contacts
  from unnest(coalesce(p_contact_ids, '{}'::uuid[])) as member(contact_id);

  expected_count := cardinality(normalized_contacts);
  if expected_count = 0 or expected_count > 100 then
    raise exception 'A context needs between 1 and 100 contacts';
  end if;

  select count(*) into matched_count
  from public.contacts
  where tenant_id = p_tenant_id
    and id = any(normalized_contacts)
    and archived_at is null;

  if matched_count <> expected_count then
    raise exception 'Every context member must belong to this tenant';
  end if;

  prior := case
    when normalized_type in ('mastermind', 'board', 'company', 'cohort') then 'strong'
    when normalized_type in ('community', 'school') then 'moderate'
    when normalized_type in ('conference', 'event') then 'weak'
    else 'moderate'
  end;

  if p_context_id is not null then
    update public.relationship_contexts
    set
      description = coalesce(normalized_description, description),
      archived_at = null
    where tenant_id = p_tenant_id
      and id = p_context_id
    returning * into context_row;

    if not found then
      raise exception 'Relationship context not found';
    end if;
  else
    if normalized_name = '' then
      raise exception 'Relationship context name is required';
    end if;

    insert into public.relationship_contexts (
      tenant_id,
      name,
      canonical_key,
      context_type,
      connection_prior,
      description,
      source,
      created_by
    ) values (
      p_tenant_id,
      normalized_name,
      app_private.relationship_context_key(normalized_name),
      normalized_type,
      prior,
      normalized_description,
      'owner',
      p_actor_user_id
    )
    on conflict (tenant_id, canonical_key) do update set
      description = coalesce(excluded.description, public.relationship_contexts.description),
      archived_at = null
    returning * into context_row;
  end if;

  insert into public.relationship_context_memberships (
    tenant_id,
    context_id,
    contact_id,
    verification_state,
    source,
    source_connection_id,
    created_by
  )
  select
    p_tenant_id,
    context_row.id,
    contact_id,
    'confirmed',
    'owner',
    null,
    p_actor_user_id
  from unnest(normalized_contacts) as member(contact_id)
  on conflict (tenant_id, context_id, contact_id) do update set
    verification_state = 'confirmed',
    source = 'owner',
    source_connection_id = null,
    created_by = p_actor_user_id;

  insert into public.audit_log (
    tenant_id,
    actor_user_id,
    actor_type,
    action,
    table_name,
    record_id,
    after
  ) values (
    p_tenant_id,
    p_actor_user_id,
    'client',
    'relationship_context.members_saved',
    'relationship_contexts',
    context_row.id,
    jsonb_build_object(
      'context', to_jsonb(context_row),
      'contact_ids', to_jsonb(normalized_contacts)
    )
  );

  return jsonb_build_object(
    'context_id', context_row.id,
    'name', context_row.name,
    'context_type', context_row.context_type,
    'connection_prior', context_row.connection_prior,
    'member_count', expected_count
  );
end;
$function$;

grant execute on function "public"."lbb_save_relationship_context"(uuid, uuid, uuid, text, text, text, uuid[]) to "postgres", "service_role";

revoke all on function "public"."lbb_save_relationship_context"(uuid, uuid, uuid, text, text, text, uuid[]) from public;

-- source: public/functions/lbb_set_engagement_signal_state.sql
create or replace function public.lbb_set_engagement_signal_state (
  p_signal_id     uuid,
  p_tenant_id     uuid,
  p_actor_user_id uuid,
  p_action        text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
  AS $function$
declare
  before_row public.signals%rowtype;
  after_row public.signals%rowtype;
  changed boolean := false;
  audit_action text;
begin
  if not exists (
    select 1
    from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and status = 'active'
  ) then
    raise exception 'Actor is not an active tenant member';
  end if;

  if p_action not in (
    'opened',
    'engaged',
    'dismissed',
    'restore_engaged',
    'restore_dismissed',
    'restored'
  ) then
    raise exception 'Unsupported engagement action';
  end if;

  select *
  into before_row
  from public.signals
  where id = p_signal_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Engagement signal not found';
  end if;

  after_row := before_row;

  if p_action = 'opened' then
    changed := before_row.opened_at is null;
    if changed then
      update public.signals
      set
        opened_at = now(),
        opened_by = p_actor_user_id
      where id = p_signal_id and tenant_id = p_tenant_id
      returning * into after_row;
    end if;
    audit_action := 'engagement.signal_opened';
  elsif p_action = 'engaged' then
    changed :=
      before_row.engaged_at is null
      and before_row.dismissed_at is null;
    if changed then
      update public.signals
      set
        opened_at = coalesce(opened_at, now()),
        opened_by = coalesce(opened_by, p_actor_user_id),
        engaged_at = now(),
        engaged_by = p_actor_user_id
      where id = p_signal_id and tenant_id = p_tenant_id
      returning * into after_row;
    end if;
    audit_action := 'engagement.signal_engaged';
  elsif p_action = 'dismissed' then
    changed :=
      before_row.dismissed_at is null
      and before_row.engaged_at is null;
    if changed then
      update public.signals
      set
        dismissed_at = now(),
        dismissed_by = p_actor_user_id
      where id = p_signal_id and tenant_id = p_tenant_id
      returning * into after_row;
    end if;
    audit_action := 'engagement.signal_do_not_engage';
  elsif p_action = 'restore_engaged' then
    changed := before_row.engaged_at is not null;
    if changed then
      update public.signals
      set
        engaged_at = null,
        engaged_by = null
      where id = p_signal_id and tenant_id = p_tenant_id
      returning * into after_row;
    end if;
    audit_action := 'engagement.signal_restored';
  elsif p_action = 'restore_dismissed' then
    changed := before_row.dismissed_at is not null;
    if changed then
      update public.signals
      set
        dismissed_at = null,
        dismissed_by = null
      where id = p_signal_id and tenant_id = p_tenant_id
      returning * into after_row;
    end if;
    audit_action := 'engagement.signal_restored';
  else
    changed :=
      before_row.dismissed_at is not null
      or before_row.engaged_at is not null;
    if changed then
      update public.signals
      set
        dismissed_at = null,
        dismissed_by = null,
        engaged_at = null,
        engaged_by = null
      where id = p_signal_id and tenant_id = p_tenant_id
      returning * into after_row;
    end if;
    audit_action := 'engagement.signal_restored';
  end if;

  if changed then
    insert into public.audit_log (
      tenant_id,
      actor_user_id,
      actor_type,
      action,
      table_name,
      record_id,
      before,
      after,
      metadata
    ) values (
      p_tenant_id,
      p_actor_user_id,
      'client',
      audit_action,
      'signals',
      p_signal_id,
      jsonb_build_object(
        'opened_at', before_row.opened_at,
        'engaged_at', before_row.engaged_at,
        'dismissed_at', before_row.dismissed_at
      ),
      jsonb_build_object(
        'opened_at', after_row.opened_at,
        'engaged_at', after_row.engaged_at,
        'dismissed_at', after_row.dismissed_at
      ),
      jsonb_build_object('transition', p_action)
    );
  end if;

  return jsonb_build_object(
    'changed', changed,
    'signal_id', after_row.id,
    'contact_id', after_row.contact_id,
    'opened_at', after_row.opened_at,
    'engaged_at', after_row.engaged_at,
    'dismissed_at', after_row.dismissed_at
  );
end;
$function$;

grant execute on function "public"."lbb_set_engagement_signal_state"(uuid, uuid, uuid, text) to "postgres", "service_role";

revoke all on function "public"."lbb_set_engagement_signal_state"(uuid, uuid, uuid, text) from public;

-- source: public/functions/set_connection_recommendation_status.sql
create or replace function public.set_connection_recommendation_status (
  p_connection_id uuid,
  p_tenant_id     uuid,
  p_actor_user_id uuid,
  p_status        text,
  p_owner_note    text default null::text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
  AS $function$
declare
  before_row public.connections%rowtype;
  after_row public.connections%rowtype;
  normalized_note text;
  changed boolean;
begin
  if p_status not in ('suggested', 'already_connected') then
    raise exception 'Unsupported connection recommendation status';
  end if;

  if not exists (
    select 1
    from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and status = 'active'
  ) then
    raise exception 'Actor is not an active tenant member';
  end if;

  select *
  into before_row
  from public.connections
  where id = p_connection_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Connection recommendation not found';
  end if;

  normalized_note := case
    when p_status = 'already_connected'
      then nullif(left(trim(coalesce(p_owner_note, '')), 500), '')
    else null
  end;

  changed :=
    before_row.status is distinct from p_status
    or before_row.owner_note is distinct from normalized_note
    or before_row.snoozed_until is not null
    or before_row.snoozed_at is not null
    or before_row.snoozed_by is not null;

  if changed then
    update public.connections
    set
      status = p_status,
      owner_note = normalized_note,
      confirmed_at = case when p_status = 'already_connected' then now() else null end,
      confirmed_by = case when p_status = 'already_connected' then p_actor_user_id else null end,
      snoozed_until = null,
      snoozed_at = null,
      snoozed_by = null,
      updated_at = now()
    where id = p_connection_id
      and tenant_id = p_tenant_id
    returning * into after_row;

    insert into public.audit_log (
      tenant_id,
      actor_user_id,
      actor_type,
      action,
      table_name,
      record_id,
      before,
      after
    ) values (
      p_tenant_id,
      p_actor_user_id,
      'client',
      case
        when p_status = 'already_connected'
          then 'connection.already_connected_confirmed'
        else 'connection.recommendation_restored'
      end,
      'connections',
      p_connection_id,
      to_jsonb(before_row),
      to_jsonb(after_row)
    );
  else
    after_row := before_row;
  end if;

  return jsonb_build_object(
    'changed', changed,
    'connection_id', after_row.id,
    'contact_a', after_row.contact_a,
    'contact_b', after_row.contact_b,
    'status', after_row.status,
    'snoozed_until', after_row.snoozed_until
  );
end;
$function$;

grant execute on function "public"."set_connection_recommendation_status"(uuid, uuid, uuid, text, text) to "postgres", "service_role";

revoke all on function "public"."set_connection_recommendation_status"(uuid, uuid, uuid, text, text) from public;

-- source: public/functions/set_engagement_signal_dismissed.sql
create or replace function public.set_engagement_signal_dismissed (
  p_signal_id     uuid,
  p_tenant_id     uuid,
  p_actor_user_id uuid,
  p_dismissed     boolean
)
  returns jsonb
  language sql
  security definer
  set search_path to 'pg_catalog', 'public'
  AS $function$
  select public.lbb_set_engagement_signal_state(
    p_signal_id,
    p_tenant_id,
    p_actor_user_id,
    case when p_dismissed then 'dismissed' else 'restored' end
  );
$function$;

grant execute on function "public"."set_engagement_signal_dismissed"(uuid, uuid, uuid, boolean) to "postgres", "service_role";

revoke all on function "public"."set_engagement_signal_dismissed"(uuid, uuid, uuid, boolean) from public;

-- source: public/functions/snooze_connection_recommendation.sql
create or replace function public.snooze_connection_recommendation (
  p_connection_id uuid,
  p_tenant_id     uuid,
  p_actor_user_id uuid
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
  AS $function$
declare
  before_row public.connections%rowtype;
  after_row public.connections%rowtype;
  changed boolean;
begin
  if not exists (
    select 1
    from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and status = 'active'
  ) then
    raise exception 'Actor is not an active tenant member';
  end if;

  select *
  into before_row
  from public.connections
  where id = p_connection_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Connection recommendation not found';
  end if;

  if before_row.status <> 'suggested' then
    raise exception 'Only suggested connections can be snoozed';
  end if;

  changed := before_row.snoozed_until is null or before_row.snoozed_until <= now();

  if changed then
    update public.connections
    set
      snoozed_until = now() + interval '45 days',
      snoozed_at = now(),
      snoozed_by = p_actor_user_id,
      updated_at = now()
    where id = p_connection_id
      and tenant_id = p_tenant_id
    returning * into after_row;

    insert into public.audit_log (
      tenant_id,
      actor_user_id,
      actor_type,
      action,
      table_name,
      record_id,
      before,
      after
    ) values (
      p_tenant_id,
      p_actor_user_id,
      'client',
      'connection.recommendation_snoozed',
      'connections',
      p_connection_id,
      to_jsonb(before_row),
      to_jsonb(after_row)
    );
  else
    after_row := before_row;
  end if;

  return jsonb_build_object(
    'changed', changed,
    'connection_id', after_row.id,
    'contact_a', after_row.contact_a,
    'contact_b', after_row.contact_b,
    'status', after_row.status,
    'snoozed_until', after_row.snoozed_until
  );
end;
$function$;

grant execute on function "public"."snooze_connection_recommendation"(uuid, uuid, uuid) to "postgres", "service_role";

revoke all on function "public"."snooze_connection_recommendation"(uuid, uuid, uuid) from public;

-- source: public/default_privileges.sql
alter default privileges for role "postgres" in schema "public" grant select, update, usage on sequences to "authenticated";

alter default privileges for role "postgres" in schema "public" grant select, update, usage on sequences to "service_role";

alter default privileges for role "postgres" in schema "public" revoke all on FUNCTIONS from public;

alter default privileges for role "postgres" in schema "public" grant execute on FUNCTIONS to "authenticated";

alter default privileges for role "postgres" in schema "public" grant execute on FUNCTIONS to "service_role";

alter default privileges for role "postgres" in schema "public" grant delete, insert, maintain, references, select, trigger, truncate, update on tables to "authenticated";

alter default privileges for role "postgres" in schema "public" grant delete, insert, maintain, references, select, trigger, truncate, update on tables to "service_role";

-- Canonical private Storage configuration. This is product configuration, not production relationship data.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('transcripts', 'transcripts', false, null, null)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "members read transcript objects" on storage.objects;
create policy "members read transcript objects"
on storage.objects for select
to authenticated
using (
  bucket_id = 'transcripts'
  and app_private.is_tenant_member((storage.foldername(name))[1]::uuid)
);

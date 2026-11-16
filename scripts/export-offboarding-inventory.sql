\set ON_ERROR_STOP on
\set QUIET 1
\pset format unaligned
\pset tuples_only on

-- Required psql variables (supply with -v, never commit their values):
--   evidence_nonce  64 lowercase hexadecimal characters; never emitted
--   project_ref     the observed project ref
--   tenant_id       the tenant UUID
--   release_sha     exact 40-character application Git SHA
--   environment     production or isolated_restore
--   observation_id  opaque evidence identifier

begin transaction isolation level repeatable read read only;
set local lock_timeout = '2s';
set local statement_timeout = '60s';

with recursive
parameters as (
  select
    :'evidence_nonce'::text as nonce,
    :'project_ref'::text as project_ref,
    :'tenant_id'::uuid as tenant_id,
    :'release_sha'::text as release_sha,
    :'environment'::text as environment,
    :'observation_id'::text as observation_id
),
guard as (
  select
    nonce ~ '^[a-f0-9]{64}$'
      and project_ref ~ '^[a-z0-9]{20}$'
      and release_sha ~ '^[a-f0-9]{40}$'
      and environment in ('production', 'isolated_restore')
      and char_length(observation_id) between 6 and 500
      and observation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' as valid
  from parameters
),
allowed_tenant_tables(table_name) as (values
  ('ask_runs'), ('audit_log'), ('calendar_attendee_preferences'),
  ('calendar_attendees'), ('calendar_events'), ('claude_write_receipts'),
  ('client_import_batches'), ('connection_contexts'), ('connections'),
  ('contacts'), ('content_items'), ('content_scan_runs'),
  ('content_scan_sources'), ('field_provenance'), ('google_oauth_transactions'),
  ('integration_connections'), ('interaction_contacts'), ('interactions'),
  ('introductions'), ('jobs'), ('notion_oauth_transactions'),
  ('notion_webhook_events'), ('pending_changes'), ('promises'),
  ('recommendation_day_overrides'), ('recording_followups'),
  ('recording_ingest_receipts'), ('recording_sync_state'),
  ('relationship_actions'), ('relationship_context_memberships'),
  ('relationship_contexts'), ('reviews'), ('signals'), ('tenant_config'),
  ('tenant_members'), ('transcripts'), ('usage_events'), ('want_to_know')
),
catalog_tenant_tables as (
  select c.relname::text as table_name
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and exists (
      select 1
      from pg_catalog.pg_attribute a
      where a.attrelid = c.oid
        and a.attname = 'tenant_id'
        and a.attnum > 0
        and not a.attisdropped
    )
),
application_tables as (
  select n.nspname::text as schema_name, c.relname::text as table_name
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'app_private')
    and c.relkind in ('r', 'p')
),
application_catalog_facts(fact) as (
  select concat_ws('|', 'relation', n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner), coalesce(c.relacl::text, ''))
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'app_private')
  union all
  select concat_ws('|', 'column', n.nspname, c.relname, a.attnum, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), ''), a.attidentity, a.attgenerated)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p', 'v', 'm', 'S')
  union all
  select concat_ws('|', 'constraint', n.nspname, c.relname, con.conname, con.contype, pg_get_constraintdef(con.oid, true), con.convalidated)
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_class c on c.oid = con.conrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'app_private')
  union all
  select concat_ws('|', 'index', schemaname, tablename, indexname, indexdef)
  from pg_catalog.pg_indexes where schemaname in ('public', 'app_private')
  union all
  select concat_ws('|', 'policy', schemaname, tablename, policyname, permissive, roles::text, cmd, coalesce(qual, ''), coalesce(with_check, ''))
  from pg_catalog.pg_policies where schemaname in ('public', 'app_private')
  union all
  select concat_ws('|', 'function', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid), p.prosecdef, p.provolatile, coalesce(p.proconfig::text, ''), pg_get_functiondef(p.oid), coalesce(p.proacl::text, ''))
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app_private')
  union all
  select concat_ws('|', 'trigger', n.nspname, c.relname, t.tgname, pg_get_triggerdef(t.oid, true))
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'app_private') and not t.tgisinternal
  union all
  select concat_ws('|', 'sequence', schemaname, sequencename, data_type, start_value, min_value, max_value, increment_by, cycle, cache_size, last_value)
  from pg_catalog.pg_sequences where schemaname in ('public', 'app_private')
  union all
  select concat_ws('|', 'schema_acl', n.nspname, coalesce(n.nspacl::text, ''))
  from pg_catalog.pg_namespace n where n.nspname in ('public', 'app_private')
),
application_catalog_observation as (
  select
    count(*)::integer as fact_count,
    encode(extensions.hmac(convert_to(coalesce(string_agg(fact, E'\x1e' order by fact), ''), 'UTF8'), convert_to(parameters.nonce, 'UTF8'), 'sha256'), 'hex') as fingerprint
  from application_catalog_facts cross join parameters
  group by parameters.nonce
),
platform_catalog as (
  select
    coalesce(jsonb_agg(c.relname order by c.relname) filter (where n.nspname = 'auth'), '[]'::jsonb) as auth_tables,
    coalesce(jsonb_agg(c.relname order by c.relname) filter (where n.nspname = 'storage'), '[]'::jsonb) as storage_tables,
    coalesce(jsonb_agg(c.relname order by c.relname) filter (where n.nspname = 'vault'), '[]'::jsonb) as vault_tables
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('auth', 'storage', 'vault')
    and c.relkind in ('r', 'p')
),
platform_tables as (
  select n.nspname::text as schema_name, c.relname::text as table_name
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('auth', 'storage', 'vault') and c.relkind in ('r', 'p')
),
allowed_platform_tables(schema_name, table_name) as (
  values
    ('auth','audit_log_entries'), ('auth','custom_oauth_providers'), ('auth','flow_state'),
    ('auth','identities'), ('auth','instances'), ('auth','mfa_amr_claims'),
    ('auth','mfa_challenges'), ('auth','mfa_factors'), ('auth','oauth_authorizations'),
    ('auth','oauth_client_states'), ('auth','oauth_clients'), ('auth','oauth_consents'),
    ('auth','one_time_tokens'), ('auth','refresh_tokens'), ('auth','saml_providers'),
    ('auth','saml_relay_states'), ('auth','schema_migrations'), ('auth','sessions'),
    ('auth','sso_domains'), ('auth','sso_providers'), ('auth','users'),
    ('auth','webauthn_challenges'), ('auth','webauthn_credentials'),
    ('storage','buckets'), ('storage','buckets_analytics'), ('storage','buckets_vectors'),
    ('storage','migrations'), ('storage','objects'), ('storage','s3_multipart_uploads'),
    ('storage','s3_multipart_uploads_parts'), ('storage','vector_indexes'),
    ('vault','secrets')
),
platform_projection_guard as (
  select not exists (
    (select schema_name, table_name from platform_tables
     except
     select schema_name, table_name from allowed_platform_tables)
    union all
    (select schema_name, table_name from allowed_platform_tables
     except
     select schema_name, table_name from platform_tables)
  ) as valid
),
platform_safe_rows(schema_name, table_name, row_key, row_state) as (
  select 'auth', 'audit_log_entries', t.id::text, jsonb_build_object('id',t.id,'instance_id',t.instance_id,'created_at',t.created_at)::text from auth.audit_log_entries t
  union all select 'auth','custom_oauth_providers',t.id::text,jsonb_build_object('id',t.id,'provider_type',t.provider_type,'enabled',t.enabled,'pkce_enabled',t.pkce_enabled,'email_optional',t.email_optional,'created_at',t.created_at,'updated_at',t.updated_at)::text from auth.custom_oauth_providers t
  union all select 'auth','flow_state',t.id::text,jsonb_build_object('id',t.id,'user_id',t.user_id,'provider_type',t.provider_type,'created_at',t.created_at,'updated_at',t.updated_at,'authentication_method',t.authentication_method,'auth_code_issued_at',t.auth_code_issued_at,'oauth_client_state_id',t.oauth_client_state_id,'linking_target_id',t.linking_target_id,'email_optional',t.email_optional)::text from auth.flow_state t
  union all select 'auth','identities',t.id::text,jsonb_build_object('id',t.id,'user_id',t.user_id,'provider',t.provider,'last_sign_in_at',t.last_sign_in_at,'created_at',t.created_at,'updated_at',t.updated_at)::text from auth.identities t
  union all select 'auth','instances',t.id::text,jsonb_build_object('id',t.id,'uuid',t.uuid,'created_at',t.created_at,'updated_at',t.updated_at)::text from auth.instances t
  union all select 'auth','mfa_amr_claims',t.id::text,jsonb_build_object('id',t.id,'session_id',t.session_id,'authentication_method',t.authentication_method,'created_at',t.created_at,'updated_at',t.updated_at)::text from auth.mfa_amr_claims t
  union all select 'auth','mfa_challenges',t.id::text,jsonb_build_object('id',t.id,'factor_id',t.factor_id,'created_at',t.created_at,'verified_at',t.verified_at)::text from auth.mfa_challenges t
  union all select 'auth','mfa_factors',t.id::text,jsonb_build_object('id',t.id,'user_id',t.user_id,'factor_type',t.factor_type,'status',t.status,'created_at',t.created_at,'updated_at',t.updated_at,'last_challenged_at',t.last_challenged_at)::text from auth.mfa_factors t
  union all select 'auth','oauth_authorizations',t.id::text,jsonb_build_object('id',t.id,'authorization_id',t.authorization_id,'client_id',t.client_id,'user_id',t.user_id,'status',t.status,'response_type',t.response_type,'code_challenge_method',t.code_challenge_method,'created_at',t.created_at,'expires_at',t.expires_at,'approved_at',t.approved_at)::text from auth.oauth_authorizations t
  union all select 'auth','oauth_client_states',t.id::text,jsonb_build_object('id',t.id,'provider_type',t.provider_type,'created_at',t.created_at)::text from auth.oauth_client_states t
  union all select 'auth','oauth_clients',t.id::text,jsonb_build_object('id',t.id,'registration_type',t.registration_type,'grant_types',t.grant_types,'created_at',t.created_at,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'client_type',t.client_type,'token_endpoint_auth_method',t.token_endpoint_auth_method)::text from auth.oauth_clients t
  union all select 'auth','oauth_consents',t.id::text,jsonb_build_object('id',t.id,'user_id',t.user_id,'client_id',t.client_id,'granted_at',t.granted_at,'revoked_at',t.revoked_at)::text from auth.oauth_consents t
  union all select 'auth','one_time_tokens',t.id::text,jsonb_build_object('id',t.id,'user_id',t.user_id,'token_type',t.token_type,'created_at',t.created_at,'updated_at',t.updated_at)::text from auth.one_time_tokens t
  union all select 'auth','refresh_tokens',t.id::text,jsonb_build_object('id',t.id,'instance_id',t.instance_id,'user_id',t.user_id,'revoked',t.revoked,'created_at',t.created_at,'updated_at',t.updated_at,'session_id',t.session_id)::text from auth.refresh_tokens t
  union all select 'auth','saml_providers',t.id::text,jsonb_build_object('id',t.id,'sso_provider_id',t.sso_provider_id,'created_at',t.created_at,'updated_at',t.updated_at,'name_id_format',t.name_id_format)::text from auth.saml_providers t
  union all select 'auth','saml_relay_states',t.id::text,jsonb_build_object('id',t.id,'sso_provider_id',t.sso_provider_id,'created_at',t.created_at,'updated_at',t.updated_at,'flow_state_id',t.flow_state_id)::text from auth.saml_relay_states t
  union all select 'auth','schema_migrations',t.version::text,jsonb_build_object('version',t.version)::text from auth.schema_migrations t
  union all select 'auth','sessions',t.id::text,jsonb_build_object('id',t.id,'user_id',t.user_id,'created_at',t.created_at,'updated_at',t.updated_at,'factor_id',t.factor_id,'aal',t.aal,'not_after',t.not_after,'refreshed_at',t.refreshed_at,'oauth_client_id',t.oauth_client_id,'refresh_token_counter',t.refresh_token_counter)::text from auth.sessions t
  union all select 'auth','sso_domains',t.id::text,jsonb_build_object('id',t.id,'sso_provider_id',t.sso_provider_id,'created_at',t.created_at,'updated_at',t.updated_at)::text from auth.sso_domains t
  union all select 'auth','sso_providers',t.id::text,jsonb_build_object('id',t.id,'created_at',t.created_at,'updated_at',t.updated_at,'disabled',t.disabled)::text from auth.sso_providers t
  union all select 'auth','users',t.id::text,jsonb_build_object('id',t.id,'instance_id',t.instance_id,'aud',t.aud,'role',t.role,'email_confirmed_at',t.email_confirmed_at,'invited_at',t.invited_at,'last_sign_in_at',t.last_sign_in_at,'is_super_admin',t.is_super_admin,'created_at',t.created_at,'updated_at',t.updated_at,'phone_confirmed_at',t.phone_confirmed_at,'confirmed_at',t.confirmed_at,'email_change_confirm_status',t.email_change_confirm_status,'banned_until',t.banned_until,'is_sso_user',t.is_sso_user,'deleted_at',t.deleted_at,'is_anonymous',t.is_anonymous)::text from auth.users t
  union all select 'auth','webauthn_challenges',t.id::text,jsonb_build_object('id',t.id,'user_id',t.user_id,'challenge_type',t.challenge_type,'created_at',t.created_at,'expires_at',t.expires_at)::text from auth.webauthn_challenges t
  union all select 'auth','webauthn_credentials',t.id::text,jsonb_build_object('id',t.id,'user_id',t.user_id,'attestation_type',t.attestation_type,'aaguid',t.aaguid,'sign_count',t.sign_count,'transports',t.transports,'backup_eligible',t.backup_eligible,'backed_up',t.backed_up,'created_at',t.created_at,'updated_at',t.updated_at,'last_used_at',t.last_used_at)::text from auth.webauthn_credentials t
  union all select 'storage','buckets',t.id::text,jsonb_build_object('id',t.id,'owner',t.owner,'created_at',t.created_at,'updated_at',t.updated_at,'public',t.public,'avif_autodetection',t.avif_autodetection,'file_size_limit',t.file_size_limit,'allowed_mime_types',t.allowed_mime_types,'owner_id',t.owner_id,'type',t.type,'versioning_status',t.versioning_status)::text from storage.buckets t
  union all select 'storage','buckets_analytics',t.id::text,jsonb_build_object('id',t.id,'type',t.type,'format',t.format,'created_at',t.created_at,'updated_at',t.updated_at,'deleted_at',t.deleted_at)::text from storage.buckets_analytics t
  union all select 'storage','buckets_vectors',t.id::text,jsonb_build_object('id',t.id,'type',t.type,'created_at',t.created_at,'updated_at',t.updated_at)::text from storage.buckets_vectors t
  union all select 'storage','migrations',t.id::text,jsonb_build_object('id',t.id,'name',t.name,'hash',t.hash,'executed_at',t.executed_at)::text from storage.migrations t
  union all select 'storage','objects',t.id::text,jsonb_build_object('id',t.id,'owner',t.owner,'created_at',t.created_at,'updated_at',t.updated_at,'last_accessed_at',t.last_accessed_at,'version',t.version,'owner_id',t.owner_id,'archived_at',t.archived_at,'is_delete_marker',t.is_delete_marker,'is_versioned',t.is_versioned)::text from storage.objects t
  union all select 'storage','s3_multipart_uploads',t.id::text,jsonb_build_object('id',t.id,'in_progress_size',t.in_progress_size,'version',t.version,'owner_id',t.owner_id,'created_at',t.created_at)::text from storage.s3_multipart_uploads t
  union all select 'storage','s3_multipart_uploads_parts',t.id::text,jsonb_build_object('id',t.id,'upload_id',t.upload_id,'size',t.size,'part_number',t.part_number,'owner_id',t.owner_id,'version',t.version,'created_at',t.created_at)::text from storage.s3_multipart_uploads_parts t
  union all select 'storage','vector_indexes',t.id::text,jsonb_build_object('id',t.id,'data_type',t.data_type,'dimension',t.dimension,'distance_metric',t.distance_metric,'created_at',t.created_at,'updated_at',t.updated_at)::text from storage.vector_indexes t
  union all select 'vault','secrets',t.id::text,jsonb_build_object('id',t.id,'key_id',t.key_id,'created_at',t.created_at,'updated_at',t.updated_at)::text from vault.secrets t
),
platform_table_observations as (
  select
    table_scope.schema_name,
    table_scope.table_name,
    count(row_scope.row_key)::integer as row_count,
    encode(extensions.hmac(convert_to(coalesce(string_agg(concat(row_scope.row_key, E'\x1f', row_scope.row_state), E'\x1e' order by row_scope.row_key), ''), 'UTF8'), convert_to(parameters.nonce, 'UTF8'), 'sha256'), 'hex') as fingerprint
  from allowed_platform_tables table_scope
  cross join parameters
  left join platform_safe_rows row_scope on row_scope.schema_name = table_scope.schema_name and row_scope.table_name = table_scope.table_name
  group by table_scope.schema_name, table_scope.table_name, parameters.nonce
),
auth_sequence_observation as (
  select
    coalesce(jsonb_agg(sequence.sequencename order by sequence.sequencename) filter (where sequence.sequencename is not null), '[]'::jsonb) as sequence_names,
    count(sequence.sequencename)::integer as sequence_count,
    encode(
      extensions.hmac(
        convert_to(coalesce(string_agg(concat_ws('|', sequence.sequencename, sequence.last_value), E'\x1e' order by sequence.sequencename), ''), 'UTF8'),
        convert_to(parameters.nonce, 'UTF8'),
        'sha256'
      ),
      'hex'
    ) as sequence_fingerprint
  from parameters
  left join pg_catalog.pg_sequences sequence on sequence.schemaname = 'auth'
  group by parameters.nonce
),
tenant_rows(table_name, row_key, row_state) as (
  select 'ask_runs', t.id::text, to_jsonb(t)::text from public.ask_runs t, parameters p where t.tenant_id = p.tenant_id
  union all select 'audit_log', t.id::text, to_jsonb(t)::text from public.audit_log t, parameters p where t.tenant_id = p.tenant_id
  union all select 'calendar_attendee_preferences', concat_ws('|', t.tenant_id, t.user_id, t.normalized_email), to_jsonb(t)::text from public.calendar_attendee_preferences t, parameters p where t.tenant_id = p.tenant_id
  union all select 'calendar_attendees', t.id::text, to_jsonb(t)::text from public.calendar_attendees t, parameters p where t.tenant_id = p.tenant_id
  union all select 'calendar_events', t.id::text, to_jsonb(t)::text from public.calendar_events t, parameters p where t.tenant_id = p.tenant_id
  union all select 'claude_write_receipts', concat_ws('|', t.tenant_id, t.usage_date, t.request_key), to_jsonb(t)::text from public.claude_write_receipts t, parameters p where t.tenant_id = p.tenant_id
  union all select 'client_import_batches', t.id::text, to_jsonb(t)::text from public.client_import_batches t, parameters p where t.tenant_id = p.tenant_id
  union all select 'connection_contexts', concat_ws('|', t.tenant_id, t.connection_id, t.context_id), to_jsonb(t)::text from public.connection_contexts t, parameters p where t.tenant_id = p.tenant_id
  union all select 'connections', t.id::text, to_jsonb(t)::text from public.connections t, parameters p where t.tenant_id = p.tenant_id
  union all select 'contacts', t.id::text, to_jsonb(t)::text from public.contacts t, parameters p where t.tenant_id = p.tenant_id
  union all select 'content_items', t.id::text, to_jsonb(t)::text from public.content_items t, parameters p where t.tenant_id = p.tenant_id
  union all select 'content_scan_runs', t.id::text, to_jsonb(t)::text from public.content_scan_runs t, parameters p where t.tenant_id = p.tenant_id
  union all select 'content_scan_sources', t.id::text, to_jsonb(t)::text from public.content_scan_sources t, parameters p where t.tenant_id = p.tenant_id
  union all select 'field_provenance', t.id::text, to_jsonb(t)::text from public.field_provenance t, parameters p where t.tenant_id = p.tenant_id
  union all select 'google_oauth_transactions', t.id::text, to_jsonb(t)::text from public.google_oauth_transactions t, parameters p where t.tenant_id = p.tenant_id
  union all select 'integration_connections', t.id::text, to_jsonb(t)::text from public.integration_connections t, parameters p where t.tenant_id = p.tenant_id
  union all select 'interaction_contacts', concat_ws('|', t.interaction_id, t.contact_id), to_jsonb(t)::text from public.interaction_contacts t, parameters p where t.tenant_id = p.tenant_id
  union all select 'interactions', t.id::text, to_jsonb(t)::text from public.interactions t, parameters p where t.tenant_id = p.tenant_id
  union all select 'introductions', t.id::text, to_jsonb(t)::text from public.introductions t, parameters p where t.tenant_id = p.tenant_id
  union all select 'jobs', t.id::text, to_jsonb(t)::text from public.jobs t, parameters p where t.tenant_id = p.tenant_id
  union all select 'notion_oauth_transactions', t.id::text, to_jsonb(t)::text from public.notion_oauth_transactions t, parameters p where t.tenant_id = p.tenant_id
  union all select 'notion_webhook_events', t.id::text, to_jsonb(t)::text from public.notion_webhook_events t, parameters p where t.tenant_id = p.tenant_id
  union all select 'pending_changes', t.id::text, to_jsonb(t)::text from public.pending_changes t, parameters p where t.tenant_id = p.tenant_id
  union all select 'promises', t.id::text, to_jsonb(t)::text from public.promises t, parameters p where t.tenant_id = p.tenant_id
  union all select 'recommendation_day_overrides', concat_ws('|', t.tenant_id, t.user_id, t.activity_date), to_jsonb(t)::text from public.recommendation_day_overrides t, parameters p where t.tenant_id = p.tenant_id
  union all select 'recording_followups', t.id::text, to_jsonb(t)::text from public.recording_followups t, parameters p where t.tenant_id = p.tenant_id
  union all select 'recording_ingest_receipts', t.id::text, to_jsonb(t)::text from public.recording_ingest_receipts t, parameters p where t.tenant_id = p.tenant_id
  union all select 'recording_sync_state', t.connection_id::text, to_jsonb(t)::text from public.recording_sync_state t, parameters p where t.tenant_id = p.tenant_id
  union all select 'relationship_actions', t.id::text, to_jsonb(t)::text from public.relationship_actions t, parameters p where t.tenant_id = p.tenant_id
  union all select 'relationship_context_memberships', concat_ws('|', t.tenant_id, t.context_id, t.contact_id), to_jsonb(t)::text from public.relationship_context_memberships t, parameters p where t.tenant_id = p.tenant_id
  union all select 'relationship_contexts', t.id::text, to_jsonb(t)::text from public.relationship_contexts t, parameters p where t.tenant_id = p.tenant_id
  union all select 'reviews', t.id::text, to_jsonb(t)::text from public.reviews t, parameters p where t.tenant_id = p.tenant_id
  union all select 'signals', t.id::text, to_jsonb(t)::text from public.signals t, parameters p where t.tenant_id = p.tenant_id
  union all select 'tenant_config', t.tenant_id::text, to_jsonb(t)::text from public.tenant_config t, parameters p where t.tenant_id = p.tenant_id
  union all select 'tenant_members', concat_ws('|', t.tenant_id, t.user_id), to_jsonb(t)::text from public.tenant_members t, parameters p where t.tenant_id = p.tenant_id
  union all select 'transcripts', t.id::text, to_jsonb(t)::text from public.transcripts t, parameters p where t.tenant_id = p.tenant_id
  union all select 'usage_events', t.id::text, to_jsonb(t)::text from public.usage_events t, parameters p where t.tenant_id = p.tenant_id
  union all select 'want_to_know', t.id::text, to_jsonb(t)::text from public.want_to_know t, parameters p where t.tenant_id = p.tenant_id
),
tenant_table_observations as (
  select
    allowed.table_name,
    count(identifier.row_key)::integer as row_count,
    encode(
      extensions.hmac(
        convert_to(coalesce(string_agg(concat(identifier.row_key, E'\x1f', identifier.row_state), E'\x1e' order by identifier.row_key), ''), 'UTF8'),
        convert_to(parameters.nonce, 'UTF8'),
        'sha256'
      ),
      'hex'
    ) as fingerprint
  from allowed_tenant_tables allowed
  cross join parameters
  left join tenant_rows identifier on identifier.table_name = allowed.table_name
  group by allowed.table_name, parameters.nonce
),
tenant_observation as (
  select
    count(tenant.id)::integer as row_count,
    encode(extensions.hmac(convert_to(coalesce(string_agg(concat(tenant.id, E'\x1f', to_jsonb(tenant)::text), E'\x1e' order by tenant.id::text), ''), 'UTF8'), convert_to(parameters.nonce, 'UTF8'), 'sha256'), 'hex') as fingerprint,
    encode(extensions.hmac(convert_to(parameters.tenant_id::text, 'UTF8'), convert_to(parameters.nonce, 'UTF8'), 'sha256'), 'hex') as tenant_fingerprint
  from parameters
  left join public.tenants tenant on tenant.id = parameters.tenant_id
  group by parameters.nonce, parameters.tenant_id
),
private_receipts_observation as (
  select
    count(receipt.snapshot_id)::integer as row_count,
    encode(extensions.hmac(convert_to(coalesce(string_agg(concat(concat_ws('|', receipt.tenant_id, receipt.snapshot_id), E'\x1f', to_jsonb(receipt)::text), E'\x1e' order by concat_ws('|', receipt.tenant_id, receipt.snapshot_id)), ''), 'UTF8'), convert_to(parameters.nonce, 'UTF8'), 'sha256'), 'hex') as fingerprint
  from parameters
  left join app_private.calendar_snapshot_receipts receipt on receipt.tenant_id = parameters.tenant_id
  group by parameters.nonce
),
notion_config_observation as (
  select
    count(config.singleton)::integer as row_count,
    encode(extensions.hmac(convert_to(coalesce(string_agg(to_jsonb(config)::text, E'\x1e' order by config.singleton::text), ''), 'UTF8'), convert_to(parameters.nonce, 'UTF8'), 'sha256'), 'hex') as fingerprint
  from parameters
  left join public.notion_webhook_config config on true
  group by parameters.nonce
),
baseline_policy_observation as (
  select
    count(policy.field_name)::integer as row_count,
    encode(extensions.hmac(convert_to(coalesce(string_agg(concat(policy.field_name, E'\x1f', to_jsonb(policy)::text), E'\x1e' order by policy.field_name), ''), 'UTF8'), convert_to(parameters.nonce, 'UTF8'), 'sha256'), 'hex') as fingerprint
  from parameters
  left join app_private.recording_baseline_field_policy policy on true
  group by parameters.nonce
),
migration_observation as (
  select
    max(migration.version)::text as migration_head,
    encode(
      extensions.hmac(
        convert_to(
          coalesce(
            string_agg(
              concat_ws('|', migration.version, migration.name, encode(extensions.digest(convert_to(array_to_string(migration.statements, E'\n-- statement boundary --\n'), 'UTF8'), 'sha256'), 'hex')),
              E'\x1e' order by migration.version
            ),
            ''
          ),
          'UTF8'
        ),
        convert_to(parameters.nonce, 'UTF8'),
        'sha256'
      ),
      'hex'
    ) as migration_digest
  from parameters
  left join supabase_migrations.schema_migrations migration on true
  group by parameters.nonce
),
auth_scope as (
  select tenant.owner_user_id as user_id
  from public.tenants tenant, parameters
  where tenant.id = parameters.tenant_id
  union
  select member.user_id
  from public.tenant_members member, parameters
  where member.tenant_id = parameters.tenant_id
),
auth_observations as (
  select
    (select count(*)::integer from auth.users user_row where user_row.id in (select user_id from auth_scope)) as users_count,
    (select encode(extensions.hmac(convert_to(coalesce(string_agg(user_row.id::text, E'\x1e' order by user_row.id::text), ''), 'UTF8'), convert_to(parameters.nonce, 'UTF8'), 'sha256'), 'hex') from auth.users user_row where user_row.id in (select user_id from auth_scope)) as users_fingerprint,
    (select count(*)::integer from auth.identities identity_row where identity_row.user_id in (select user_id from auth_scope)) as identities_count,
    (select encode(extensions.hmac(convert_to(coalesce(string_agg(identity_row.id::text, E'\x1e' order by identity_row.id::text), ''), 'UTF8'), convert_to(parameters.nonce, 'UTF8'), 'sha256'), 'hex') from auth.identities identity_row where identity_row.user_id in (select user_id from auth_scope)) as identities_fingerprint,
    (select count(*)::integer from public.tenant_members member where member.tenant_id = parameters.tenant_id) as memberships_count,
    (select encode(extensions.hmac(convert_to(coalesce(string_agg(concat_ws('|', member.tenant_id, member.user_id), E'\x1e' order by concat_ws('|', member.tenant_id, member.user_id)), ''), 'UTF8'), convert_to(parameters.nonce, 'UTF8'), 'sha256'), 'hex') from public.tenant_members member where member.tenant_id = parameters.tenant_id) as memberships_fingerprint,
    (select count(*)::integer from auth.sessions session_row where session_row.user_id in (select user_id from auth_scope)) as sessions_count,
    (select encode(extensions.hmac(convert_to(coalesce(string_agg(session_row.id::text, E'\x1e' order by session_row.id::text), ''), 'UTF8'), convert_to(parameters.nonce, 'UTF8'), 'sha256'), 'hex') from auth.sessions session_row where session_row.user_id in (select user_id from auth_scope)) as sessions_fingerprint,
    (select count(*)::integer from auth.refresh_tokens refresh_row where not coalesce(refresh_row.revoked, false) and refresh_row.user_id in (select user_id::text from auth_scope)) as refresh_count,
    (select encode(extensions.hmac(convert_to(coalesce(string_agg(refresh_row.id::text, E'\x1e' order by refresh_row.id::text), ''), 'UTF8'), convert_to(parameters.nonce, 'UTF8'), 'sha256'), 'hex') from auth.refresh_tokens refresh_row where not coalesce(refresh_row.revoked, false) and refresh_row.user_id in (select user_id::text from auth_scope)) as refresh_fingerprint,
    (select count(*)::integer from public.tenant_members member left join auth.users user_row on user_row.id = member.user_id where member.tenant_id = parameters.tenant_id and user_row.id is null) as orphan_memberships,
    (select count(*)::integer from auth.users user_row where not exists (select 1 from public.tenant_members member where member.user_id = user_row.id)) as unassigned_users
  from parameters
),
storage_observations as (
  select
    count(*) filter (where not bucket.public)::integer as private_buckets,
    count(*) filter (where bucket.public)::integer as public_buckets,
    (select count(*)::integer from storage.objects) as objects_count,
    (select encode(extensions.hmac(convert_to(coalesce(string_agg(concat_ws('|', object_row.bucket_id, object_row.name, coalesce(object_row.metadata ->> 'eTag', object_row.metadata ->> 'etag', '')), E'\x1e' order by concat_ws('|', object_row.bucket_id, object_row.name, coalesce(object_row.metadata ->> 'eTag', object_row.metadata ->> 'etag', ''))), ''), 'UTF8'), convert_to(parameters.nonce, 'UTF8'), 'sha256'), 'hex') from storage.objects object_row) as objects_fingerprint,
    (select coalesce(sum(case when coalesce(object_row.metadata ->> 'size', '') ~ '^\d+$' then (object_row.metadata ->> 'size')::bigint else 0 end), 0)::bigint from storage.objects object_row) as object_bytes,
    (select count(*)::integer from public.transcripts transcript, parameters inner_parameters where transcript.tenant_id = inner_parameters.tenant_id and transcript.storage_path is not null) as transcript_references,
    (select count(*)::integer from public.transcripts transcript cross join parameters inner_parameters join storage.objects object_row on object_row.bucket_id = 'transcripts' and object_row.name = transcript.storage_path where transcript.tenant_id = inner_parameters.tenant_id and transcript.storage_path is not null) as matched_references,
    (select count(*)::integer from public.transcripts transcript cross join parameters inner_parameters left join storage.objects object_row on object_row.bucket_id = 'transcripts' and object_row.name = transcript.storage_path where transcript.tenant_id = inner_parameters.tenant_id and transcript.storage_path is not null and object_row.id is null) as dangling_references,
    (select count(*)::integer from storage.objects object_row where not exists (select 1 from public.transcripts transcript cross join parameters inner_parameters where transcript.tenant_id = inner_parameters.tenant_id and transcript.storage_path is not null and object_row.bucket_id = 'transcripts' and object_row.name = transcript.storage_path)) as unreferenced_objects
  from parameters
  left join storage.buckets bucket on true
  group by parameters.nonce
),
vault_references as (
  select connection.access_token_secret_id as secret_id from public.integration_connections connection, parameters where connection.tenant_id = parameters.tenant_id and connection.access_token_secret_id is not null
  union all select connection.refresh_token_secret_id from public.integration_connections connection, parameters where connection.tenant_id = parameters.tenant_id and connection.refresh_token_secret_id is not null
  union all select connection.webhook_secret_id from public.integration_connections connection, parameters where connection.tenant_id = parameters.tenant_id and connection.webhook_secret_id is not null
  union all select oauth_row.verifier_secret_id from public.google_oauth_transactions oauth_row, parameters where oauth_row.tenant_id = parameters.tenant_id and oauth_row.verifier_secret_id is not null
  union all select config.verification_token_secret_id from public.notion_webhook_config config where config.verification_token_secret_id is not null
),
vault_observations as (
  select
    (select count(*)::integer from vault_references) as references_count,
    (select count(distinct secret_id)::integer from vault_references) as distinct_references,
    (select count(*)::integer from vault.secrets secret_row where secret_row.id in (select secret_id from vault_references)) as referenced_secrets_count,
    (select encode(extensions.hmac(convert_to(coalesce(string_agg(secret_row.id::text, E'\x1e' order by secret_row.id::text), ''), 'UTF8'), convert_to(parameters.nonce, 'UTF8'), 'sha256'), 'hex') from vault.secrets secret_row where secret_row.id in (select secret_id from vault_references)) as referenced_secrets_fingerprint,
    (select count(*)::integer from (select distinct secret_id from vault_references) reference left join vault.secrets secret_row on secret_row.id = reference.secret_id where secret_row.id is null) as dangling_references,
    (select count(*)::integer from vault.secrets secret_row where secret_row.id not in (select secret_id from vault_references)) as unreferenced_secrets
  from parameters
)
select jsonb_pretty(
  jsonb_build_object(
    'format_version', 1,
    'observation_id', parameters.observation_id,
    'captured_at_utc', to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'environment', parameters.environment,
    'project_ref', parameters.project_ref,
    'tenant_fingerprint', tenant_observation.tenant_fingerprint,
    'release_sha', parameters.release_sha,
    'schema', jsonb_build_object(
      'discovered_tenant_tables', (select jsonb_agg(table_name order by table_name) from catalog_tenant_tables),
      'application_tables', jsonb_build_object(
        'public', (select jsonb_agg(table_name order by table_name) from application_tables where schema_name = 'public'),
        'app_private', (select jsonb_agg(table_name order by table_name) from application_tables where schema_name = 'app_private')
      ),
      'application_catalog', jsonb_build_object('count', application_catalog_observation.fact_count, 'fingerprint', application_catalog_observation.fingerprint),
      'migration_head', migration_observation.migration_head,
      'migration_digest', migration_observation.migration_digest
    ),
    'platform_catalog', jsonb_build_object(
      'auth_tables', platform_catalog.auth_tables,
      'storage_tables', platform_catalog.storage_tables,
      'vault_tables', platform_catalog.vault_tables,
      'auth_sequences', auth_sequence_observation.sequence_names,
      'auth_sequence_state', jsonb_build_object('count', auth_sequence_observation.sequence_count, 'fingerprint', auth_sequence_observation.sequence_fingerprint),
      'table_state', (select jsonb_agg(jsonb_build_object('schema', schema_name, 'table', table_name, 'count', row_count, 'fingerprint', fingerprint) order by schema_name, table_name) from platform_table_observations)
    ),
    'tenant_tables', (select jsonb_agg(jsonb_build_object('table', table_name, 'count', row_count, 'fingerprint', fingerprint) order by table_name) from tenant_table_observations),
    'tenant', jsonb_build_object('count', tenant_observation.row_count, 'fingerprint', tenant_observation.fingerprint),
    'private_calendar_receipts', jsonb_build_object('count', private_receipts_observation.row_count, 'fingerprint', private_receipts_observation.fingerprint),
    'install_global', jsonb_build_object(
      'notion_webhook_config', jsonb_build_object('count', notion_config_observation.row_count, 'fingerprint', notion_config_observation.fingerprint),
      'recording_baseline_field_policy', jsonb_build_object('count', baseline_policy_observation.row_count, 'fingerprint', baseline_policy_observation.fingerprint)
    ),
    'auth', jsonb_build_object(
      'users', jsonb_build_object('count', auth_observations.users_count, 'fingerprint', auth_observations.users_fingerprint),
      'identities', jsonb_build_object('count', auth_observations.identities_count, 'fingerprint', auth_observations.identities_fingerprint),
      'memberships', jsonb_build_object('count', auth_observations.memberships_count, 'fingerprint', auth_observations.memberships_fingerprint),
      'sessions', jsonb_build_object('count', auth_observations.sessions_count, 'fingerprint', auth_observations.sessions_fingerprint),
      'unrevoked_refresh_tokens', jsonb_build_object('count', auth_observations.refresh_count, 'fingerprint', auth_observations.refresh_fingerprint),
      'orphan_memberships', auth_observations.orphan_memberships,
      'unassigned_users', auth_observations.unassigned_users
    ),
    'storage', jsonb_build_object(
      'private_buckets', storage_observations.private_buckets,
      'public_buckets', storage_observations.public_buckets,
      'objects', jsonb_build_object('count', storage_observations.objects_count, 'fingerprint', storage_observations.objects_fingerprint),
      'bytes', storage_observations.object_bytes,
      'transcript_references', storage_observations.transcript_references,
      'matched_references', storage_observations.matched_references,
      'dangling_references', storage_observations.dangling_references,
      'unreferenced_objects', storage_observations.unreferenced_objects
    ),
    'vault', jsonb_build_object(
      'references', vault_observations.references_count,
      'distinct_references', vault_observations.distinct_references,
      'referenced_secrets', jsonb_build_object('count', vault_observations.referenced_secrets_count, 'fingerprint', vault_observations.referenced_secrets_fingerprint),
      'dangling_references', vault_observations.dangling_references,
      'unreferenced_secrets', vault_observations.unreferenced_secrets
    )
  )
)
from parameters
cross join guard
cross join platform_projection_guard
cross join application_catalog_observation
cross join platform_catalog
cross join auth_sequence_observation
cross join tenant_observation
cross join private_receipts_observation
cross join notion_config_observation
cross join baseline_policy_observation
cross join migration_observation
cross join auth_observations
cross join storage_observations
cross join vault_observations
where guard.valid and platform_projection_guard.valid;

rollback;

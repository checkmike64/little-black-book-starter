-- PostgreSQL gives PUBLIC execute on new functions through the owner's global
-- default ACL. A schema-scoped REVOKE cannot remove that global grant, so this
-- must be revoked at the role level. Schema-scoped service_role grants from the
-- preceding migration remain additive for public application functions.

alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated;

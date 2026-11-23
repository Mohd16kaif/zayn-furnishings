-- Supabase-era migrations (0002, 0004, and 0007) revoke privileges from the
-- `anon` and `authenticated` roles. Supabase projects define those roles;
-- a plain PostgreSQL 16 cluster does not.
--
-- This bootstrap creates the roles only when they are missing:
--   * NOLOGIN: they cannot open a database connection.
--   * No grants: they own nothing and receive no privileges.
--   * IF NOT EXISTS: on Supabase, or on a re-run, this is a no-op and does not
--     alter the existing roles.
--
-- The roles are inert compatibility shims. They exist only so the historical
-- REVOKE statements have valid targets. They are not used by the API.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$$;

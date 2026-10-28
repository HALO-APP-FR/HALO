-- =====================================================================
-- Préproduction LOCALE de HALO : reproduit les rôles et schémas que
-- Supabase fournit (auth via GoTrue, API via PostgREST). Données fictives
-- uniquement. Ne jamais appliquer sur un vrai projet Supabase.
-- =====================================================================
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit password 'local-authenticator'; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin login createrole password 'local-auth-admin'; end if;
end $$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists auth authorization supabase_auth_admin;
create schema if not exists extensions;
create schema if not exists storage;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema public, extensions, storage to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
do $$ begin execute format('grant create on database %I to supabase_auth_admin', current_database()); end $$;
alter role supabase_auth_admin set search_path = auth;

-- Stockage : structure minimale (les fichiers ne sont pas servis par cette préproduction locale)
create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text not null,
  owner uuid, created_at timestamptz default now(), metadata jsonb, unique (bucket_id, name));
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

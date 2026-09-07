-- Shim minimal "Supabase-like" untuk menguji sql/schema.sql di Postgres polos.
-- Bukan bagian repo MyFinance; hanya harness verifikasi lokal.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique
);

-- auth.uid()/auth.role() versi shim: dibaca dari GUC request.* supaya bisa
-- disimulasikan per-sesi (set request.uid = '...').
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.uid', true), '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(current_setting('request.role', true), '');
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

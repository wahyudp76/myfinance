-- MYFINANCE — AI RATE-LIMIT HARDENING (2026-08)
-- Run ONLY after deploying the matching analyze-finance Edge Function.
-- The Edge Function now validates the user's JWT with the anon client and uses
-- SUPABASE_SERVICE_ROLE_KEY only for internal rate-limit persistence.
--
-- This migration removes direct authenticated-client write access to rate_limits.
-- It intentionally does not expose any service-role credential to the browser.

begin;

-- Verify the expected table shape before changing policy.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rate_limits'
      and column_name = 'user_id'
  ) then
    raise exception 'rate_limits.user_id is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rate_limits'
      and column_name = 'last_ai_chat_at'
  ) then
    raise exception 'rate_limits.last_ai_chat_at is missing';
  end if;
end $$;

drop policy if exists "Users manage own rate limit row" on public.rate_limits;

-- Explicitly deny normal authenticated clients from inserting/updating/deleting
-- rate-limit state. The Edge Function's service-role client bypasses RLS.
-- Existing SELECT policy, if present, may remain; the browser does not need it for
-- the hardened AI path.

commit;

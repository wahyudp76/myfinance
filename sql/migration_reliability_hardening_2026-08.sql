-- MYFINANCE — RELIABILITY HARDENING (2026-08)
--
-- This migration is intentionally additive and does not alter existing rows.
-- Run it in Supabase SQL Editor after reviewing the notes below.
--
-- Goals:
-- 1. Make recurring transactions idempotent at the database level.
-- 2. Prevent authenticated clients from directly changing their AI rate-limit row.
-- 3. Provide transactional RPCs for future client-side adoption of safe writes.
--
-- IMPORTANT:
-- The current browser implementation still needs to call the recurring RPC below
-- for the idempotency guarantee to be active for newly generated recurring rows.
--

begin;

-- -----------------------------------------------------------------------------
-- 1. RECURRING TRANSACTION IDEMPOTENCY
-- -----------------------------------------------------------------------------
-- A generated transaction needs to remember which recurring template + due date
-- produced it. The pair is the natural idempotency key: one template can create
-- at most one real transaction for a given due date.

alter table public.transactions
    add column if not exists recurring_id uuid;

alter table public.transactions
    add column if not exists recurring_due_date date;

create index if not exists transactions_recurring_id_idx
    on public.transactions (user_id, recurring_id, recurring_due_date)
    where recurring_id is not null;

-- Before creating the unique index, surface duplicate historical rows so they
-- can be reviewed manually instead of silently deleting/merging user data.
-- Run this diagnostic separately if the unique index fails:
--
-- select user_id, recurring_id, recurring_due_date, count(*)
-- from public.transactions
-- where recurring_id is not null
-- group by user_id, recurring_id, recurring_due_date
-- having count(*) > 1;

create unique index if not exists transactions_recurring_idempotency_idx
    on public.transactions (user_id, recurring_id, recurring_due_date)
    where recurring_id is not null and recurring_due_date is not null;

-- -----------------------------------------------------------------------------
-- 2. SAFE SERVER-SIDE RECURRING INSERT
-- -----------------------------------------------------------------------------
-- This function is SECURITY INVOKER: RLS remains authoritative. The caller can
-- only insert a transaction for auth.uid(). ON CONFLICT makes repeated browser
-- retries safe instead of creating duplicate money movements.

create or replace function public.create_recurring_transaction(
    p_recurring_id uuid,
    p_due_date date,
    p_jenis text,
    p_jumlah numeric,
    p_akun text,
    p_kategori text,
    p_keterangan text default null,
    p_mata_uang text default null,
    p_kurs numeric default null,
    p_jumlah_idr numeric default null
)
returns public.transactions
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_row public.transactions;
begin
    if p_recurring_id is null or p_due_date is null then
        raise exception 'recurring_id and due_date are required';
    end if;

    if p_jumlah is null or p_jumlah <= 0 then
        raise exception 'jumlah must be greater than zero';
    end if;

    insert into public.transactions (
        user_id, jenis, tanggal, jumlah, akun, kategori, keterangan,
        mata_uang, kurs, jumlah_idr, recurring_id, recurring_due_date
    ) values (
        auth.uid(), p_jenis, p_due_date, p_jumlah, p_akun, p_kategori,
        p_keterangan, p_mata_uang, p_kurs,
        coalesce(p_jumlah_idr, p_jumlah), p_recurring_id, p_due_date
    )
    on conflict (user_id, recurring_id, recurring_due_date)
        where recurring_id is not null and recurring_due_date is not null
    do nothing
    returning * into v_row;

    -- If this invocation is a retry, return the already-existing row.
    if v_row.id is null then
        select * into v_row
        from public.transactions
        where user_id = auth.uid()
          and recurring_id = p_recurring_id
          and recurring_due_date = p_due_date
        limit 1;
    end if;

    return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. AI RATE LIMIT MUST NOT BE USER-WRITABLE
-- -----------------------------------------------------------------------------
-- The old policy allowed a logged-in browser to update its own rate-limit row.
-- That means a malicious client could reset last_ai_chat_at and bypass the
-- intended application-level throttle. Edge Functions using the service-role
-- key can still read/write this table because service-role bypasses RLS.

drop policy if exists "Users manage own rate limit row" on public.rate_limits;

-- No authenticated CRUD policy is intentionally recreated here.
-- The table remains protected by RLS; server-side code must perform rate-limit
-- reads/writes with a privileged server context.

-- -----------------------------------------------------------------------------
-- 4. TRANSACTION VALIDATION (ADDITIVE)
-- -----------------------------------------------------------------------------
-- Prevent impossible monetary values while retaining compatibility with legacy
-- records that may have NULL currency metadata.

alter table public.transactions
    drop constraint if exists transactions_jumlah_idr_nonnegative;

alter table public.transactions
    add constraint transactions_jumlah_idr_nonnegative
    check (jumlah_idr is null or jumlah_idr >= 0);

alter table public.transactions
    drop constraint if exists transactions_kurs_positive;

alter table public.transactions
    add constraint transactions_kurs_positive
    check (kurs is null or kurs > 0);

commit;

-- NEXT APPLICATION STEP
-- Update processDueRecurring() so that generated rows are inserted through
-- public.create_recurring_transaction() and only advance next_due_date after
-- the RPC succeeds. This migration intentionally does not modify the 650KB
-- monolithic index.html automatically.

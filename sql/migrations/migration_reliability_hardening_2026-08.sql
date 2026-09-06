-- MYFINANCE — RELIABILITY HARDENING (2026-08)
--
-- This migration is intentionally additive and does not alter existing rows.
-- Run in Supabase SQL Editor only after the application changes in this branch
-- are reviewed and deployed together.
--
-- Goals:
-- 1. Make recurring transactions idempotent at the database level.
-- 2. Provide transactional RPCs for safe recurring and budget writes.
-- 3. Add basic validation for monetary conversion fields.
-- 4. Prepare AI rate-limit hardening without breaking the currently deployed
--    Edge Function.

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
-- 2. SAFE RECURRING INSERT
-- -----------------------------------------------------------------------------
-- SECURITY INVOKER keeps the existing transactions RLS authoritative.
-- ON CONFLICT makes repeated browser retries safe instead of creating duplicate
-- money movements.

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
-- 3. ATOMIC BUDGET REPLACEMENT
-- -----------------------------------------------------------------------------
-- The old client path does DELETE all rows for a month, then INSERT the new set.
-- If the insert fails after the delete succeeds, the month can be left empty.
-- This RPC wraps the replacement in one database transaction.
--
-- Input JSON shape:
-- { "Makanan": 1500000, "Transportasi": 500000 }

create or replace function public.replace_month_budgets(
    p_bulan text,
    p_budgets jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_key text;
    v_value numeric;
begin
    if p_bulan is null or p_bulan !~ '^\d{4}-\d{2}$' then
        raise exception 'bulan must use YYYY-MM format';
    end if;

    if p_budgets is null or jsonb_typeof(p_budgets) <> 'object' then
        raise exception 'budgets must be a JSON object';
    end if;

    delete from public.budgets
    where user_id = auth.uid()
      and bulan = p_bulan;

    for v_key, v_value in
        select key, value::numeric
        from jsonb_each_text(p_budgets)
    loop
        if trim(v_key) = '' then
            raise exception 'kategori budget tidak boleh kosong';
        end if;
        if v_value is null or v_value <= 0 then
            continue;
        end if;

        insert into public.budgets (user_id, bulan, kategori, jumlah)
        values (auth.uid(), p_bulan, v_key, v_value);
    end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. AI RATE LIMIT — DEFERRED
-- -----------------------------------------------------------------------------
-- DO NOT remove the existing authenticated-user rate_limits policy yet.
-- The currently deployed Edge Function (index.ts) reads AND writes this table
-- through a user-scoped Supabase client. Removing the policy before that Edge
-- Function is changed to use a privileged server-side client would break the
-- AI chat rate limiter.
--
-- After the Edge Function has been hardened, run the following separately:
--
-- drop policy if exists "Users manage own rate limit row" on public.rate_limits;
--
-- The hardened Edge Function should verify the user's JWT with the user-scoped
-- client, but perform the rate-limit read/write using a service-role client.

-- -----------------------------------------------------------------------------
-- 5. TRANSACTION VALIDATION
-- -----------------------------------------------------------------------------

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

-- NEXT APPLICATION STEPS
-- 1. Update processDueRecurring() so generated rows call
--    public.create_recurring_transaction() and only advance next_due_date after
--    the RPC succeeds.
-- 2. Update saveBudgetsCloudRemote() to call public.replace_month_budgets()
--    instead of DELETE + INSERT from the browser.
-- 3. Harden the Edge Function's rate-limit writes with a privileged server-side
--    client, then remove the client-writable rate_limits policy separately.
-- 4. Run the duplicate recurring diagnostic above before the unique index if
--    historical recurring rows already exist.

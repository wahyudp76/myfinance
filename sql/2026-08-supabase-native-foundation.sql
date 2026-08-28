-- MyFinance — Supabase-native foundation migration
-- IMPORTANT: review and backup production before execution.
-- This migration is intentionally additive and does not delete or rewrite
-- historical transaction rows.

begin;

alter table public.transactions add column if not exists mata_uang text;
alter table public.transactions add column if not exists kurs numeric;
alter table public.transactions add column if not exists jumlah_idr numeric;
alter table public.transactions add column if not exists transfer_jumlah_tujuan numeric;
alter table public.transactions add column if not exists transfer_mata_uang_tujuan text;
alter table public.transactions add column if not exists transfer_kurs_tujuan numeric;
alter table public.transactions add column if not exists transfer_jumlah_tujuan_idr numeric;

alter table public.transactions drop constraint if exists transaction_currency_rate_positive;
alter table public.transactions add constraint transaction_currency_rate_positive
  check (kurs is null or kurs > 0);

alter table public.transactions drop constraint if exists transaction_amount_idr_nonnegative;
alter table public.transactions add constraint transaction_amount_idr_nonnegative
  check (jumlah_idr is null or jumlah_idr >= 0);

alter table public.transactions drop constraint if exists transfer_target_amount_positive;
alter table public.transactions add constraint transfer_target_amount_positive
  check (transfer_jumlah_tujuan is null or transfer_jumlah_tujuan > 0);

alter table public.transactions drop constraint if exists transfer_target_rate_positive;
alter table public.transactions add constraint transfer_target_rate_positive
  check (transfer_kurs_tujuan is null or transfer_kurs_tujuan > 0);

alter table public.transactions drop constraint if exists transfer_target_idr_nonnegative;
alter table public.transactions add constraint transfer_target_idr_nonnegative
  check (transfer_jumlah_tujuan_idr is null or transfer_jumlah_tujuan_idr >= 0);

create or replace function public.create_transfer_transaction(
    p_tanggal date,
    p_jumlah numeric,
    p_akun_sumber text,
    p_akun_tujuan text,
    p_mata_uang_sumber text,
    p_mata_uang_tujuan text,
    p_kurs_sumber numeric,
    p_kurs_tujuan numeric,
    p_keterangan text default null
)
returns public.transactions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.transactions;
  v_source_idr numeric;
  v_target_amount numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_jumlah is null or p_jumlah <= 0 then raise exception 'Jumlah transfer harus lebih besar dari nol'; end if;
  if nullif(trim(p_akun_sumber), '') is null or nullif(trim(p_akun_tujuan), '') is null then raise exception 'Akun sumber dan tujuan wajib diisi'; end if;
  if p_akun_sumber = p_akun_tujuan then raise exception 'Akun sumber dan tujuan harus berbeda'; end if;
  if nullif(trim(p_mata_uang_sumber), '') is null or nullif(trim(p_mata_uang_tujuan), '') is null then raise exception 'Mata uang sumber dan tujuan wajib diisi'; end if;
  if p_kurs_sumber is null or p_kurs_sumber <= 0 or p_kurs_tujuan is null or p_kurs_tujuan <= 0 then raise exception 'Kurs harus lebih besar dari nol'; end if;

  v_source_idr := p_jumlah * p_kurs_sumber;
  v_target_amount := v_source_idr / p_kurs_tujuan;

  insert into public.transactions (
    user_id, jenis, tanggal, jumlah, akun, kategori, keterangan,
    mata_uang, kurs, jumlah_idr,
    transfer_jumlah_tujuan, transfer_mata_uang_tujuan,
    transfer_kurs_tujuan, transfer_jumlah_tujuan_idr
  ) values (
    auth.uid(), 'Transfer', p_tanggal, p_jumlah, p_akun_sumber, p_akun_tujuan,
    p_keterangan, p_mata_uang_sumber, p_kurs_sumber, v_source_idr,
    v_target_amount, p_mata_uang_tujuan, p_kurs_tujuan, v_source_idr
  ) returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.create_transfer_transaction(date, numeric, text, text, text, text, numeric, numeric, text) to authenticated;

create or replace function public.replace_month_budgets(
    p_bulan text,
    p_budgets jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_bulan !~ '^\d{4}-\d{2}$' then raise exception 'Bulan harus berformat YYYY-MM'; end if;
  if jsonb_typeof(p_budgets) <> 'array' then raise exception 'Budget harus berupa array'; end if;

  delete from public.budgets where user_id = auth.uid() and bulan = p_bulan;

  insert into public.budgets (user_id, bulan, kategori, jumlah)
  select auth.uid(), p_bulan,
         trim(x->>'kategori'),
         (x->>'jumlah')::numeric
  from jsonb_array_elements(p_budgets) x
  where nullif(trim(x->>'kategori'), '') is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.replace_month_budgets(text, jsonb) to authenticated;

commit;

-- NOTE: recurring idempotency is deliberately not included here yet.
-- We need to confirm the exact recurring schema and generated-transaction
-- semantics before adding a unique key or changing production behavior.

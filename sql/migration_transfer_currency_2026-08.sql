-- MYFINANCE — CROSS-CURRENCY TRANSFER SUPPORT (2026-08)
--
-- Additive migration. DO NOT RUN in production until the browser write/read path
-- is updated in the same release.
--
-- Model: one logical Transfer row stores both legs:
--   source: jumlah + mata_uang + kurs + jumlah_idr
--   target: transfer_jumlah_tujuan + transfer_mata_uang_tujuan
--           + transfer_kurs_tujuan + transfer_jumlah_tujuan_idr
--
-- The target amount is calculated from IDR snapshots, not by reusing the source
-- nominal. This prevents USD 100 -> IDR from becoming IDR 100.

begin;

alter table public.transactions
    add column if not exists transfer_jumlah_tujuan numeric;

alter table public.transactions
    add column if not exists transfer_mata_uang_tujuan text;

alter table public.transactions
    add column if not exists transfer_kurs_tujuan numeric;

alter table public.transactions
    add column if not exists transfer_jumlah_tujuan_idr numeric;

alter table public.transactions
    drop constraint if exists transfer_target_amount_positive;

alter table public.transactions
    add constraint transfer_target_amount_positive
    check (transfer_jumlah_tujuan is null or transfer_jumlah_tujuan > 0);

alter table public.transactions
    drop constraint if exists transfer_target_rate_positive;

alter table public.transactions
    add constraint transfer_target_rate_positive
    check (transfer_kurs_tujuan is null or transfer_kurs_tujuan > 0);

alter table public.transactions
    drop constraint if exists transfer_target_idr_nonnegative;

alter table public.transactions
    add constraint transfer_target_idr_nonnegative
    check (transfer_jumlah_tujuan_idr is null or transfer_jumlah_tujuan_idr >= 0);

-- Atomic transfer writer. The caller explicitly supplies the target currency
-- and rate snapshot; do not infer currency from settings JSON because older
-- settings rows may not contain a stable account_currencies map.
-- Currency rates are expressed as IDR per one unit of that currency; IDR = 1.
-- Target amount = source amount * source IDR rate / target IDR rate.
-- Existing RLS on transactions remains authoritative because this is SECURITY INVOKER.
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
    v_target_amount numeric;
    v_source_idr numeric;
begin
    if auth.uid() is null then
        raise exception 'Authentication required';
    end if;
    if p_tanggal is null then
        raise exception 'Tanggal transfer wajib diisi';
    end if;
    if p_jumlah is null or p_jumlah <= 0 then
        raise exception 'Jumlah transfer harus lebih besar dari nol';
    end if;
    if nullif(trim(p_akun_sumber), '') is null or nullif(trim(p_akun_tujuan), '') is null then
        raise exception 'Akun sumber dan tujuan wajib diisi';
    end if;
    if p_akun_sumber = p_akun_tujuan then
        raise exception 'Akun sumber dan tujuan harus berbeda';
    end if;
    if nullif(trim(p_mata_uang_sumber), '') is null or nullif(trim(p_mata_uang_tujuan), '') is null then
        raise exception 'Mata uang sumber dan tujuan wajib diisi';
    end if;
    if p_kurs_sumber is null or p_kurs_sumber <= 0 or p_kurs_tujuan is null or p_kurs_tujuan <= 0 then
        raise exception 'Kurs sumber dan tujuan harus lebih besar dari nol';
    end if;

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
    )
    returning * into v_row;

    return v_row;
end;
$$;

commit;

-- IMPORTANT APPLICATION NOTES
-- 1. The frontend must resolve both account currencies and supply current IDR
--    rate snapshots before calling this RPC.
-- 2. For same-currency transfers, source and target rates are equal, so the
--    target amount equals the source amount.
-- 3. Existing historical Transfer rows remain compatible: when the new target
--    fields are NULL, the UI may continue using jumlah for the target leg.
-- 4. The dashboard/account-balance reducer must use transfer_jumlah_tujuan for
--    the destination account when the field is populated.

-- MYFINANCE — CROSS-CURRENCY TRANSFER SUPPORT (2026-08)
--
-- >>> STATUS 2026-09-01: SUDAH DITERAPKAN DI DATABASE LIVE. JANGAN DIJALANKAN LAGI. <<<
-- Diverifikasi lewat introspeksi skema live (semua objek yang dibuat file ini
-- terbukti ada); lihat docs/db-migration-status-2026-09-01.md. File ini kini
-- berstatus ARSIP/riwayat definisi -- berguna kalau perlu membangun project
-- Supabase baru dari nol (staging), bukan instruksi kerja untuk produksi.
--
-- (Teks asli: "Additive migration. DO NOT RUN in production until the browser
--  write/read path is updated in the same release." — syarat itu sudah
--  terpenuhi: jalur tulis/baca browser sudah memakai kolom-kolom ini.)
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
    -- v123 (susulan): DEFAULT 1 ini DISESUAIKAN DENGAN DATABASE LIVE, bukan
    -- karangan. Waktu perbaikan v123 diterapkan lewat Supabase Management API,
    -- Postgres menolak: "cannot remove parameter defaults from existing function".
    -- Ternyata function di produksi punya `p_kurs_sumber numeric DEFAULT 1` dan
    -- `p_kurs_tujuan numeric DEFAULT 1` yang TIDAK PERNAH ada di berkas SQL mana
    -- pun di repo (foundation, migration_transfer_currency, maupun schema.sql di
    -- commit 4343d07/7054b37/405f7a1) -- bukti drift skema live-vs-repo, dan
    -- alasan kedua kenapa transfer IDR-ke-IDR ternyata TIDAK rusak di produksi
    -- walau schema.sql menolaknya: yang tayang bukan versi repo.
    -- DEFAULT 1 dipertahankan karena selaras dengan "kurs NULL = IDR implisit"
    -- dan membuat CREATE OR REPLACE legal (menambah default boleh, menghapus tidak).
    p_kurs_sumber numeric default 1,
    p_kurs_tujuan numeric default 1,
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
    v_mata_uang_sumber text;
    v_mata_uang_tujuan text;
    v_kurs_sumber numeric;
    v_kurs_tujuan numeric;
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
    -- v123 (2026-09-12): mata uang NULL/kosong = IDR IMPLISIT, BUKAN error.
    --
    -- Konvensi "NULL berarti IDR" dipakai di SELURUH app: kolom
    -- transactions.mata_uang memang nullable, dan app.src.js menyimpan NULL utk
    -- akun IDR (`currentTxMataUang = null`, baris ~3375/~3423) lalu mengirimnya
    -- apa adanya ke RPC ini (src/services/supabase/transfers.js ->
    -- toTransferParams: `data.mata_uang_sumber || null`).
    --
    -- SEBELUM perbaikan ini RPC menolak NULL dengan 'Mata uang sumber dan tujuan
    -- wajib diisi' -- padahal tests/unit/rpc-param-shapes.test.js justru
    -- MENEGASKAN kontrak null itu ("transfer IDR-ke-IDR biasa (mayoritas
    -- transfer di app ini)"). Dua kontrak yang saling bertentangan, keduanya
    -- hijau, karena diuji terpisah: unit test memakai mock client (tidak pernah
    -- menyentuh Postgres), dan CEK 3 di scripts/schema-verify/functional-check.sql
    -- hanya menguji transfer LINTAS mata uang. Akibatnya transfer IDR-ke-IDR
    -- gagal di database tanpa satu pun gerbang yang merah.
    --
    -- Normalisasi: NULL/kosong -> NULL (TETAP IDR implisit -- sengaja TIDAK
    -- ditulis 'IDR' supaya baris Transfer konsisten dengan baris
    -- Pemasukan/Pengeluaran yang juga menyimpan NULL), kurs NULL -> 1.
    -- Kurs yang eksplisit 0/negatif tetap ditolak.
    v_mata_uang_sumber := nullif(trim(coalesce(p_mata_uang_sumber, '')), '');
    v_mata_uang_tujuan := nullif(trim(coalesce(p_mata_uang_tujuan, '')), '');
    v_kurs_sumber := coalesce(p_kurs_sumber, 1);
    v_kurs_tujuan := coalesce(p_kurs_tujuan, 1);
    if v_kurs_sumber <= 0 or v_kurs_tujuan <= 0 then
        raise exception 'Kurs sumber dan tujuan harus lebih besar dari nol';
    end if;

    v_source_idr := p_jumlah * v_kurs_sumber;
    v_target_amount := v_source_idr / v_kurs_tujuan;

    insert into public.transactions (
        user_id, jenis, tanggal, jumlah, akun, kategori, keterangan,
        mata_uang, kurs, jumlah_idr,
        transfer_jumlah_tujuan, transfer_mata_uang_tujuan,
        transfer_kurs_tujuan, transfer_jumlah_tujuan_idr
    ) values (
        auth.uid(), 'Transfer', p_tanggal, p_jumlah, p_akun_sumber, p_akun_tujuan,
        p_keterangan, v_mata_uang_sumber, v_kurs_sumber, v_source_idr,
        v_target_amount, v_mata_uang_tujuan, v_kurs_tujuan, v_source_idr
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

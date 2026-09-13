-- ============================================================================
-- MYFINANCE DASHBOARD — SUPABASE SCHEMA (FULL — semua fitur di Supabase)
-- ============================================================================
-- Cara pakai:
-- 1. Buka project Supabase kamu -> menu "SQL Editor" -> "New query".
-- 2. Copy-paste SELURUH isi file ini -> klik "Run".
-- 3. Pastikan Authentication -> Providers -> Email dalam keadaan aktif
--    (biasanya sudah aktif secara default).
--
-- File ini AMAN dijalankan ulang (pakai "if not exists" / "drop policy if
-- exists") kalau kamu sebelumnya sudah pernah menjalankan versi lama yang
-- cuma berisi tabel "transactions".
--
-- Semua tabel di bawah memakai Row Level Security (RLS): tiap user HANYA
-- bisa melihat & mengubah datanya sendiri, walaupun anon key dipakai
-- langsung dari browser.
--
-- ----------------------------------------------------------------------------
-- v95 (2026-09-07): FILE INI KINI BENAR-BENAR LENGKAP -- SATU KALI RUN CUKUP.
-- ----------------------------------------------------------------------------
-- Sebelum v95 file ini cuma berisi 6 tabel inti: TANPA satu pun RPC, tanpa
-- api_rate_limits / platform_logos / whatsapp_*, dan tanpa kolom-kolom yang
-- ditambahkan migrasi (multi-currency, recurring_id, simbol/jumlah_unit/
-- sumber_harga/tanggal_nav). Padahal aplikasi memanggil 4 RPC:
--   create_transfer_transaction, create_recurring_transaction,
--   replace_month_budgets, check_and_consume_rate_limit
-- Akibatnya project Supabase BARU yang dipasang dari file ini "hidup" tapi
-- rusak begitu dipakai: Transfer, simpan Budget, Transaksi Berulang, dan rate
-- limit Edge Function semuanya gagal.
--
-- Menjalankan sql/migrations/* setelahnya JUGA tidak menyelamatkan (sudah
-- dibuktikan dengan menjalankannya di Postgres nyata):
--   * migration_reliability_hardening_2026-08.sql GAGAL TOTAL di project baru
--     ("cannot change return type of existing function") karena foundation
--     lebih dulu membuat replace_month_budgets versi `returns integer`,
--     sedangkan file itu mendefinisikan ulang `returns void`. File-nya
--     dibungkus begin/commit -> SEMUA isinya ikut rollback, termasuk
--     create_recurring_transaction.
--   * rls_performance_fix.sql GAGAL di baris `public.rate_limits` (tabel
--     warisan yang tidak pernah ada di repo ini) -> seluruh perbaikan policy
--     initplan-nya ikut rollback.
--
-- Karena itu SEMUA objek yang dipakai produksi kini dikonsolidasikan ke file
-- ini, dengan definisi function disalin PERSIS (byte-identical) dari migrasi
-- kanoniknya. Kecocokan itu dijaga otomatis oleh
-- tests/unit/sql-schema-completeness.test.js -- kalau suatu saat sebuah RPC
-- diubah di migrasi tanpa ikut diperbarui di sini (atau sebaliknya), test itu
-- merah. Isi sql/migrations/ tetap sebagaimana adanya sebagai ARSIP RIWAYAT.
--
-- Bentuk policy memakai `(select auth.uid())`, bukan `auth.uid()` polos --
-- sama persis dengan database live (lihat migrations/rls_performance_fix.sql):
-- auth.uid() dievaluasi SEKALI per query, bukan sekali per baris.
--
-- OPSIONAL (tidak dijalankan otomatis oleh file ini, butuh hak superuser /
-- keputusan sadar): migrations/event_trigger_ensure_rls.sql dan
-- migrations/migration_f1_rls_auto_enable_2026-08-31.sql -- jaring pengaman
-- yang memaksa RLS aktif otomatis di tabel baru.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TRANSACTIONS — transaksi (Pemasukan, Pengeluaran, Transfer)
-- ----------------------------------------------------------------------------
create table if not exists public.transactions (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
    jenis       text not null check (jenis in ('Pemasukan', 'Pengeluaran', 'Transfer')),
    tanggal     date not null,
    jumlah      numeric not null check (jumlah >= 0),
    akun        text not null,
    kategori    text not null,
    keterangan  text,
    created_at  timestamptz not null default now()
);
create index if not exists transactions_user_id_idx on public.transactions (user_id);
create index if not exists transactions_tanggal_idx  on public.transactions (tanggal);
-- v59 (2026-09-02): index komposit utk pola utama app (filter user_id + order
-- tanggal DESC) -- lihat sql/migrations/migration_composite_indexes_2026-09-02.sql.
create index if not exists transactions_user_tanggal_id_idx on public.transactions (user_id, tanggal desc, id asc);

-- Kolom multi-currency (foundation 2026-08 + migration_transfer_currency_2026-08).
-- Satu baris Transfer menyimpan KEDUA kaki: sumber (jumlah/mata_uang/kurs/
-- jumlah_idr) dan tujuan (transfer_*). Nominal tujuan dihitung dari snapshot
-- IDR, bukan menyalin nominal sumber -- supaya USD 100 -> IDR tidak jadi Rp 100.
alter table public.transactions add column if not exists mata_uang text;
alter table public.transactions add column if not exists kurs numeric;
alter table public.transactions add column if not exists jumlah_idr numeric;
alter table public.transactions add column if not exists transfer_jumlah_tujuan numeric;
alter table public.transactions add column if not exists transfer_mata_uang_tujuan text;
alter table public.transactions add column if not exists transfer_kurs_tujuan numeric;
alter table public.transactions add column if not exists transfer_jumlah_tujuan_idr numeric;

-- Jejak transaksi berulang (migration_reliability_hardening_2026-08): pasangan
-- (recurring_id, recurring_due_date) adalah kunci idempotensi -- satu template
-- paling banyak menghasilkan SATU transaksi nyata per tanggal jatuh tempo.
alter table public.transactions add column if not exists recurring_id uuid;
alter table public.transactions add column if not exists recurring_due_date date;

create index if not exists transactions_recurring_id_idx
    on public.transactions (user_id, recurring_id, recurring_due_date)
    where recurring_id is not null;

create unique index if not exists transactions_recurring_idempotency_idx
    on public.transactions (user_id, recurring_id, recurring_due_date)
    where recurring_id is not null and recurring_due_date is not null;

-- ---------------------------------------------------------------------------
-- CHECK constraint transaksi multi-currency.
--
-- v124 (audit drift live-vs-repo 2026-09-13). Bagian ini dulu memasang TUJUH
-- constraint, dan komentarnya menyatakan dua di antaranya "duplikat SEMANTIK
-- ... KEDUANYA ada di database live". Audit membuktikan klaim itu SALAH.
-- Produksi hanya menyimpan SATU constraint per aturan, memakai keluarga nama
-- `transactions_*`:
--
--   transactions_jumlah_idr_nonnegative           jumlah_idr >= 0
--   transactions_kurs_positive                    kurs > 0
--   transactions_transfer_jumlah_tujuan_positive  transfer_jumlah_tujuan > 0
--   transactions_transfer_kurs_tujuan_positive    transfer_kurs_tujuan > 0
--   transfer_target_idr_nonnegative               transfer_jumlah_tujuan_idr >= 0
--
-- Empat nama berikut TIDAK PERNAH ada di produksi (diperiksa langsung lewat
-- pg_constraint): transaction_currency_rate_positive,
-- transaction_amount_idr_nonnegative, transfer_target_amount_positive,
-- transfer_target_rate_positive.
--
-- Akibatnya instalasi baru dulu mendapat 11 constraint di transactions
-- sementara produksi punya 9 -- termasuk DUA PASANG aturan identik yang
-- dievaluasi dua kali pada setiap INSERT/UPDATE. Sekarang disamakan dengan
-- produksi. Keempat nama yang tidak pernah ada di live tetap di-DROP (tanpa
-- dipasang ulang) supaya database yang terlanjur dibangun dari schema.sql versi
-- lama ikut bersih saat berkas ini dijalankan ulang.
-- ---------------------------------------------------------------------------
alter table public.transactions drop constraint if exists transaction_currency_rate_positive;
alter table public.transactions drop constraint if exists transaction_amount_idr_nonnegative;
alter table public.transactions drop constraint if exists transfer_target_amount_positive;
alter table public.transactions drop constraint if exists transfer_target_rate_positive;

alter table public.transactions drop constraint if exists transfer_target_idr_nonnegative;
alter table public.transactions add constraint transfer_target_idr_nonnegative
  check (transfer_jumlah_tujuan_idr is null or transfer_jumlah_tujuan_idr >= 0);

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

alter table public.transactions
    drop constraint if exists transactions_transfer_jumlah_tujuan_positive;
alter table public.transactions
    add constraint transactions_transfer_jumlah_tujuan_positive
    check (transfer_jumlah_tujuan is null or transfer_jumlah_tujuan > 0);

alter table public.transactions
    drop constraint if exists transactions_transfer_kurs_tujuan_positive;
alter table public.transactions
    add constraint transactions_transfer_kurs_tujuan_positive
    check (transfer_kurs_tujuan is null or transfer_kurs_tujuan > 0);

alter table public.transactions enable row level security;
drop policy if exists "Users can view own transactions"   on public.transactions;
drop policy if exists "Users can insert own transactions" on public.transactions;
drop policy if exists "Users can update own transactions" on public.transactions;
drop policy if exists "Users can delete own transactions" on public.transactions;

create policy "Users can view own transactions"   on public.transactions for select using ((select auth.uid()) = user_id);
create policy "Users can insert own transactions" on public.transactions for insert with check ((select auth.uid()) = user_id);
create policy "Users can update own transactions" on public.transactions for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own transactions" on public.transactions for delete using ((select auth.uid()) = user_id);


-- ----------------------------------------------------------------------------
-- 2. BUDGETS — anggaran per kategori per bulan
-- ----------------------------------------------------------------------------
create table if not exists public.budgets (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
    bulan      text not null,              -- format 'YYYY-MM'
    kategori   text not null,
    jumlah     numeric not null check (jumlah >= 0),
    unique (user_id, bulan, kategori)
);
create index if not exists budgets_user_bulan_idx on public.budgets (user_id, bulan);

alter table public.budgets enable row level security;
drop policy if exists "Users manage own budgets" on public.budgets;
create policy "Users manage own budgets" on public.budgets
    for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);


-- ----------------------------------------------------------------------------
-- 3. ASSETS — portofolio aset / investasi
-- ----------------------------------------------------------------------------
create table if not exists public.assets (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
    nama       text not null,
    kategori   text not null,
    platform   text,
    modal      numeric not null default 0,
    nilai      numeric not null default 0,
    terakhir   timestamptz not null default now(),
    -- Riwayat nilai dari waktu ke waktu, buat grafik performa per aset (menu Aset -> Detail).
    -- Array of {tanggal, nilai}, ditambah (bukan ditimpa) tiap kali nilai aset diperbarui.
    value_history jsonb not null default '[]'::jsonb
);
create index if not exists assets_user_id_idx on public.assets (user_id);
-- v59 (2026-09-02): index komposit utk pola utama app (filter user_id + order
-- terakhir DESC) -- lihat sql/migrations/migration_composite_indexes_2026-09-02.sql.
create index if not exists assets_user_terakhir_id_idx on public.assets (user_id, terakhir desc, id asc);

-- Kolom auto-update harga (migration_asset_price_columns_2026-08 +
-- migration_assets_tanggal_nav_2026-09). Dipakai Edge Function
-- refresh-asset-price: nilai_baru = round(harga_per_unit x jumlah_unit).
-- sumber_harga: 'coingecko' (Kripto) | 'yahoo_id_stock' (Saham) |
-- 'reksadana_bibit' (Reksadana) | 'manual_nav'.
alter table public.assets add column if not exists simbol text;
alter table public.assets add column if not exists jumlah_unit numeric;
alter table public.assets add column if not exists sumber_harga text;
alter table public.assets add column if not exists tanggal_nav text;

comment on column public.assets.simbol is
  'Kode ticker/simbol aset utk refresh harga otomatis (mis. "BTC", "BBCA.JK"). NULL = aset manual, tidak ikut auto-refresh.';
comment on column public.assets.jumlah_unit is
  'Jumlah unit/lot yang dimiliki, dipakai Edge Function refresh-asset-price utk menghitung ulang `nilai` dari harga terkini x jumlah_unit.';
comment on column public.assets.sumber_harga is
  'Sumber data harga (mis. "coingecko"), dipakai Edge Function refresh-asset-price utk tahu API mana yang harus dipanggil utk simbol ini.';

-- Migrasi aman untuk yang sudah pernah menjalankan schema ini sebelumnya (kolom baru di tabel lama).
alter table public.assets add column if not exists value_history jsonb not null default '[]'::jsonb;

alter table public.assets enable row level security;
drop policy if exists "Users manage own assets" on public.assets;
create policy "Users manage own assets" on public.assets
    for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);


-- ----------------------------------------------------------------------------
-- 4. SETTINGS — daftar akun & kategori kustom (1 baris per user, disimpan
--    sebagai JSON supaya persis mengikuti struktur objek "appSettings" di
--    aplikasi: { accounts: [...], custom_categories: {...} })
-- ----------------------------------------------------------------------------
create table if not exists public.settings (
    user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
    data        jsonb not null default '{}'::jsonb,
    updated_at  timestamptz not null default now()
);

alter table public.settings enable row level security;
drop policy if exists "Users manage own settings" on public.settings;
create policy "Users manage own settings" on public.settings
    for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);


-- ----------------------------------------------------------------------------
-- 5. CUSTOM_ICONS — ikon/logo kustom per akun (upload gambar atau pilih ikon)
-- ----------------------------------------------------------------------------
create table if not exists public.custom_icons (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
    account_name  text not null,
    icon_data     jsonb not null,
    unique (user_id, account_name)
);
create index if not exists custom_icons_user_id_idx on public.custom_icons (user_id);

alter table public.custom_icons enable row level security;
drop policy if exists "Users manage own custom icons" on public.custom_icons;
create policy "Users manage own custom icons" on public.custom_icons
    for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);


-- ----------------------------------------------------------------------------
-- 6. RECURRING_TRANSACTIONS — template transaksi berulang (langganan, gaji,
--    cicilan, tagihan rutin, dsb). Transaksi NYATA di tabel "transactions"
--    otomatis dibuat dari template ini saat aplikasi dibuka dan
--    next_due_date <= hari ini (lihat processDueRecurring() di index.html).
-- ----------------------------------------------------------------------------
create table if not exists public.recurring_transactions (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
    jenis           text not null check (jenis in ('Pemasukan', 'Pengeluaran', 'Transfer')),
    jumlah          numeric not null check (jumlah > 0),
    akun            text not null,
    kategori        text not null,   -- untuk Transfer: nama akun tujuan (sama seperti tabel transactions)
    keterangan      text,
    frequency       text not null check (frequency in ('harian', 'mingguan', 'bulanan', 'tahunan')),
    start_date      date not null,
    next_due_date   date not null,
    end_date        date,            -- kosong = tanpa batas waktu
    active          boolean not null default true,
    created_at      timestamptz not null default now()
);
create index if not exists recurring_user_id_idx on public.recurring_transactions (user_id);
create index if not exists recurring_next_due_idx on public.recurring_transactions (next_due_date);
-- v59 (2026-09-02): index komposit utk pola utama app (filter user_id + order
-- next_due_date ASC) -- lihat sql/migrations/migration_composite_indexes_2026-09-02.sql.
create index if not exists recurring_user_next_due_id_idx on public.recurring_transactions (user_id, next_due_date asc, id asc);

alter table public.recurring_transactions enable row level security;
drop policy if exists "Users manage own recurring transactions" on public.recurring_transactions;
create policy "Users manage own recurring transactions" on public.recurring_transactions
    for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);


-- ----------------------------------------------------------------------------
-- 7. API_RATE_LIMITS — penghitung rate limit per (user_id, action)
-- ----------------------------------------------------------------------------
-- Dipakai Edge Function yang memanggil API berbayar (analyze-finance,
-- refresh-asset-price, scan-receipt, whatsapp-webhook) lewat RPC
-- check_and_consume_rate_limit di bawah. Definisi kanonik:
-- sql/migrations/migration_rate_limiting_2026-08.sql
-- ----------------------------------------------------------------------------
create table if not exists public.api_rate_limits (
    user_id      uuid not null,
    action       text not null,
    window_start timestamptz not null default now(),
    call_count   integer not null default 0,
    primary key (user_id, action)
);

comment on table public.api_rate_limits is
  'Penghitung rate-limit per (user_id, action), window tetap (fixed window, di-reset otomatis oleh check_and_consume_rate_limit() begitu window_start sudah lewat p_window_minutes). HANYA diakses lewat RPC di bawah atau service role -- lihat kebijakan RLS.';

alter table public.api_rate_limits enable row level security;
-- SENGAJA tanpa policy apa pun untuk anon/authenticated: tabel ini TIDAK BOLEH
-- disentuh langsung dari browser (kalau bisa, user tinggal DELETE barisnya
-- sendiri untuk mereset limit). Jalan masuk yang sah cuma dua: RPC di bawah
-- (SECURITY DEFINER, melewati RLS dari dalam) atau service_role.

create or replace function public.check_and_consume_rate_limit(
    p_user_id uuid,
    p_action text,
    p_max_calls integer,
    p_window_minutes integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now          timestamptz := now();
    v_window_start timestamptz;
    v_call_count   integer;
begin
    -- FIX KEAMANAN (ditemukan & diperbaiki saat apply ke live, lihat riwayat percakapan/commit):
    -- Supabase otomatis meng-grant EXECUTE ke role anon utk SETIAP function baru di schema public
    -- (default privilege level-project) -- "revoke all from public" di bawah TIDAK mencabut ini,
    -- krn anon dapat grant-nya langsung, bukan lewat PUBLIC. Tanpa baris berikut, caller ANON
    -- (belum login sama sekali) bisa memanggil RPC ini -- dan karena auth.uid() JUGA null utk
    -- anon (sama seperti utk service_role terpercaya), guard "auth.uid() is not null and ..." di
    -- bawah TIDAK mendeteksinya: anon bisa kirim p_user_id SEMBARANG dan menghabiskan/mereset
    -- jatah rate limit USER LAIN (DoS). auth.role() membedakan ini dgn benar: null = konteks
    -- terpercaya (service_role/panggilan SQL langsung), 'anon' = publik tak terverifikasi.
    if auth.role() = 'anon' then
        raise exception 'Caller anonim tidak boleh memanggil check_and_consume_rate_limit.';
    end if;
    -- Kalau dipanggil dgn JWT user biasa (auth.uid() terisi), user itu HANYA boleh memeriksa
    -- rate limit MILIKNYA SENDIRI -- tidak boleh diam-diam mengisi/menghabiskan limit user lain
    -- dengan mengirim p_user_id sembarang. Kalau dipanggil lewat service role (mis. dari
    -- whatsapp-webhook, yang usernya diresolve dari nomor WhatsApp, bukan dari JWT), auth.uid()
    -- otomatis NULL -- pengecekan ini dilewati, dipercaya sepenuhnya krn cuma Edge Function
    -- pemegang SUPABASE_SERVICE_ROLE_KEY yang bisa manggil dgn konteks itu.
    if auth.uid() is not null and auth.uid() <> p_user_id then
        raise exception 'Tidak boleh memeriksa/mengisi rate limit milik user lain.';
    end if;
    if p_max_calls <= 0 or p_window_minutes <= 0 then
        raise exception 'p_max_calls dan p_window_minutes harus lebih dari 0.';
    end if;

    -- UPSERT atomik: baris belum ada -> mulai window baru hitungan 1. Baris sudah ada TAPI
    -- window_start-nya sudah kedaluwarsa (lebih lama dari p_window_minutes yang lalu) -> reset
    -- ke window baru hitungan 1. Baris ada & window masih berlaku -> call_count + 1. Semuanya 1
    -- statement, jadi tidak ada celah race condition antara SELECT dan UPDATE terpisah kalau ada
    -- 2 request nyaris bersamaan. Sudah diuji langsung (INSERT, akumulasi count, reset window
    -- kedaluwarsa) terhadap database live sebelum migrasi ini dianggap selesai.
    insert into public.api_rate_limits as rl (user_id, action, window_start, call_count)
    values (p_user_id, p_action, v_now, 1)
    on conflict (user_id, action) do update
        set call_count   = case when rl.window_start <= v_now - make_interval(mins => p_window_minutes)
                                 then 1 else rl.call_count + 1 end,
            window_start = case when rl.window_start <= v_now - make_interval(mins => p_window_minutes)
                                 then v_now else rl.window_start end
    returning window_start, call_count into v_window_start, v_call_count;

    return v_call_count <= p_max_calls;
end;
$$;

comment on function public.check_and_consume_rate_limit is
  'Cek DAN langsung catat 1 pemakaian dalam sekali panggilan (atomik) -- true = masih boleh lanjut, false = sudah kena limit utk window saat ini. Panggil ini SEBELUM melakukan operasi mahal (panggil Gemini, dsb), bukan sesudahnya.';

revoke all on function public.check_and_consume_rate_limit from public;
revoke execute on function public.check_and_consume_rate_limit from anon;
grant execute on function public.check_and_consume_rate_limit to authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 7b. RATE_LIMITS (warisan) — jeda MINIMAL 8 detik antar pesan "Tanya AI"
-- ----------------------------------------------------------------------------
-- BUKAN duplikat api_rate_limits di atas: tujuannya beda (jeda antar-pesan vs
-- kuota per jam) dan skemanya beda (satu timestamp vs penghitung per action).
-- Edge Function analyze-finance membaca & menulis tabel ini lewat client
-- ber-JWT user (lihat supabase/functions/analyze-finance/index.ts -- .from(
-- "rate_limits")), jadi tabel ini BUTUH policy per-user, tidak seperti
-- api_rate_limits yang tertutup rapat.
--
-- KENAPA BARU MUNCUL DI SINI (v95): tabel ini lahir langsung di database live
-- sebelum repo punya file SQL, dan TIDAK PERNAH ikut di schema.sql maupun
-- migrations/ -- satu-satunya jejaknya cuma baris `drop policy ... on
-- public.rate_limits` di migrations/rls_performance_fix.sql. Akibatnya di
-- project baru, jeda 8 detik itu GAGAL DIAM-DIAM: query select-nya error,
-- error-nya tidak diperiksa (hanya `data` yang di-destructure), jadi jeda
-- tidak pernah berlaku sama sekali tanpa pesan apa pun.
-- ----------------------------------------------------------------------------
create table if not exists public.rate_limits (
    user_id         uuid primary key references auth.users(id) on delete cascade,
    last_ai_chat_at timestamptz
);

alter table public.rate_limits enable row level security;
drop policy if exists "Users manage own rate limit row" on public.rate_limits;
create policy "Users manage own rate limit row" on public.rate_limits
    for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);


-- ----------------------------------------------------------------------------
-- 8. PLATFORM_LOGOS — katalog logo platform investasi (data global, bukan
--    per-user). Dibaca src/domain/platform-logos.js untuk kartu/detail Aset.
--    Riwayat: sql/migrations/20260906_platform_logos.sql (ARSIP -- lihat catatan
--    drift di bawah sebelum membandingkan bentuk tabelnya).
--
--    ⚠️ BENTUK TABEL INI MENGIKUTI PRODUKSI, bukan keinginan (audit drift
--    live-vs-repo 2026-09-13). Sampai audit itu, berkas ini menulis
--    `id uuid primary key default gen_random_uuid()` padahal production memakai
--    `id bigint GENERATED BY DEFAULT AS IDENTITY` + sequence
--    `platform_logos_id_seq`.
--
--    AKARNYA: tabelnya sudah ada di database live SEBELUM migration-nya pernah
--    dijalankan -- hampir pasti dibuat lewat Supabase Dashboard UI, yang
--    otomatis memberi `id bigint generated by default as identity`. Karena
--    migration (dan berkas ini) memakai `create table if not exists`, ia
--    DIAM-DIAM JADI NO-OP dan tidak pernah membentuk ulang tabelnya;
--    `alter table add column if not exists id uuid ...` juga no-op karena kolom
--    `id` sudah ada. Tidak ada error, tidak ada peringatan -- migration
--    melaporkan sukses. File migration-nya sendiri sudah mengakui hal ini
--    ("tahan drift bentuk vs tabel live yang dibuat migrasi yang hilang tadi").
--    Bukti tambahan: seluruh 12 baris live ber-created_at 2026-09-06.
--
--    PELAJARAN UMUM: `if not exists` membuat migration TAHAN DIJALANKAN ULANG,
--    tapi TIDAK KOREKTIF. Tabel yang sudah ada mempertahankan bentuk lamanya
--    selamanya.
--
--    DAMPAK RUNTIME: NIHIL. Aplikasi tidak pernah menyentuh kolom `id` --
--    src/services/supabase/platform-logos.js hanya membaca platform_key,
--    display_name, logo_url, source_url (identitas baris di seluruh alur adalah
--    platform_key). Yang diperbaiki di sini adalah KEJUJURAN berkas ini: supaya
--    instalasi baru menghasilkan replika produksi, bukan tabel yang berbeda.
--    Arahnya sengaja "repo mengikuti live": memigrasikan id produksi ke uuid
--    berarti menulis ulang tabel + membuang sequence, berisiko, dan manfaatnya
--    nol karena tidak ada pemakai kolom itu.
-- ----------------------------------------------------------------------------
create table if not exists public.platform_logos (
    id           bigint generated by default as identity primary key,
    platform_key text not null
        constraint platform_logos_key_format check (platform_key ~ '^[a-z0-9][a-z0-9_-]*$'),
    display_name text not null,
    logo_url     text not null,
    source_url   text,
    is_active    boolean not null default true,
    created_at   timestamptz not null default timezone('utc', now()),
    updated_at   timestamptz not null default timezone('utc', now()),
    -- Di produksi ini UNIQUE constraint (bukan unique index polos). Efek dan
    -- namanya sama, dan `on conflict (platform_key)` di seed bawah tetap jalan.
    constraint platform_logos_platform_key_key unique (platform_key)
);

-- Melayani PERSIS query aplikasi: .eq('is_active', true).order('display_name').
-- Index ini sudah ada di produksi tapi tidak pernah tercatat di repo, jadi
-- instalasi baru dulu kalah dari produksi.
create index if not exists platform_logos_active_idx
    on public.platform_logos (is_active, display_name);

-- updated_at dipelihara trigger. Function + trigger ini ADA di produksi namun
-- TIDAK PERNAH ada di berkas SQL mana pun di repo (frasa
-- set_platform_logos_updated_at tidak muncul di sql/ sama sekali sebelum v124).
-- Akibatnya instalasi baru punya kolom updated_at yang tidak pernah diperbarui
-- saat UPDATE. Body di produksi memakai CRLF (ciri objek buatan Dashboard);
-- di sini ditulis LF normal -- pembanding drift menormalkan whitespace, jadi
-- perbedaannya tidak dilaporkan sebagai drift.
create or replace function public.set_platform_logos_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- `create trigger` tidak punya `if not exists`, jadi pakai pola drop-then-create
-- yang sama dengan policy di berkas ini (tetap idempoten -- CI menjalankan
-- berkas ini dua kali).
drop trigger if exists platform_logos_set_updated_at on public.platform_logos;
create trigger platform_logos_set_updated_at
    before update on public.platform_logos
    for each row execute function public.set_platform_logos_updated_at();

alter table public.platform_logos enable row level security;

-- Baca PUBLIK (katalog global, bukan data pribadi) -- tulis tetap hanya lewat
-- service_role / SQL Editor.
drop policy if exists "Platform logos are publicly readable" on public.platform_logos;
create policy "Platform logos are publicly readable"
    on public.platform_logos
    for select
    using (true);

grant select on public.platform_logos to anon, authenticated;

-- Seed 11 platform dengan logo SELF-HOSTED (icons/platforms/*): satu origin
-- dengan aplikasi -> lolos CSP 'self', tidak bergantung hotlink pihak ketiga,
-- dan tetap tampil offline lewat service worker.
insert into public.platform_logos
    (platform_key, display_name, logo_url, source_url, is_active)
values
    ('bibit',       'Bibit',          'icons/platforms/bibit.svg',        'https://bibit.id/',       true),
    ('ajaib',       'Ajaib',          'icons/platforms/ajaib.ico',        'https://ajaib.co.id/',    true),
    ('stockbit',    'Stockbit',       'icons/platforms/stockbit.svg',     'https://stockbit.com/',   true),
    ('bareksa',     'Bareksa',        'icons/platforms/bareksa.svg',      'https://bareksa.com/',    true),
    ('pluang',      'Pluang',         'icons/platforms/pluang.png',       'https://pluang.com/',     true),
    ('indodax',     'Indodax',        'icons/platforms/indodax.png',      'https://indodax.com/',    true),
    ('tokocrypto',  'Tokocrypto',     'icons/platforms/tokocrypto.svg',   'https://tokocrypto.com/', true),
    ('pintu',       'Pintu',          'icons/platforms/pintu.png',        'https://pintu.co.id/',    true),
    ('mirae',       'Mirae',          'icons/platforms/mirae.svg',        'https://www.miraeasset.co.id/', true),
    ('goto',        'GoTo',           'icons/platforms/goto.svg',         'https://gotocompany.com/', true),
    ('danamas-stabil', 'Danamas Stabil', 'icons/platforms/danamas-stabil.png', 'https://www.banksinarmas.com/', true)
on conflict (platform_key) do update set
    display_name = excluded.display_name,
    logo_url     = excluded.logo_url,
    source_url   = excluded.source_url,
    is_active    = excluded.is_active,
    updated_at   = timezone('utc', now());

-- IPOT sengaja tidak di-seed: belum ada file logo self-hosted yang terverifikasi
-- (semua URL logo indopremier 404 saat diuji 2026-09-06) -> app memakai fallback
-- badge lokal "IP".


-- ----------------------------------------------------------------------------
-- 9. WHATSAPP — kode verifikasi + pemetaan nomor ke akun (bot Fonnte).
--    Definisi kanonik: sql/migrations/migration_whatsapp.sql
-- ----------------------------------------------------------------------------
create table if not exists public.whatsapp_link_codes (
    id uuid primary key default gen_random_uuid(),
    -- default auth.uid() (F2 di migrations/migration_rls_hardening_2026-08-31.sql):
    -- konsisten dengan tabel inti lain, supaya client tidak perlu mengirim user_id.
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    code text not null unique,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '10 minutes')
);
create index if not exists whatsapp_link_codes_user_id_idx on public.whatsapp_link_codes (user_id);

create table if not exists public.whatsapp_links (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null unique references auth.users(id) on delete cascade,
    whatsapp_number text not null unique,
    linked_at timestamptz not null default now()
);

alter table public.whatsapp_link_codes enable row level security;
alter table public.whatsapp_links enable row level security;

drop policy if exists "user bisa bikin kode sendiri" on public.whatsapp_link_codes;
create policy "user bisa bikin kode sendiri" on public.whatsapp_link_codes
    for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "user bisa lihat kode sendiri" on public.whatsapp_link_codes;
create policy "user bisa lihat kode sendiri" on public.whatsapp_link_codes
    for select to authenticated using ((select auth.uid()) = user_id);

-- SENGAJA tidak ada policy INSERT untuk authenticated di whatsapp_links: baris
-- baru hanya boleh dibuat Edge Function (service role) SETELAH kode terverifikasi,
-- supaya tidak ada yang bisa mengklaim nomor WhatsApp mana pun dari browser.
drop policy if exists "user bisa lihat link whatsapp sendiri" on public.whatsapp_links;
create policy "user bisa lihat link whatsapp sendiri" on public.whatsapp_links
    for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "user bisa putus link whatsapp sendiri" on public.whatsapp_links;
create policy "user bisa putus link whatsapp sendiri" on public.whatsapp_links
    for delete to authenticated using ((select auth.uid()) = user_id);


-- ============================================================================
-- 10. RPC ATOMIK — dipanggil langsung oleh aplikasi (supabase.rpc(...))
-- ============================================================================
-- Ketiganya SECURITY INVOKER: RLS tabel transactions/budgets tetap yang
-- berkuasa, RPC hanya membungkus operasi multi-langkah jadi satu transaksi
-- database supaya tidak bisa gagal separuh jalan.
--
-- Definisi disalin PERSIS dari migrasi kanoniknya (dijaga
-- tests/unit/sql-schema-completeness.test.js):
--   create_transfer_transaction  <- migrations/migration_transfer_currency_2026-08.sql
--   create_recurring_transaction <- migrations/migration_reliability_hardening_2026-08.sql
--   replace_month_budgets        <- migrations/migration_reliability_hardening_2026-08.sql
--
-- CATATAN PENTING soal replace_month_budgets: versi kanoniknya `returns void`
-- (versi `returns integer` di migrations/2026-08-supabase-native-foundation.sql
-- sudah usang). Postgres TIDAK mengizinkan `create or replace` mengubah tipe
-- kembalian -- karena itu file ini memakai versi final saja, dan menjalankan
-- foundation setelah file ini akan error. Jangan campur keduanya.
-- ----------------------------------------------------------------------------

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
        -- v123: snapshot IDR dihitung dari kurs bila p_jumlah_idr tidak diberikan.
        -- Sebelumnya `coalesce(p_jumlah_idr, p_jumlah)` menyalin nominal MENTAH, jadi
        -- template berulang bermata uang asing yang suatu saat diisi (tabel
        -- recurring_transactions belum punya kolom mata_uang/kurs -- gap yang tercatat
        -- di docs/supabase-native-migration-plan.md) akan menghasilkan USD 100 ->
        -- jumlah_idr 100, bukan 1.600.000. Persis regresi klasik "USD 100 jadi Rp 100"
        -- yang sudah dijaga di create_transfer_transaction (CEK 3a/3b).
        -- Untuk pemanggil SEKARANG (p_kurs selalu NULL karena belum ada dukungan mata
        -- uang di template berulang) hasilnya IDENTIK: coalesce -> p_jumlah.
        coalesce(p_jumlah_idr,
                 case when p_kurs is not null then p_jumlah * p_kurs else p_jumlah end),
        p_recurring_id, p_due_date
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

-- Grant/revoke RPC (hasil audit migrations/migration_rls_hardening_2026-08-31.sql):
-- anon TIDAK boleh memanggil RPC apa pun. Mencabut dari anon SAJA tidak memadai
-- -- anon otomatis anggota role PUBLIC, jadi harus dicabut dari keduanya, dan
-- grant eksplisit diberikan LEBIH DULU supaya jalur app tidak terputus sesaat pun.
--
-- Memakai DO block dinamis (pola yang sama dengan migrasi hardening): signature
-- dibaca apa adanya dari pg_proc, jadi tidak bisa salah tulis tipe argumen dan
-- tetap benar kalau suatu saat ada overload.
do $$
declare
    r record;
    v_count integer := 0;
begin
    for r in
        select ns.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and p.proname in ('create_recurring_transaction',
                            'create_transfer_transaction',
                            'replace_month_budgets')
    loop
        execute format('grant execute on function %I.%I(%s) to authenticated, service_role',
                       r.nspname, r.proname, r.args);
        execute format('revoke execute on function %I.%I(%s) from public',
                       r.nspname, r.proname, r.args);
        execute format('revoke execute on function %I.%I(%s) from anon',
                       r.nspname, r.proname, r.args);
        v_count := v_count + 1;
    end loop;
    if v_count < 3 then
        raise exception 'Grant RPC: hanya % dari 3 function ditemukan -- schema.sql tidak lengkap.', v_count;
    end if;
end $$;

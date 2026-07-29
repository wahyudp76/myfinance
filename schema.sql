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

alter table public.transactions enable row level security;
drop policy if exists "Users can view own transactions"   on public.transactions;
drop policy if exists "Users can insert own transactions" on public.transactions;
drop policy if exists "Users can update own transactions" on public.transactions;
drop policy if exists "Users can delete own transactions" on public.transactions;

create policy "Users can view own transactions"   on public.transactions for select using (auth.uid() = user_id);
create policy "Users can insert own transactions" on public.transactions for insert with check (auth.uid() = user_id);
create policy "Users can update own transactions" on public.transactions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own transactions" on public.transactions for delete using (auth.uid() = user_id);


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
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


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

-- Migrasi aman untuk yang sudah pernah menjalankan schema ini sebelumnya (kolom baru di tabel lama).
alter table public.assets add column if not exists value_history jsonb not null default '[]'::jsonb;

alter table public.assets enable row level security;
drop policy if exists "Users manage own assets" on public.assets;
create policy "Users manage own assets" on public.assets
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


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
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ----------------------------------------------------------------------------
-- 5. CUSTOM_ICONS — penyimpanan generik untuk objek "ikon custom" (jsonb bebas
--    bentuknya: {type:'icon',value,bg,color} atau {type:'image',value}), dengan
--    "account_name" berfungsi sebagai KEY string generik, bukan cuma nama akun:
--      * nama akun asli         -> ikon/logo kustom akun (upload gambar/pilih ikon)
--      * '__myfinance_profile_avatar__'                    -> foto profil pengguna
--      * '__myfinance_category_style__<jenis>::<kategori>' -> override ikon/warna/
--        gambar kustom per kategori Pengeluaran/Pemasukan (lihat categoryStyleKey()
--        di index.html) -- dipakai lagi supaya tidak perlu tabel/migrasi baru.
-- ----------------------------------------------------------------------------
create table if not exists public.custom_icons (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
    account_name  text not null, -- key generik (nama akun ASLI, atau key khusus berawalan __myfinance_...)
    icon_data     jsonb not null,
    unique (user_id, account_name)
);
create index if not exists custom_icons_user_id_idx on public.custom_icons (user_id);

alter table public.custom_icons enable row level security;
drop policy if exists "Users manage own custom icons" on public.custom_icons;
create policy "Users manage own custom icons" on public.custom_icons
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


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

alter table public.recurring_transactions enable row level security;
drop policy if exists "Users manage own recurring transactions" on public.recurring_transactions;
create policy "Users manage own recurring transactions" on public.recurring_transactions
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


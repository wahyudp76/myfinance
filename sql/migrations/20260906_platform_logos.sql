-- ============================================================================
-- KATALOG LOGO PLATFORM ASET/INVESTASI (tabel platform_logos) — v86
-- ============================================================================
-- File ini MENUTUP celah migrasi: sebelumnya hanya file ALIAS
-- (20260906_platform_logo_aliases.sql) yang ter-commit, sedangkan file yang
-- MEMBUAT tabel + mengisinya tidak pernah masuk repo -- isinya hanya ada di
-- database live. Akibatnya setup ulang/restore project Supabase kehilangan
-- katalog logo sama sekali.
--
-- PENTING -- POLA AKAR BUG "LOGO ASET TIDAK MUNCUL" (2026-09-06):
-- Event trigger `ensure_rls` (lihat sql/event_trigger_ensure_rls.sql) OTOMATIS
-- mengaktifkan Row Level Security untuk SETIAP tabel baru di schema public.
-- Tanpa policy SELECT, RLS menolak SEMUA baca dari anon/authenticated secara
-- SENYAP (REST tetap 200 + array kosong -- bukan error). Itulah mengapa tabel
-- platform_logos di project live terbaca KOSONG oleh aplikasi walau barisnya
-- ada: katalog global memang HARUS punya policy baca publik.
--
-- File ini IDEMPOTENT (aman dijalankan ulang kapan pun):
--   1. create table if not exists + alter add column if not exists (tahan
--      drift bentuk vs tabel live yang dibuat migrasi yang hilang tadi),
--   2. unique index on platform_key (prasyarat ON CONFLICT),
--   3. RLS aktif + policy "Platform logos are publicly readable" (baca saja;
--      tulis tetap hanya lewat service_role/SQL Editor -- anon TIDAK bisa
--      menulis logo sembarangan),
--   4. grant select ke anon & authenticated,
--   5. seed 11 platform dengan logo_url SELF-HOSTED (icons/platforms/* --
--      di-serve dari origin yang sama dengan aplikasi: lolos CSP 'self',
--      tidak bergantung hotlink pihak ketiga, tetap tampil offline lewat SW)
--      memakai ON CONFLICT DO UPDATE supaya baris lama yang logo_url-nya
--      URL remote (rawan mati/404/hotlink-blokir) DIPERBAIKI menjadi path
--      lokal, dan is_active dipaksa true.
--
-- Verifikasi setelah Run (dari SQL Editor, jalankan sebagai postgres):
--   select platform_key, display_name, logo_url, is_active
--   from public.platform_logos order by display_name;
--   -- lalu cek policy:
--   select policyname, cmd from pg_policies where tablename = 'platform_logos';
-- ============================================================================

-- 1. Tabel + kolom (idempotent, tahan drift bentuk tabel live) -----------------
create table if not exists public.platform_logos (
    id           uuid primary key default gen_random_uuid(),
    platform_key text not null,
    display_name text not null,
    logo_url     text not null,
    source_url   text,
    is_active    boolean not null default true,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

alter table public.platform_logos add column if not exists id          uuid primary key default gen_random_uuid();
alter table public.platform_logos add column if not exists platform_key text;
alter table public.platform_logos add column if not exists display_name text;
alter table public.platform_logos add column if not exists logo_url     text;
alter table public.platform_logos add column if not exists source_url   text;
alter table public.platform_logos add column if not exists is_active    boolean not null default true;
alter table public.platform_logos add column if not exists created_at   timestamptz not null default now();
alter table public.platform_logos add column if not exists updated_at   timestamptz not null default now();

-- backfill platform_key dari display_name bila ada baris lama tanpa key
update public.platform_logos
set platform_key = lower(regexp_replace(trim(display_name), '[^a-z0-9]+', '-', 'g'))
where platform_key is null or platform_key = ''
  and display_name is not null;

alter table public.platform_logos alter column platform_key set not null;
alter table public.platform_logos alter column display_name set not null;
alter table public.platform_logos alter column logo_url set not null;

-- 2. Unique index utk ON CONFLICT (index memenuhi inferensi konflik) -----------
create unique index if not exists platform_logos_platform_key_key
    on public.platform_logos (platform_key);

-- 3. RLS + policy baca publik (KUNCI FIX "katalog terbaca kosong") ------------
alter table public.platform_logos enable row level security;

drop policy if exists "Platform logos are publicly readable" on public.platform_logos;
create policy "Platform logos are publicly readable"
    on public.platform_logos
    for select
    using (true);

-- 4. Grant baca utk peran klien Supabase ---------------------------------------
grant select on public.platform_logos to anon, authenticated;

-- 5. Seed katalog (self-hosted; upsert memperbaiki URL remote yang basi) -------
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

-- Catatan: IPOT (Indopremier) SENGAJA tidak di-seed di sini -- belum ada file
-- logo self-hosted yang terverifikasi; katalog lokal memakai badge "IP" dan
-- admin tetap bisa menambah baris IPOT sendiri dengan URL remote yang
-- diizinkan (host harus masuk ICON_REMOTE_HOSTS + CSP img-src).

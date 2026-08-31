-- ============================================================
-- Migrasi F1: inspeksi + DROP TERJAGA rls_auto_enable (2026-08-31)
-- ============================================================
-- Sumber temuan: docs/rls-grants-audit-2026-08-31.md §3 F1 & §6.
-- Migrasi sebelumnya (sql/migration_rls_hardening_2026-08-31.sql) MENAHAN drop
-- ini karena definisi tidak lolos blacklist-nya -- file ini adalah tindak lanjut
-- yang lebih baik: MENCETAK definisi lengkap, lalu drop hanya jika lolos
-- whitelist ketat, plus jalur drop manual yang jelas.
--
-- Status live saat file ini dibuat (probe 2026-08-31): fungsi MASIH muncul di
-- spec PostgREST service-role, signature TANPA argumen -> rls_auto_enable().
-- Anon tetap tertolak (fungsi tidak terlihat bagi anon). Tidak ada referensi
-- fungsi ini di repo/app mana pun (0 hasil pencarian kode).
--
-- Cara pakai: Dashboard > SQL Editor > New query > paste seluruh file > Run.
--   Langkah 1-2  : READ-ONLY (definisi + pola yang terdeteksi).
--   Langkah 3    : guarded drop -- hanya jatuh bila definisi memuat
--                  "enable row level security" DAN bebas seluruh pola
--                  berbahaya; kalau tidak lolos, DIPERTAHANKAN + alasan
--                  dicetak di pane Messages.
--   Langkah 4    : drop manual (baris terkomentar) bila setelah membaca
--                  definisi di pane Messages kamu yakin aman.
-- Aman untuk data: tidak menyentuh baris/policy/kolom/tabel apa pun.
-- Rollback: tidak diperlukan -- helper tak dipakai app; RLS yang sudah aktif
--   tetap aktif apa pun yang terjadi pada fungsi ini (fungsi hanya Pengaktif,
--   bukan status).

-- ---------- 1) Definisi lengkap (read-only) ----------
select p.oid::regprocedure as fungsi,
       p.prosecdef          as security_definer,
       pg_get_userbyid(p.proowner) as owner,
       pg_get_functiondef(p.oid) as definisi
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'rls_auto_enable';

-- ---------- 2) Pola terdeteksi (read-only, informasional) ----------
-- Baris yang muncul = kata/frasa berbahaya yang ADA di definisi.
-- Hasil KOSONG tidak menjamin apa pun sebaliknya -- selalu baca langkah 1.
with def as (
    select pg_get_functiondef(p.oid) as d
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
)
select v.pola as pola_terdeteksi
from def, (values
    ('disable row level security'),
    ('create policy'),
    ('drop policy'),
    ('grant '),
    ('revoke '),
    ('insert into'),
    ('delete from'),
    ('truncate'),
    ('drop table'),
    ('drop function'),
    ('drop schema'),
    ('alter role'),
    ('create role'),
    ('create table'),
    ('security bypass'),
    ('dblink'),
    ('pg_read_file'),
    ('pg_ls_dir'),
    ('lo_import'),
    ('lo_export'),
    ('copy ')
) as v(pola)
where def.d ilike '%' || v.pola || '%';

-- ---------- 3) Guarded drop ----------
do $$
declare
    v_def  text;
    v_hits text;
begin
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable';

    if v_def is null then
        raise notice 'F1: rls_auto_enable sudah tidak ada -- selesai, tidak ada yang perlu dilakukan.';
        return;
    end if;

    select string_agg(pola, ', ') into v_hits
    from unnest(array[
        'disable row level security','create policy','drop policy','grant ','revoke ',
        'insert into','delete from','truncate','drop table','drop function','drop schema',
        'alter role','create role','create table','security bypass','dblink',
        'pg_read_file','pg_ls_dir','lo_import','lo_export','copy '
    ]) as pola
    where v_def ilike '%' || pola || '%';

    if v_def ilike '%enable row level security%' and coalesce(v_hits, '') = '' then
        execute 'drop function if exists public.rls_auto_enable()';
        raise notice 'F1: LOLOS guard (definisi murni pengaktif RLS) -> fungsi DI-DROP.';
    else
        raise warning 'F1: DITAHAN GUARD. Pola terdeteksi: %',
            coalesce(nullif(v_hits, ''), '(tidak ada -- tapi definisi juga tidak memuat "enable row level security")');
        raise warning 'F1: Definisi lengkap utk review manual (lihat juga hasil langkah 1):';
        raise warning '%', v_def;
        raise warning 'F1: Bila setelah dibaca kamu yakin aman, jalankan satu baris drop manual di langkah 4.';
    end if;
end $$;

-- ---------- 4) Drop manual (HANYA setelah review definisi) ----------
-- drop function if exists public.rls_auto_enable();

-- ---------- 5) Verifikasi akhir (harus 0 baris setelah drop) ----------
select count(*) as sisa_rls_auto_enable
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'rls_auto_enable';

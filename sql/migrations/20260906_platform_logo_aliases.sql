-- Tambahan katalog logo untuk aset produk/holding yang umum dipakai user.
-- Jalankan setelah 20260906_platform_logos.sql.
--
-- v86: logo_url kedua platform ini kini SELF-HOSTED (icons/platforms/goto.svg
-- dan icons/platforms/danamas-stabil.png, diunduh dari sumber aslinya ke repo)
-- menggantikan hotlink remote -- URL remote Wikimedia/banksinarmas rawan mati,
-- diblokir hotlink, atau keluar dari daftar CSP img-src. File utama
-- 20260906_platform_logos.sql sudah meng-seed keduanya dengan path lokal;
-- file ini tetap dipertahankan sebagai CONTOH pola upsert katalog custom.

insert into public.platform_logos
  (platform_key, display_name, logo_url, source_url, is_active)
values
  (
    'goto', 'GoTo',
    'icons/platforms/goto.svg',
    'https://gotocompany.com/', true
  ),
  (
    'danamas-stabil', 'Danamas Stabil',
    'icons/platforms/danamas-stabil.png',
    'https://www.banksinarmas.com/id/personal/produk/reksadana/danamas-stabil&lang=en', true
  )
on conflict (platform_key) do update set
  display_name = excluded.display_name,
  logo_url = excluded.logo_url,
  source_url = excluded.source_url,
  is_active = excluded.is_active,
  updated_at = timezone('utc', now());

-- Verifikasi:
-- select platform_key, display_name, logo_url
-- from public.platform_logos
-- where platform_key in ('goto', 'danamas-stabil');

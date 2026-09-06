-- Tambahan katalog logo untuk aset produk/holding yang umum dipakai user.
-- Jalankan setelah 20260906_platform_logos.sql.

insert into public.platform_logos
  (platform_key, display_name, logo_url, source_url, is_active)
values
  (
    'goto', 'GoTo',
    'https://commons.wikimedia.org/wiki/Special:FilePath/GoTo%20logo.svg?download=1',
    'https://gotocompany.com/', true
  ),
  (
    'danamas-stabil', 'Danamas Stabil',
    'https://www.banksinarmas.com/id/public/revamp/logoj.png',
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

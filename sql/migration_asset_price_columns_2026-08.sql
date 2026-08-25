-- ============================================================================
-- MIGRASI: Kolom refresh harga otomatis aset (simbol, jumlah_unit, sumber_harga)
-- ============================================================================
-- KENAPA FILE INI ADA: index.html (fungsi addAssetRemote/editAssetRemote/fetchAssetsRemote,
-- lihat juga src/services/supabase/assets.js) dan Edge Function `refresh-asset-price` sudah
-- lama membaca & menulis 3 kolom ini di tabel `assets` -- fitur ini AKTIF di produksi
-- (refresh-asset-price ada di daftar 6 edge function ter-deploy, lihat AUDIT_REPORT_2026-08.md
-- §4.6). Tapi tidak ada satu pun file migrasi manapun di repo ini yang pernah membuat kolom
-- tersebut -- kemungkinan besar ditambahkan manual lewat Supabase Table Editor waktu itu,
-- bukan lewat SQL Editor, jadi tidak pernah tercatat di git. Ini sisi SQL dari celah yang sama
-- yang sudah ditemukan AUDIT_REPORT_2026-08.md utk source Edge Function-nya.
--
-- Kalau kolom-kolom ini SUDAH ada di database live Anda (kemungkinan besar begitu, kalau
-- fitur refresh harga otomatis sudah pernah dipakai): migrasi ini aman dijalankan ulang,
-- "add column if not exists" tidak menyentuh data yang sudah ada sama sekali.
--
-- Kalau BELUM ada (mis. setup baru dari sql/schema.sql dari nol): migrasi ini melengkapinya
-- supaya fitur refresh harga otomatis aset tidak error "column does not exist".
--
-- Cara pakai: SQL Editor -> New query -> paste seluruh isi file ini -> Run.

alter table public.assets add column if not exists simbol text;
alter table public.assets add column if not exists jumlah_unit numeric;
alter table public.assets add column if not exists sumber_harga text;

comment on column public.assets.simbol is
  'Kode ticker/simbol aset utk refresh harga otomatis (mis. "BTC", "BBCA.JK"). NULL = aset manual, tidak ikut auto-refresh.';
comment on column public.assets.jumlah_unit is
  'Jumlah unit/lot yang dimiliki, dipakai Edge Function refresh-asset-price utk menghitung ulang `nilai` dari harga terkini x jumlah_unit.';
comment on column public.assets.sumber_harga is
  'Sumber data harga (mis. "coingecko"), dipakai Edge Function refresh-asset-price utk tahu API mana yang harus dipanggil utk simbol ini.';

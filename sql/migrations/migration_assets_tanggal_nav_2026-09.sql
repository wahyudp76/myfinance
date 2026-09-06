-- sql/migration_assets_tanggal_nav_2026-09.sql
-- v41/v43: kolom tanggal NAB utk validasi jalur manual_nav di Edge Function.
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS tanggal_nav text;

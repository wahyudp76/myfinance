-- ============================================================
-- REFERENCE COPY (bukan migrasi!): event trigger ensure_rls
-- ============================================================
-- STATUS: SUDAH AKTIF di database live proyek uxfngmxgh (2026-08-31).
-- JANGAN menjalankan file ini -- ia hanya dokumentasi agar mekanisme ini
-- berhenti menjadi "fungsi tak terdokumentasi" (temuan F1 audit
-- docs/rls-grants-audit-2026-08-31.md). Menjalankan ulang tidak berbahaya
-- (CREATE OR REPLACE + event trigger sudah ada), tapi tidak diperlukan.
--
-- ASAL-USUL (penutup F1, 2026-08-31):
--   rls_auto_enable() muncul di spec PostgREST service-role tanpa ada di
--   repo -> dikira helper yatim. Saat di-drop manual, Postgres menolak:
--   "cannot drop function rls_auto_enable() because other objects depend
--   on it -- event trigger ensure_rls depends on function rls_auto_enable()"
--   Inspeksi via pg_event_trigger (hasil di audit doc) membuktikan fungsi
--   ini adalah JARING PENGAMAN: setiap CREATE TABLE / CREATE TABLE AS /
--   SELECT INTO di schema public OTOMATIS mendapat ENABLE ROW LEVEL
--   SECURITY. Inilah sebabnya seluruh 10 tabel live terbukti RLS aktif
--   saat audit. Tidak ada verb berbahaya (murni ALTER ... ENABLE RLS +
--   RAISE LOG), SECURITY DEFINER dgn search_path dipatok ke pg_catalog
--   (praktik higien utk event trigger), owner postgres.
--
-- KEPUTUSAN: DIPERTAHANKAN. F1 ditutup sebagai "by design". Jangan drop
--   kecuali kamu sengaja ingin tabel baru TIDAK otomatis ber-RLS.
--
-- Kalau suatu hari ingin melepasnya secara sadar (dua langkah, urutan penting):
--   drop event trigger if exists ensure_rls;
--   drop function if exists public.rls_auto_enable();
-- lalu tabel baru HARUS di-ALTER ENABLE ROW LEVEL SECURITY manual + policy.

-- ---------- Bentuk live (verbatin hasil pg_get_functiondef + pg_event_trigger) ----------
-- event trigger: name=ensure_rls  event=ddl_command_end  enabled=O(origin)
--   tags: CREATE TABLE, CREATE TABLE AS, SELECT INTO

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
      RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- (tidak ada statement CREATE EVENT TRIGGER di sini -- yang berlaku adalah
--  trigger live; membuatnya ulang butuh event trigger ddl_command_end
--  bernama ensure_rls yang memanggil fungsi di atas)

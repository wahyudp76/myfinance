-- ============================================================
-- Migrasi: RLS + Grants Hardening (tindak lanjut audit 2026-08-31)
-- ============================================================
-- Sumber temuan: docs/rls-grants-audit-2026-08-31.md (audit behavioral live).
-- Jalankan SEKALI lewat Supabase SQL Editor (Dashboard > SQL Editor > New query).
--
-- Isi (sesuai temuan audit):
--   F2 (LOW)  : whatsapp_link_codes.user_id kini punya default auth.uid()
--               seperti 6 tabel inti -- konsistensi; app tetap mengirim
--               user_id eksplisit, jadi TIDAK ada perubahan perilaku.
--   F3 (INFO) : anon tidak boleh mengeksekusi 3 RPC invoker
--               (create_recurring_transaction, create_transfer_transaction,
--               replace_month_budgets). Efeknya utk anon memang nol hari ini
--               (semua jalur data di dalamnya berujung RLS 42501), tapi ini
--               defense-in-depth -- pola grant-default yang sama pernah jadi
--               celah nyata di check_and_consume_rate_limit (lihat
--               sql/migration_rate_limiting_2026-08.sql). MENIRU PRESEDEN itu
--               persis: revoke dari public DAN anon (cukup revoke anon saja
--               TIDAK cukup -- anon otomatis anggota role PUBLIC), lalu grant
--               eksplisit ke authenticated + service_role supaya jalur app
--               (browser login & Edge Function) tidak pernah terputus.
--   F1 (LOW)  : drop function rls_auto_enable -- helper "aktifkan RLS semua
--               tabel" yang tidak ada di sql/ repo mana pun. DIBEKUKAN GUARD:
--               hanya di-drop bila definisinya benar-benar cuma memuat
--               'enable row level security' tanpa satu pun pola berbahaya;
--               kalau tidak lolos guard, migrasi TIDAK menghapusnya dan
--               mencetak definisinya utk review manual.
--
-- Aman utk data: tidak menyentuh baris apa pun, tidak mengubah policy RLS
-- yang ada, tidak mengubah kolom/tipe. Semua DDL di sini aditif atau
-- berupa pengaturan ulang GRANT function.

begin;

-- ---------- F2: default user_id konsisten dgn tabel inti ----------
alter table public.whatsapp_link_codes
    alter column user_id set default auth.uid();

-- ---------- F3: revoke execute anon (+public) di 3 RPC invoker ----------
-- DO block dinamis supaya tahan thd signature live (apa adanya di pg_proc),
-- termasuk kalau ada overload.
do $$
declare
    r      record;
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
        -- grant eksplisit DULU (jalur app tidak pernah terputus sesaat pun)
        execute format('grant execute on function %I.%I(%s) to authenticated, service_role',
                       r.nspname, r.proname, r.args);
        -- baru cabut dari public (anon anggotanya) lalu grant langsung anon
        execute format('revoke execute on function %I.%I(%s) from public',
                       r.nspname, r.proname, r.args);
        execute format('revoke execute on function %I.%I(%s) from anon',
                       r.nspname, r.proname, r.args);
        v_count := v_count + 1;
        raise notice 'F3: grant authenticated+service_role, revoke public+anon -> %.%(%s)',
                     r.nspname, r.proname, r.args;
    end loop;
    if v_count < 3 then
        raise warning 'F3: hanya % function ditemukan dari 3 nama -- periksa pg_proc bila ada nama yang hilang.', v_count;
    end if;
end $$;

-- ---------- F1: drop rls_auto_enable (hanya jika lolos guard) ----------
do $$
declare
    r record;
    v_blacklist text := 'disable row level security|create policy|drop policy|grant |revoke |insert into|delete from|truncate|drop table|drop function|alter role|create role|create table';
begin
    for r in
        select ns.nspname, p.proname, pg_get_functiondef(p.oid) as def,
               pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.proname = 'rls_auto_enable'
    loop
        if r.def ~* 'enable row level security' and r.def !~* v_blacklist then
            execute format('drop function %I.%I(%s)', r.nspname, r.proname, r.args);
            raise notice 'F1: rls_auto_enable di-drop -- definisi lolos guard (hanya ENABLE ROW LEVEL SECURITY).';
        else
            raise warning 'F1: rls_auto_enable TIDAK di-drop -- definisi tidak cocok dgn guard. Review manual definisi berikut lalu drop sendiri bila aman: %', r.def;
        end if;
    end loop;
    if not found then
        raise notice 'F1: rls_auto_enable tidak ditemukan (sudah tidak ada / sudah dihapus manual).';
    end if;
end $$;

commit;

-- ============================================================
-- VERIFIKASI PASCA-MIGRASI (jalankan di session SQL Editor baru)
-- ============================================================
-- 1) F1: harus 0 baris
--    select p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
--    where ns.nspname = 'public' and p.proname = 'rls_auto_enable';
--
-- 2) F2: default harus auth.uid()
--    select column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'whatsapp_link_codes' and column_name = 'user_id';
--
-- 3) F3: ketiganya harus f (anon tidak boleh execute)
--    select has_function_privilege('anon', 'public.create_recurring_transaction(uuid,date,text,numeric,text,text,text,text,numeric,numeric)', 'execute') as anon_recurring,
--           has_function_privilege('anon', 'public.create_transfer_transaction(date,numeric,text,text,text,text,numeric,numeric,text)', 'execute') as anon_transfer,
--           has_function_privilege('anon', 'public.replace_month_budgets(text,jsonb)', 'execute') as anon_budgets;
--    (catatan: has_function_privilege butuh signature persis; cara paling
--     simpel & menyeluruh: jalankan ulang scripts/rls-audit/rls-audit2.mjs --
--    ketiga RPC utk anon harus berubah jadi "permission denied for function".)

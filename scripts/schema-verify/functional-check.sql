-- ============================================================================
-- UJI FUNGSIONAL sql/schema.sql — SELF-ASSERTING
-- ============================================================================
-- Setiap cek MELEMPAR exception kalau hasilnya tidak sesuai, jadi file ini
-- cocok dipakai di CI: dijalankan dengan `psql -v ON_ERROR_STOP=1`, satu
-- kegagalan saja langsung membuat exit code non-nol.
--
-- Prasyarat: scripts/schema-verify/supabase-shim.sql lalu sql/schema.sql sudah
-- dijalankan di database yang sama. Lihat README.md di folder ini.
--
-- Aman dijalankan berulang: baris uji dibersihkan dulu di bagian PERSIAPAN.
-- ============================================================================

\echo ''
\echo '=== PERSIAPAN (sebagai superuser) ==='

-- Meniru Supabase: di sana role anon/authenticated otomatis dapat grant untuk
-- tabel baru di schema public. Postgres polos tidak, jadi diberikan manual.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.id'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.id')
on conflict do nothing;

-- Bersihkan sisa run sebelumnya supaya cek berbasis hitungan tetap akurat.
delete from public.transactions where user_id in (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
delete from public.budgets where user_id in (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
delete from public.api_rate_limits where user_id in (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

\echo '=== CEK 1-7 (sebagai role authenticated, RLS aktif) ==='

set role authenticated;
set request.role = 'authenticated';
set request.uid = '11111111-1111-1111-1111-111111111111';

do $$
declare
    v_count   integer;
    v_sum     numeric;
    v_row     public.transactions;
    v_id1     uuid;
    v_id2     uuid;
    v_ok      boolean;
    A constant uuid := '11111111-1111-1111-1111-111111111111';
    B constant uuid := '22222222-2222-2222-2222-222222222222';
begin
    -- CEK 1: isolasi RLS lintas user -------------------------------------------
    insert into public.transactions (jenis, tanggal, jumlah, akun, kategori)
    values ('Pengeluaran', current_date, 50000, 'BCA', 'Makanan');

    select count(*) into v_count from public.transactions;
    if v_count <> 1 then
        raise exception 'CEK 1a GAGAL: user A harusnya melihat 1 baris, dapat %', v_count;
    end if;

    perform set_config('request.uid', B::text, true);
    select count(*) into v_count from public.transactions;
    if v_count <> 0 then
        raise exception 'CEK 1b GAGAL (BOCOR!): user B melihat % baris milik user A', v_count;
    end if;
    perform set_config('request.uid', A::text, true);
    raise notice 'CEK 1 LULUS: RLS mengisolasi transaksi antar user';

    -- CEK 2: RPC replace_month_budgets ------------------------------------------
    perform public.replace_month_budgets('2026-09', '{"Makanan": 1500000, "Transport": 500000}'::jsonb);
    select count(*), coalesce(sum(jumlah), 0) into v_count, v_sum
    from public.budgets where bulan = '2026-09';
    if v_count <> 2 or v_sum <> 2000000 then
        raise exception 'CEK 2 GAGAL: harusnya 2 budget total 2.000.000, dapat % baris total %', v_count, v_sum;
    end if;
    -- panggilan kedua HARUS mengganti, bukan menumpuk (itu inti "replace")
    perform public.replace_month_budgets('2026-09', '{"Makanan": 100}'::jsonb);
    select count(*) into v_count from public.budgets where bulan = '2026-09';
    if v_count <> 1 then
        raise exception 'CEK 2b GAGAL: replace kedua harusnya menyisakan 1 baris, dapat %', v_count;
    end if;
    raise notice 'CEK 2 LULUS: replace_month_budgets mengganti (bukan menumpuk)';

    -- CEK 3: RPC create_transfer_transaction lintas mata uang -------------------
    -- USD 100 @16.000 -> IDR: nominal tujuan dihitung dari snapshot IDR,
    -- BUKAN menyalin angka 100 (regresi klasik "USD 100 jadi Rp 100").
    v_row := public.create_transfer_transaction(
        current_date, 100, 'Wise USD', 'BCA', 'USD', 'IDR', 16000, 1, 'tes transfer');
    if v_row.jumlah_idr <> 1600000 then
        raise exception 'CEK 3a GAGAL: jumlah_idr harusnya 1.600.000, dapat %', v_row.jumlah_idr;
    end if;
    if v_row.transfer_jumlah_tujuan <> 1600000 then
        raise exception 'CEK 3b GAGAL: nominal tujuan harusnya 1.600.000, dapat %', v_row.transfer_jumlah_tujuan;
    end if;
    raise notice 'CEK 3 LULUS: transfer USD 100 @16.000 -> Rp 1.600.000';

    -- CEK 4: idempotensi create_recurring_transaction ----------------------------
    v_id1 := (public.create_recurring_transaction(
        '33333333-3333-3333-3333-333333333333'::uuid, current_date,
        'Pengeluaran', 99000, 'BCA', 'Langganan', 'Netflix')).id;
    v_id2 := (public.create_recurring_transaction(
        '33333333-3333-3333-3333-333333333333'::uuid, current_date,
        'Pengeluaran', 99000, 'BCA', 'Langganan', 'Netflix')).id;
    if v_id1 is distinct from v_id2 then
        raise exception 'CEK 4a GAGAL: panggilan kedua membuat baris baru (% vs %)', v_id1, v_id2;
    end if;
    select count(*) into v_count from public.transactions
    where recurring_id = '33333333-3333-3333-3333-333333333333';
    if v_count <> 1 then
        raise exception 'CEK 4b GAGAL: harusnya 1 transaksi berulang, dapat % (dobel!)', v_count;
    end if;
    raise notice 'CEK 4 LULUS: create_recurring_transaction idempoten';

    -- CEK 5: check_and_consume_rate_limit ----------------------------------------
    for i in 1..3 loop
        v_ok := public.check_and_consume_rate_limit(A, 'tes', 3, 60);
        if not v_ok then
            raise exception 'CEK 5a GAGAL: panggilan ke-% harusnya masih diizinkan', i;
        end if;
    end loop;
    v_ok := public.check_and_consume_rate_limit(A, 'tes', 3, 60);
    if v_ok then
        raise exception 'CEK 5b GAGAL: panggilan ke-4 harusnya DITOLAK (limit 3)';
    end if;
    raise notice 'CEK 5 LULUS: rate limit menahan panggilan ke-4';

    -- CEK 5c: user tidak boleh menghabiskan jatah user lain -----------------------
    begin
        perform public.check_and_consume_rate_limit(B, 'tes', 3, 60);
        raise exception 'CEK 5c GAGAL: user A bisa mengisi rate limit milik user B';
    exception
        when raise_exception then
            if sqlerrm like 'CEK 5c GAGAL%' then raise; end if;  -- kegagalan asli, teruskan
    end;
    raise notice 'CEK 5c LULUS: rate limit user lain tidak bisa disentuh';

    -- CEK 6: api_rate_limits tertutup dari client ---------------------------------
    select count(*) into v_count from public.api_rate_limits;
    if v_count <> 0 then
        raise exception 'CEK 6 GAGAL (BOCOR!): client bisa membaca % baris api_rate_limits', v_count;
    end if;
    raise notice 'CEK 6 LULUS: api_rate_limits tidak terbaca dari client';

    -- CEK 7: katalog logo platform terbaca ----------------------------------------
    select count(*) into v_count from public.platform_logos where is_active;
    if v_count <> 11 then
        raise exception 'CEK 7 GAGAL: harusnya 11 logo aktif ter-seed, dapat %', v_count;
    end if;
    raise notice 'CEK 7 LULUS: 11 logo platform ter-seed & terbaca';
end $$;

reset role;

\echo '=== CEK 8-9 (hak eksekusi RPC: anon ditolak, authenticated diizinkan) ==='

-- CATATAN KENAPA TIDAK "COBA PANGGIL SEBAGAI ANON":
-- pendekatan itu memberi FALSE PASS. RPC-nya SECURITY INVOKER, jadi kalau anon
-- sempat masuk ke dalam body-nya, dia tetap kena permission denied di tabel
-- (mis. budgets) -- error yang PERSIS SAMA (insufficient_privilege) dengan
-- error "tidak boleh memanggil function". Terbukti saat uji negatif v96:
-- `grant execute ... to anon` sengaja ditambahkan, tapi cek berbasis panggilan
-- tetap hijau. Karena itu di sini hak aksesnya diperiksa LANGSUNG ke katalog.
do $$
declare
    r        record;
    v_count  integer := 0;
begin
    for r in
        select p.oid,
               p.proname,
               pg_get_function_identity_arguments(p.oid) as args,
               has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_boleh,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_boleh
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('create_recurring_transaction', 'create_transfer_transaction',
                            'replace_month_budgets', 'check_and_consume_rate_limit')
    loop
        -- CEK 8: anon (belum login) TIDAK boleh punya EXECUTE.
        -- has_function_privilege ikut memperhitungkan grant lewat PUBLIC, jadi
        -- "revoke dari anon saja" yang tidak menutup PUBLIC akan ketahuan.
        if r.anon_boleh then
            raise exception 'CEK 8 GAGAL (LUBANG KEAMANAN): anon punya EXECUTE di %(%)', r.proname, r.args;
        end if;
        -- CEK 9: jangan sampai kebablasan mencabut -- app pakai role ini.
        if not r.auth_boleh then
            raise exception 'CEK 9 GAGAL: authenticated TIDAK punya EXECUTE di %(%) -- fitur ini akan rusak di app', r.proname, r.args;
        end if;
        v_count := v_count + 1;
    end loop;

    if v_count <> 4 then
        raise exception 'CEK 8/9 GAGAL: harusnya memeriksa 4 RPC, yang ditemukan cuma %', v_count;
    end if;
    raise notice 'CEK 8 LULUS: anon tidak punya EXECUTE di keempat RPC';
    raise notice 'CEK 9 LULUS: authenticated tetap punya EXECUTE di keempat RPC';
end $$;

\echo ''
\echo '>>> SEMUA CEK LULUS'
\echo ''

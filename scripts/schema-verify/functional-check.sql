-- Uji fungsional sql/schema.sql di PostgreSQL sungguhan (lihat README.md di folder ini).
-- Meniru Supabase: auto-grant ke anon/authenticated untuk tabel di schema public.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;

-- dua user uji
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.id'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.id')
on conflict do nothing;

\echo '--- 1. ISOLASI RLS: user A insert, user B tidak boleh melihat ---'
set role authenticated;
set request.uid = '11111111-1111-1111-1111-111111111111';
set request.role = 'authenticated';
insert into public.transactions (jenis, tanggal, jumlah, akun, kategori)
values ('Pengeluaran', current_date, 50000, 'BCA', 'Makanan');
select count(*) as "baris_terlihat_oleh_A" from public.transactions;

set request.uid = '22222222-2222-2222-2222-222222222222';
select count(*) as "baris_terlihat_oleh_B_harus_0" from public.transactions;

\echo '--- 2. RPC replace_month_budgets (atomik) ---'
set request.uid = '11111111-1111-1111-1111-111111111111';
select public.replace_month_budgets('2026-09', '{"Makanan": 1500000, "Transport": 500000}'::jsonb);
select kategori, jumlah from public.budgets order by kategori;

\echo '--- 3. RPC create_transfer_transaction (beda mata uang) ---'
select (public.create_transfer_transaction(
    current_date, 100, 'Wise USD', 'BCA', 'USD', 'IDR', 16000, 1, 'tes transfer'
)).jumlah_idr as "jumlah_idr_harus_1600000";

\echo '--- 4. RPC create_recurring_transaction: dipanggil 2x, harus idempoten ---'
select (public.create_recurring_transaction(
    '33333333-3333-3333-3333-333333333333'::uuid, current_date,
    'Pengeluaran', 99000, 'BCA', 'Langganan', 'Netflix'
)).id as panggilan_1;
select (public.create_recurring_transaction(
    '33333333-3333-3333-3333-333333333333'::uuid, current_date,
    'Pengeluaran', 99000, 'BCA', 'Langganan', 'Netflix'
)).id as panggilan_2_id_harus_sama;
select count(*) as "baris_recurring_harus_1"
from public.transactions where recurring_id = '33333333-3333-3333-3333-333333333333';

\echo '--- 5. RPC check_and_consume_rate_limit: batas 3, panggilan ke-4 harus false ---'
select public.check_and_consume_rate_limit('11111111-1111-1111-1111-111111111111','tes',3,60) as ke1,
       public.check_and_consume_rate_limit('11111111-1111-1111-1111-111111111111','tes',3,60) as ke2,
       public.check_and_consume_rate_limit('11111111-1111-1111-1111-111111111111','tes',3,60) as ke3,
       public.check_and_consume_rate_limit('11111111-1111-1111-1111-111111111111','tes',3,60) as ke4_harus_false;

\echo '--- 6. api_rate_limits TIDAK boleh terbaca langsung dari client ---'
select count(*) as "baris_api_rate_limits_terlihat_harus_0" from public.api_rate_limits;

\echo '--- 7. katalog platform_logos harus terbaca ---'
select count(*) as "logo_aktif" from public.platform_logos where is_active;

reset role;

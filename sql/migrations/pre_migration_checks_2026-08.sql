-- MYFINANCE — PRE-MIGRATION INTEGRITY CHECKS (2026-08)
-- Read-only diagnostics. Safe to run in Supabase SQL Editor.
-- Run BEFORE the reliability/transfer migrations.
-- A result with zero rows is the desired outcome for duplicate checks.

-- 1) Historical recurring duplicates (should be zero once recurring_id fields
-- exist and historical rows have been backfilled; currently this is informational).
-- This query is intentionally commented because the columns may not exist yet.
--
-- select user_id, recurring_id, recurring_due_date, count(*) as duplicate_count
-- from public.transactions
-- where recurring_id is not null and recurring_due_date is not null
-- group by user_id, recurring_id, recurring_due_date
-- having count(*) > 1;

-- 2) Existing Transfer rows that use different account names. These are candidates
-- for manual review after the new target-leg fields are populated.
select
    id,
    tanggal,
    akun as akun_sumber,
    kategori as akun_tujuan,
    jumlah,
    mata_uang,
    jumlah_idr
from public.transactions
where jenis = 'Transfer'
order by tanggal desc, created_at desc
limit 100;

-- 3) Potential impossible monetary metadata.
select id, tanggal, jumlah, mata_uang, kurs, jumlah_idr
from public.transactions
where (jumlah < 0)
   or (kurs is not null and kurs <= 0)
   or (jumlah_idr is not null and jumlah_idr < 0)
limit 100;

-- 4) Budget duplicates are already prevented by the schema's unique constraint.
-- This is a defensive diagnostic only.
select user_id, bulan, kategori, count(*) as duplicate_count
from public.budgets
 group by user_id, bulan, kategori
 having count(*) > 1;

-- 5) Recurring templates with invalid schedule values.
select id, user_id, frequency, start_date, next_due_date, end_date, active
from public.recurring_transactions
where next_due_date is null
   or start_date is null
   or (end_date is not null and end_date < start_date)
limit 100;

-- IMPORTANT:
-- These checks are diagnostic only. Do not treat an empty result from one query
-- as proof that the whole migration is safe. The application write/read paths
-- must be deployed together with the database changes.

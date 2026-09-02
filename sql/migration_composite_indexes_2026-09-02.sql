-- ============================================================================
-- MIGRASI: index komposit untuk pola query utama app (v59, 2026-09-02)
-- ============================================================================
-- LATAR: semua query data app menyaring user_id (RLS PostgREST) lalu
-- mengurutkan hasilnya. Index single-column yang ada sebelumnya (lihat
-- sql/schema.sql: transactions_user_id_idx, dst) hanya membantu FILTER,
-- tidak dengan ORDER BY -- planner tetap butuh node "Sort" tambahan per
-- query (terbukti lewat EXPLAIN sebelum migrasi ini):
--   transactions:  Seq Scan + Sort (tanggal DESC, id)
--   assets:        Seq Scan + Sort (terakhir DESC, id)
--   recurring:     Index Scan (user_id) + Sort (next_due_date, id)
--
-- Index komposit di bawah meng-cover filter + urutan sekaligus. Kolom "id"
-- di ujung membuat index menjadi total order (stabil utk keyset pagination
-- bila suatu saat dipakai) dan meng-enable Index Only Scan.
--
-- TERAPKAN LIVE 2026-09-02 via Supabase Management API (database/query),
-- proyek uxfngmxghupdlwoeoxgh. Bukti EXPLAIN SETELAH index dibuat:
--   transactions:  Index Only Scan using transactions_user_tanggal_id_idx
--                  (Sort node HILANG; planner memilihnya pada 111 baris)
--   recurring:     Index Only Scan using recurring_user_next_due_id_idx
--                  (Sort node HILANG)
--   assets:        Seq Scan + Sort MASIH dipilih planner -- BENAR & disengaja:
--                  tabel baru 5 baris, seq scan memang lebih murah pada ukuran
--                  itu. Index terbukti VIABLE (dipakai saat seqscan dimatikan:
--                  Index Only Scan using assets_user_terakhir_id_idx) dan akan
--                  otomatis dipilih planner begitu tabel membesar.
--
-- Ukuran index saat ini: 16 kB + 16 kB + 8 kB (transaksi 111 baris) --
-- biaya penyimpanan bisa diabaikan; ini investasi future-proofing.
--
-- CATATAN: tidak memakai CREATE INDEX CONCURRENTLY karena tabel kecil
-- (indeks terbangun < 1 detik, lock sesaat tidak terasa). `if not exists`
-- membuat file ini aman dijalankan ulang.
-- ============================================================================

create index if not exists transactions_user_tanggal_id_idx
    on public.transactions (user_id, tanggal desc, id asc);

create index if not exists assets_user_terakhir_id_idx
    on public.assets (user_id, terakhir desc, id asc);

create index if not exists recurring_user_next_due_id_idx
    on public.recurring_transactions (user_id, next_due_date asc, id asc);

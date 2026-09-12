# Schema Contract Audit

> **⚠️ DOKUMEN HISTORIS — gap yang disebut di sini SUDAH DITUTUP (catatan 2026-09-12).**
> "Important migration gap" di bawah (kolom `mata_uang` / `kurs` / `jumlah_idr` tidak ada di
> `sql/schema.sql`) **sudah tidak berlaku sejak v95** (2026-09-07): `schema.sql` dikonsolidasi
> jadi benar-benar lengkap — 11 tabel + 4 RPC + 15 policy + 14 index, satu kali Run cukup,
> dan keempat RPC (`create_transfer_transaction`, `create_recurring_transaction`,
> `replace_month_budgets`, `check_and_consume_rate_limit`) kini terdefinisi di dalamnya
> byte-identical dengan migrasi kanoniknya.
>
> "Release rule" di bawah juga **sudah terpenuhi**: RPC transfer dipanggil produksi lewat
> `src/services/supabase/transfers.js`, dan smoke check pasca-migrasi dijalankan otomatis di
> CI oleh job `Schema install check (Postgres)` (`scripts/schema-verify/run.mjs` — install dari
> nol di Postgres 17 nyata, dua kali untuk membuktikan idempotensi, plus 10 cek perilaku
> termasuk "USD 100 @16.000 → Rp 1.600.000, bukan Rp 100").
> Kecocokan definisi RPC antara `schema.sql` dan `sql/migrations/` dijaga
> `tests/unit/sql-schema-completeness.test.js`.
>
> Daftar kolom `transactions` yang terkini ada di `sql/schema.sql` (baris ~63) — selain 9 kolom
> yang disebut di bawah, ada `mata_uang`, `kurs`, `jumlah_idr`, empat kolom sisi tujuan
> (`transfer_jumlah_tujuan`, `transfer_mata_uang_tujuan`, `transfer_kurs_tujuan`,
> `transfer_jumlah_tujuan_idr`), serta pasangan idempotensi `recurring_id` +
> `recurring_due_date`.

## Current database contract

The canonical schema currently defines `transactions` with `id`, `user_id`, `jenis`, `tanggal`, `jumlah`, `akun`, `kategori`, `keterangan`, and `created_at`. It also defines `budgets`, `assets`, `settings`, `custom_icons`, and `recurring_transactions` with user-scoped RLS.

## Important migration gap

The cross-currency migration adds `mata_uang`, `kurs`, and `jumlah_idr` usage inside `create_transfer_transaction()`, but the base schema shown in `sql/schema.sql` does not define those three transaction columns. The migration must therefore add/guard those columns before the RPC can be created successfully on a database initialized only from the current base schema.

## Application contract

The new service layer must not assume columns that are absent from the base schema. Currency-aware transaction fields are treated as a migration-gated capability until the final migration is applied.

## Release rule

Do not call the new transfer RPC from production UI until the final migration has successfully created every referenced column/function and the post-migration smoke checks pass.

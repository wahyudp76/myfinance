# Schema Contract Audit

## Current database contract

The canonical schema currently defines `transactions` with `id`, `user_id`, `jenis`, `tanggal`, `jumlah`, `akun`, `kategori`, `keterangan`, and `created_at`. It also defines `budgets`, `assets`, `settings`, `custom_icons`, and `recurring_transactions` with user-scoped RLS.

## Important migration gap

The cross-currency migration adds `mata_uang`, `kurs`, and `jumlah_idr` usage inside `create_transfer_transaction()`, but the base schema shown in `sql/schema.sql` does not define those three transaction columns. The migration must therefore add/guard those columns before the RPC can be created successfully on a database initialized only from the current base schema.

## Application contract

The new service layer must not assume columns that are absent from the base schema. Currency-aware transaction fields are treated as a migration-gated capability until the final migration is applied.

## Release rule

Do not call the new transfer RPC from production UI until the final migration has successfully created every referenced column/function and the post-migration smoke checks pass.

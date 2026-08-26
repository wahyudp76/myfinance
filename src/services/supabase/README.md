# Supabase service layer

The service layer is the only intended database boundary for the new frontend architecture.

- `client.js`: browser-safe Supabase client creation.
- `../transactions.js` (one directory up, not in this folder): transaction CRUD. Kept there
  for now to avoid a churny rename while it's actively changing; move it into this folder
  once it stabilizes, and delete this note.
- `transfers.js`: atomic transfer RPC + currency conversion preview.
- `recurring.js`: idempotent recurring RPC boundary.
- `budgets.js`: atomic monthly budget replacement.
- `settings.js`: get/save akun, kategori kustom, mata uang akun, tujuan keuangan, dan
  utang/cicilan -- semuanya 1 JSON blob per user (tabel `settings`).
- `custom-icons.js`: ikon/logo kustom per akun (tabel `custom_icons`).
- `assets.js`: CRUD portofolio aset/investasi, termasuk kolom refresh harga otomatis
  (tabel `assets`).

No service-role credentials belong in this directory. Privileged operations must use Edge Functions or secure database RPCs.

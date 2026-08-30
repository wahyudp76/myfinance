# Probe Audit RLS + Grants (behavioral)

Alat audit utk laporan `docs/rls-grants-audit-2026-08-31.md`. Berjalan
langsung terhadap proyek Supabase live dan TIDAK mengubah data user
sungguhan — insersi uji memakai baris milik user audit sementara yang
dibuat lewat Admin API lalu dihapus (FK cascade). Laporan ronde 1 di
`rls-audit.mjs` (matriks tabel), ronde 2 di `rls-audit2.mjs` (RPC & guard
SECURITY DEFINER), ronde 3 di `rls-audit3-verify-hardening.mjs`
(verifikasi pasca `sql/migration_rls_hardening_2026-08-31.sql`).

## Cara menjalankan

```bash
export SUPABASE_URL="https://<ref>.supabase.co"
export SUPABASE_ANON_KEY="<anon key>"
export SUPABASE_SERVICE_KEY="<service role key>"   # sensitif!

node scripts/rls-audit/rls-audit.mjs   > hasil1.json
node scripts/rls-audit/rls-audit2.mjs  > hasil2.json
```

Butuh `crypto.randomUUID` (Node >= 19) dan global `fetch` (Node >= 18).

## Catatan penting

- Kedua skrip membersihkan diri sendiri; ronde 1 juga menyapu user audit
  terbengkalai dari run yang gagal di tengah (pre-sweep `rls-audit-*@audit.local`).
- Verifikasi pasca-run: jumlah baris tiap tabel via service key harus sama
  dgn sebelum audit, dan `?code=like.rls-audit-*` / `?action=eq.rls-audit-test`
  harus kosong.
- `rls-audit2.mjs` memanggil RPC dgn argumen valid — efek sampingnya hanya
  baris rate-limit action `rls-audit-test` milik user audit (ikut tersapu).
- Jangan pernah commit key. Jalankan ulang setiap ada perubahan policy/SQL.

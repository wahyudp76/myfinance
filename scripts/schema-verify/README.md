# Verifikasi `sql/schema.sql` di PostgreSQL sungguhan

Harness manual (TIDAK dijalankan CI, tidak butuh dependensi npm) untuk
membuktikan bahwa `sql/schema.sql` benar-benar bisa memasang project baru dari
nol — bukan sekadar "kelihatannya lengkap kalau dibaca".

Dipakai pertama kali di **v95**, saat ketahuan `schema.sql` tidak memuat satu
pun RPC padahal aplikasi memanggil 4 (lihat entri v95 di `AGENT-HANDOFF.md`).

## Isi

| File | Guna |
|---|---|
| `supabase-shim.sql` | Meniru bagian Supabase yang tidak ada di Postgres polos: role `anon`/`authenticated`/`service_role`, schema+tabel `auth.users`, dan `auth.uid()`/`auth.role()` yang dibaca dari GUC `request.uid`/`request.role` (bisa diganti per sesi untuk mensimulasikan user berbeda). |
| `functional-check.sql` | Uji perilaku: isolasi RLS lintas user, ke-4 RPC (termasuk idempotensi `create_recurring_transaction` & batas `check_and_consume_rate_limit`), `api_rate_limits` tidak terbaca client, katalog logo terbaca. |

## Cara pakai

```bash
# 1. Postgres lokal (contoh Debian/Ubuntu; versi 14+ cukup)
sudo apt-get install -y postgresql
export PATH=/usr/lib/postgresql/17/bin:$PATH
initdb -D /tmp/pgdata -U postgres --auth=trust
mkdir -p /tmp/pgsock
pg_ctl -D /tmp/pgdata -o "-k /tmp/pgsock -p 5433 -c listen_addresses=''" -l /tmp/pg.log start

PSQL="psql -h /tmp/pgsock -p 5433 -U postgres -v ON_ERROR_STOP=1"

# 2. Database bersih + shim
$PSQL -c "create database newdb;"
$PSQL -q -d newdb -f scripts/schema-verify/supabase-shim.sql

# 3. INSTALASI: satu kali Run, harus tanpa error
$PSQL -q -d newdb -f sql/schema.sql

# 4. IDEMPOTENSI: jalankan lagi, juga harus tanpa error
$PSQL -q -d newdb -f sql/schema.sql

# 5. Uji fungsional
$PSQL -d newdb -f scripts/schema-verify/functional-check.sql
```

Hasil yang diharapkan di langkah 5 (persis seperti verifikasi v95):

```
baris_terlihat_oleh_A            = 1     (user lain: 0  -> RLS mengisolasi)
replace_month_budgets            = void, 2 baris budget tersimpan
jumlah_idr_harus_1600000         = 1600000   (USD 100 @ 16.000)
panggilan_1 / panggilan_2        = id SAMA, baris_recurring_harus_1 = 1
ke1..ke3 = t, ke4_harus_false    = f
baris_api_rate_limits_terlihat   = 0
logo_aktif                       = 11
```

## Membandingkan dengan struktur produksi

Untuk memastikan `schema.sql` menghasilkan struktur yang setara dengan database
live (schema lama + seluruh migrasi):

```bash
pg_dump -h /tmp/pgsock -p 5433 -U postgres -s --no-owner --no-privileges -d newdb \
  | grep -v '^--' | grep -v '^$' > /tmp/dump-new.sql
# bangun database pembanding dari git show HEAD~:sql/schema.sql + sql/migrations/*
# lalu: diff /tmp/dump-ref.sql /tmp/dump-new.sql
```

Catatan v95: membangun database pembanding itu **butuh 2 langkah manual** yang
tidak terdokumentasi di file migrasi mana pun — `drop function
public.replace_month_budgets(text, jsonb)` sebelum
`migration_reliability_hardening_2026-08.sql`, dan membuat stub tabel
`public.rate_limits` sebelum `rls_performance_fix.sql`. Itu justru bukti kenapa
jalur "schema lama + semua migrasi" tidak layak dipakai untuk instalasi baru.

## Batasan

Shim ini **bukan** Supabase sungguhan: tidak ada GoTrue, PostgREST, maupun
grant otomatis ke `anon`/`authenticated` untuk tabel baru di schema `public`
(karena itu `functional-check.sql` memberi grant itu sendiri). Yang diuji di
sini adalah kebenaran DDL, RLS, isi RPC, dan grant function — bukan perilaku
end-to-end lewat REST.

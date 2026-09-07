# Verifikasi `sql/schema.sql` di PostgreSQL sungguhan

Membuktikan bahwa `sql/schema.sql` benar-benar bisa memasang project baru dari
nol — bukan sekadar "kelihatan lengkap kalau dibaca".

Sejak **v96** ini berjalan otomatis di CI sebagai job **`Schema install check
(Postgres)`** (`.github/workflows/parity.yml`): hermetic, memakai container
`postgres:17-alpine`, tanpa secrets, tanpa menyentuh database produksi — jadi
ikut jalan di pull_request termasuk PR Dependabot.

Dipakai pertama kali di **v95**, saat ketahuan `schema.sql` tidak memuat satu
pun RPC padahal aplikasi memanggil 4 (lihat entri v95 di `AGENT-HANDOFF.md`).

## Isi

| File | Guna |
|---|---|
| `run.mjs` | Runner (tanpa dependensi npm, cuma butuh biner `psql`): bikin database kosong → shim → `schema.sql` **2x** → uji fungsional. Exit code non-nol kalau ada yang gagal. Inilah yang dipanggil CI. |
| `supabase-shim.sql` | Meniru bagian Supabase yang tidak ada di Postgres polos: role `anon`/`authenticated`/`service_role`, schema + tabel `auth.users`, dan `auth.uid()`/`auth.role()` yang dibaca dari GUC `request.uid`/`request.role` (bisa diganti per sesi untuk mensimulasikan user berbeda). |
| `functional-check.sql` | 10 cek perilaku, **self-asserting** (tiap cek `raise exception` kalau meleset, jadi `ON_ERROR_STOP=1` cukup untuk menggagalkan CI). |

## Yang diuji

| # | Cek |
|---|---|
| — | `schema.sql` jalan bersih di database KOSONG |
| — | dijalankan **dua kali** tetap bersih (idempoten) |
| — | jumlah objek terpasang = 11 tabel / 4 function / 15 policy |
| 1 | Isolasi RLS: user B tidak bisa melihat baris user A |
| 2 | `replace_month_budgets` **mengganti** isi bulan, bukan menumpuk |
| 3 | `create_transfer_transaction`: USD 100 @16.000 → Rp 1.600.000 (bukan Rp 100) |
| 4 | `create_recurring_transaction` idempoten: dipanggil 2x → id sama, 1 baris |
| 5 | `check_and_consume_rate_limit`: batas 3 → panggilan ke-4 ditolak |
| 5c | user tidak bisa menghabiskan jatah rate limit user lain |
| 6 | `api_rate_limits` tidak terbaca dari client |
| 7 | 11 logo platform ter-seed & terbaca |
| 8 | `anon` **tidak** punya EXECUTE di keempat RPC |
| 9 | `authenticated` **tetap** punya EXECUTE (jangan kebablasan mencabut) |

## Menjalankan lokal

```bash
# 1. Postgres lokal (contoh Debian/Ubuntu; versi 14+ cukup)
sudo apt-get install -y postgresql
export PATH=/usr/lib/postgresql/17/bin:$PATH
initdb -D /tmp/pgdata -U postgres --auth=trust
mkdir -p /tmp/pgsock
pg_ctl -D /tmp/pgdata -o "-k /tmp/pgsock -p 5433 -c listen_addresses=''" -l /tmp/pg.log start

# 2. satu perintah saja
PGHOST=/tmp/pgsock PGPORT=5433 PGUSER=postgres node scripts/schema-verify/run.mjs
```

Variabel yang dibaca: `PGHOST` (default `127.0.0.1`), `PGPORT` (`5432`),
`PGUSER` (`postgres`), `PGPASSWORD`, dan `SCHEMA_CHECK_DB` (nama database
sekali-pakai, default `myfinance_schema_check` — dibuat & dihapus sendiri).

Keluaran saat sehat:

```
  OK    INSTALASI: sql/schema.sql di database kosong
  OK    IDEMPOTENSI: sql/schema.sql dijalankan ulang
  OK    objek terpasang lengkap (tabel/function/policy = 11/4/15)
  OK    uji fungsional (10 cek)
HASIL: SEMUA LULUS
```

## Pelajaran dari uji negatif (v96) — jangan diulang

Harness ini sendiri sudah diuji dengan sengaja merusak `schema.sql`:

| Kerusakan yang disuntik | Hasil |
|---|---|
| satu RPC dihapus | merah (install + jumlah objek + fungsional) |
| policy dibocorkan jadi `using (true)` | merah (CEK 1b: "user B melihat 1 baris milik user A") |
| `grant execute ... to anon` | merah (CEK 8) |
| `revoke execute ... from authenticated` | merah (CEK 9) |

Skenario ketiga awalnya **LOLOS (false pass)** waktu CEK 8 masih berupa "coba
panggil RPC sebagai anon". Sebabnya: RPC-nya `SECURITY INVOKER`, jadi anon yang
berhasil masuk ke body-nya tetap kena `permission denied` di tabel — kode error
yang **persis sama** (`insufficient_privilege`) dengan penolakan hak eksekusi.
Karena itu CEK 8/9 sekarang membaca `has_function_privilege()` langsung dari
katalog. **Kalau menambah cek keamanan baru di sini, uji dulu bahwa cek itu
benar-benar bisa merah** — cek yang tidak pernah gagal cuma stempel hijau palsu.

## Batasan

Shim ini **bukan** Supabase sungguhan: tidak ada GoTrue, PostgREST, maupun
grant otomatis ke `anon`/`authenticated` untuk tabel baru di schema `public`
(karena itu `functional-check.sql` memberi grant itu sendiri di bagian
persiapan). Yang diuji di sini adalah kebenaran DDL, RLS, isi RPC, dan grant
function — bukan perilaku end-to-end lewat REST.

## Membandingkan dengan struktur produksi

```bash
pg_dump -h /tmp/pgsock -p 5433 -U postgres -s --no-owner --no-privileges \
  -d myfinance_schema_check | grep -v '^--' | grep -v '^$' > /tmp/dump-new.sql
# bangun database pembanding dari git show <rev>:sql/schema.sql + sql/migrations/*
# lalu: diff /tmp/dump-ref.sql /tmp/dump-new.sql
```

Catatan v95: membangun database pembanding itu **butuh 2 langkah manual** yang
tidak terdokumentasi di file migrasi mana pun — `drop function
public.replace_month_budgets(text, jsonb)` sebelum
`migration_reliability_hardening_2026-08.sql`, dan membuat stub tabel
`public.rate_limits` sebelum `rls_performance_fix.sql`. Itu justru bukti kenapa
jalur "schema lama + semua migrasi" tidak layak dipakai untuk instalasi baru.

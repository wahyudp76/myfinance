# Audit RLS + Grants — Seluruh Tabel (2026-08-31)

Lingkup: **10 tabel** dan **5 RPC** di schema `public`, proyek Supabase live
(`uxfngmxgh…supabase.co`). Metode: **audit behavioral** — probe HTTP langsung
ke REST/PostgREST memakai 3 konteks (anon key, JWT user sementara, service
role key). Tidak ada data user sungguhan yang diubah; semua insersi uji
memakai baris milik user audit sendiri dan dibersihkan habis (verifikasi
akhir: jumlah baris per tabel identik sebelum/sesudah audit, sisa junk = 0).

Alat: `scripts/rls-audit/` (ronde 1: matriks tabel; ronde 2: RPC & guard).
User audit dibuat lewat Admin API lalu dihapus (FK `on delete cascade`
membersihkan barisnya).

## 1. Matriks RLS per tabel (hasil live)

| Tabel | Baris* | RLS aktif | anon baca | user baru baca | insert milik sendiri | insert user_id orang lain | update/delete milik sendiri |
|---|---:|---|---|---|---|---|---|
| transactions | 105 | ✅ | 0 baris | 0 baris | 201 | **42501** | 200 / 204 |
| budgets | 33 | ✅ | 0 baris | 0 baris | 201 | **42501** | 200 / 204 |
| assets | 3 | ✅ | 0 baris | 0 baris | 201 | **42501** | 200 / 204 |
| settings | 4 | ✅ | 0 baris | 0 baris | 201 (PK user_id) | **42501** | 200 / 204 |
| custom_icons | 17 | ✅ | 0 baris | 0 baris | 201 | **42501** | 200 / 204 |
| recurring_transactions | 0 | ✅ | 0 baris | 0 baris | 201 | **42501** | 200 / 204 |
| api_rate_limits | 2 | ✅ **tanpa policy (by design)** | 0 baris | 0 baris | **42501** (benar: tertutup rapat) | **42501** | n/a (sengaja tanpa akses langsung) |
| rate_limits | 0 | ✅ | 0 baris + insert anon **42501** | 0 baris | 201 | 42501 | 201→bersih |
| whatsapp_link_codes | 12 | ✅ | 0 baris | 0 baris | 201 (**dengan user_id eksplisit**) | **42501** | n/a (policy hanya insert+select) |
| whatsapp_links | 0 | ✅ | 0 baris + insert anon **42501** | 0 baris | **42501** (by design: hanya Edge Function) | **42501** | delete policy ada (tak diuji baris — tabel kosong) |

\* jumlah global via service key (pembanding): user terautentikasi baru
melihat **0 baris** di semua tabel padahal total global 105/33/17/… → isolasi
lintas user terbukti. `42501` = RLS violation dari Postgres.

Catatan desain yang terverifikasi sesuai dokumentasi SQL:
- `api_rate_limits` sengaja tanpa policy (satu-satunya jalan masuk: RPC
  SECURITY DEFINER / service role) — terkunci total dari browser ✅.
- `whatsapp_links` sengaja tanpa policy INSERT utk authenticated (klaim nomor
  hanya boleh lewat verifikasi Edge Function) ✅.
- `rate_limits` adalah tabel legacy cooldown AI-chat yang SENGAJA dipertahankan
  (dipakai `analyze-finance`, lihat `sql/migration_rate_limiting_2026-08.sql`
  header) — RLS aktif + policy "own" hidup ✅.

## 2. Matriks RPC / grants (hasil live)

| RPC | Keamanan | anon | authenticated | Bukti |
|---|---|---|---|---|
| `check_and_consume_rate_limit` | DEFINER + 2 guard | **permission denied** (revoke live) | user_id sendiri → `true`; user_id orang lain → `P0001 "Tidak boleh memeriksa/mengisi rate limit milik user lain."` | guard `auth.role()` & `auth.uid()<>p_user_id` TERBUKTI hidup |
| `create_recurring_transaction` | INVOKER | execute ada, tapi insert ke transactions **42501 RLS** | jalur app normal (snake_case, dipakai `src/services/supabase/recurring.js`) | aman via RLS |
| `create_transfer_transaction` | INVOKER | sama — **42501 RLS** di dalam | jalur app normal | aman via RLS |
| `replace_month_budgets` | INVOKER | execute ada; body jalan, kena validasi input/RLS | jalur app normal | aman via RLS |
| `rls_auto_enable` | ? (tidak ada di repo) | **permission denied** | tidak diuji (lihat temuan F1) | hanya service role |

## 3. Temuan

**F1 — `rls_auto_enable`: RPC tak terdokumentasi di live DB** (severity: LOW,
verifikasi disarankan). Muncul di spec service role, tidak ada di `sql/`
mana pun. Eksekusi anon sudah tertolak (42501). Kemungkinan helper
"aktifkan RLS semua tabel" yang pernah dijalankan lewat SQL Editor.
Tindak lanjut (jalankan di Dashboard → SQL Editor):

```sql
select p.proname, pg_get_functiondef(p.oid), p.prosecdef
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'rls_auto_enable';
-- kalau isinya sesuai ekspektasi (hanya ALTER ... ENABLE ROW LEVEL SECURITY):
-- drop function public.rls_auto_enable();
```

**F2 — `whatsapp_link_codes.user_id` tanpa `default auth.uid()`** (severity:
LOW, kosmetik/konsistensi). Satu-satunya tabel user-facing yang user_id-nya
TIDAK punya default; app mengirim `user_id` eksplisit (index.html, insert
kode WA) jadi tidak ada bug — hanya inkonsisten dengan 6 tabel inti. Opsional:

```sql
alter table public.whatsapp_link_codes alter column user_id set default auth.uid();
```

**F3 — anon masih memegang EXECUTE di 3 RPC invoker** (severity: INFO /
defense-in-depth). `create_recurring_transaction`,
`create_transfer_transaction`, `replace_month_budgets` bisa DIPANGGIL anon
(efeknya nol — semua jalur data berujung RLS 42501, terbukti). Supabase
memberi grant anon otomatis utk function baru di `public` (perilaku yang
sama yang sempat jadi celah di `check_and_consume_rate_limit` dan sudah
direvoke di sana). Opsional, meniru perlakuan rate-limit RPC:

```sql
revoke execute on function public.create_recurring_transaction(uuid,date,text,numeric,text,text,text,text,numeric,numeric) from anon;
revoke execute on function public.create_transfer_transaction(date,numeric,text,text,text,text,numeric,numeric,text) from anon;
revoke execute on function public.replace_month_budgets(text,jsonb) from anon;
```
(cek signature via `\df` / query `pg_proc` sebelum menjalankan.)

**F4 — privilese tabel default utk anon** (severity: INFO). anon punya grant
SELECT/INSERT dst. level tabel (default Supabase); baris dilindungi RLS dan
introspeksi root `/rest/v1/` utk anon sudah 401. Tidak ada aksi wajib;
mencabut privilese anon level tabel adalah hardening opsional (harus hati-hati
agar tidak mematahkan alur auth).

## 4. Kesimpulan

- **Isolasi lintas user: TERBUKTI PENUH** — 0 kebocoran baca/tulis di 10 tabel.
- **RLS aktif di seluruh tabel**, termasuk dua tabel terkunci total by design.
- **RPC DEFINER rate-limit**: guard kepemilikan + larangan anon hidup di live.
- Tidak ditemukan celah kritis/sedang. Temuan = 1 verifikasi dok (F1) + 3
  opsional hardening/konsistensi (F2–F4).

Basis acuan niat desain: `sql/schema.sql`, `sql/rls_performance_fix.sql`,
`sql/migration_{rate_limiting,whatsapp,reliability_hardening,transfer_currency}_2026-08.sql`.
Untuk menjalankan ulang audit: lihat `scripts/rls-audit/README.md`.

## 5. Tindak lanjut

Temuan F1–F3 telah dibekukan jadi migrasi siap-jalankan:
**`sql/migration_rls_hardening_2026-08-31.sql`** — F1 drop `rls_auto_enable`
dengan guard keamanan (hanya jika definisinya benar-benar sekadar pengaktif
RLS), F2 `default auth.uid()` di `whatsapp_link_codes.user_id`, F3 revoke
execute anon **dan public** + grant eksplisit `authenticated, service_role`
di 3 RPC invoker (meniru preseden `check_and_consume_rate_limit`).

Setelah migrasi dijalankan, verifikasi dengan menjalankan ulang
`scripts/rls-audit/rls-audit2.mjs`: ketiga RPC invoker utk anon harus
berubah dari "RLS violation di dalam" menjadi **"permission denied for
function"**, dan jalur app (authenticated) tetap normal.

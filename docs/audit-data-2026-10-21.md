# Audit Data & Stabilitas — 2026-10-21 (v140)

Audit menyeluruh atas **kebenaran data antara Supabase dan web**, kualitas
sinkronisasi, potensi bug, stabilitas, dan performa. Semua angka di bawah adalah
hasil perintah yang benar-benar dijalankan pada tanggal itu, bukan perkiraan.
Klaim yang tidak bisa diverifikasi dari lingkungan ini ditandai
**[belum diverifikasi]**.

---

## 1. Batas yang harus jujur diakui

| Yang diinginkan | Bisa dijalankan di sini? | Alasan |
|---|---|---|
| Bandingkan data web vs **database produksi** | **TIDAK** | `tests/parity/transactions-live.test.js` keluar `process.exit(0)` bila `SUPABASE_URL`/`SUPABASE_ANON_KEY` tidak ada. Tidak ada kredensial di lingkungan ini. |
| `drift-check` mode **produksi** | **TIDAK** | butuh `SUPABASE_PROJECT_REF` + token; katalog produksi tidak terjangkau. |
| Bandingkan web vs **Postgres dengan skema & RLS asli** | **YA** | PostgreSQL 17 lokal + `scripts/schema-verify/supabase-shim.sql` + `sql/schema.sql`. Inilah yang dikerjakan. |

**Temuan struktural (penting):** karena uji parity live otomatis SKIP, job CI
`parity` bisa **hijau terus tanpa pernah membandingkan apa pun** — `npm run
test:parity` mencetak `# pass 1` bahkan tanpa database. Itu "hijau yang tidak
berarti". Ditutup sebagian oleh harness hermetik baru (§2) yang kini ikut CI.

---

## 2. Harness baru: `scripts/verify-data-parity.mjs` (20 cek, semua LULUS)

PostgreSQL 17 + skema asli + grant default ala Supabase + **RLS aktif**
(`role=authenticated` + GUC `request.uid`). Data uji sengaja memuat kasus yang
paling sering membuat angka web melenceng: valuta asing + kurs, tanggal di
awal/akhir bulan, transaksi bulan lalu & dua bulan lalu, transfer antar akun,
dan baris milik user lain.

| Kelompok | Cek | Hasil |
|---|---|---|
| Isolasi RLS | U1 hanya melihat 10 barisnya; U2 hanya 2; tidak ada kebocoran | 3 LULUS |
| Tingkat baris | `mapTransactionRow()` → tanggal/jenis/`jumlah_idr` = kata SQL (10 baris) | 2 LULUS |
| Valuta asing | 120,50 USD × 16.250 = 1.958.125 | 1 LULUS |
| Agregat | `totalIn` 21.691.563 · `totalOut` 3.831.625 · `monthIn` 13.691.563 · `monthOut` 2.331.625 · `monthTxCount` 6 · per kategori (3) · per bulan (3) · saldo per akun (2) | 9 LULUS |
| Transfer | tidak masuk `monthIn`/`monthOut` di kedua sisi | 3 LULUS |
| Kontrak mata uang | saldo akun ≠ ekuivalen IDR; saldo = kata SQL | 2 LULUS |
| Data kotor | angka sebagai teks, `jumlah_idr` null, tanggal kosong, `jenis` huruf kecil, `jumlah` bukan angka → tanpa exception, tanpa NaN, fallback ke `jumlah` benar | 3 LULUS |

**Kontrol negatif (harness-nya menggigit):** saat `src/domain/dashboard.js`
dimutasi memakai `amtIdr` untuk saldo akun, harness **2 CEK GAGAL**; setelah
dipulihkan, semua lulus.

### Dua hal yang harness ini luruskan (mudah salah di kemudian hari)

1. **Saldo akun memakai `jumlah` (mata uang akun itu sendiri), BUKAN
   `jumlah_idr`.** Dugaan pertama saya — bahwa saldo harus ekuivalen IDR —
   menghasilkan selisih Rp 3.733.208,25 pada akun BCA. Kode menegaskan ini
   memang desain (`src/domain/dashboard.js`: *"amt = NATIVE (mata uang akun itu
   sendiri) — dipakai HANYA utk saldo per-akun"*), sedangkan semua total
   gabungan lintas akun/kategori memakai `jumlah_idr`.
2. **`monthlyMap` berkunci label bulan Indonesia** (`"Okt 2026"`), bukan
   `"YYYY-MM"`. Perbandingan awal saya gagal karena mengira formatnya ISO.

Keduanya bukan bug produk; keduanya sekarang dikunci oleh uji agar tidak
"diperbaiki" secara keliru di masa depan.

---

## 3. Skema & integritas database

`scripts/schema-verify/run.mjs` (PostgreSQL 17 lokal):

- `sql/schema.sql` terpasang bersih **dan idempoten** (dijalankan dua kali).
- Objek lengkap: **11 tabel / 5 fungsi / 15 policy**.
- **12 cek fungsional LULUS**, termasuk: RLS mengisolasi transaksi antar user;
  `replace_month_budgets` mengganti (bukan menumpuk); transfer USD 100 @16.000 →
  Rp 1.600.000; `create_recurring_transaction` idempoten; rate limit menahan
  panggilan ke-4; `api_rate_limits` tidak terbaca dari client; `anon` tidak
  punya EXECUTE di keempat RPC.

**Kesimpulan:** tidak ditemukan cacat skema. Yang belum bisa dipastikan dari
sini adalah apakah **database produksi** masih identik dengan `sql/schema.sql`
(butuh `drift-check` mode produksi — lihat §1).

---

## 4. Stabilitas (semua dijalankan ulang hari ini)

| Pemeriksaan | Hasil |
|---|---|
| `npm run lint` | **0 masalah** |
| `npm run test:unit` | **1006/1006 lulus** |
| `npm run test:parity` | 1 lulus — **live SKIP** (lihat §1) |
| `schema-verify` | semua lulus (12 cek fungsional) |
| `verify-data-parity` (baru) | **20/20 lulus** |
| E2E 10 harness browser | **244 PASS / 0 gagal** — hud 70, asset-logos 17, applock 21, applock-biometric 14, applock-rpid 31, offline-cache 13, ui-actions 39, csp 17, ui-sweep 9, budget-notify 13 |
| pageerror selama pengukuran | **0** (bench 2 skala + seluruh harness) |

---

## 5. Performa terkini (`scripts/bench-load-sync.mjs`, CPU 4× throttle, SW mati)

Pengukuran **satu run** — untuk keputusan optimasi wajib diulang 3× dan diambil
median (pelajaran dari v138: satu run bisa meleset ±30%).

| metrik | 2.500 baris | 20.000 baris |
|---|---|---|
| shell terlihat (paint) | 727 ms | 667 ms |
| data cloud ter-commit | 2.368 ms | 3.540 ms |
| satu `loadData()` penuh | 875 ms | 2.521 ms |
| `filterTransactions()` | 415,1 ms | **875,2 ms** |
| `processDataForUI()` | 171,3 ms | 412 ms |
| `renderRecentList()` | 30,4 ms | 159,7 ms |

Perbaikan v138 (seleksi jendela alih-alih sortir penuh) tetap terlihat:
`renderRecentList` 159,7 ms pada 20.000 baris, dibanding 286,2 ms sebelum
perbaikan. **Biaya render terbesar kini `filterTransactions` (875,2 ms pada
20.000 baris)** — kandidat optimasi berikutnya, tetapi ia memang membutuhkan
seluruh daftar terurut untuk ditampilkan, jadi tidak bisa diperlakukan seperti
`renderRecentList`.

---

## 6. Yang direkomendasikan selanjutnya

1. **Jalankan `verify-data-parity` terhadap data produksi sekali** (dengan
   kredensial read-only) — harness ini hermetik, tapi nilai terbesarnya adalah
   membuktikan data NYATA Anda sehat. **[belum diverifikasi]**
2. **Rotasi token**: GitHub PAT dan token Supabase `sbp_` pernah tertempel di
   chat. Ini satu-satunya temuan berisiko nyata yang belum ditutup.
3. **`filterTransactions`** (875 ms @ 20.000 baris) — **sudah diselidiki di v141**:
   ternyata 77% biayanya pembangunan DOM, bukan sortir (filter waktu default
   hanya menyortir subset 30 hari). Kandidat optimasi berikutnya adalah DOM,
   bukan data. `renderRecentList` sudah dipercepat −22% di v141.
4. **Migrasi `migration_tx_order_index_2026-09-15.sql`** belum ke produksi
   **[belum diverifikasi]**.

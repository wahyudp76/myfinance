# Audit performa: jalur LOAD & SYNC data (2026-09-15, v127)

Lingkup: seberapa cepat aplikasi **memuat** data dari Supabase saat dibuka, dan
seberapa cepat ia **menyinkronkan** ulang (pull-to-refresh, refresh pasca-CRUD,
buka tab). Fokus pada angka terukur, bukan perkiraan.

Status ringkas:

| Perubahan | Status | Bukti |
|---|---|---|
| Index `(user_id, tanggal desc, created_at desc, id asc)` untuk `transactions` | ✅ diterapkan di `sql/schema.sql` + migrasi | EXPLAIN ANALYZE, Postgres 17.11 |
| Guard CI: urutan `ORDER BY` service ↔ index komposit (3 tabel) | ✅ `tests/unit/service-order-index-contract.test.js` | uji kontrol negatif ikut di dalamnya |
| `animateRupiah`: `textContent` menggantikan `innerText` | ✅ `app.src.js` (+ rebuild `app.js`) | micro A/B di harness |
| Harness benchmark load & sync yang bisa diulang | ✅ `scripts/bench-load-sync.mjs` | — |
| Helper `sortTxRows` (lewati `.sort()` bila sudah terurut) | ❌ **DIBATALKAN** — terukur lebih lambat | micro A/B |
| Menghapus `PUT settings` yang diduga terjadi tiap sync | ❌ **tidak diperlukan** — terukur 0 kali | mata-mata `persistSettings` |
| Keyset pagination (ganti `LIMIT/OFFSET`) | ❌ **DIBATALKAN** — klaim 3,1× tidak lolos A/B terkontrol (terukur 0,32× lewat HTTP) | bagian 7 (koreksi 2026-09-16) |
| Render chart sebelum shell tampil (~200 ms) | 📋 temuan baru, tunggu keputusan produk | bagian 7.2 |
| Delta/incremental sync (payload 8,6 MB → kecil) | 📋 rekomendasi, butuh perubahan skema | bagian "Lever berikutnya" |

---

## 1. Cara mengukur (supaya angka bisa diulang)

Dua alat, karena dua sisi bottleneck-nya berbeda.

**Sisi browser — `scripts/bench-load-sync.mjs`** (baru). Memuat aplikasi
sungguhhan (`index.html` + `app.js` + `boot.bundle.js`) di Chromium headless
dengan Supabase yang di-stub lewat Playwright route: tanpa rahasia, tanpa
kuota, tanpa jaringan luar. Service worker dimatikan (`serviceWorkers: "block"`)
supaya cache tidak mencemari antar-run, CPU di-throttle 4× (konvensi yang sama
dengan catatan profil v114), viewport ponsel 390×844. Yang diukur: waktu boot,
waktu satu `loadData()` penuh, waktu `refreshTransactionsOnly()`, biaya fungsi
render besar, jumlah request REST + byte payload. Tiga mode tambahan:
`BENCH_PROFILE=1` (pembungkus pencatat waktu di sekeliling fungsi app),
`BENCH_MICRO=1` (A/B terisolasi, 7–15 pengulangan), `BENCH_ROWS`/`BENCH_LATENCY_MS`.

Stub-nya meniru PostgREST secara nyata: halaman lewat query param `offset`/
`limit` (begitulah supabase-js 2.113 mengirimnya — **bukan** header `Range`),
total baris lewat header `Content-Range`, dan header itu harus ikut
`Access-Control-Expose-Headers` supaya terlihat oleh JS lintas-origin. Tanpa
yang terakhir, `count` terbaca `null` dan `fetchAllRows` jatuh ke fallback loop
berurutan tanpa ujung — jebakan yang bikin pengukuran pertama harness ini
menghasilkan ratusan request dan tidak pernah selesai.

**Sisi database — PostgreSQL 17.11 sungguhan** (bukan perkiraan). Skema dipasang
dari `sql/schema.sql` apa adanya (lewat `scripts/schema-verify/supabase-shim.sql`),
diisi **515.000 baris milik 100 user**, user yang diukur punya 20.000 transaksi
(= 20 halaman @1.000 baris per tarikan penuh). Query yang di-explain adalah
PERSIS yang dikirim `list()`, termasuk 15 kolom select-nya.

---

## 2. Temuan: urutan `ORDER BY` tidak lagi cocok dengan index

`src/services/transactions.js` meminta:

```
.order("tanggal", desc).order("created_at", desc).order("id", asc)
```

Index komposit yang ada (`migration_composite_indexes_2026-09-02.sql`) adalah
`(user_id, tanggal desc, id asc)` — dibuat saat urutannya masih
`(tanggal desc, id asc)`. `created_at` disisipkan ke query belakangan, index-nya
tidak ikut. Karena tidak ada error apa pun, regresi ini tidak terlihat: yang
terjadi hanya planner menambahkan node `Incremental Sort` di setiap halaman.

**Terukur** (median 5 run):

| | sebelum | sesudah (index baru) |
|---|---|---|
| halaman pertama (offset 0) | 1,814 ms | **1,053 ms** |
| halaman ke-10 (offset 9000) | 22,626 ms | 20,482 ms |
| halaman ke-20 (offset 19000) | 26,981 ms | 26,775 ms |
| total satu tarikan penuh | 410,8 ms | 399,7 ms (1,03×) |
| node `Sort` di rencana | ada (`Incremental Sort`) | **hilang** |

Jujur soal skalanya: keuntungan totalnya kecil (3%) karena biaya tarikan penuh
didominasi pola `LIMIT/OFFSET` dan fetch heap, bukan sortirnya. Yang benar-benar
membaik: halaman pertama (1,7× — dan halaman pertama itulah yang paling sering
terjadi, karena mayoritas akun muat <1.000 transaksi) dan hilangnya CPU+memori
sortir per halaman.

> **Peringatan untuk yang membaca riwayat:** pengukuran pertama perubahan ini
> memakai tabel 20.000 baris yang semuanya milik SATU user dan menghasilkan
> angka **2,7×**. Angka itu salah dan jangan dikutip. Pada tabel satu-user
> planner malah memilih `transactions_tanggal_idx` (backward scan) sehingga
> index baru tidak dipakai sama sekali; pada tabel multi-user node Sort memang
> murah karena `Presorted Key: tanggal`. Bentuk data uji menentukan
> kesimpulannya — itu sebabnya bagian ini diukur ulang pada 515.000 baris/100 user.

**Bagian yang paling berharga bukan index-nya, melainkan penjaganya.**
`tests/unit/service-order-index-contract.test.js` kini membandingkan urutan
`ORDER BY` di ketiga service (`transactions`, `assets`,
`recurring_transactions`) dengan index komposit di `sql/schema.sql`. Uji itu
sudah dibuktikan bisa merah: ketika index baru dihapus dari `schema.sql`, test
`transactions` gagal dengan pesan yang menyebutkan index mana saja yang ada;
ketika dipasang kembali, 6/6 lulus.

---

## 3. Di mana waktu habis di sisi browser

Profil satu `loadData()` penuh, 2.500 transaksi, CPU 4× (total **704 ms**):

| fungsi | panggilan | ms | % |
|---|---|---|---|
| `processDataForUI` | 1× | 248,2 | 35% |
| ↳ `animateRupiah` (di dalamnya) | 4× | 86,1 | 12% |
| `renderRecentList` | 1× | 44,6 | 6% |
| `renderSettings` | 1× | 22,2 | 3% |
| `aggregateDashboardData` | 1× | 19,2 | 3% |
| sisanya (insights, sparkline, dll.) | — | <5 masing-masing | — |

Angka end-to-end (median 3–5 run, dan **bising** — variasinya ±50 ms antar-run):

| metrik | 300 transaksi | 2.500 transaksi |
|---|---|---|
| boot → appShell tampil | 1.523 ms | 1.655 ms |
| boot → data cloud ter-commit | 1.685 ms | 1.901 ms |
| satu `loadData()` penuh | 536 ms | 649–792 ms |
| `refreshTransactionsOnly()` | 249 ms | 90–188 ms |
| `filterTransactions()` | 96,2 ms | 268–379 ms |
| `processDataForUI()` | 127,5 ms | 134–152 ms |
| request REST saat boot | 3× transactions + 6 tabel lain | sama |
| payload transaksi | ~130 KB | **1.078,5 KB** |

Dua kesimpulan yang menentukan prioritas:

1. **Untuk akun tipikal (ratusan transaksi), data BUKAN bottleneck.** Dari
   1.685 ms boot, hanya ~162 ms yang bertambah antara "appShell tampil" dan
   "data ter-commit". Sisa ~1,5 s adalah HTML+CSS+JS (parse/eksekusi
   `app.js` 271 KB + `boot.bundle.js` 158 KB + vendor) di CPU 4× throttle.
   Kunjungan kedua dan seterusnya melewati unduhan berkat precache SW.
2. **Untuk akun berat, payload-lah bottleneck-nya.** 2.500 transaksi = 1,08 MB
   JSON mentah per tarikan penuh; 20.000 transaksi ≈ 8,6 MB. Itu diunduh ulang
   setiap pull-to-refresh dan setiap refresh pasca-CRUD, lalu di-parse dan
   dipetakan baris demi baris di JS.

Biaya render terbesar bukan agregasi melainkan **parse HTML**: menetapkan ulang
string `innerHTML` tabel transaksi (151 baris = 284 KB HTML) terukur **363,5 ms**,
sementara sortir 2.500 baris hanya **21,1 ms**. Artinya memangkas jumlah baris
per halaman atau menyederhanakan markup per baris jauh lebih berpengaruh
daripada mengutak-atik algoritma di sekitarnya.

---

## 4. Yang dibatalkan karena pengukurannya berkata lain

**a) Helper `sortTxRows` (lewati `.sort()` bila baris sudah terurut).**
Idenya masuk akal di atas kertas: hasil `list()` sudah terurut server, dan
comparator-nya mahal. Sudah sempat diimplementasikan di
`src/domain/transactions.js` + 4 call site di `app.src.js`. A/B terisolasi
(median 7 run) membatalkannya:

| kasus | `[...rows].sort()` | helper | simpulan |
|---|---|---|---|
| 2.500 baris, sudah terurut | 10,8 ms | **16,8 ms** | lebih lambat |
| 20.000 baris, sudah terurut | 171,7 ms | 176,3 ms | tidak beda |
| 20.000 baris, dikocok | 503,3 ms | 460,0 ms | dalam derau |

Sebabnya: TimSort di V8 **sudah** mendeteksi run terurut dalam O(n), jadi
`.sort()` pada array terurut memang murah; helper itu hanya menambah satu pass
O(n) di atasnya. Pada 300 transaksi biaya sortirnya 0,1 ms. Perubahan
dikembalikan seluruhnya (tidak ada kode mati yang ditinggal).

**b) `PUT settings` yang diduga terjadi tiap sync.** Profil jaringan harness
menunjukkan entri `settings(w)` saat boot, yang terlihat seperti tulis ulang
tiap sync. Mata-mata pada `persistSettings` + `syncAccountsFromTransactions`
pada satu `loadData()` penuh: **0 panggilan** (`accSync.added` dan
`shadowNames` dua-duanya kosong). Tidak ada yang perlu diperbaiki.

**c) `animateRupiah` — dipertahankan, tapi klaimnya dikoreksi.** Profil
menunjukkan 86,1 ms untuk 4 panggilan, dan itu sempat terbaca sebagai "biaya
`innerText`". A/B terisolasi pada 4 elemen dashboard yang sama berkata lain:
versi `innerText` 1,1 ms vs `textContent` 0 ms. Jadi 86 ms itu bukan biaya
`innerText` itu sendiri, melainkan *forced synchronous layout* — baca
`innerText` memaksa browser menyelesaikan layout dari semua penulisan DOM
dashboard yang belum sempat di-layout. Mengganti ke `textContent` (semua
elemen target berisi teks polos, diverifikasi satu per satu di `index.html`)
menghapus paksaan itu; keuntungannya nyata secara mekanisme tapi **di dalam
derau pengukuran** pada angka end-to-end, jadi tidak diklaim sebagai kemenangan
besar.

---

## 5. Lever berikutnya (terukur, belum dikerjakan)

Diurutkan menurut dampak pada akun berat.

**1. Delta/incremental sync — dampak terbesar.** Tarikan penuh mengunduh ulang
SELURUH riwayat: 1,08 MB pada 2.500 transaksi, ≈8,6 MB pada 20.000 transaksi,
setiap kali. Padahal satu pull-to-refresh biasanya tidak mengubah apa pun.
Butuh perubahan skema (kolom `updated_at` + trigger, dan tombstone atau
mekanisme lain untuk menangkap DELETE) plus rekonsiliasi dengan
`_pendingTxMutations` yang sudah ada (v119). Ini pekerjaan terpisah yang
layak dirancang dulu; risikonya ada di kebenaran data, bukan di performa.

**2. Keyset pagination — 3,1× di sisi server.** `fetchAllRows` memakai
`LIMIT/OFFSET`, sehingga halaman ke-N menelusuri index dari awal lagi (biaya
tumbuh mendekati kuadratik). Diukur pada tabel yang sama, query identik
(15 kolom), satu query per halaman, 20 halaman:

| pola | waktu satu tarikan penuh |
|---|---|
| `LIMIT/OFFSET` (sekarang) | 278 ms |
| keyset (kursor `(tanggal, created_at, id)`) | **91 ms** (3,1×) |

Index baru di bagian 2 adalah prasyaratnya (keyset butuh index yang persis
meng-cover urutan). Kontrak `buildQuery(from, to, opts)` di
`src/services/supabase/paging.js` harus diperluas jadi berbasis kursor, dan
ketiga pemanggilnya (`transactions`, `assets`, `recurring_transactions`) punya
kolom urutan berbeda — jadi butuh konfigurasi kursor per tabel plus uji yang
membuktikan hasilnya identik dengan paging offset.

**3. Bobot app shell — paling terasa untuk akun tipikal.** ~1,5 s dari 1,7 s
boot adalah HTML+CSS+JS, bukan data. Kandidat: memecah `app.js` (271 KB) per
view sehingga tab yang tidak dibuka tidak ikut di-parse saat boot. Sudah
searah dengan `docs/architecture-modernization-plan.md` Phase 4.

**4. Biaya render tabel transaksi.** 363,5 ms untuk 151 baris (284 KB HTML).
Menurunkan `TX_LIST_PAGE_SIZE` (150) atau menyederhanakan markup per baris
akan memotongnya hampir linear — keduanya keputusan produk/desain, bukan
sekadar teknis.

---

## 6. Cara mengulang pengukuran ini

```bash
# sisi browser (butuh playwright + chromium terpasang)
node scripts/bench-load-sync.mjs                       # angka ringkas
BENCH_ROWS=20000 node scripts/bench-load-sync.mjs      # akun berat
BENCH_PROFILE=1 node scripts/bench-load-sync.mjs       # profil per fungsi
BENCH_MICRO=1 node scripts/bench-load-sync.mjs         # A/B terisolasi
BENCH_JSON=hasil.json node scripts/bench-load-sync.mjs # simpan hasil mentah

# sisi database (butuh biner psql + server Postgres lokal)
node scripts/schema-verify/run.mjs                     # schema.sql pasang bersih
node scripts/schema-verify/drift-check.mjs --check     # katalog vs snapshot
node --test tests/unit/service-order-index-contract.test.js
```

Harness sengaja TIDAK dipasang di CI: angka waktunya bergantung mesin, sehingga
menjadikannya gate hanya akan melahirkan tes flaky. Fungsinya alat ukur lokal —
sama seperti `scripts/bench-save-latency.mjs`.

---

## 7. Koreksi & lanjutan (2026-09-16, v129)

Bagian ini menambah pengukuran yang MEMBATALKAN satu rekomendasi di atas dan
mengoreksi satu kesimpulan. Aturannya sama: optimasi yang terbantahkan
pengukuran dibatalkan total, bukan disimpan sebagai "mungkin nanti".

### 7.1 Keyset pagination DITOLAK (klaim 3,1× di bagian 5 tidak bertahan)

**Lingkungan uji (baru, bukan angka lama):** PostgreSQL 17.10 + PostgREST 12.2.3
lokal, database berisi **515.000 baris / 100 user** dengan **20.000 baris** milik
user target (skala yang sama dengan bagian 2). Akses lewat HTTP PostgREST
sungguhan memakai JWT HS256 (`auth.uid()` dibaca dari klaim `sub`), jadi RLS
aktif persis seperti produksi — bukan query `psql` langsung.

Urutan yang diuji: `tanggal desc, created_at desc, id asc`, page size 100,
kursor `(tanggal, created_at, id)`.

**Lewat HTTP, user 5.000 baris / 50 halaman, median 5 run:**

| pola | waktu | catatan |
|---|---|---|
| `LIMIT/OFFSET` berurutan | 112,1 ms | 50 request |
| `LIMIT/OFFSET` paralel 6 (**yang dipakai app sekarang**) | **55,1 ms** | `MAX_PARALLEL_PAGES=6` |
| keyset berurutan | 174,1 ms | 51 request, tidak bisa diparalelkan |

Keyset menghasilkan **urutan baris yang identik** dan **0 duplikat** (diperiksa
baris demi baris terhadap hasil offset) — jadi ini murni soal performa, bukan
kebenaran. Tapi ia **0,32×** dibanding pola sekarang, karena keyset mengharuskan
halaman diambil berurutan sedangkan klien sekarang menarik 6 halaman sekaligus.

**Lewat SQL, per halaman, median 5 run (kedalaman 0–19.900):**

| kondisi | kedalaman | OFFSET | keyset | rasio |
|---|---|---|---|---|
| dengan index v127 | 10.000 | 1,58 ms | 1,86 ms | 0,85× |
| dengan index v127 | 19.900 | 1,73 ms | 2,22 ms | 0,78× |
| **tanpa** index v127 | 10.000 | 4,55 ms | 2,90 ms | 1,57× |
| **tanpa** index v127 | 19.900 | 9,06 ms | 0,55 ms | 16,38× |

**Akar kekeliruan angka lama:** index covering
`(user_id, tanggal desc, created_at desc, id asc)` yang dipasang di v127 sudah
menyerap seluruh keuntungan keyset — dengan index itu, lompatan OFFSET jadi
murah karena ter-cover index. Angka "278 → 91 ms (3,1×)" di bagian 5
membandingkan OFFSET **tanpa** index melawan keyset **dengan** index, jadi
keuntungannya berasal dari index, bukan dari keyset.

**Keputusan:** `src/services/supabase/paging.js` TIDAK diubah, tidak ada
perubahan skema, tidak ada migrasi. Satu-satunya manfaat keyset yang tersisa
adalah stabilitas kursor saat ada tulis bersamaan (halaman tidak bergeser);
efeknya di app ini kecil karena tarikan penuh diulang tiap sync dan baris
dipetakan berdasarkan `id`.

### 7.2 Komposisi biaya boot — koreksi atas kesimpulan bagian 3

Angka harness (300 transaksi, CPU 4×, SW mati, median 3 run):

| metrik | CPU 4× | CPU 1× |
|---|---|---|
| boot → appShell tampil | 1.734 ms | 524 ms |
| boot → data cloud ter-commit | 1.993 ms | 555 ms |

Boot jelas **CPU-bound** (throttle 4× memperlambat 3,3×). Tapi biaya itu BUKAN
parse skrip. Trace CDP (kategori `devtools.timeline` + `v8`, median 3 load)
menunjukkan `EvaluateScript` per berkas:

| berkas | EvaluateScript | v8.compile |
|---|---|---|
| `app.js` (265 KB) | 9,7 ms | 0,8 ms |
| `index.html` (skrip inline) | 3,6 ms | 0,4 ms |

Profil CPU fase boot (navigasi → `#appShell` terlihat; sampel 2.445 ms,
appShell 2.303 ms karena overhead profiler):

| fungsi | ms | % |
|---|---|---|
| `(program)` — parse HTML/CSS + layout/paint | 1.119,4 | 45,8% |
| `Ya` @ `boot.bundle.js` | 126,5 | 5,2% |
| Chart.js (`xe` + anonymous + `update` + `draw`) | ~200 | ~8% |
| `renderCategoryTree` @ `app.js` | 19,8 | 0,8% |
| `processDataForUI` @ `app.js` | 17,8 | 0,7% |
| `renderRecentList` @ `app.js` | 13,9 | 0,6% |

Dua koreksi/kesimpulan:

1. Klaim bagian 3 poin 1 ("~1,5 s adalah HTML+CSS+JS parse/eksekusi `app.js`
   271 KB + `boot.bundle.js` 158 KB") **keliru di bagian "parse"**: biaya
   parse/compile skrip hanya ~10 ms. Yang mahal adalah pekerjaan browser atas
   DOM+CSS (45,8%) dan eksekusi render.
2. Karena itu **memecah `app.js` per view (rekomendasi bagian 5 poin 3) tidak
   akan banyak menolong** — yang dihemat hanya sebagian dari ~10 ms parse.
   Tuas yang nyata: (a) memangkas DOM/CSS yang ikut diparse & di-layout saat
   boot (puluhan modal tersembunyi di `index.html`), dan (b) menunda render
   chart sampai setelah shell tampil (~200 ms). Keduanya menyentuh
   perilaku/UX, jadi menunggu keputusan produk.

### 7.3 Cara mengulang pengukuran bagian 7

```bash
# SQL: butuh PostgreSQL lokal + PostgREST 12.2.3 (biner di /tmp/postgrest)
#   db-uri -> database hasil scripts/schema-verify + 515.000 baris/100 user
#   jwt-secret diisi, auth.uid() dibaca dari klaim 'sub'
#   bandingkan: offset berurutan / offset paralel 6 / keyset berurutan
#   lalu ulangi per kedalaman dengan & tanpa index
#   transactions_user_tanggal_createdat_id_idx (drop di dalam transaksi + rollback)

# Browser
BENCH_CPU=1 node scripts/bench-load-sync.mjs   # pembanding tanpa throttle
BENCH_CPU=4 node scripts/bench-load-sync.mjs   # angka utama
# EvaluateScript per berkas & profil boot: CDP Tracing + Profiler di Chromium
# (skrip sekali pakai, sengaja tidak disimpan ke repo)
```

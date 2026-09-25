# Audit menyeluruh + cek stabilitas + bug performa — 2026-09-17 (v133)

Melanjutkan `docs/maintenance-2026-09-17.md` (v132, pemeriksaan rutin). Audit ini
menambah tiga hal yang belum tercakup di sana: **menjalankan kesembilan harness
E2E**, **menganalisis jalur terpanas akun berat**, dan **mencari bug/inefisiensi
yang terkuantifikasi**. Semua angka di bawah hasil pengukuran, bukan perkiraan.

Lingkungan: Node v22.23.2, PostgreSQL 17.11, Chromium headless 151 (Playwright
1.62.1), server statis `python3 -m http.server 8123`, CPU 4× untuk angka browser.

## 1. Stabilitas — hasil pemeriksaan

| Pemeriksaan | Cakupan | Hasil |
|---|---|---|
| `verify-hud.mjs` | 70 cek HUD dashboard + Rekomendasi AI | **hijau** (exit 0) |
| `verify-asset-logos.mjs` | 17 cek logo platform aset | **17 PASS / 0 FAIL** |
| `verify-applock.mjs` | 21 cek kunci aplikasi + pengingat | **hijau** (exit 0) |
| `verify-applock-biometric.mjs` | 14 cek biometrik multi-perangkat | **hijau** (exit 0) |
| `verify-applock-rpid.mjs` | 31 cek RP ID + pindah domain | **hijau** (exit 0) |
| `verify-offline-cache.mjs` | 13 cek cache data offline | **hijau** (exit 0) |
| `verify-ui-actions.mjs` | 39 cek aksi UI deklaratif | **hijau** (exit 0) |
| `verify-csp.mjs` | 17 cek Content-Security-Policy | **hijau** (exit 0) |
| `verify-ui-sweep.mjs` | 9 cek sapu permukaan aksi | **hijau** (exit 0) |
| Unit + parity + lint | 973 unit, 1 parity | **973/973, 1/1, lint 0** |
| Skema + drift katalog | CEK 1–9, katalog vs snapshot | **SEMUA LULUS / IDENTIK** |
| Error runtime (harness beban) | 300 / 2.500 / 20.000 transaksi | **0 pageerror** di ketiganya |

Kesembilan harness butuh server statis di `:8123` dan variabel URL-nya sendiri
(`HUD_URL`, `APPLOCK_URL`, `OFFLINE_URL`, `UIACT_URL`, `CSP_URL`, `SWEEP_URL`);
tanpa itu semuanya gagal dengan `ERR_CONNECTION_REFUSED` — di CI server itu
dinyalakan lebih dulu, jadi kegagalan itu artefak lingkungan lokal, bukan cacat.

## 2. Performa saat ini (median, CPU 4×, SW mati, latensi stub 0)

| metrik | 300 tx | 2.500 tx | 20.000 tx |
|---|---|---|---|
| shell terlihat (paint) | 806 ms | 899 ms | 953 ms |
| data cloud ter-commit | 2.396 ms | 3.416 ms | 4.497 ms |
| `loadData()` penuh | 681 ms | 1.036 ms | 3.314 ms |
| `filterTransactions()` | 147,5 ms | 452,2 ms | 634,6 ms |
| `processDataForUI()` | 240,6 ms | 251,6 ms | 306,2 ms |
| `renderRecentList()` | 35,8 ms | 55,1 ms | **394,7 ms** |
| sortir `[...globalData].sort(txServerCompare)` | 1,8 ms | 33,7 ms | **302,3 ms** |
| payload transaksi per tarikan penuh | 129,1 KB | 1.078,5 KB | **8.645,4 KB** |

## 3. Temuan audit: satu inefisiensi nyata, terkuantifikasi

**`renderRecentList()` mengurutkan ulang SELURUH dataset untuk menampilkan 10
baris.** Baris pertama fungsi itu:

```js
let sortedData = [...data].sort(txServerCompare);
```

lalu hanya `slice(pageStart, pageStart + RECENT_TRANSACTIONS_PAGE_SIZE)` yang
dipakai, dan `RECENT_TRANSACTIONS_PAGE_SIZE = 10`. Fungsi ini dipanggil dari 4
tempat. Baris "SORT" di `scripts/bench-load-sync.mjs` mengukur persis pekerjaan
yang sama (`[...globalData].sort(txServerCompare)`), sehingga porsinya bisa
dihitung langsung:

| ukuran data | `renderRecentList` | porsi sortir | % |
|---|---|---|---|
| 300 tx | 35,8 ms | 1,8 ms | 5% |
| 2.500 tx | 55,1 ms | 33,7 ms | 61% |
| 20.000 tx | 394,7 ms | **302,3 ms** | **77%** |

Jadi pada akun berat, tiga perempat biaya "daftar 10 transaksi terakhir" adalah
sortir O(n log n) atas 20.000 baris — dan biaya itu dibayar ulang di setiap
pemanggilan.

**Kenapa tidak langsung saya perbaiki di audit ini:** ini persis optimasi yang
sudah pernah dicoba dan DIBATALKAN di v127 (helper `sortTxRows` yang melewati
`.sort()` bila data sudah terurut). Pengukuran saat itu: 10,8 ms
(`[...rows].sort()`) vs 16,8 ms (helper) — helper lebih lambat karena
pemeriksaan "sudah terurut?" sendiri berjalan O(n) memakai pembanding yang
mahal, sementara TimSort V8 sudah mendeteksi data terurut dengan sangat murah.
Mengulang perubahan yang sama tanpa pengukuran baru akan melanggar aturan repo
ini (optimasi yang terbantahkan pengukuran dibatalkan, bukan dicoba lagi).

Dua jalur yang layak diukur sebelum diputuskan:

1. **Seleksi top-N** (ambil 10 terbesar tanpa sortir penuh) — O(n) dengan
   konstanta kecil, tapi harus terbukti lebih cepat dari TimSort pada data yang
   memang sudah terurut.
2. **Pakai invariant urutan dari service** (`order=tanggal.desc,created_at.desc,
   id.asc`) tanpa sortir sama sekali — paling murah, tapi BERISIKO: ada jalur
   yang menyisipkan/mengganti baris secara lokal (`insertTransactionRow`,
   `reconcileTxRowsWithPending` di `src/domain/transactions.js`) yang bisa
   mematahkan invariant itu, sehingga urutan bisa salah diam-diam.

Keduanya butuh A/B pada 2.500 **dan** 20.000 baris, plus uji yang membuktikan
urutan hasil identik. Belum dikerjakan — menunggu keputusan.

## 4. Yang diperiksa dan ternyata sehat (tidak perlu tindakan)

- **Tidak ada drift build**: rebuild `build:app/boot/styles/css/csp` tidak
  mengubah satu byte pun.
- **Tidak ada kerentanan dependensi**: `npm audit` 0 (prod & dev). Pembaruan
  tersedia (`@supabase/supabase-js` 2.113.0 → 2.116.0 yang di sini *vendored* &
  ter-pin, `tailwindcss` 3 → 4 major, patch `esbuild`/`eslint`/`playwright`) dan
  sengaja tidak dipasang — tidak ada desakan keamanan, dan menaikkan build-tool
  bisa mengubah byte bundel (wajib rebuild + cek determinisme + bump
  `CACHE_VERSION`).
- **Tidak ada rahasia bocor**: pola `sbp_`, `github_pat_`+82, private key, dan
  JWT hanya mengenai anon key publik (memang ditempel di client) dan teks
  komentar/dokumen.
- **Aset lengkap**: 31 entri precache SW dan 17 referensi aset `index.html`
  semuanya ada di disk.
- **Skema konsisten**: CEK 1–9 lulus (termasuk RLS, grant RPC, rate limit), dan
  katalog identik dengan snapshot (32 index, 38 constraint, 15 policy, 5 grant
  fungsi, 1 trigger, 1 sequence/view).
- **Boot bukan masalah** (mengulang temuan v131): shell terpaint 806–953 ms dan
  nyaris tidak terpengaruh ukuran data.

## 5. Prioritas rekomendasi

1. **Delta/incremental sync untuk akun berat** — 8.645 KB per tarikan penuh
   adalah beban terbesar yang terukur, dan satu-satunya yang membesar drastis
   terhadap ukuran data. Butuh migrasi skema (`updated_at` + trigger + backfill +
   tombstone) → kerjakan desain + file migrasi dulu, klien belakangan.
2. **`renderRecentList` top-N** — 302 ms pada 20.000 tx, tapi wajib A/B karena
   percobaan sebelumnya (v127) kalah di 2.500 baris.
3. **Biaya chart pada render pertama** (~476 ms dari `processDataForUI` 624 ms) —
   jalur "murahkan chart" (mis. tanpa animasi di render pertama), bukan menunda
   chart; harus diukur dulu.
4. **Tidak disarankan**: memecah `app.js` per view. Parse skrip terukur hanya
   ~10 ms (v129), jadi manfaatnya kecil dibanding risiko refactor.

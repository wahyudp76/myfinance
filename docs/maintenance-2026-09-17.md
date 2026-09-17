# Maintenance rutin & cek stabilitas — 2026-09-17 (v132)

Lingkup: pemeriksaan menyeluruh kesehatan repo (statis, build, dependensi,
skema, rahasia, aset) + pengukuran performa & stabilitas runtime pada tiga
ukuran akun. **Tidak ada perubahan kode app di versi ini** — hasilnya semua
hijau, jadi tidak ada yang perlu diperbaiki.

Lingkungan: Node v22.23.2, PostgreSQL 17.11 (Debian), Chromium headless 151
(Playwright 1.62.1), CPU di-throttle 4× untuk angka browser (konvensi
`scripts/bench-load-sync.mjs`), service worker dimatikan agar cache tidak
mencemari antar-run.

## 1. Hasil pemeriksaan

| Pemeriksaan | Perintah | Hasil |
|---|---|---|
| Lint | `npm run lint` | **0 masalah** |
| Unit test | `npm run test:unit` | **973/973 lulus**, 0 skip, 0 batal |
| Parity (stub) | `npm run test:parity` | **1/1 lulus** |
| Drift build | rebuild `build:app/boot/styles/css/csp` | **tanpa perubahan byte** (5 target) |
| Kerentanan dependensi | `npm audit` (+ `--omit=dev`) | **0 kerentanan** (prod & dev) |
| Skema pasang bersih | `scripts/schema-verify/run.mjs` | **SEMUA LULUS** (CEK 1–9, termasuk RLS & grant RPC) |
| Drift katalog skema | `scripts/schema-verify/drift-check.mjs --check` | **IDENTIK** — 5 grant fungsi, 15 policy, 32 index, 38 constraint, 1 trigger, 1 sequence/view |
| Scan rahasia | pola `sbp_`, `github_pat_`+82, private key, JWT | **bersih** — yang terdeteksi hanya anon key publik (memang ditempel di client) dan kalimat di komentar/dokumen |
| Precache service worker | 31 entri `PRECACHE_URLS` vs disk | **semua ada** (entri `./` = root situs) |
| Aset `index.html` | 17 referensi unik (src/href lokal) | **semua ada** |
| Error runtime | `pageerror` selama harness | **0** pada 300, 2.500, dan 20.000 transaksi |

## 2. Performa saat ini (median, CPU 4×, SW mati, latensi stub 0)

| metrik | 300 tx | 2.500 tx | 20.000 tx |
|---|---|---|---|
| **shell terlihat (paint)** | **806 ms** | **899 ms** | **953 ms** |
| terdeteksi harness (bukan momen terlihat) | 2.083 ms | 2.936 ms | 2.087 ms |
| data cloud ter-commit | 2.396 ms | 3.416 ms | 4.497 ms |
| satu `loadData()` penuh | 681 ms | 1.036 ms | 3.314 ms |
| `refreshTransactionsOnly()` | 440 ms | 165 ms | 230 ms |
| `filterTransactions()` | 147,5 ms | 452,2 ms | 634,6 ms |
| `processDataForUI()` | 240,6 ms | 251,6 ms | 306,2 ms |
| `renderRecentList()` | 35,8 ms | 55,1 ms | 394,7 ms |
| request / payload transaksi per tarikan penuh | 1× / 129,1 KB | 3× / 1.078,5 KB | **20× / 8.645,4 KB** |

Dua bacaan penting:

1. **Shell nyaris tidak terpengaruh ukuran data** (806 → 953 ms dari 300 ke
   20.000 transaksi). Biaya yang membesar semuanya ada di fase data, sesuai
   temuan v131 bahwa "bobot shell" bukan masalahnya.
2. **Payload akun berat terukur 8.645 KB per tarikan penuh** — sebelumnya angka
   8,6 MB hanya perkiraan di audit 2026-09-15, sekarang terkonfirmasi alat ukur.
   Ini satu-satunya beban yang layak diperbaiki (delta sync), dan prasyaratnya
   perubahan skema.

## 3. Catatan & temuan kecil

- **`npm run test:legacy-read` tidak dijalankan.** Uji itu LIVE ke situs
  produksi dan menuntut `PARITY_TEST_EMAIL` + `PARITY_TEST_PASSWORD`; tanpa
  keduanya ia memang melempar di baris 10. Bukan cacat — butuh kredensial dan
  izin pemilik.
- **Angka "970/973" di Node 20 sempat terlihat, tapi artefak.** Saat itu
  `node_modules` sedang hilang (sandbox ter-reset), sehingga sebagian test tidak
  termuat. Setelah lingkungan dipulihkan, Node 20 maupun Node 22 sama-sama
  **973/973 dengan exit code 0**. `engines.node >=22.19.0` tetap dijaga
  `tests/unit/node-engine.test.js`.
- **Pembaruan dependensi tersedia, sengaja TIDAK dipasang** di maintenance ini:
  `@supabase/supabase-js` 2.113.0 → 2.116.0 (di repo ini **vendored & ter-pin**
  di `vendor/`, jadi naik versi = proses re-vendoring, bukan `npm update`);
  `tailwindcss` 3.4.19 → 4.x (major, breaking); `esbuild` 0.25.10 → 0.25.12 dan
  `eslint` 10.9.1 → 10.10.0 (patch dev-tool — bisa mengubah byte bundel, jadi
  kalau dipasang wajib disertai rebuild + cek determinisme + bump
  `CACHE_VERSION`). `npm audit` bersih, jadi tidak ada desakan keamanan.
- **Lingkungan sandbox tidak stabil** (ter-reset beberapa kali selama sesi:
  `node_modules`, Chromium, dan PostgreSQL hilang dan harus dipasang ulang).
  Ini catatan infrastruktur pengerjaan, bukan kondisi repo.

## 4. Kesimpulan

Repo dalam keadaan sehat: tidak ada kegagalan test, tidak ada drift build maupun
drift skema, tidak ada kerentanan dependensi, tidak ada rahasia bocor, tidak ada
aset precache yang hilang, dan tidak ada error runtime pada ketiga ukuran akun.
Tidak ada perbaikan yang diperlukan dari hasil maintenance ini.

Pekerjaan yang masih menunggu keputusan pemilik (bukan temuan maintenance):
delta/incremental sync untuk memangkas payload akun berat (butuh migrasi
`updated_at` + trigger + backfill + tombstone), dan opsi memurahkan biaya chart
pada render pertama.

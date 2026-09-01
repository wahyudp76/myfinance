# AGENT HANDOFF — MyFinance (Ai-Agen)

> Catatan antar-agen. Diisi ulang 2026-09-01 setelah file lama hilang akibat reset
> lingkungan kerja (riwayat v38–v40 dirangkum dari docs/SESSION-HANDOFF.md & log sesi).
> Status: semua fitur di bawah SUDAH teruji unit + E2E browser + (untuk Edge Function) live di produksi.

## Peta cepat
- App: SPA statis `index.html` + `src/**` (domain services, modul ES) + Tailwind build (`npm run build:css`) + service worker `sw.js` (bump `CACHE_VERSION` + jalankan `node tests/unit/update-sw-cache-snapshot.mjs` SETELAH build:css setiap kali aset berubah).
- Verifikasi wajib: `npm run lint` (ESLint, sejak v45 -- job CI tersendiri) + `npm test` (kini lint+unit+parity) + `node scripts/verify-hud.mjs` (49 cek E2E Playwright terhadap `http://localhost:8123`, server via `npx http-server . -p 8123 -c-1`).
- Backend Supabase: project `uxfngmxghupdlwoeoxgh`; Edge Functions `analyze-finance`, `refresh-asset-price` (deploy via CLI `~/tools/supabase/supabase functions deploy <nama> --project-ref uxfngmxghupdlwoeoxgh`, butuh token akses Supabase; JWT diverifikasi default).
- Kontrak UI: tooltip gelap #000, palet colorblind-safe, 7 view (ringkasan/transaksi/akun/aset/budget/laporan/pengaturan), Ctrl/Cmd+K command palette.

## v41 — Reksadana: auto-update nilai dari Bibit (Edge Function `refresh-asset-price`)
- Kolom baru di aset: `simbol`, `jumlah_unit`, `sumber_harga`, `tanggal_nav` (form Tambah/Edit Aset, sumber otomatis per kategori via `ASSET_AUTO_UPDATE_CONFIG` di index.html: Kripto→coingecko, Saham→yahoo_id_stock, Reksadana→reksadana_bibit).
- API Bibit (live-verified): GET `https://api.bibit.id/products/list?page=1&limit=N&sort=asc&sort_by=7[&name=Q]` WAJIB header `Origin: https://bibit.id`, UA browser-ish, `Accept: application/json` (tanpa itu 403). Body terenkripsi hex: `iv=hex(payload[0:32])`, `key=utf8(payload[-32:])`, ciphertext=`payload[32:-32]`, AES-256-CBC. Item: id, symbol, name, aum, nav{date,value}. Helper + uji unit: `supabase/functions/_shared/bibit.js` ↔ `tests/unit/bibit-market.test.js`; kontrak domain: `src/domain/market-sync.js` ↔ `tests/unit/market-sync.test.js` (computeMarketValue, withSyncedValue same-day overwrite/change-only, describeSyncSource).
- Aturan nilai: `nilai_baru = round(harga_per_unit × jumlah_unit)`; value_history dedupe-per-hari (timpa titik hari sama).
- Jalur `manual_nav` (tanpa API): derive harga/unit dari nilai÷unit, tgl NAB divalidasi `isBibitNavDate`, ditulis `sumber_harga="manual_nav"`.
- Modal "Sync NAB/UP Pasar" di detail aset (v41 khusus Reksadana, v43 digeneralisasi).

## v42 — Self-heal akun bayangan nama aset
- Bug historis: nama aset (mis. "Shopee Merchant") pernah terdaftar sebagai akun. Fix murni `pruneAssetShadowAccounts({accounts,transactions,assets})` di `src/domain/asset-flows.js`: entri akun dihapus HANYA bila (1) nama cocok aset (trim+lowercase via findAssetByName) DAN (2) tidak pernah dipakai sebagai `akun` transaksi mana pun DAN (3) ada transaksi Transfer dengan `kategori` = nama itu. Terpasang di KEDUA loop sinkronisasi pengaturan (loadData + refresh) → settings cloud yang terpolusi sembuh sendiri saat app dimuat; peta accountIcons/currencies ikut dipangkas.

## v43 — Penyempurnaan refresh harga Kripto & Saham (Edge Function v18)
- Uji sumber live 2026-09-01: CoinGecko `simple/price?ids=...&vs_currencies=idr` OK; Yahoo `query1` DAN `query2` `.finance.yahoo.com/v8/finance/chart/{TICKER}.JK` OK (meta.regularMarketPrice + regularMarketTime); **Stooq MATI — jangan dipakai**; proxy CORS publik semua mati/berbayar.
- Helper murni `supabase/functions/_shared/price-sources.js` (yahooChartUrls 2 mirror, pickYahooMarketPrice→{price,timeIso}|null, yahooFailureMessage) ↔ `tests/unit/price-sources.test.js` (4 kasus).
- Edge v18: fetcher saham mencoba 2 mirror Yahoo berurutan; CoinGecko 429 pesan ramah; respons diperkaya `sumber` + `tanggal_pasar`; fetcher kini mengembalikan `{price, marketIso}`.
- UI: baris info sumber di modal detail aset (sumber + 1 unit ≈ Rp + waktu diperbarui); tombol Sync Manual utk SEMUA kategori auto (label dinamis koin/lembar/unit); toast refresh menampilkan harga per unit + tanggal data pasar; tombol **Refresh Harga** (semua aset auto sekuensial, ringkasan hasil) di header tab Aset.
- Rate limit Edge: 30 request/jam/user. KOREKSI 2026-09-01: bukan tabel `refresh_price_rate_limits`
  (tabel itu TIDAK ADA) -- Edge memanggil RPC `check_and_consume_rate_limit` dgn
  `p_action='refresh-asset-price'`, tersimpan sbg baris di tabel `api_rate_limits`
  (berbagi dgn analyze-finance). Lihat docs/db-migration-status-2026-09-01.md §3.

## v45 — Gerbang statis ESLint, fix precache SW, kebersihan dependensi
- **ESLint 9 flat config** (`eslint.config.js`) -- repo sebelumnya TANPA linter sama sekali.
  Sengaja mengatur KEBENARAN saja (no-undef, no-unused-vars, eqeqeq, no-unsafe-finally,
  require-atomic-updates), BUKAN gaya penulisan (tidak ada aturan indentasi/kutip/titik koma)
  supaya tidak mengubur riwayat git. `npm run lint` / `lint:fix`; job CI `lint` ditambahkan;
  `npm test` kini = lint + unit + parity. Status: **0 masalah**.
- Daftar global aplikasi didaftar EKSPLISIT di eslint.config.js utk file harness E2E -- ini jadi
  dokumentasi hidup permukaan `window.*` yang masih dipegang monolit index.html. Saat Phase 4
  refactor memindahkan salah satunya, lint langsung memberi tahu.
- **BUG FIX sw.js**: `PRECACHE_URLS` memuat `cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm`,
  URL yang TIDAK PERNAH diminta app (client.js & semua Edge Function mengimpor dari `esm.sh`).
  Akibatnya tiap install SW mengunduh bundel yang tak terpakai SEKALIGUS gagal men-cache library
  yang sesungguhnya dibutuhkan -- skenario "kunjungan pertama lalu offline" tetap gagal boot.
  Diganti ke `https://esm.sh/@supabase/supabase-js@2` (sudah diizinkan CSP). CACHE_VERSION v44→v45.
- **BUG FIX tests/parity/live-data-rich-parity.mjs**: `throw` di dalam `finally` membuat error
  cleanup MENIMPA kegagalan paritas yang asli (CI melaporkan gejala, bukan sebab). Direstrukturisasi
  jadi `primaryError ?? cleanupError` tanpa throw-dalam-finally.
- Perbandingan longgar `==` di src/domain/{transactions,budgets,reports}.js (string hasil split()
  vs number dari getFullYear()) diganti koersi `Number()` EKSPLISIT + `===`. Perilaku identik,
  500/500 unit test tetap hijau. JANGAN asal ganti `==`→`===` di sini tanpa koersi: akan rusak.
- `dependencies` dikosongkan -> semua pindah ke `devDependencies`. Alasan: TIDAK ADA paket npm yang
  sampai ke browser user (supabase-js dari esm.sh, Chart.js/FullCalendar dari jsdelivr); npm murni
  perkakas dev/CI. Ini juga menjelaskan kenapa 20 temuan `npm audit` (rantai lighthouse→puppeteer→
  extract-zip) TIDAK berdampak ke pengguna, dan kenapa "fix"-nya sengaja TIDAK dijalankan: satu-
  satunya remediasi yg ditawarkan npm adalah MENURUNKAN lighthouse 12.8.2→12.6.1.
- Audit skema live read-only: docs/db-migration-status-2026-09-01.md -- **semua migrasi di `sql/`
  ternyata SUDAH diterapkan**, walau beberapa header file masih menulis "menunggu dijalankan".
- Verifikasi v45: lint 0 masalah, unit 500/500, `verify-hud.mjs` 49/49 PASS (0 error halaman),
  `build:css` tanpa drift, snapshot SW disinkronkan.

## v46 — Keamanan & higiene repo (Paket C)
- **Gerbang secret-scanning** (`.gitleaks.toml` + job CI `secret-scan`, gitleaks 8.28 ter-pin,
  binary diunduh langsung karena gitleaks-action butuh lisensi utk akun organisasi). Memindai
  kondisi kerja DAN seluruh riwayat commit (`fetch-depth: 0`). Riwayat penuh dipindai 2026-09-01:
  **bersih, tidak pernah ada kredensial ter-commit**.
- GOTCHA allowlist gitleaks (sudah diuji langsung, jangan diubah tanpa uji ulang): kondisi dalam
  satu blok allowlist digabung **OR**, bukan AND -- menulis `paths` + `regexes` bersamaan berarti
  `paths` SENDIRIAN sudah meloloskan seluruh isi file itu. Kunci `condition`/`matchCondition`
  tidak berefek di allowlist global, dan `targetRules` malah membuat blok allowlist mati total.
  Karena itu pengecualian dikunci ke **pola isi saja, tanpa paths**. Anon key dimaafkan lewat
  pola `cm9sZSI6ImFub24` (base64url `role":"anon`), sehingga **service_role key yang salah tempel
  TETAP menggagalkan CI** -- sudah dibuktikan dgn uji negatif.
- **Dependabot** (`.github/dependabot.yml`): npm + github-actions, bulanan, minor/patch digrup
  jadi 1 PR, major sengaja dipisah (mis. Tailwind 3->4 akan memicu css-drift dan perlu dibaca
  manual). Kalau PR Dependabot bikin css-drift merah: jalankan build:css + update snapshot SW,
  commit ke branch PR itu.
- **CSP: `'unsafe-eval'` DIHAPUS** dari script-src di index.html DAN _headers (dua-duanya, wajib
  sinkron). Alasan: tidak ada eval()/new Function() di kode sendiri, dan ketiga library vendor
  diuji langsung di browser dgn CSP baru (Chart.js instantiate, FullCalendar render, supabase-js
  createClient dari esm.sh) -> **0 pelanggaran CSP**. Catatan: `verify-hud.mjs` TIDAK pernah
  membuka tab Kalender, jadi FullCalendar harus diuji terpisah -- itu yang dilakukan saat ini.
  Jangan kembalikan 'unsafe-eval' tanpa membuktikan library mana yang butuh.
- Utang dokumentasi dilunasi: 3 header di `sql/` yang masih berbunyi "menunggu dijalankan"/
  "DO NOT RUN" diberi banner STATUS SUDAH DITERAPKAN, dan `docs/AUDIT_REPORT_2026-08.md` diberi
  catatan tindak lanjut supaya kolom "Butuh aksi Anda"-nya tidak menyesatkan.
- CACHE_VERSION v45 -> v46 (index.html berubah). Verifikasi v46: lint 0, unit 500/500,
  verify-hud 49/49 PASS (0 error halaman), gitleaks bersih, build:css tanpa drift.

## v47 — Perbaikan CI yang tersingkap oleh Dependabot
- **BUG CI (laten, lama)**: job `parity` dipasang `on: pull_request` padahal ia menguji SITUS
  TER-DEPLOY dan menunggu workflow "pages build and deployment" utk SHA-nya. GitHub Pages hanya
  men-deploy `main`, jadi untuk SHA branch PR penunggu itu PASTI timeout ~3 menit lalu exit 1.
  Tidak pernah terlihat karena belum pernah ada PR; keempat PR Dependabot pertama langsung merah
  semua. Fix: `if: github.event_name != 'pull_request'` pada job parity. PR tetap dijaga unit +
  lint + secret-scan + css-drift + lighthouse; uji live tetap penuh saat mendarat di main.
  (Alasan kedua: PR Dependabot memang tidak diberi akses repository secrets oleh GitHub.)
- **`@eslint/js` kini devDependency EKSPLISIT.** eslint.config.js mengimpornya sejak v45 tapi
  paketnya hanya ikut lewat hoisting dari `eslint` -- ESLint 10 menghentikan itu dan CI mati
  ERR_MODULE_NOT_FOUND. Ketahuan dari PR Dependabot. Sekalian ESLint dinaikkan 9 -> 10.9.1
  (diuji lokal: 0 masalah, konfigurasi flat config tidak perlu diubah sama sekali).
- Catatan buat sesi berikutnya: **lighthouse 13.4.1 menuntaskan SELURUH 20 temuan `npm audit`**
  (diuji di project bersih: "found 0 vulnerabilities"). Jadi rekomendasi v45 utk TIDAK menjalankan
  `npm audit fix` tetap benar (remediasinya downgrade), tapi jalur yang benar adalah NAIK ke
  lighthouse 13 lewat PR Dependabot, bukan turun ke 12.6.1.

## Gotcha lingkungan
- Sandbox sering ter-reset tengah sesi: `.git` bisa kembali ke parent lama + file tracked ter-restore + `~/tools`/chromium hilang. Ritual: cek `git log --oneline -1` vs `origin/main`; `git fetch` + `git reset --mixed origin/main` (worktree aman); reinstall node22 (`~/tools/node-v22.23.2-linux-x64`) + `npm ci` + `npx playwright install chromium`; server 8123 via start_process.
- Test akun Supabase: signup butuh toggle `mailer_autoconfirm` (balikkan + verifikasi!) — hapus user hanya bisa via dashboard/Mgmt UI.
- Jangan commit kredensial; remote disimpan plain URL, PAT hanya via set-url sesaat.

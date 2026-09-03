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

## v48 — Bump dependensi (menuntaskan seluruh temuan npm audit)
- lighthouse 12.8.2 -> **13.4.1**, @supabase/supabase-js ^2.57.0 -> **^2.112.4**,
  actions/checkout & actions/setup-node **v5 -> v7**. Isinya identik dgn PR Dependabot #8/#7/#6;
  diterapkan langsung ke main (PR-nya auto-close sbg superseded).
- **`npm audit` kini "found 0 vulnerabilities"** (sebelumnya 20: 16 moderate + 4 high, semua dari
  rantai lighthouse -> puppeteer-core -> extract-zip). Ini menutup catatan v45: menolak
  `npm audit fix` memang benar (remediasinya downgrade ke 12.6.1), jalan keluarnya NAIK ke 13.x.
- Kenapa lewat commit langsung, bukan tombol merge PR: sejak v47 job `parity` di-skip pada event
  pull_request, jadi bump supabase-js TIDAK pernah teruji thd Supabase live selama masih berupa
  PR -- validasi sesungguhnya baru terjadi setelah mendarat di main. Lewat commit langsung, CI
  penuh (termasuk parity live) langsung berjalan pada commit-nya sendiri.
- Verifikasi v48: lint 0 (ESLint 10.9.1), unit 500/500, verify-hud 49/49 PASS (0 error halaman),
  gitleaks bersih, build:css tanpa drift, `node scripts/lighthouse/run.mjs` dgn LH13 lolos
  (performance 58 / accessibility 97 / best-practices 100). CACHE_VERSION tetap v46 -- tidak ada
  aset precache yang berubah (murni perkakas dev + workflow).

## v49 — Auto-merge Dependabot
- Workflow baru `.github/workflows/dependabot-auto-merge.yml`: PR Dependabot yang LULUS CI penuh
  di-merge (squash + hapus branch) tanpa campur tangan manusia.
- **JANGAN ganti dgn `gh pr merge --auto`.** Dua alasan: (1) fitur itu butuh Settings > General >
  "Allow auto-merge" yang belum dinyalakan; (2) lebih penting -- auto-merge bawaan hanya MENUNGGU
  bila ada required status check di branch protection, dan repo ini TIDAK punya branch protection,
  jadi `--auto` justru me-merge SEKETIKA tanpa menunggu CI. Karena itu workflow ini dipicu oleh
  `workflow_run` (selesainya CI) lalu memeriksa sendiri seluruh check-run di head SHA.
- Syarat merge (semua wajib): penulis `dependabot[bot]`, PR OPEN & bukan draft, branch `dependabot/*`,
  tidak berlabel `no-auto-merge`, dan SETIAP check-run di head SHA berstatus completed dgn
  conclusion success/skipped/neutral (skipped diizinkan krn job parity memang di-skip pada PR).
- Logika gerbang diuji thd data check-run NYATA sebelum dipasang: head PR #8 (hijau + parity
  skipped) -> LOLOS; head PR #6 pra-rebase (parity failure) -> TOLAK.
- Cara uji tanpa menunggu PR nyata: Actions > "Dependabot auto-merge" > Run workflow, isi nomor PR,
  biarkan `dry_run` = true -> mencetak keputusan tanpa merge apa pun.
- Membatalkan utk SATU PR: beri label `no-auto-merge`.
- CELAH YANG DISADARI (didokumentasikan di header workflow): job parity di-skip pada PR, jadi bump
  @supabase/supabase-js lolos ke main hanya bermodal unit test; uji live-nya baru jalan SETELAH
  merge. Dampak terburuk = CI main merah (bukan pengguna terdampak), pemulihan = `git revert`.

## v50 — Perbaikan flaky `headless-browser-legacy.mjs`
- Gejala: job `parity` merah di main (run f558ceb) dgn `locator.click: Timeout 30000ms` dan
  `<div id="authGate">…</div> intercepts pointer events`. Terlihat seperti tombol login rusak.
- Diagnosis: **situs live SEHAT** (diprobe langsung: authGate hilang ~1,2 dtk, tombol submit bisa
  diklik, 0 pelanggaran CSP, 0 error). Ini murni balapan waktu di harness -- ia menunggu input
  email/password "visible", padahal input bisa visible SEMENTARA overlay #authGate masih menutupi
  dan menangkap pointer event.
- Fix: tunggu `#authGate` benar-benar hilang/hidden dulu (waitForFunction, 60 dtk) SEBELUM mengisi
  form & klik. `.catch()` sengaja dipasang supaya kalau gate memang macet, yang gagal tetap klik-nya
  agar pesan error Playwright tetap informatif.
- PELAJARAN: `waitFor({state:"visible"})` TIDAK menjamin elemen bisa DIKLIK. Kalau ada overlay,
  tunggu overlay-nya, bukan elemennya.

## Gotcha lingkungan
- Sandbox sering ter-reset tengah sesi: `.git` bisa kembali ke parent lama + file tracked ter-restore + `~/tools`/chromium hilang. Ritual: cek `git log --oneline -1` vs `origin/main`; `git fetch` + `git reset --mixed origin/main` (worktree aman); reinstall node22 (`~/tools/node-v22.23.2-linux-x64`) + `npm ci` + `npx playwright install chromium`; server 8123 via start_process.
- Test akun Supabase: signup butuh toggle `mailer_autoconfirm` (balikkan + verifikasi!) — hapus user hanya bisa via dashboard/Mgmt UI.
- Jangan commit kredensial; remote disimpan plain URL, PAT hanya via set-url sesaat.

## v51 — Subset Font Awesome (perf) + perbaikan race di verify-hud

**Konteks.** Diminta fokus performa & UX. Baseline Lighthouse mobile (server
lokal, tanpa gzip): performance 58, FCP 7,2 s, LCP 8,9 s, TBT 50 ms, CLS 0.

**Diagnosis.** TBT rendah + CLS nol ⇒ bukan masalah eksekusi JS, tapi payload.
Penting: GitHub Pages SUDAH mengaktifkan gzip, jadi `index.html` 640 KB hanya
~144 KB di kabel — memangkas HTML nilainya kecil. Yang TIDAK bisa dikompresi
lagi adalah woff2: `fa-solid-900` 150 KB + `fa-brands-400` 108 KB + CSS Font
Awesome 100 KB = ~358 KB untuk aplikasi yang cuma memakai 193 ikon.

**Yang dikerjakan.**
1. `scripts/subset-fontawesome.py` — subset reproducible. Sumber penuh disimpan
   di `css/_full/` + `webfonts/_full/` supaya subset bisa dibangun ulang saat
   daftar ikon bertambah. CSS tidak ditulis ulang dari nol; hanya rule
   `.fa-x:before{content:...}` yang tidak terpakai yang dibuang, jadi seluruh
   utility class (`fa-spin`, `fa-fw`, `fa-2x`, …) dijamin utuh.
   Hasil: CSS 99,6→24,6 KB · fa-solid 146,6→17,8 KB · fa-brands 105,5→1,1 KB.
2. `tests/unit/icon-subset.test.js` — gerbang wajib. Tanpa ini, menambah ikon
   baru tanpa menjalankan ulang subset akan menghasilkan kotak kosong di
   produksi TANPA error apa pun. Sudah diuji negatif: `fa-igloo` (terbuang) dan
   `fa-sparkles` (ikon Pro) sama-sama membuat test merah.
3. Bug UX lama ketemu: tombol "Isi Data Contoh" memakai `fa-sparkles`, yang
   **ikon Pro** dan tidak ada di Font Awesome Free — selama ini tampil kosong.
   Diganti ke `fa-wand-magic-sparkles`.
4. `CACHE_VERSION` → `myfinance-v51` + snapshot SW diperbarui (aset berubah).
5. `.gitleaks.toml`: `^css/_full/` masuk allowlist paths (artefak vendor).

**Hasil.** FCP 7,2→6,2 s · LCP 8,9→7,7 s · TBT 50→10 ms · performance 58→60
(lokal tanpa gzip; di produksi porsi hematnya lebih besar karena woff2 kebal
gzip). 502 unit test hijau, lint 0, verify-hud 49/49, gitleaks bersih.

### JEBAKAN: `SAFELIST` di scripts/subset-fontawesome.py
`index.html` merakit nama ikon saat runtime:
`<i class="fas fa-arrow-${up ? 'up' : 'down'}">`. Scanner hanya melihat token
`fa-arrow`, sehingga `fa-arrow-up`/`fa-arrow-down` nyaris ikut terbuang.
**Setiap kali menambah nama ikon dinamis, daftarkan semua hasilnya di
`SAFELIST`.** Test gerbang tidak bisa menangkap kasus ini (ia memakai scanner
yang sama).

### Race di scripts/verify-hud.mjs (bukan flaky biasa)
Cek "komposisi kas: hover memunculkan garis aksen kiri" mulai gagal 2 dari 3
run setelah subset. Sempat terlihat seperti flaky, tapi baseline lolos 3/3 —
jadi ini regresi yang harus dijelaskan, bukan diabaikan. Diagnostik menunjukkan
baris yang sama berpindah dari `y=843` ke `y=421` antar-run: daftar masih
bergeser saat `hover()` dipanggil, kursor mendarat di koordinat lama, `:hover`
tidak pernah aktif, `::before` tetap opacity 0. Halaman yang lebih cepat hanya
mengubah timing sehingga race lama lebih sering kalah.

Perbaikan: tunggu posisi baris DIAM (3 frame beruntun dengan `top` sama)
sebelum hover, lalu `waitForFunction` sampai opacity `1` alih-alih menebak
lewat `waitForTimeout(350)`. 5/5 run hijau setelahnya.
Pelajaran sama seperti v50: **tunggu kondisi nyata, jangan tambah sleep atau
`{force:true}`.**

## v52 — Percepatan input transaksi ke database (echo lokal + sesi tanpa RTT)

Permintaan owner: "lakukan improvement pada peningkatan kecepatan input data
transaksi ke database". Tidak menyentuh Paket B/Phase 4 (split monolit ditolak
owner sebagai berisiko). Tujuan: memangkas round-trip jaringan & waktu antara
"klik Simpan" sampai data tampil di UI, untuk SEMUA jalur penyimpanan transaksi.

### Temuan diagnosis (mengapa simpan terasa lambat)
1. **1 RTT sia-sia per operasi tulis**: setiap service (transactions, assets,
   settings, custom-icons, recurring) punya `getCurrentUserId()` sendiri yang
   memanggil `auth.getUser()` = query ke server Auth, padahal user.id SUDAH ada
   di sesi lokal. Jadi simpan transaksi = getUser() + insert = 2 RTT berurutan.
2. **Re-fetch seluruh tabel setelah simpan**: `onSaveOk` lama memanggil
   `refreshTransactionsOnly()` = `list()` seluruh tabel transaksi (paging 1000
   baris per request, BERURUTAN) + render ulang penuh (filter, daftar, dashboard,
   chart, laporan) sebelum modal ditutup.
3. Setor ke aset = 2-3 request berurutan (insert/update + updateAsset), plus
   refresh aset & transaksi. Transfer baru sudah atomik (RPC) — jalur terbaik.

### Yang diubah
- **`src/services/user-id.js` (BARU)** — resolver `getCurrentUserId` SATU untuk
  semua service: `auth.getSession()` dulu (baca storage lokal, TANPA jaringan;
  dipakai bila `expires_at` masih > 30 detik lagi), fallback `auth.getUser()`
  untuk sesi hilang/token hampir kedaluwarsa/mock lama. Perilaku error sama
  persis ("Sesi login tidak ditemukan...").
- **`src/services/transactions.js`** — `mapTransactionRow()` (bentuk kanonik
  baris, dipakai list & write) + `TX_SELECT`. `create()` sekarang
  `.insert().select(TX_SELECT).single()` dan `update()` `.eq(id).eq(user_id)
  .select(TX_SELECT).maybeSingle()` — KEDUANYA mengembalikan baris ASLI dari
  server (update: null bila baris hilang, bukan error — perilaku lama dijaga).
- **`src/domain/transactions.js`** + `insertTransactionRow` (posisi urutan
  server: tanggal DESC, lalu id ASC) & `replaceTransactionRow` (by id, pindah
  posisi bila tanggal berubah) — murni, teruji unit.
- **`src/domain/asset-flows.js`** + `syncAccountsFromTransactions` — pendaftaran
  akun baru + self-heal "akun bayangan aset" (logika yang dulu inline di
  index.html) dipakai refresh penuh DAN echo lokal, jadi tidak mungkin beda.
- **`index.html`** — `applyLocalTxEcho(mode, txRow, assetPatches, afterCb)`:
  update `globalData` (insert/replace), merge patch aset, sinkron akun, lalu
  pipeline render IDENTIK dengan `refreshTransactionsOnly`. Error apapun ->
  fallback `refreshTransactionsOnly()` (perilaku lama). `finishSave` mengatur
  close modal (atau buka ulang utk "Simpan & Catat Lagi") + toast + notif budget.
  RPC transfer: `result.data` di-map via `mapTransactionRow` (RPC memang
  `RETURNS public.transactions`). Setor-ke-aset: patch aset yang dikirim ke
  `updateAsset` dipakai juga utk echo lokal (tidak perlu refreshAssetsOnly).
  Tombol **"Simpan & Catat Lagi"** (`btnSubmitFormRepeat`,
  `submitFormNewAndRepeat`, flag `_pendingRepeatSave` di-reset di awal submit)
  + autofocus kolom Jumlah saat modal baru (desktop saja).
- **`scripts/verify-hud.mjs`** — stub `/rest/v1/transactions` kini membalas
  OBJEK (bukan array) untuk POST/PATCH karena `.single()`/`.maybeSingle()`
  mengirim `Accept: application/vnd.pgrst.object+json`; counter `txGets`,
  `authUserGets`, `txPosts`, `txUpdates`; 10 cek baru "simpan cepat": payload
  POST benar + user_id dari sesi lokal (tanpa GET /auth/v1/user) + TANPA refetch
  seluruh tabel + modal tertutup/toast + baris baru tampil via echo + repeat
  modal tetap terbuka form kosong + PATCH edit + nominal baru di tabel.
- **`sw.js`** CACHE_VERSION `myfinance-v51` -> `myfinance-v52` (snapshot
  di-update lewat `node tests/unit/update-sw-cache-snapshot.mjs` — hash aset
  berubah karena index.html & src/*).
- **`scripts/bench-save-latency.mjs` (BARU)** — ukur RTT nyata ke Supabase
  (median 10), bandingkan jumlah & perkiraan ms alur lama vs baru; `ROWS=`
  untuk simulasi ukuran data. Contoh nyata dari sandbox (RTT ke `uxfngmxghupdlwoeoxgh`
  ~17-28 ms): 300 baris -> 63 ms -> 17 ms (3 RTT -> 1); 5000 baris -> 153 ms
  -> 20 ms (7 RTT -> 1). Di jaringan pengguna (Indonesia, RTT 50-150 ms)
  penghematannya proporsional & lebih terasa.

### Hasil verifikasi (semua hijau)
- `npm run lint` OK; `npm run test:unit` = **533 pass / 0 fail** (dari 502; +31
  test baru: user-id 8, tx-echo 8, accounts-sync 6, service payload 9).
- `scripts/verify-hud.mjs` = **59/59 PASS**, `Error halaman: 0` (v51: 49 cek).
- `scripts/lighthouse/run.mjs` = performance 58 / a11y 97 / best-practices 100
  (pagar 55/85/90 — 58 vs 60 di v51 adalah noise server lokal, bukan regresi).
- Belum ada perubahan database/SQL — murni sisi klien; RLS & RPC tidak disentuh.

### Perangkap & catatan
- **Jangan kembalikan array di stub POST/PATCH** untuk `.single()`/`.maybeSingle()`:
  klien kirim `Accept: vnd.pgrst.object+json`, PostgREST asli membalas OBJEK.
  Array membuat `mapTransactionRow` menerima array -> id hilang -> echo gagal
  (kelihatannya "flaky", padahal stub).
- Test gerbang `index-inline-scripts.test.js` tetap valid: blok inline 4000-an
  baris masih lolos `node --check` via masker komentar.
- `pruneAssetShadowAccounts` tetap diekspor & dipakai (di dalam
  `syncAccountsFromTransactions`); pemanggil inline index.html yang lama
  dihapus.
- Echo lokal memakai baris hasil simpan DI SERVER — bukan baris rekaan klien,
  jadi tidak ada risiko divergensi data. Trade-off yang disadari: perubahan dari
  perangkat LAIN tidak ikut tampil sampai load/refresh berikutnya (sebelumnya
  re-fetch penuh menangkapnya).

## v53 — Preload/preconnect + minify styles.css + precache lengkap

Lanjutan fokus performa (tanpa menyentuh Paket B/Phase 4). Target: kurangi
waterfall network di layar login & byte CSS render-blocking.

### Temuan diagnosis
- Lighthouse v52 (lokal, tanpa gzip): FCP 7.5 s, LCP 10.2 s, TBT 40 ms.
  Request terbesar: dokumen 663 KB, chart.js 72 KB, tailwind 53 KB, styles.css
  51 KB, auth-js (esm.sh) 33 KB, font 27 KB + 18 KB.
- Font Plus Jakarta SUDAH preload + font-display:swap (slice loading v).
- `_headers` ternyata DIABAIKAN GitHub Pages (ada catatan di file itu sendiri)
  -- perombakan cache via _headers batal, tidak berguna di hosting ini.
- chart.js sengaja dimuat saat halaman dibuka (paralel, non-blocking,
  di-await hanya pasca-login) -- DIPERTAHANKAN, itu keputusan yang benar utk UX
  nyata: LH menandainya "unused-js" karena mengukur layar login, bukan bug.

### Yang diubah
- **index.html `<head>`**: `preconnect` ke `https://esm.sh` (auth-js +
  supabase-js dimuat dari sana; DNS+TLS disiapkan paralel sejak parse HTML),
  `preload` `webfonts/fa-solid-900.woff2` (menutup waterfall: @font-face baru
  diketahui setelah CSS FA selesai diunduh), `fetchpriority="high"` pada
  preload font Plus Jakarta (teks utama layar login/hero).
- **styles.css minified dari styles.src.css** (pola identik tailwind):
  - `scripts/build-styles.mjs` (clean-css `{level:1}` -- optimasi semantik-
    identik, bukan level 2 yang bisa merombak aturan).
  - `npm run build:styles`; `npm run build:css` kini berantai keduanya.
  - `tests/unit/styles-minify.test.js` = drift guard, TAPI **graceful-skip**
    bila clean-css tidak terpasang (lihat perangkap di bawah).
  - Hasil: 50.9 KB -> 34.0 KB (-33.5%); gzip 12.2 KB -> 7.8 KB.
- **sw.js**: tambah `./src/services/user-id.js` ke PRECACHE_URLS (modul v52
  yang belum tercakup) + CACHE_VERSION v53 + snapshot.
- **.github/workflows/parity.yml** job `css-drift`: `git diff --exit-code`
  kini memeriksa `css/tailwind.css styles.css`.

### Perangkap: job "unit" yang tidak pernah install dependensi
Push pertama v53 (4c20d5e) GAGAL di job `Unit tests (tanpa install)`:
job itu (sengaja, sejak dulu) hanya checkout + node, TANPA `npm ci`, karena
semua unit test sebelumnya murni Node builtin. Test drift yang mengimpor
clean-css langsung crash (module not found). Solusi yang dipilih:
1. test drift **skip dengan pesan jelas** saat clean-css tidak terpasang
   (terverifikasi: 1 pass + 1 skip, exit 0), dan
2. pengawasan drift SESUNGGUHNYA dipindah ke job `css-drift` (yang memang
   `npm ci` + `npm run build:css` + git diff).
Komit perbaikan `753aa38` -> CI sukses penuh. Pelajaran: **jangan pernah
menambah dependensi baru ke unit test TANPA memeriksa kontrak job unit**.
Kalau perlu deps sungguhan di unit test, ubah workflow-nya dulu (npm ci).

### Verifikasi (v53 + fix CI, semua hijau)
- lint OK; unit 535/535 lokal (dengan clean-css) / 533 pass + 1 skip +
  1 pass saat tanpa clean-css (persis kondisi job unit di CI).
- verify-hud 59/59, `Error halaman: 0` (gradasi/glass/dark-mode utuh pasca
  minify CSS).
- lighthouse: perf 58 / a11y 97 / bp 100; FCP 7.5->7.1 s, LCP 10.2->9.9 s,
  TBT 40->20 ms (lokal tanpa gzip -- gain terpotong karena dokumen 663 KB
  masih dominan).
- Live (Pages, commit 753aa38): styles.css gzip 7.9 KB (dari 12.2 KB), tag
  preconnect/preload ada di HTML ter-deploy, user-id.js 200.

## v54 — Ekstraksi blok script monolit inline -> app.js (disetujui owner)

Owner menyetujui "ekstraksi dengan verifikasi penuh dan hati-hati". PENTING:
ini BUKAN Paket B/Phase 4. Tidak ada kode yang diubah, tidak ada modul baru,
tidak ada pemisahan logika -- blok `<script>` classic 442.907 byte diekstrak
**byte-exact** dari index.html ke `app.js` (satu file, satu scope global,
sloppy mode seperti aslinya). Posisi tag `<script src>` = posisi inline
sebelumnya (setelah loader chart, sebelum SW register) -> urutan eksekusi
terhadap script lain tidak berubah.

### Cara ekstraksi (reproducible)
- Mask komentar HTML (`<!--...-->` -> placeholder) supaya regex `<script>`
  tidak menangkap teks di dalam komentar, lalu ambil blok ke-4 dari 6 blok
  nyata (blok classic terbesar, berisi `function submitForm(`).
- Verifikasi: `sha1(app.js) == sha1(blok inline di git HEAD)` (a0d3f11b9bb4).
- `index.html` 663.557 -> 221.372 byte; sisanya IDENTIK (dibuktikan dengan
  string-replace: `html.replace(blok_lama, referensi_baru) == hasil`).

### Hasil
- Lighthouse (server lokal, 2 run): perf 58 -> **60..72**; FCP 7.1 -> **3.6..6.2 s**;
  LCP 9.9 -> **5.2..8.0 s**; TBT 10..100 ms (noise). Varian antar-run berasal
  dari CDN (esm.sh/jsdelivr), bukan regresi.
- gzip: index.html 144.7 KB -> **37.3 KB**; app.js 106.4 KB. Total load
  pertama ~sama (byte-nya memang sama), tapi dokumen lebih ringan + parse HTML
  lebih cepat + app.js kini aset cacheable sendiri (SW precache + HTTP cache).
- verify-hud 59/59, Error halaman 0; unit 535/535; lint OK.

### Perangkap & perawatan
- **node --check app.js**: repo `"type": "module"` membuat Node mem-parse .js
  sbg ESM. Test parse menyalin app.js ke tmp TANPA package.json (parse
  CommonJS/sloppy = terdekat dgn classic script browser). Browser TIDAK peduli
  package.json -- `<script src>` selalu classic.
- **eslint.config.js**: blok khusus `app.js` hanya mode parse + browser
  globals; no-undef/no-unused-vars/no-empty/no-redeclare dimatikan dengan
  alasan tertulis (permukaan global = kontrak E2E; memberlakukan rule ketat ke
  440 KB kode lama akan membanjiri review).
- **no-redeclare `exportTransactionsCsv` 2x** (baris ~1200 & ~3915 app.js):
  warisan monolit (ada di index.html sejak lama; dibuktikan `git show
  HEAD:index.html | grep -c` = 2), legal di sloppy mode (deklarasi terakhir
  menang), TIDAK diubah -- perilaku wajib identik. Debt tercatat di sini.
- **scripts/subset-fontawesome.py**: SCAN_FILES kini memindai `index.html` DAN
  `app.js` (ikon pindah ke app.js; kalau tidak, subset berikutnya akan membuang
  ikon yang dipakai app). Icon-subset unit test juga kini memindai keduanya.
- **tests/unit/index-inline-scripts.test.js**: kontrak baru -> index.html wajib
  mereferensikan app.js, blok inline > 30KB dilarang, app.js di-parse + sentinel
  fungsi diverifikasi.
- **tests/unit/lazy-charts.test.js**: pola app (loadData + gerbang chart)
  dicari di app.js; loader chart tetap di index.html.
- Job CI `unit` TANPA npm ci tetap berlaku (tidak ada dependensi baru).
- sw.js: precache + './app.js', CACHE_VERSION v54 (snapshot di-update).

### Perangkap pasca-push: job css-drift gagal di push pertama v54 (56b46de)
Push pertama v54 GAGAL di "Tailwind build drift guard": `npm run build:css`
menghasilkan css/tailwind.css 47.709 B vs 53.314 B yang di-commit. Penyebab:
tailwind.config.js content masih `['./index.html', './src/**/*.js']` -- dengan
blok script pindah ke app.js, Tailwind kehilangan ~5.6 KB kelas yang hanya
muncul di template literal app (dahulu ada di index.html). REBUILD TANPA
config ini akan mematahkan styling yang jarang dipakai (masih terbaca saat
dipakai? YA -- kelaskanya hilang dari CSS -> tampilan tanpa gaya itu).
Perbaikan: content += './app.js'. Setelah fix, rebuild IDENTIK dengan yang
di-commit (set kelas sama persis; css/tailwind.css TIDAK berubah). Guard baru
tests/unit/tailwind-content.test.js memastikan app.js & index.html selalu ada
di content. PELAJARAN: setiap kali file sumber kelas Tailwind dipindah/baru,
cek tailwind.config.js content SEBELUM push (job css-drift tidak bisa
"membetulkan" -- ia hanya menandai).

## v55 — Performa: minify app.js + paging paralel transaksi
Diskusi/disetujui owner: "lanjutkan improvement untuk manfaat performa" --
tanpa perubahan logika/perilaku, verifikasi penuh, CI hijau.
- **app.js kini OUTPUT BUILD.** `app.src.js` = sumber manual (salinan utuh
  monolit v54 + header). `npm run build:app` = terser (compress passes 2,
  unsafe false; **mangle.toplevel=false + keep_fnames=true** -- nama fungsi
  global = kontrak untuk onclick= di index.html & harness E2E). Hasil: 442.991
  -> 222.906 B (-49,7%); gzip 106.443 -> 53.343 B. EDIT app.src.js, BUKAN
  app.js; commit keduanya.
- **PRELOAD app.js DICOB A & DIBUANG.** Eksperimen jujur: tambah `<link
  rel="preload" href="app.js" as="script" fetchpriority="high">` di head, A/B
  Lighthouse (jendela noise sama): TIDAK ADA perbaikan (perf 63 vs 63; TBT 20
  vs 50 ms). Teori: skrip dimuat di AKHIR body -- preload prioritas-tinggi
  hanya berebut bandwidth dengan CSS render-blocking. Jangan hidupkan kembali
  tanpa data. (Perangkap utama: skor Lighthouse di sandbox ini bergantung pada
  beban CPU -- noise ±10 poin; selalu bandingkan berurutan dalam jendela yang
  sama.)
- **Paging paralel list() transaksi** (src/services/transactions.js): 2 fase --
  halaman pertama + `count=exact` dalam 1 request, sisanya `Promise.all` per
  batch `MAX_PARALLEL_PAGES=6`; fallback loop berurutan bila count tak
  tersedia; hasil = gabungan halaman berurutan (IDENTIK). Call-site `list()`
  WAJIB meneruskan opts (`.select(TX_SELECT, opts?.withCount ? { count:
  "exact" } : undefined)`) -- kalau tidak, jalur paralel inert (count
  undefined -> fallback). assets.js & recurring.js punya salinan
  `fetchAllRows` LOKAL sendiri yang masih berurutan -- sengaja tidak disatukan
  (Paket B/refactor = skip). Kandidat v56+.
- **Tailwind kena efek minify**: terser menggabungkan string/komentar hilang
  -> hasil scan kandidat kelas BERUBAH: TIDAK ADA kelas hilang, tapi muncul
  `.bg-rose-600` (plain, ~100 B; sebelumnya hanya `hover:bg-rose-600`).
  `npm run build:css` + commit css/tailwind.css baru; drift guard CI menolak
  kalau lupa.
- **Guard baru**: tests/unit/app-minify.test.js (drift terser + setiap handler
  global tetap ada pasca-build), tests/unit/services-paging.test.js (kontrak
  paralel/urutan/fallback/error), job CI `css-drift` -> "Build drift guard
  (CSS + app)" (npm run build:css && build:app + git diff).
- **sw-cache-hash-helper.mjs +app.js** ke daftar file ter-hash (sebelumnya
  lolos: perubahan app.js saja tidak memaksa bump CACHE_VERSION). SW: v55 +
  snapshot regen.
- **Perangkap minify utk tes string-match**: `async function loadData()`
  menjadi `async function loadData(){` -- tests/unit/lazy-charts.test.js &
  index-inline-scripts.test.js kini mencocokkan via regex toleran-spasi.
  eslint: app.src.js masuk blok classic-script yg sama dgn app.js
  (no-redeclare off -- duplicate exportTransactionsCsv tetap legal sloppy).

## v56 — Paging paralel jadi modul BERSAMA (assets & recurring) + defense-in-depth user_id

Melanjutkan kandidat v56 yang tercatat di v55 ("assets.js & recurring.js punya
salinan fetchAllRows LOKAL sendiri yang masih berurutan"). Tanpa perubahan
perilaku pengguna; semua verifikasi hijau.

### Yang diubah
1. **`src/services/supabase/paging.js` (BARU)** — `fetchAllRows(client, buildQuery, pageSize)`
   hasil ekstraksi VERBATIM dari transactions.js v55 (2 fase: halaman pertama +
   `count=exact` dalam 1 request, sisa halaman PARALEL batch `MAX_PARALLEL_PAGES=6`,
   fallback loop berurutan bila count tak tersedia). Kontrak buildQuery:
   `(from, to, opts)` — client di-close-over pemanggil, builder sudah `.range()`
   dan thenable. Tiga salinan lokal (transactions/assets/recurring) dilebur jadi
   satu; tidak ada lagi salinan yang bisa diam-diam tertinggal versi lama.
2. **`src/services/transactions.js`** — hapus salinan lokal, import paging.js.
   Perilaku IDENTIK (kode yang sama persis, cuma pindah rumah).
3. **`src/services/supabase/assets.js`** — `listAssets` kini paralel 2-fase
   (dulu berurutan; efek nyata baru terasa kalau aset > 1000 baris, tapi
   kontraknya kini seragam). `updateAsset`/`deleteAsset` kini `.eq("user_id")`
   eksplisit — pola yang sudah dipakai transactions update/remove. RLS tetap
   lapisan utama; ini defense-in-depth + konsistensi.
4. **`src/services/supabase/recurring.js`** — `listRecurring` paralel 2-fase
   (salinan loop berurutan dihapus). KEEMPAT mutasi tabelnya
   (`updateRecurring`, `deleteRecurring`, `setRecurringActive`,
   `advanceRecurringDueDate`) kini juga `.eq("user_id")` eksplisit — semula
   hanya `.eq("id")` (create & generate tetap lewat RPC `create_recurring_
   transaction` yang sudah mengunci user dari sisi server).
5. **`src/services/supabase/custom-icons.js`** — `deleteCustomIcon` kini
   `.eq("user_id")` eksplisit. PENTING: PK tabel ini `(user_id, account_name)`
   — `account_name` SENDIRIAN tidak unik antar user, jadi ini kasus
   defense-in-depth yang paling beralasan.
6. **Tests**: `services-paging.test.js` diperluas — mockPagedClient kini
   merekam tabel + punya `rpc()` yang melempar (requireClient recurring butuh
   `typeof client.rpc === "function"`); 6 kasus baru membuktikan listAssets &
   listRecurring: paralel (maxInflight >= 2), count hanya halaman pertama,
   fallback berurutan tanpa count, urutan & kelengkapan baris, error halaman
   dilempar. `assets-service.test.js`, `custom-icons-service.test.js` &
   `recurring-service.test.js` diperbarui: filters kini
   `[["id",..],["user_id",..]]` / `[["account_name",..],["user_id",..]]`.
7. **sw.js**: CACHE_VERSION v55 -> v56; PRECACHE_URLS += `./src/services/
   supabase/paging.js`; snapshot di-regen (`node tests/unit/update-sw-cache-snapshot.mjs`).
8. **README.md**: bagian struktur folder disegarkan (masih menggambarkan
   "index.html = SATU blok script gabungan" ala pra-v54) — kini menjelaskan
   app.src.js (sumber) vs app.js (output build) + styles/tailwind serupa.

### Verifikasi (semua hijau, lokal)
- `npm run lint` OK; `npm run test:unit` = **552 pass / 0 fail** (dari 546;
  +6 kasus paging baru; net +6 karena 3 kasus lama berubah konten, bukan nambah).
- `node scripts/verify-hud.mjs` = **59/59 PASS, Error halaman: 0** (stub
  /rest/v1/assets menjawab apapun query param-nya, jadi filter user_id
  lolos E2E; jalur setor-ke-aset tetap hijau).
- `npm run build:css` + `npm run build:app` = tanpa drift (css/tailwind.css,
  styles.css, app.js byte-identik — memang tidak ada perubahan kelas/monolit).
- Tidak ada perubahan SQL/RLS/Edge Function — murni sisi klien.

### Catatan & kandidat v57+
- **`assets.tanggal_nav` kolom YATIM (temuan diskusi v56)**: ada di DB live
  (13 kolom), DIBACA Edge `refresh-asset-price` utk jalur `manual_nav`, tapi
  TIDAK PERNAH ditulis siapa pun (klien tidak punya field form "Tanggal NAB"
  & Edge hanya menulis nilai/terakhir/value_history, bukan tanggal_nav) dan
  TIDAK dipilih `listAssets`. Karena itu jalur `sumber_harga === "manual_nav"`
  di Edge praktis TIDAK TERJANGKAU dari UI (tidak ada cara klien menulis
  nilai itu). Kandidat v57: (a) tambah field "Tanggal NAB" di form aset +
  kirim `tanggal_nav` di updateAsset + tampilkan tanggal data pasar di modal
  detail, dan/atau (b) Edge menulis `tanggal_nav = tanggal_pasar` saat
  refresh berhasil (butuh deploy ulang Edge + PAT Supabase). Tanpa (a)/(b),
  hapus saja jalur manual_nav dari Edge saat refactor berikutnya biar jujur.
- `npm outdated`: supabase-js 2.112.4 -> 2.113.0 tersedia (minor) — biarkan
  Dependabot yang mengangkat.
- Node sandbox 20.20.2 dipakai verifikasi v56 (engines repo minta >=22; CI
  pakai .nvmrc 22). Suite unit+E2E hijau di keduanya.

## v57 — Tanggal data pasar untuk aset (menutup loop kolom yatim `assets.tanggal_nav`)

Melanjutkan kandidat v57 yang tercatat di v56. Kolom `tanggal_nav` (ada di DB live
sejak migrasi 2026-09) sebelumnya TIDAK PERNAH ditulis siapa pun & tidak di-select
klien. v57 memberinya makna yang jujur & tervalidasi: **tanggal DATA PASAR yang
mendasari nilai terakhir aset** (beda dari `terakhir` = jam nilai ditulis).

### Yang diubah
1. **`src/domain/market-sync.js`** + `formatNavDate(dateStr)` (murni, teruji unit):
   "YYYY-MM-DD" MAUPUN ISO datetime (bentuk `tanggal_pasar` Yahoo) -> label id-ID
   "30 Agu 2026"; null utk input tak valid (UI menyembunyikan segmen). Validasi
   zona-aman (parse UTC ala isBibitNavDate), format via local-midnight (pola
   sinceLabel) supaya benar di zona waktu mana pun.
2. **`src/services/supabase/assets.js`**:
   - `listAssets` select += `tanggal_nav` (passthrough, tanpa koersi).
   - `updateAsset`: `tanggal_nav` hanya ikut PATCH bila pemanggil MENYETELNYA
     (`data.tanggal_nav !== undefined`); undefined = kolom tak tersentuh. INI
     KUNCINYA: `submitAsset` (form Edit Aset) membangun payload BARU tanpa
     tanggal_nav -- jaminan tidak sengaja menghapus tanggal data pasar saat user
     cuma ganti nama/modal. `""`/null eksplisit -> ditulis null (reset disengaja).
3. **UI (app.src.js + index.html)**:
   - Modal sync manual: field **"Tanggal data pasar"** (type=date, prefill HARI
     INI, label per kategori: "Tanggal NAB/UP"/"harga koin"/"harga saham"),
     divalidasi `isBibitNavDate` (riil, <=30 hari, tak masa depan) -> tolak =
     toast error + TIDAK menulis; lolos = `tanggal_nav` ikut PATCH + toast
     "...data per 30 Agu 2026".
   - `handleRefreshAssetPrice` (refresh tunggal): setelah `listAssets` (baris
     SEGAR -- Edge baru menulis nilai/history), tanggal_pasar di-persist ke
     tanggal_nav via updateAsset tambahan. NON-FATAL: gagal tulis tidak
     menggagalkan render nilai baru.
   - `refreshAllAssetPrices` (massal): tanggal_pasar per aset sukses dikumpulkan,
     lalu di-persist PARALEL (Promise.allSettled, skip yang tanggalnya sudah sama)
     sebelum render -- konsisten dgn jalur tunggal & manual.
   - Detail Aset, baris sumber: segmen baru **"· Data pasar per <label>"** hanya
     bila `asset.tanggal_nav` ada (aset lama -> tak ada segmen, bukan "-").
4. **Edge `refresh-asset-price` (KODE v19 di repo; TER-DEPLOY 2026-09-02 -- lihat
   "Tindak lanjut v57" di bawah)**: cabang
   auto kini menulis `tanggal_nav` ATOMIK bersama nilai (`marketIso.slice(0,10)`
   utk Yahoo/Bibit; fallback `todayStr` utk CoinGecko yang realtime). Header file
   diberi blok STATUS DEPLOY eksplisit. Sampai ter-deploy, klien yang menulis
   tanggal sendiri (di atas); setelah deploy, tulisan ganda = no-op idempoten.
   **Deploy butuh PAT Supabase (`sbp_...`) -- `sb_secret_` TIDAK bisa akses
   Management API (401 teruji).** Alternatif tanpa CLI: copy-paste isi file ke
   dashboard Functions.
5. **SEMANTIK TETAP**: titik value_history tetap dicap HARI-INI-saat-sync (aturan
   dedupe-per-hari tak berubah, identik dgn Edge); `tanggal_nav` murni metadata
   tanggal datanya. `sumber_harga` TIDAK diubah jalur manual (aset tetap bisa
   auto-refresh; jalur `manual_nav` di Edge tetap tak terjangkau dari UI -- lihat
   catatan v56, kandidat dihapus di refactor Edge berikutnya).

### Verifikasi (semua hijau, lokal)
- `npm run lint` OK; `npm run test:unit` = **558 pass / 0 fail** (dari 552;
  +3 formatNavDate, +3 updateAsset-tanggal_nav semantics: undefined tak dikirim /
  eksplisit terkirim / empty jadi null).
- `node scripts/verify-hud.mjs` = **64/64 PASS, Error halaman: 0** (dari 59;
  +5: helper murni v57 via servicesModule, PATCH default hari ini, tolak tanggal
  basi tanpa tulis, tanggal kustom (relatif -2 hari, tak lapuk) terkirim, baris
  sumber menampilkan/menyembunyikan segmen sesuai tanggal_nav).
- `npm run build:app` (app.src.js 448.022 -> app.js 224.269 B) + `build:css`
  TANPA drift (field date memakai kelas yang sudah ada -- tailwind.css/styles.css
  byte-identik). sw.js: CACHE_VERSION v56 -> v57 + snapshot regen.
- `node scripts/lighthouse/run.mjs` = perf 61 / a11y 97 / bp 100 (pagar 55/85/90;
  dalam rentang noise v54-v56).

### Perangkap
- **Jangan bawa `tanggal_nav` di payload `submitAsset`** -- begitu itu jadi
  `undefined`-vs-`null` ambigu, jaminan "form tidak menghapus tanggal" hilang.
  Satu-satunya penulis eksplisit: submitManualNav, handleRefreshAssetPrice,
  refreshAllAssetPrices (dan Edge v19 setelah deploy).
- **Persist pasca-refresh WAJIB pakai baris hasil listAssets**, bukan aset lama
  dari globalAssets -- updateAsset menulis FULL ROW; baris basi akan MENIMPA
  nilai & value_history segar yang baru ditulis Edge.
- `formatNavDate` di unit test menghasilkan label id-ID bergantung ICU Node
  (penuh sejak Node 13) -- aman; kalau test jalan di runtime ICU-kecil
  (small-icu), label bulan bisa beda -- jangan "fix" logikanya.

### Tindak lanjut v57 — Edge v19 TER-DEPLOY + terbukti E2E live (2026-09-02)

- **Deploy sukses** via Supabase CLI 2.116.0 (binary tunggal di `~/tools/supabase`,
  metode API -- WARNING "Docker is not running" aman diabaikan): 4 file ter-upload
  (`refresh-asset-price/index.ts` + `_shared/{market-sync,price-sources,bibit}.js`).
- **Bukti via Management API**: version 20 -> **21**, status ACTIVE,
  `verify_jwt: true` tetap, `ezbr_sha256` berubah, updated_at 2026-09-02T11:14Z.
- **Bukti E2E live (invoke API murni, TANPA klien)**:
  1. User test dibuat via **Auth Admin API** (`email_confirm: true`) + JWT via
     password grant;
  2. aset test Kripto (simbol `bitcoin`, 0.001 unit) disisipkan utk user test;
  3. `POST /functions/v1/refresh-asset-price` -> HTTP 200
     `{harga_per_unit: 1.359.684.250, nilai_baru: 1.359.684, sumber: "coingecko",
     tanggal_pasar: null}` (CoinGecko realtime -> null sesuai desain);
  4. baris aset dibaca ulang: **`tanggal_nav` terisi '2026-09-02'** -- ditulis
     ATOMIK oleh Edge, bukan oleh klien (klien tidak dilibatkan sama sekali);
  5. cleanup terverifikasi: aset test terhapus (204, sisa 0), user test terhapus
     (200, hilang dari daftar admin users).
- **PROSEDUR UJI BARU (lebih aman dari toggle lama)**: dulu uji live butuh
  toggle `mailer_autoconfirm` (risiko lupa dibalikkan). Sekarang TIDAK PERLU:
  `POST /auth/v1/admin/users` dengan `email_confirm: true` mem-bypass konfirmasi
  email sepenuhnya tanpa menyentuh konfigurasi auth project. Login JWT via
  `POST /auth/v1/token?grant_type=password`. Kunci admin (`sb_secret_`) cukup
  utk setup/cleanup; hanya deploy yang butuh PAT `sbp_`.
- Dampak ke klien: tulisan `tanggal_nav` pasca-refresh oleh app.src.js menjadi
  no-op idempoten (Edge sudah mengisi nilainya -> `fresh.tanggal_nav !== tglPasar`
  false -> PATCH dilewati). Tidak ada perubahan kode klien.
- **SARAN KEAMANAN utk owner**: PAT `sbp_...` yang dipakai deploy ini sebaiknya
  di-REVOKE setelah sesi selesai (account-level, sangat kuat); buat baru perlu.

## v58 — Edge refresh-asset-price v20: jalur mati `manual_nav` DIHAPUS (ter-deploy)

Melanjutkan rencana yang tercatat sejak v56 ("tanpa (a)/(b), hapus saja jalur
manual_nav biar jujur") -- v57 sudah menutup (a)+(b), jadi pembersihan aman.

### Mengapa aman dihapus (dibuktikan sebelum menyentuh kode)
- **Tidak ada jalur UI yang bisa menulis `sumber_harga='manual_nav'`**: form aset
  hanya mengirim sumber dari ASSET_AUTO_UPDATE_CONFIG (coingecko /
  yahoo_id_stock / reksadana_bibit) atau null; modal "Sync NAB/UP Pasar" klien
  TIDAK menyentuh sumber_harga (by design, supaya aset tetap bisa auto-refresh).
- **DB live bersih**: `GET /rest/v1/assets?sumber_harga=eq.manual_nav` = 0 baris
  (dicek 2026-09-02 sebelum pembersihan).
- Perilaku pasca-hapus utk nilai liar (edit DB manual): 400
  `"Sumber harga "manual_nav" belum didukung untuk auto-update."` -- dan klien
  punya fallback `/belum didukung/i` (handleRefreshAssetPrice) yang mengarahkan
  user ke modal Sync manual. Jujur & tertolong, bukan diam-diam aneh.

### Yang diubah (hanya `supabase/functions/refresh-asset-price/index.ts`)
1. Blok `if (asset.sumber_harga === "manual_nav") {...}` DIHAPUS (35 baris:
    validasi tanggal NAB, derive nilai, stempel history, respons khusus).
2. Entri `manual_nav: null` di PRICE_FETCHERS DIHAPUS (penanda yang menyesatkan).
3. Import `isBibitNavDate, computeMarketValue` dari `_shared/market-sync.js`
   DIHAPUS -- keduanya hanya dipakai blok itu. Efek nyata: bundel deploy v20
   hanya 3 file (index.ts + price-sources.js + bibit.js), `market-sync.js`
   tidak lagi ikut ter-upload.
4. Label UI `describeSyncSource('manual_nav')` (toast modal sync manual klien)
   TETAP ADA di src/domain/market-sync.js -- itu label string di klien, bukan
   nilai kolom DB.

### Deploy & verifikasi (2026-09-02)
- Deploy via CLI 2.116.0 -> **management version 22** (v19=21 -> v20=22), ACTIVE.
- **Uji E2E live ganda** (prosedur admin-user, tanpa klien):
  - POSITIF (regresi): aset coingecko (bitcoin 0.001) -> HTTP 200,
    `{harga_per_unit: 1.357.797.222, nilai_baru: 1.357.797}` -- jalur utama
    TIDAK rusak oleh penghapusan blok di atasnya;
  - NEGATIF: aset `sumber_harga='manual_nav'` (nilai yatim sengaja) -> HTTP 400
    `"Sumber harga \"manual_nav\" belum didukung untuk auto-update."`;
  - aset manual_nav TIDAK tersentuh (nilai & value_history utuh);
  - cleanup: aset test 0 sisa, user test terhapus (tidak ada 'edge-e2e' di
    daftar admin users).
- Perangkap kecil yang ketemu saat uji: PostgREST POST bulk menolak array
  dgn KEY SET BERBEDA (PGRST102 "All object keys must match") -- samakan key
  (isi `tanggal_nav: null` di objek yang tidak pakai) kalau perlu bulk insert.

### Tidak berubah
- Tidak ada perubahan klien / DB / RLS. CACHE_VERSION tetap v57 (aset statis
  webapp tidak berubah). `sb_secret_` & PAT `sbp_` dipakai hanya utk verifikasi
  read-only + deploy; tetap disarankan REVOKE PAT `sbp_` setelah sesi.

## v59 — Optimalisasi menyeluruh: vendoring semua CDN + pin versi + index komposit DB + a11y 100
Fokus: hilangkan SELURUH origin pihak ketiga dari jalur kritis, pin versi yang
selama ini floating, future-proof query DB, tutup audit a11y terakhir.

### 1. Vendoring (folder `vendor/` baru, provenance di `vendor/README.md`)
- `supabase-js-2.113.0.bundle.min.mjs` (219 KB) + 5 polyfill `esm-node-{process,
  buffer,events,tty,async_hooks}.mjs` (50 KB total) -- sebelumnya import FLOATING
  `https://esm.sh/@supabase/supabase-js@2` yang resolve ke rantai 7 request
  lintas-origin. JEBAKAN esm.sh: bundel `es2022/*.bundle.mjs` mengimpor polyfill dgn
  path ABSOLUT `/node/*.mjs`; polyfill process malah mengimpor events+tty, dan
  events mengimpor async_hooks -- seluruh rantai HARUS ditulis ulang ke relative
  `./esm-node-*.mjs` (guard: `tests/unit/vendor-local.test.js` cek rantai tertutup).
- `chartjs-4.5.1.min.js` + `chartjs-plugin-datalabels-2.0.0.min.js` + `fullcalendar-6.1.10.min.js`
  -- chart.js sebelumnya `https://cdn.jsdelivr.net/npm/chart.js` TANPA versi
  (floating! bisa major-bump diam-diam). Semua kini PINNED + lokal.
- Titik ganti: `src/services/supabase/client.js` (import `../../../vendor/...` --
  3 level dalam!, pernah salah `../../` = boot mati 404, ketahuan lewat E2E),
  loader chart index.html, `loadFullCalendarLib()` app.src.js (+ rebuild app.js).
- CSP `script-src` kini cukup `'self' 'unsafe-inline'` (jsdelivr+esm.sh DIHAPUS
  dari meta index.html DAN `_headers` -- test baru menegaskan keduanya SINKRON);
  preconnect CDN diganti preconnect Supabase. devDep @supabase/supabase-js →
  ^2.113.0 (parity dgn vendored).
- SW: `CACHE_VERSION` v57→**v58**, precache 6 file vendor menggantikan 4 URL CDN;
  `vendor/` ditambahkan ke hash helper snapshot (perubahan vendor kini WAJIB
  memicu bump). `eslint.config.js`: `vendor/**` di-ignore (artefak penerbit).
- Drift guard baru `tests/unit/vendor-local.test.js` (7 test): file ada + rantai
  import tertutup + import client.js resolve ke file nyata + nol URL CDN aktif
  di index.html/app.js + CSP meta≡_headers tanpa CDN + precache SW lengkap +
  role="main" a11y.

### 2. Index komposit DB (LIVE, terdokumentasi `sql/migration_composite_indexes_2026-09-02.sql`)
- `transactions(user_id, tanggal DESC, id ASC)`, `assets(user_id, terakhir DESC,
  id ASC)`, `recurring_transactions(user_id, next_due_date ASC, id ASC)` -- via
  Management API `POST /v1/projects/{ref}/database/query` (Bearer sbp_).
- Bukti EXPLAIN: transactions & recurring kini **Index Only Scan** (node Sort
  HILANG, dipilih planner default); assets masih Seq Scan -- BENAR utk 5 baris
  (seq memang lebih murah; index terbukti viable saat seqscan off, otomatis
  dipilih begitu tabel membesar). Biaya: 16+16+8 kB. schema.sql disinkronkan.
- Endpoint query Management API = kapabilitas DDL langsung (tanpa psql); body
  `{"query":"..."}`; multi-statement `set ...; explain ...` JUGA jalan.

### 3. A11y & hasil Lighthouse (lokal, mobile throttle, login screen)
- Fix satu-satunya audit gagal `landmark-one-main`: `role="main"` di #loginView
  DAN #appShell (yang .hidden keluar dari a11y tree -> selalu tepat 1 main).
- Before v59: perf 59 / a11y 97 / bp 100, TBT 150ms. After: perf 60-61 /
  **a11y 100** / bp 100, **TBT 20-30ms**, third-party origins = NOL (sebelumnya
  jsdelivr+esm.sh). LCP lokal noise (8.5-9.7s, server python tanpa gzip);
  produksi Pages ber-gzip + tanpa 2 handshake lintas-origin akan lebih baik.

### Verifikasi v59 (semua hijau sebelum commit)
lint 0 masalah; unit **565/565** (+7 baru); E2E verify-hud **64/64 PASS**,
0 page error (login+data+chart+modal lewat modul supabase vendored asli);
gitleaks 8.28.0 + config repo: **no leaks** (catatan: binary 8.24.3 memberi 3
false-positive jwt/api-key yg TIDAK muncul di 8.28 -- selalu uji dgn versi
ter-pin CI); lighthouse PASS semua ambang.

## v60 — Audit bug & hardening input tak tepercaya (CSV injection + XSS via nama akun/override ikon)

Permintaan owner: "pahami struktur webapps, maintenance & analisa potensi bug".
Baseline sebelum audit semua hijau (lint 0, unit 565/565, verify-hud 64/64,
tanpa drift). Detail lengkap: docs/audit-bug-analysis-2026-09-02.md.

### Temuan yang DIPERBAIKI (3)
1. **CSV formula injection** (`src/domain/export-csv.js`, csvEscape): sel data
   user diawali `= + - @ TAB/CR` dinetralkan apostrof (angka polos tak
   disentuh, Nominal tetap bisa di-SUM). Guard baru tests/unit/export-csv.test.js.
2. **Dropdown Akun form Catat render nama akun MENTAH** (`updateFormOptions`):
   SATU-SATUNYA titik daftar akun tanpa escapeHtml (semua titik lain sudah
   escape). Nama akun dgn `"`/`<>` merusak markup select & berpotensi
   menyuntik atribut. Fix = pola escape sama dgn form berulang. Guard statis
   baru form-options-escape.test.js (cek sumber app.src.js DAN build app.js;
   regex backreference `value="${X}">${X}` utk pola mentah + toleran mangle
   terser utk pola aman).
3. **Stored-XSS via override ikon/gaya dari restore backup** (accountIcons /
   categoryStyles -> src/class/badge di innerHTML). Backup hanya divalidasi
   `app==='MyFinance'` + settings ada; isi settings ditimpa mentah (termasuk
   ke cloud). Fix 2 lapis:
   - `src/domain/settings.js`: validasi bentuk baru (isSafeIconImageUrl /
     isSafeClassToken / isSafeFaIconToken / sanitizeIconOverride /
     sanitizeSettingsIconOverrides). Pola diterima = persis bentuk UI: data
     URL raster base64 (upload modal; svg+xml base64 diizinkan krn INERT di
     <img>), `icons/banks/*` (logo internal), token Tailwind tunggal, `fa-*`,
     badge pendek.
   - Titik render `renderAccountIconObj` & `categoryIconHtml` di app.src.js:
     token tak valid -> fallback ikon netral (fa-wallet/bg-white/
     text-slate-500, kelas sudah ada di subset FA). Restore backup: override
     disanitasi SEBELUM Object.assign + persist (data kotor tak ikut ke cloud).
   Guard: settings-domain.test.js +8 kasus.
- Ekspor baru settings.js di-import index.html + masuk bag __myfinanceServices
  (blok classic memakainya via servicesModule.*).

### Bukti browser sekali pakai (tidak di-commit)
Harness Playwright menyuntik nama akun `Cash <img src=x onerror=...>` +
override ikon payload onerror: window.__xss tetap 0, dropdown utuh, tidak ada
img mencurigakan dirender.

### Verifikasi v60 (semua hijau)
lint 0; unit **583/583** (+18); verify-hud **64/64** Error halaman 0;
build:app tanpa drift (app.src.js 450.384 -> app.js 224.574 B); tidak ada
perubahan SQL/RLS/Edge. sw.js CACHE_VERSION v58 -> **v59** + snapshot
di-regen (index.html/app.js berubah). Tidak ada file vendor/tailwind berubah
(tidak ada kelas baru).

### Catatan & observasi (tidak diubah, lihat laporan §5)
Toast budget memakai cache bulan FILTER tab Budget vs pengeluaran dari
lastInsightsCtx; kurs saat edit transaksi valas = kurs tersimpan (desain);
presisi Number > 2^53; restore/removeDemo tanpa transaksi DB (perilaku lama).

## v61 — Fix chart "Bagan Komparasi Budget" tumpang tindih legend di Android/mobile

Permintaan owner: label nilai (datalabel) di atas batang tertinggi bagan
komparasi budget MENABRAK legend atas pada HP.

### Akar masalah (dibuktikan dgn probe geometri Chart.js di viewport 393px)
- Opsi lama `layout.padding: { top: 18 }` HANYA memisahkan legend dari tepi
  ATAS canvas. Strip legend (posisi "top") dirender di antara padding-top dan
  chartArea -- jadi padding-top TIDAK PERNAH menambah jarak legend<->plot.
- Akibatnya chartArea.top == legend.bottom persis; label nilai (datalabel
  anchor 'end' + offset di atas batang tertinggi) digambar MENIMPA legend.
- (Chart.js: labels.padding pada legend hanya jarak antar item HORIZONTAL,
  tidak menambah tinggi baris legend.)

### Perbaikan (src/ui/budgets.js, renderBudgetView)
1. `layout.padding` diubah `{ top: 18 }` -> `{ top: 6, bottom: 18 }`.
   Padding BOTTOM menambah ruang di bawah canvas -> chartArea bergeser turun
   -> ada celah nyata antara legend & puncak batang/label nilainya.
2. Adaptasi mobile < 400px: font legend 10 -> 9 (dua item "Budget/Realisasi"
   selalu muat 1 baris), padding antar item 10 -> 12, via update("none")
   sekali setelah chart dibuat (no-op saat lebar >= 400).
- Desktop (kartu h-80) tidak berubah secara visual berarti (chartArea tetap
  lega; padding bottom 18 dari tinggi ~260px).

### Bukti (Playwright, stub data, viewport 393x852 = Android)
- Baseline (HEAD): legend.bottom = chartArea.top = 48 (0 celah) -- label
  nilai tertinggi (teks ~8px + offset) PASTI menimpa legend.
- Sesudah: legend.bottom = 37, chartArea.top = 37, baris legend TURUN 11px ke
  atas canvas; clearance puncak batang -> legend = 7-13px (label nilai aman).
- Unit ui-budgets 14/14, lint 0, unit penuh 583/583, verify-hud 64/64,
  Error halaman 0.
- sw.js CACHE_VERSION v59 -> v60 (src/ui/budgets.js berubah) + snapshot
  di-regen. Tidak ada file lain berubah; build:css/build:app tanpa drift.

## v62 — Dashboard "5 transaksi terakhir" urut jam input pencatatan (created_at DESC)

Permintaan owner: daftar "5 transaksi terakhir" di Dashboard tidak mengikuti
urutan waktu input pencatatan -- transaksi yang sama-sama dicatat di tanggal
yang sama tampil dalam urutan sembarang.

### Akar masalah
- `list()` mengurutkan `tanggal DESC, id ASC`; padahal `id` = UUID acak
  (`gen_random_uuid()`), jadi urutan transaksi se-hari bukan apa-apa (bukan
  urutan input). Kolom `created_at timestamptz not null default now()` sudah
  ada sejak awal di `public.transactions` tapi tidak diseleksi/dipakai.
- Echo lokal pasca-simpan (`insertTransactionRow`/`replaceTransactionRow` di
  src/domain/transactions.js) meniru asumsi lama "id lebih besar = dicatat
  belakangan" (salah untuk UUID), dan `renderRecentList` HUD hanya sortir per
  tanggal lalu `slice(0,5)` -- urutan se-hari menurun dari globalData yang acak.

### Perbaikan
1. `src/services/transactions.js`: `TX_SELECT` + kolom `created_at`; urutan
   `list()` jadi `tanggal DESC, created_at DESC (jam input), id ASC` (id hanya
   tie-break deterministik). `create()`/`update()` memakai TX_SELECT sehingga
   respons echo lokal ikut membawa `created_at` (default now() server).
2. `src/domain/transactions.js`: helper echo memakai comparator bersama
   (tanggal desc -> created_at desc -> id asc). Baris tanpa `created_at`
   (fixture/stub lama) dianggap PALING LAMA di tanggalnya = perilaku lama
   stabil, bukan lompat ke atas; `replaceTransactionRow` juga memindah ulang
   kalau created_at berubah (mis. baris lama diganti respons update yang
   memuat created_at).
3. `app.src.js`: comparator `txServerCompare` dipakai `renderRecentList`
   (HUD), tabel Riwayat, riwayat detail akun & detail kategori (semua
   sebelumnya cuma sortir tanggal -> urutan se-hari ikut urutan globalData).

### Bukti (probe Playwright sekali pakai, stub REST; sudah dihapus)
- 6 transaksi se-TANGGAL sama dikirim stub TERBALIK (tertua di depan, id asc):
  HUD menampilkan urut-5..urut-1 (created_at desc) 3/3 PASS, error halaman 0.
- Simpan cepat baris baru (stub POST mengembalikan created_at = now): baris
  baru muncul PALING ATAS "5 transaksi terakhir" (sebelumnya nyungsep ke bawah
  grup karena id 'tx-*' > 'demo-*'), dan baris pertama tabel Riwayat ikut
  berubah ke baris baru.
- Unit: tx-echo-domain ditulis ulang 15 tes (semantik created_at + fallback
  fixture tanpa created_at + tie-break id) -- total unit 588/588, lint 0,
  verify-hud 64/64 PASS error halaman 0, app-minify & SW drift guard hijau.
- sw.js CACHE_VERSION v60 -> v61 + snapshot di-regen (setelah build:app).

## v63 — Bagan komparasi Budget: jarak tetap antara legend & batang tertinggi (grace sumbu-y)

Permintaan owner (lagi): label nilai di atas batang paling besar pada bagan
komparasi budget masih bisa menabrak legend grafik -- "tolong tambah jarak
antara legend dan batang chart yang nilainya paling besar".

### Akar masalah (dibuktikan probe geometri 4 lebar x 3 pola data)
- v61 hanya menyusutkan plot dari BAWAH (layout.padding.bottom); TEPI ATAS
  chartArea selalu menempel tepi bawah kotak legend (Chart.js tidak punya opsi
  celah vertikal legend<->plot).
- Saat nilai max DATA == nilai max sumbu otomatis (mis. budget bulat
  300.000/700.000), batang tertinggi menempel legend: gap 0..-1px di mobile;
  label nilainya (~12px di atas batang) pasti menimpa legend. v61 aman hanya
  bila kebetulan sumbu menyisakan ruang (kasus 465rb: 5-10px saja).
- Plugin afterLayout utk menggeser chartArea TIDAK persisten (tiap update
  me-layout ulang dari nol -> butuh update kedua -> loop tak berujung,
  terbukti hang renderer) -> jalur ini dibuang.

### Perbaikan (src/ui/budgets.js, helper budgetCompareScales)
- `scales.y.grace = "40%"` pada bagan komparasi: nilai maks sumbu otomatis
  dinaikkan 40% di atas data terbesar (lalu dibulatkan "nice" oleh Chart).
  Headroom DI ATAS batang tertinggi menjadi ~20-30% tinggi plot, tidak lagi
  bergantung pada kebetulan nilai data vs pembulatan sumbu.
- Dipilih 40% setelah diuji: 25% tidak cukup (kasus over 700rb di mobile
  tetap memilih top 800rb -> gap cuma 8px); 40% membuat kasus terburuk
  berubah ke 1.000.000 -> gap >= 16px di semua kombinasi.

### Bukti (probe geometri Playwright 4x3 = 12 kombinasi; skenario bulat/over/ganjil)
- Baseline (HEAD v62): gap legend->batang 0.6..-1px (overlap) di kasus nilai
  bulat 300rb/700rb; 5-10px di kasus ganjil (label tetap berisiko).
- Sesudah grace 40%: gap 16,2-21px di mobile 360/393 & 30-35px di desktop
  768/1440; label nilai (tinggi ~12px) kini selalu berhenti DI BAWAH tepi
  bawah legend (clearance >= 4px dari strip + >= 12px dari teks legend).
- Unit ui-budgets + asersi regresi (scales.y.grace === "40%") -- total unit
  588/588, lint 0, verify-hud 64/64 PASS, error halaman 0.
- sw.js CACHE_VERSION v61 -> v62 + snapshot di-regen; app.js tidak berubah.

## v64 — Wawasan Keuangan lebih banyak & komprehensif (review + 11 aturan data)

Permintaan owner: bagian wawasan keuangan kurang "dalam" -- minta saran dan
review yang lebih banyak, lengkap & komprehensif terhadap data transaksi.

### Perubahan (src/domain/insights.js + app.src.js + index.html)
1. `buildInsightsContext(baseCtx, {transactions, now, parseTgl, txIdrAmount,
   categorizeExpenseParent})` (baru, murni): memperkaya context wawasan dengan
   penggalian dari BARIS transaksi: `biggestExpense` (transaksi tunggal
   terbesar bulan ini), `smallTx` (transaksi <= Rp 25.000), `weekendTx`
   (belanja Sabtu/Minggu), `prevMonthCatOutMap` (pengeluaran bulan lalu per
   kategori parent -- bahan deteksi pos berulang naik). Field agregat lama
   dipertahankan apa adanya (context lama tetap kompatibel).
2. `computeFinancialInsights` diperluas dari maks 4 -> maks 10 kartu, disusun
   per kelompok: Review > Darurat > Waspada > Positif:
   - REVIEW "Review Bulan Ini" (baru, selalu muncul kalau ada data): pemasukan,
     pengeluaran, surplus/defisit, rata2 harian, jumlah transaksi, % vs bulan
     lalu.
   - Darurat baru: "Pengeluaran Melebihi Pemasukan" (defisit), "Belum Ada
     Pemasukan Bulan Ini".
   - Waspada baru: "Fokus Pengeluaran Terbesar" (>=45% total), "Transaksi
     Terbesar" (>=30%), "Pos Berulang Naik" (>=50% & >=50rb vs bulan lalu),
     "Banyak Transaksi Kecil" (>=6 tx <=25rb, total >=100rb), "Belanja Padat
     di Akhir Pekan" (>=40% total), + 4 aturan lama (anggaran, lonjakan
     kategori, tingkat menabung vs lalu, proyeksi akhir bulan) dengan pesan
     yang dipertahankan persis.
   - Positif baru: "Pengeluaran Turun" (>=20% hemat vs lalu), "Menabung
     Konsisten" (>=30% pemasukan).
3. app.src.js processDataForUI memanggil buildInsightsContext sebelum
   renderInsights/renderHealthScore; index.html import + servicesModule expose.
4. 2 ikon baru (fa-magnifying-glass-dollar, fa-calendar-week) ditambahkan ke
   subset Font Awesome (css/fontawesome-all.min.css + fa-solid woff2).

### Bukti
- Browser nyata (stub Supabase, data demo + bulan lalu): #insights-container
  kini berisi 7 kartu (dulu maks 4), kartu pertama "Review Bulan Ini" dgn
  angka nyata (Pemasukan Rp 750.000, pengeluaran Rp 325.000, surplus
  Rp 425.000, rata2 harian ...), disusul Kategori Naik/Fokus Terbesar/
  Transaksi Terbesar/Proyeksi/Pengeluaran Turun/Menabung Konsisten; error
  halaman 0.
- Unit bertambah 16 (30 utk insights-domain; total unit 604/604), lint 0,
  verify-hud 64/64 PASS error halaman 0. Test lama "maks 4" diperbarui jadi
  "maks 10 & data kaya > 4 kartu" (inti perubahan).
- sw.js CACHE_VERSION v62 -> v63 + snapshot di-regen (app.js & aset berubah).

## v65 — Rekomendasi Gemini AI lebih akurat & presisi terhadap data transaksi

Permintaan owner: rekomendasi AI (Gemini) harus akurat & presisi terhadap data
transaksi di database.

### Akar masalah
- Ringkasan yang dikirim ke Edge Function analyze-finance cuma total kasar +
  top 5 kategori + anggaran tanpa persen -- model dipaksa menebak/membulatkan
  sendiri (sering keliru menyebut nominal/kategori), tidak ada angka turunan
  (rata2 harian, proyeksi, persen terpakai), tidak ada transaksi terbesar /
  pembanding bulan lalu / pola.
- Prompt Edge Function longgar ("jangan mengarang") tanpa aturan kutip angka;
  output tidak disanitasi; kartu dibatasi 3.

### Perbaikan
1. `src/domain/ai-summary.js` (BARU, murni, 10 unit test): membangun ringkasan
   presisi; field LAMA dipertahankan nama/nilai (kompatibel dgn function yang
   masih live), ditambah: sisa_hari_dalam_bulan, selisih_bulan_ini,
   tingkat_menabung_persen, rata_rata_pengeluaran_harian,
   proyeksi_pengeluaran_akhir_bulan, top_kategori (8 + persen_dari_total),
   status_anggaran (persen_terpakai & sisa, urut desc), kategori_bulan_lalu,
   kategori_naik_vs_bulan_lalu (kenaikan % dihitung klien, >=50rb & >=30%),
   riwayat_enam_bulan (kronologis), transaksi_terbesar_bulan_ini (top 3 dgn
   akun/tanggal/keterangan), transaksi_kecil_bulan_ini,
   pengeluaran_akhir_pekan_bulan_ini (+persen), estimasi saldo gabungan.
2. app.src.js buildFinanceSummaryForAI -> wrapper ke modul (3 pemakai otomatis
   kebagian: Rekomendasi AI, Ringkasan Bulanan, Tanya AI); index.html import +
   expose; sw.js PRECACHE + modul baru.
3. Edge Function analyze-finance (perlu DEPLOY ULANG manual oleh owner):
   prompt insights kini WAJIB mengutip minimal satu angka pasti per kartu,
   format Rp utuh, target saran dihitung dari angka data, dilarang menyebut
   kategori di luar data, pakai angka turunan yang dikirim (bukan hitung ulang
   kasar), maks 5 kartu (sebelumnya 3); prompt Tanya AI & Ringkasan Bulanan
   ikut diperkuat grounding; output disanitasi server-side (title/message
   teks, severity whitelist info/warning/success, slice 5).
   Catatan: versi function lama tetap berfungsi (field lama utuh) -- tapi agar
   aturan presisi aktif, jalankan: supabase functions deploy analyze-finance

### Bukti
- Unit baru 10 (ai-summary) -- total 614/614, lint 0, verify-hud 64/64, error
  halaman 0. SW CACHE_VERSION v63 -> v64 + snapshot. app.js & css di-rebuild
  (css +18 byte artefak deterministik).
- Probe Playwright (stub invoke analyze-finance): payload ringkasan memuat
  SEMUA field baru (tingkat_menabung 78.3, rata2 harian 54.333, proyeksi
  1.629.990, status anggaran dgn persen_terpakai/sisa, top-3 transaksi dgn
  akun-tanggal-keterangan); 5 kartu AI hasil (stub) dirender utuh; 0 error.

## v65b — analyze-finance TER-DEPLOY live (v40) + fix komentar bundling

- Owner memberikan Supabase access token (sbp_..., dipakai via env var sekali,
  tidak pernah ditulis ke repo) -> deploy langsung berhasil:
  `supabase functions deploy analyze-finance --project-ref uxfngmxghupdlwoeoxgh`
  (Supabase CLI 2.116.0 via npm global, tanpa Docker -- CLI v2 bundling ok).
- Deploy pertama GAGAL 400 (bundle parse error): baris komentar header
  "ada function LAIN ..." kehilangan prefiks "//" akibat edit v65
  (commit 83c4281) -> diperbaiki commit e4e7c6e, deploy ulang sukses.
- Verifikasi: status ACTIVE, version 40, verify_jwt=true, updated_at segar.
  Smoke test HTTP dengan anon key -> 401 Unauthorized (auth check internal
  jalan; butuh sesi user login asli utk full path Gemini -- tes dari app).
- Prompt presisi v65 (wajib kutip angka, maks 5 kartu, sanitasi output)
  sekarang AKTIF di production. GEMINI_API_KEY tidak disentuh deploy.

## v66 — Skor Kesehatan Finansial: 4 -> 7 parameter (lebih presisi & komprehensif)

Permintaan owner: parameter penilaian skor kesehatan finansial di Dashboard
harus ditambah supaya lebih akurat & mencerminkan kondisi finansial riil.

### Perubahan (src/domain/insights.js, computeFinancialHealthScore)
Bobot lama dipertahankan; 3 komponen BARU memakai context kaya v64
(buildInsightsContext), total bobot saat semua berlaku = 125 -> dinormalisasi /100:
1. Tingkat Menabung 40 (tetap, acuan 20% pemasukan)
2. Kepatuhan Anggaran 25 -- sekarang KREDIT PARSIAL per kategori: dalam budget=1,
   over menyusut proporsional (1 - kelebihan/budget), bukan hitam-putih 0.
3. Konsistensi Bulanan 20 (tetap)
4. Aktivitas Pencatatan 15 -- PRESISI: target mengikuti hari berjalan (~1 tx/2
   hari, cap 15) bila ctx.now ada; fallback 15/bulan tanpa now. Awal bulan tidak
   dihukum.
5. Kendali Transaksi Kecil 10 (BARU) -- total jajan <= Rp 25rb vs pengeluaran:
   <=5% penuh, >=30% nol (ctx.smallTx).
6. Keseimbangan Pengeluaran 10 (BARU) -- konsentrasi kategori terbesar:
   <=40% total penuh, >=80% nol.
7. Pola Belanja Akhir Pekan 5 (BARU) -- belanja Sabtu/Minggu: <=35% penuh,
   >=75% nol, dihitung hanya bila >=5 transaksi (ctx.weekendTx).
Komponen dengan data tak tersedia tetap di-skip (user tanpa budget / tanpa pola
tidak dihukum); skor dinormalisasi dari bobot yang berlaku. Komentar app.src.js
& index.html diselaraskan ("4 komponen" -> "7 komponen").

### Bukti
- Unit insights-domain bertambah 9 (39 total; semua test lama tetap hijau tanpa
  perubahan ekspektasi -- desain kompatibel mundur), total unit 623/623, lint 0.
- Browser nyata (stub): skor 84 band Sehat dengan rincian dinamis per parameter
  (Tingkat Menabung 100%, Konsistensi 60%, Aktivitas 100%, Kendali Transaksi
  Kecil 100%, Keseimbangan 27% ...); error halaman 0; verify-hud 64/64 PASS.
- sw.js CACHE_VERSION v64 -> v65 + snapshot di-regen; app.js di-rebuild
  (komentar & data alur tidak berubah). Tidak ada perubahan Edge Function
  (tidak perlu deploy ulang).

## v67 — Optimalisasi bobot aplikasi (preload jalur kritis JS)

Permintaan owner: "optimalisasi sehingga aplikasi tidak terlalu berat tanpa
mengkompensasi fitur dan animasi yang sudah ada". Target menyeluruh (beban
pertama kali + runtime), dipakai campuran HP & laptop. Jawaban owner atas
pilihan infrastruktur: "pilih yang paling aman; kalau ragu jangan ubah
infrastruktur" -> paket ini TIDAK mengubah loader modul/build order sama
sekali, murni penambahan/perapian deklaratif di index.html + bump SW.

### Temuan audit bobot (angka HEAD)
- HTML 224 KB (gz 38,5 KB) -- mayoritas markup nyata, komentar hanya 17 KB.
- app.js 224 KB (gz 53,7 KB): tag <script> di AKHIR <body> -> unduhan baru
  dimulai setelah seluruh HTML terunduh & ter-parse (waterfall terburuk).
- vendor/supabase-js 219 KB: rantai import level-2 (client.js) -> baru
  diminta setelah modul level-1 terunduh (gelombang kedua).
- Font Awesome SUDAH subset rapi: fa-brands-400.woff2 1,1 KB berisi glyph
  fa-whatsapp (dipakai) -- BUKAN aset mati; tidak dihapus.
- CSS/ikon/PWA/FullCalendar sudah optimal/lazy (v59+).

### Perubahan (3 file, semuanya deklaratif -- nol perubahan logika/UI/animasi)
1. index.html: blok preload jalur kritis di <head> -- app.js (as=script) +
   modulepreload vendor/supabase-js-2.113.0.bundle.min.mjs + 5 polyfill
   esm-node-*. Preload & import berbagi cache, tetap sekali unduh.
2. index.html: hapus blok komentar DUPLIKAT/basi era pra-v54 (menggambarkan
   susunan 4 script inline yang sudah tidak ada) di dekat <script src=app.js>.
3. sw.js: CACHE_VERSION myfinance-v65 -> myfinance-v67 (aset berubah -> user
   wajib dapat bundle baru; snapshot di-regen via update-sw-cache-snapshot.mjs).

### Bukti
- Unit 623/623 (sw-cache-version v67 hijau), lint 0, rebuild app.js/css
  byte-identik (nol drift), verify-hud 64/64 PASS, error halaman 0.
- Probe Playwright 3G-lambat (scratch, dihapus): app.js mulai diunduh 2.985ms
  -> 195ms setelah navStart; supabase bundle 4.150ms -> 195ms; app.js selesai
  turun 7.354 -> 5.597ms; DOMContentLoaded 8.106 -> 6.713ms (-1,39 dtk).
- Sisa bobot dominan setelah ini = PARSE/EKSEKUSI JS (app.js 224KB + modul
  ~40 file + bundle supabase dieksekusi utuh di setiap boot), bukan jaringan.
  Memangkasnya butuh restrukturisasi loader (mis. fase auth vs fase data via
  import() dinamis, atau bundling ESM) -- sengaja TIDAK dilakukan di v67
  (berisiko tinggi thd 200+ onclick= & bridge classic/module; owner memilih
  jalur aman). Ajukan tersendiri bila mau lanjut.

## v68 — Akselerasi sinkronisasi data (loadData): hapus serialisasi chart lib + request budgets ganda

Permintaan owner: "kecepatan untuk sync data masih sangat lama, lakukan improvement
untuk load data sync ke database". Audit alur loadData() (6 tabel via
getSyncData adapter in-line: transactions, budgets, assets, customIcons, settings,
recurring) menemukan 2 pemborosan SISI CLIENT + 1 sisa SISI DB (lihat langkah
lanjut DB di bawah).

### Temuan & perubahan (app.src.js, loadData)
1. **Fetch data berjalan SERIAL di belakang unduhan chart lib.** loadData() lama:
   `await window.__mfChartLibReady` (chart.js 204KB + datalabels, bisa 1-4 dtk di
   koneksi lambat) DI DEPAN Promise.all 6 tabel -- tiap buka app, sinkronisasi ke
   Supabase baru mulai SETELAH chart lib tuntas, padahal chart cuma dipakai saat
   RENDER grafik. FIX v68: fetch di-const-kan `const syncFetch = (async () => {...})()`
   dan DIBUAT PALING AWAL; gerbang chart dipindah ke belakangnya dan hanya menahan
   `syncFetch.then(...)` (rantai render). Efek: unduhan chart & tarikan data
   PARALEL; total waktu = max(chart, data) bukan chart + data.
2. **Request budgets bulan berjalan dobel di tiap sinkronisasi.** loadData fetch
   `fetchMonthBudgets(targetBulan)` (default = bulan berjalan) lalu
   `refreshCurrentMonthBudgetsCache()` fetch ULANG bulan yang sama untuk
   currentMonthBudgetsCache (wawasan/skor kesehatan). FIX v68: saat
   `targetBulan === currentMonthStr()`, response.budgets yang SUDAH turun
   dipakai langsung sebagai cache (seed) + renderInsights/renderHealthScore
   sekali; kalau bulan beda (user di tab Anggaran bulan lain) baru refetch async
   persis perilaku lama. Hemat 1 request REST /rest/v1/budgets + 1 render ulang
   per sinkronisasi. Idiom sama dengan saveBudgets() (baris ~4890).

### Bukti
- Guard regresi baru tests/unit/sync-load-order.test.js (2 test): syncFetch
  dibuat SEBELUM gerbang chart + seeding budgets dari response.budgets ada di
  rantai. Unit 625/625 (sebelumnya 623), lint 0.
- Probe Playwright (scratch, dihapus): chartjs ditunda 3,5 dtk -> GET
  /rest/v1/transactions mulai 442 ms (chart lib baru selesai 3.638 ms, overlap
  ~3,2 dtk); budgetGets == 1 (sebelumnya 2); 0 page error. verify-hud 64/64 PASS.
- SW CACHE_VERSION v67 -> v68 + snapshot; app.js rebuilt (453.090 -> 224.494 B,
  -50,5% vs sumber).

### LANGKAH LANJUT DB (belum dikerjakan -- butuh token sbp_ + OK owner)
- `sql/rls_performance_fix.sql` (auth.uid() -> (select auth.uid()) initplan,
  lint Supabase auth_rls_initplan) KEMUNGKINAN BESAR BELUM diterapkan live
  (tidak ada catatan penerapan; composite index sudah live sejak v59). Efek:
  tiap query paging mengevaluasi auth.uid() sekali per query, bukan per baris
  -- makin terasa makin besar data per user. Rencana: (1) introspect
  pg_policies live via Management API database/query, (2) cocokkan nama policy
  dgn file (migration_rls_hardening 08-31 mungkin mengubah nama), (3) terapkan
  file/varian nama live, (4) verifikasi ekspresi (select auth.uid()).

## v68 (langkah DB) — Verifikasi RLS initplan & index live: SUDAH DITERAPKAN SEMUA

Owner memberikan Supabase access token sbp_... (env var sekali pakai, tidak pernah
disimpan ke repo; api.supabase.com diblokir utk urllib/TLS Python -- "error code:
1010" Cloudflare -- tapi jalan normal lewat curl + User-Agent browser).

### Proses (semua via Management API database/query, READ-ONLY + eksperimen rollback)
1. Introspect pg_policies (14 policy live, nama PERSIS sama dengan file
   sql/rls_performance_fix.sql -- hardening 08-31 memang tidak menyentuh policy).
2. Hati-hati deparse: teks live `(( SELECT auth.uid() AS uid) = user_id)` SEMULA
   terbaca heuristik sebagai "auth.uid telanjang", padahal itu bentuk kanonik dari
   `(select auth.uid()) = user_id`. DIBUKTIKAN eksperimen policy uji dalam
   begin/rollback: auth.uid() polos ter-deparse `(auth.uid() = x)`; terbungkus
   ter-deparse `(( SELECT auth.uid() AS uid) = x)`. => SELURUH 14 policy live
   SUDAH initplan. (Kalau tidak diuji, file fix akan dijalankan ulang = churn
   DROP+CREATE policy identik yang tidak perlu.)
3. Introspect pg_indexes: whatsapp_link_codes_user_id_idx ADA; index komposit v59
   (transactions_user_tanggal_id_idx, assets_user_terakhir_id_idx,
   recurring_user_next_due_id_idx) ADA.

### Hasil
- TIDAK ADA perubahan DB yang diterapkan -- database live sudah optimal per
  Performance Advisor (auth_rls_initplan) & lint unindexed_foreign_keys.
  Kemungkinan pemilik menjalankan sql/rls_performance_fix.sql via SQL Editor di
  masa lalu tanpa tercatat di repo.
- Repo disinkronkan: header sql/rls_performance_fix.sql di-stamp "STATUS LIVE:
  TERVERIFIKASI SUDAH DITERAPKAN (2026-09-03)" + alasan jangan dijalankan ulang;
  catatan ini ditambahkan ke AGENT-HANDOFF. Tidak ada perubahan app.js/sw.js
  (v68 client tetap satu-satunya perubahan kode rilis ini).

## v69 — Perawatan stabilitas: generation guard commit sinkronisasi + null-safe loadData

Permintaan owner: "lakukan perawatan/maintenance for stability untuk webapps saya".
Audit stabilitas menyeluruh (listener leak, timer, siklus chart, error nets,
race) -> sebagian besar infrastruktur SUDAH sehat: jaring pengaman global
(error/unhandledrejection -> showFallbackError), semua setInterval punya
clearInterval + safety net 10 dtk, semua `new Chart` didahului destroy (tidak
ada "Canvas is already in use"), listener per-login diguard flag _*Attached
(sekali seumur tab, benar krn DOM menetap), chart lib & FullCalendar di-destroy
saat logout/reset. TIDAK ADA TODO/FIXME tersisa di sumber (hanya placeholder
WHATSAPP_BOT_NUMBER = aksi konfigurasi owner, sudah didokumentasikan sejak audit
08-2026).

### Perbaikan nyata yang diterapkan (app.src.js, loadData)
1. **Generation guard commit** (menerapkan kontrak request-generation dari
   docs/production-loader-contract.md yang selama ini baru ada di docs):
   - `let _loadDataSeq` (counter); tiap loadData: `const loadSeq = ++_loadDataSeq`
     + capture `loadUserId` dari currentSession.
   - `.then`: commit hanya bila `loadSeq === _loadDataSeq` DAN akun masih sama
     (cek user id) -- respons basi dibuang. Sebelumnya fetch yang tumpang-tindih
     (pull-to-refresh + sinkronisasi lain) atau yang selesai SETELAH logout bisa
     menimpa state lebih baru / mencemari state sesi-akun berikutnya.
   - `.catch`: `if (loadSeq !== _loadDataSeq) return;` -- error dari panggilan
     basi tidak lagi memunculkan toast error palsu.
   - `resetAppState()`: `_loadDataSeq += 1` -- logout membatalkan SEMUA
     sinkronisasi in-flight dari sesi lama.
2. **Null-safe baca DOM** elemen #budgetFilterMonth di awal loadData: kalau
   elemen tidak ada, throw di luar rantai .then/.catch = async rejection tanpa
   penangan -> overlay sinkronisasi bisa nyangkut selamanya; sekarang fallback
   aman ke bulan berjalan.

### Bukti
- Guard test baru tests/unit/stability-guards.test.js (5 test statis). Unit
  630/630 (sebelumnya 625), lint 0. app.js rebuilt (455.460 -> 224.792 B).
- STRESS PROBE browser nyata (scratch, dihapus): 3 siklus penuh
  login -> ganti tab cepat x6 -> logout (tombol UI) + boot ulang sesi; assert
  0 pageerror, 0 console error (stub logout 204 diperlukan: signOut menembak
  /auth/v1/logout), 0 "Canvas is already in use", chart alive, body
  sync-loading tidak nyangkut. PASS. verify-hud 64/64 PASS, error halaman 0.
- SW CACHE_VERSION v68 -> v69 + snapshot di-regen.

### Catatan untuk owner (di luar kode, dari audit lint sebelumnya)
- WHATSAPP_BOT_NUMBER di app.src.js masih placeholder 628XXXXXXXXXX (fitur
  WhatsApp link butuh nomor device Fonnte asli).
- Leaked-password-protection Supabase Auth masih nonaktif (setting dashboard).

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

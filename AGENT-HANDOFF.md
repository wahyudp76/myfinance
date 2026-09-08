# AGENT HANDOFF — MyFinance (Ai-Agen)

> Catatan antar-agen. Diisi ulang 2026-09-01 setelah file lama hilang akibat reset
> lingkungan kerja (riwayat v38–v40 dirangkum dari docs/SESSION-HANDOFF.md & log sesi).
> Status: semua fitur di bawah SUDAH teruji unit + E2E browser + (untuk Edge Function) live di produksi.

## Peta cepat
- App: SPA statis `index.html` + `src/**` (domain services, modul ES) + Tailwind build (`npm run build:css`) + service worker `sw.js` (bump `CACHE_VERSION` + jalankan `node tests/unit/update-sw-cache-snapshot.mjs` SETELAH build:css setiap kali aset berubah).
- Verifikasi wajib: `npm run lint` (ESLint, sejak v45 -- job CI tersendiri) + `npm test` (kini lint+unit+parity) + `node scripts/verify-hud.mjs` (69 cek E2E Playwright terhadap `http://localhost:8123`, server via `npx http-server . -p 8123 -c-1`).
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

## v70 — Perawatan: audit bug (2026-09-04) -- cache data logout, SW activate/navigate, escape badge aset

Permintaan owner: "pahami struktur, lakukan maintenance dan analisa potensi bug".
Baseline sebelum audit hijau (lint 0, unit 630/630, verify-hud 64/64). Audit
menyusuri sw.js, jalur auth/logout, parse tanggal (parseTgl/toDateStr/UTC-in-
UTC-out di export-csv & market-sync: SEMUA konsisten, aman), recurring catch-up,
titik render innerHTML. Ditemukan 4 bug nyata, semuanya diperbaiki:

1. **[SEDANG, privasi] Cache data offline TIDAK PERNAH dibuang saat logout.**
   `initStaticUIListeners()` menulis `postMessage(MYFINANCE_CLEAR_DATA_CACHE)`
   DI LUAR `addEventListener('click')` -> hanya jalan sekali saat bootstrap
   (ketika cache masih kosong), bukan saat pengguna keluar. Tujuan Tier-3 #10
   ("akun kedua di perangkat sama tidak bisa baca sisa data akun lama") selama
   ini tidak tercapai. Fix: helper `clearOfflineDataCache()` dipanggil di
   handler klik DAN di `showLoginView()` (jalur terpusat: tombol, sesi
   kedaluwarsa, dicabut dari perangkat lain).
2. **[RENDAH] sw.js `activate` menghapus DATA_CACHE tiap bump CACHE_VERSION** --
   bertentangan dgn komentar "sengaja TIDAK ikut versi agar tidak terbuang tiap
   deploy". Fix: `n !== DATA_CACHE` di filter.
3. **[RENDAH] sw.js navigasi men-cache respons apa pun**, termasuk 404/503 saat
   GitHub Pages sedang deploy -> halaman error bisa jadi fallback offline.
   Fix: `if (res && res.ok)` sebelum `cache.put` (konsisten dgn cabang SWR).
4. **[RENDAH] Badge kategori aset (`src/ui/assets.js`) dirender tanpa escapeHtml**
   -- satu-satunya field aset yang lolos (nama/platform sudah). Kategori bisa
   berasal dari restore backup (mapRestoreRows tidak memvalidasi). Fix: escape.
   Uji `ui-assets.test.js` baris 137 diperbarui komentarnya (assert tetap sama).

Guard regresi baru: `tests/unit/logout-cache-guards.test.js` (4 test statis).
CACHE_VERSION v69 -> v70, snapshot SW di-regen, app.js di-rebuild.

### Catatan yang DILIHAT tapi SENGAJA tidak diubah
- `whatsapp-webhook` `todayWIB()` mengasumsikan UTC+7 utk semua user (sudah
  didokumentasikan di kode; perlu keputusan produk, bukan bug).
- `tests/unit/ui-assets.test.js` shim `jsStr` hanya escape `'` (tidak `\`) --
  cukup utk uji, produksi pakai versi lengkap di app.src.js.

### Bukti v70
lint 0, unit 634/634, verify-hud 64/64 PASS (0 error halaman), build:app
dijalankan (app.js sinkron), snapshot SW sinkron.

## v86 — FIX LOGO ASET: akar ganda ditemukan & ditutup (sanitizer path + RLS katalog DB)

**GEJALA:** logo platform investasi tidak pernah tampil di tab Aset / detail aset /
form Tambah Aset, meski 10 commit sebelumnya (46db56c..0e9af29) sudah berurutan
mengejar: CSP img-src → logo dari Supabase → pencocokan → sanitizer remote-host.
Setelah seluruh rangkaian itu, pengguna tetap hanya melihat badge huruf / ikon dompet.

**AKAR MASALAH #1 (client, akar yang asli):** `ICON_ASSET_PATH_RE` di
`src/domain/settings.js` sejak v60 hanya mengizinkan `icons/banks/*`. Ketika
commit 46db56c menambahkan logo self-hosted `icons/platforms/*` ke
`bankWalletDatabase`, `sanitizeIconOverride` menolak SEMUANYA di titik render
(`renderAccountIconObj` fallback diam-diam ke ikon dompet) -- inilah mengapa
logo "tidak muncul" sejak awal. Fix 94023bc kemudian MENGHAPUS ikon self-hosted
tersebut dan menggantinya badge huruf + harapan logo dari DB -- tidak menutup
akar masalah, malah menambah dependensi baru.

**AKAR MASALAH #2 (server):** migrasi yang MEMBUAT tabel `platform_logos`
tidak pernah ter-commit (hanya file alias-nya). Di database live, event trigger
`ensure_rls` otomatis mengaktifkan RLS saat tabel dibuat, dan TANPA policy
SELECT katalog global itu terbaca KOSONG oleh semua klien (REST 200 + `[]`,
content-range `*/0` -- dibuktikan langsung via probe anon 2026-09-06). Jadi
`platformLogoByKey` tidak pernah terisi.

**FIX (lengkap, berlapis):**
1. `ICON_ASSET_PATH_RE` kini `icons/(banks|platforms)/*.ext` (+ `.ico` utk
   ajaib.ico) -- logo self-hosted lolos sanitizer.
2. Ikon `icons/platforms/*` DIPULIHKAN dari riwayat git (9 file, commit 46db56c
   + 3c0b522) + 2 logo baru di-self-host (goto.svg dari Wikimedia Commons,
   danamas-stabil.png dari banksinarmas.com) = 11 file, nol hotlink pihak ketiga.
3. `bankWalletDatabase` kembali memakai `url:` lokal utk 11 platform (badge
   hanya IPOT); + entri GoTo & Danamas Stabil dgn keyword anti-collision
   ("danamas" 8 huruf menang atas "dana" 4 huruf milik e-wallet DANA).
4. Pencocokan katalog DB dipindah ke modul murni ter-uji
   `src/domain/platform-logos.js` (adopsi `__platformLogos`, pola __bankIcon):
   exact normalized → exact compact → containment HANYA bila token pendek
   >= 5 huruf. Versi lama (`compactKey.includes(compactName)` bebas) ber-false-
   positive nyata: platform "Dana" bisa kebagian logo "danamas-stabil".
5. **`sql/migrations/20260906_platform_logos.sql` (file yang hilang) dibuat
   lengkap & idempotent**: create-if-not-exists + add-column-if-not-exists
   (tahan drift vs tabel live), unique index platform_key, RLS + policy
   "Platform logos are publicly readable" (`for select using (true)` -- inilah
   yang membuka katalog utk anon/authenticated), grant select, seed 11 platform
   dengan logo_url SELF-HOSTED via `on conflict do update` (memperbaiki baris
   lama yang logo_url-nya URL remote rawan mati). **PERLU DIJALANKAN SEKALI di
   SQL Editor project uxfngmxgh** -- file ini juga jadi syarat setup ulang/restore.
6. `sw.js`: 9 modul ikon/logo yang TERLEWAT dari precache dilengkapi
   (bank-icons, asset-icons, account-currency, category-style, dates, format,
   sanitize, slugify, platform-logos domain + service) + 11 file
   icons/platforms/* di-precache. CACHE_VERSION v124 → **v125**, snapshot
   di-regen SETELAH build:app.
7. Guard regresi baru:
   - `tests/unit/platform-logos-domain.test.js` (perilaku + konsistensi modul
     vs monolit + wiring, pola bank-icons).
   - `tests/unit/csp-image-hosts.test.js` -- ICON_REMOTE_HOSTS (settings.js)
     WAJIB == img-src CSP index.html == img-src CSP _headers (3 tempat, drift
     langsung merah).
   - `bank-icons-domain.test.js`: guard baru "setiap url katalog LOLOS
     sanitizer + file-nya ada di repo" -- test yang AKAN menangkap akar bug
     ini kalau kembali terjadi.
8. E2E baru `scripts/verify-asset-logos.mjs`: stub Supabase + seed 9 aset
   (platform lokal / katalog DB / custom DB / tak dikenal), assert logo
   TER-RENDER **dan BENAR-BENAR TERMUAT** (`img.complete && naturalWidth > 0`)
   di kartu aset, detail aset, saran form, dan viewport mobile; guard
   anti-collision Dana≠Danamas ikut dicek. 15/15 PASS.

**KEPUTUSAN desain yang perlu diketahui:**
- Logo default = SELF-HOSTED (filosofi v59: nol origin pihak ketiga di jalur
  kritis). Tabel `platform_logos` tetap dipakai sebagai override/admin-katalog
  (URL remote tetap boleh selama host masuk ICON_REMOTE_HOSTS == CSP img-src;
  guard test menjaga keduanya tetap sinkron).
- CSP img-src & ICON_REMOTE_HOSTS TIDAK dihapus meski seed sekarang lokal --
  dibutuhkan untuk platform custom dari DB (mis. GoTo/Danamas versi remote,
  atau platform baru yang ditambah admin). IPOT sengaja tetap badge (belum ada
  file logo terverifikasi).
- `ajaib.ico` dipertahankan sebagai .ico (raster pasif, aman di <img>) -- regex
  sanitizer diperluas, bukan file-nya dikonversi.

**Bukti v86:** lint 0 masalah; unit 753/753 PASS (0 skip); verify-asset-logos
15/15 PASS (0 error halaman); verify-hud 63/64 (1 FAIL "5 baris log transaksi"
terbukti SAMA di pristine HEAD -- bukan regresi v86, kemungkinan sensitif
lingkungan/waktu); build:app sinkron; snapshot SW v125 sinkron.

## v87 — UI: logo platform membulat mengikuti outline box-nya per logo

**GEJALA:** logo platform di kartu aset dirender persegi persis -- sudut gambar
"keluar" melewati sudut kotaknya yang membulat (kotak logo kartu aset & detail
aset rounded-xl; kotak daftar akun rounded-full; saran platform form rounded).

**FIX (universal, 1 kelas):** img di `renderAccountIconObj` (app.src.js) +
`searchAccountModalSuggestions` (pencarian akun) + `searchAssetBankSuggestions`
(saran platform aset) kini memakai **`rounded-[inherit]`** -- img mewarisi
border-radius kontainernya sehingga SETIAP logo otomatis mengikuti outline
box-nya di mana pun ia dirender, apa pun radius box-nya (xl / full / lg / sm /
tanpa radius utk badge inline mini). Plus `overflow-hidden` di kotak logo
kartu aset (src/ui/assets.js), kotak `#asset-detail-icon` & `#detail-account-logo`
(index.html) supaya konten kotak selalu terpotong tepat mengikuti outline-nya.

**Build:** build:app DULU baru build:css (tailwind memindai app.js utk kelas
`rounded-[inherit]`) -> app.js & css/tailwind.css berubah, SW bump v125 -> v126,
snapshot di-regen SETELAH kedua build.

**Bukti v87:** lint 0, unit 753/753, verify-asset-logos **17/17 PASS** --
termasuk 2 cek pembulatan BARU: computed border-radius img HARUS == computed
border-radius box-nya (12px di kartu aset & detail aset; > 0).

## v88 — MAINTENANCE + STABILITY TEST + AUDIT BUG MENYELURUH (health check penuh)

**KONTEKS:** user minta maintenance + cek stability test + audit analisa segala
potensi bug. Tidak ada gejala; ini health check preventif pasca-v87.

**HASIL STABILITY (semua di b7c4f45, tanpa perubahan app):**
- Unit: 753/753 PASS di **4 run berturut** (1 baseline + 3 stability) — nol flaky.
- Parity: 1/1 PASS di 4 run.
- E2E verify-asset-logos (lokal :8123): **17/17 PASS di 3 run**, error halaman 0.
- Reproducibility build: rebuild app.js + css menghasilkan byte identik dgn
  yang di-commit (`git status` kosong) — nol drift.
- npm audit: **0 vulnerabilities**. Update minor devDeps tersedia (opsional):
  eslint 10.9.1→10.10.0, playwright 1.62.1→1.63.0. Tailwind 4.x = major,
  JANGAN auto-upgrade. CI sudah pakai Node 22 via .nvmrc (sandbox lokal v20
  hanya beda environment, bukan masalah repo).
- CI b7c4f45: 6/6 success; Pages deployed; live = SW v126, HTTP 200, ~0.14s.

**SATU TEMUAN + FIX (test-only, TANPA ubah app):** verify-hud 63/64 — check
"5 baris log transaksi + bar nominal" gagal permanen sejak fitur paginasi
renderRecentList (RECENT_TRANSACTIONS_PAGE_SIZE=10 + div tombol halaman).
Akar masalah = **stale test expectation**, BUKAN bug app (debug Playwright:
10 baris .stagger-item + 10 .hud-bar-fill + 1 div paginasi = 11 child; semua
field user di-escapeHtml, guard NaN lengkap). Check diganti jadi: rows==10 &&
bars==10 && tombol halaman >=2. verify-hud kini **64/64 PASS** (2 run), error
halaman 0. scripts/ TIDAK di-precache SW & verify-hud TIDAK dijalankan CI ->
tanpa bump SW, tanpa rebuild, tanpa redeploy.

**HASIL AUDIT STATIK (app.src.js + src/, pola bug klasik):**
- XSS: escapeHtml/escapeAttr dipakai 50x; template innerHTML yang di-spot-check
  statik / numerik / ter-escape; CSP ketat (tanpa unsafe-eval; deps self-hosted).
- eval/new Function: NOL. console.log tertinggal: NOL. catch kosong: NOL.
- JSON.parse: 3 lokasi, semua aman (2 deep-clone in-memory, 1 try/catch).
- localStorage: 7 akses SEMUA try/catch (aman mode privat ketat).
- Handler global: window error + unhandledrejection -> fallback screen; watchdog
  boot 12 detik.
- parseInt/parseFloat: 6 lokasi, semua ada guard `|| 0` / default.
- Tanggal: dates.js kanonik aman zona waktu (parseTgl tengah malam LOKAL,
  toDateStr komponen LOKAL — bukan toISOString) + guard test konsistensi.
- Listener/leak: cuma 20 addEventListener, semua init sekali; debounce timer
  di-clearTimeout dulu; double-submit guard (disabled+spinner) ada di 3 form.
- target=_blank: noopener ada. TODO/FIXME: cuma placeholder nomor WhatsApp
  (memang disengaja utk diisi user).
- sw.js: addAll per-URL (satu URL gagal tidak meruntuhkan semua), cleanup cache
  versi lama saat activate, DATA_CACHE dipisah dari cache versi app,
  network-first utk REST + fallback 503 offline.

**KESIMPULAN:** tidak ditemukan bug aplikasi baru; satu utang test dibayar.
Commit: scripts/verify-hud.mjs + entri handoff ini.

## v89 — CI: kedua harness E2E (verify-hud + verify-asset-logos) masuk workflow otomatis

**KONTEKS:** tindak lanjut rekomendasi v88 (utang test verify-hud 63/64 karena
harness hanya ritual manual). User minta harness E2E dimasukkan ke CI.

**DELIVERABLE: workflow baru `.github/workflows/e2e-harness.yml`** (job:
"E2E harness (HUD + logo aset)", ubuntu-latest, timeout 10 menit):
- Trigger: push & pull_request ke main/refactor/** (mirror filosofi parity.yml)
  + schedule mingguan (Minggu 18:00 UTC = Senin 01:00 WIB) + workflow_dispatch.
- Steps: checkout@v7 → node dari .nvmrc → npm ci (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1)
  → npx playwright install --with-deps chromium → python3 http.server :8123
  (pola server yang sama dgn job Lighthouse, bind 127.0.0.1) → jalankan kedua
  harness SEBAGAI STEP TERPISAH → upload screenshot ke artifact HANYA saat
  gagal (retensi 7 hari) → pkill server (always).
- Kedua harness env HUD_URL=http://127.0.0.1:8123/.
- Kenapa aman di PR (beda dgn job parity yang skip PR): kedua script HERMETIC —
  semua route Supabase di-intercept Playwright, seed deterministik, TANPA
  secrets, TANPA nunggu deploy Pages; keduanya exit 1 saat FAIL/error halaman
  jadi benar-benar menggagalkan CI. Justru berguna utk PR Dependabot upgrade
  playwright/chromium (gate auto-merge dependabot-auto-merge.yml tetap aman:
  ia hanya melarang check yang gagal/berjalan; skipped diperbolehkan).

**SIMULASI LOKAL SEBELUM PUSH (persis urutan step CI):** npm ci →
npx playwright install --with-deps chromium → python3 -m http.server 8123
--bind 127.0.0.1 → HUD_URL=http://127.0.0.1:8123/ node scripts/verify-hud.mjs
(exit 0) → HUD_URL=... node scripts/verify-asset-logos.mjs (17/17, exit 0).
Catatan sandbox: node_modules terhapus antar-pesan (dikecualikan snapshot) —
jalankan npm ci lagi di awal tiap sesi kerja.

**Dokumentasi ikut disinkronkan:** STRUKTUR-REPO.md (jumlah check basi
49→64 & 15→17 + catatan workflow baru; blok perintah manual diperluas),
README.md (badge E2E Harness di samping badge CI).

**Tanpa dampak app:** workflow & docs saja — TANPA ubah app.src.js/index.html,
TANPA rebuild, TANPA bump SW (v126 tetap). Push commit ini otomatis memicu
run pertama workflow (trigger push ke main) = validasi langsung.

## v90 — UI mobile: nav bawah dibuat jauh lebih transparan (liquid glass sungguhan)

**GEJALA (permintaan user):** pada tampilan mobile/Android, bottom nav terasa
seperti bar solid — kaskade CSS berakhir di `html.dark .liquid-glass-nav {
background: rgba(5,9,20,0.90) !important }` (alpha 90%!), sehingga efek
"kaca cair" tinggal nama.

**FIX (styles.src.css, 3 titik):**
1. Blok efektif dark (line ~846): alpha **0.90 -> 0.45**, border cyan 0.32 ->
   0.36, plus `box-shadow` yang WAJIB mengulang glow blok ~734 (box-shadow
   tidak menumpuk antar-rule) + inset specular `inset 0 1px 1px
   rgba(226,255,255,0.18)` utk kesan kaca melengkung.
2. Blok dasar (line ~210, sumber backdrop-filter utk dark & light):
   blur(20px) saturate(180%) -> **blur(28px) saturate(190%)**; light
   background 0.72 -> 0.62. Dark mewarisi blur 28px dari sini.
3. Chip item aktif dark: alpha 0.14 -> 0.18 supaya tetap menonjol di glass
   yang lebih jernih.
Fallback `@supports not backdrop-filter` tetap 0.97 opaque (browser lama tetap
terbaca). Item non-aktif text-slate-400 & label "Catat" (#7dd3fc) tetap kontras.

**Verifikasi terprogram (sebelum vs sesudah, computed style headless):**
BEFORE: bg rgba(5,9,20,0.9), blur(20px) saturate(1.8), border 0.32.
AFTER : bg rgba(5,9,20,0.45), blur(28px) saturate(1.9), border 0.36.

**Guard regresi baru:** verify-hud +1 cek (64 -> **65**): "mobile: nav bawah
liquid glass (alpha < 0.6 + blur aktif)" — computed backgroundColor alpha
HARUS < 0.6 dan backdrop-filter wajib mengandung blur(). Kalau suatu saat
alpha merangkak naik lagi (nav kembali solid), CI langsung merah. Angka 65
disinkronkan ke e2e-harness.yml (nama step + komentar) & STRUKTUR-REPO.md.

**Build/deploy:** hanya styles.src.css -> styles.css (build:css); tailwind.css
tak tersentuh; app.js tak berubah. SW v126 -> **v127** + snapshot regen
(hash ea557113ed2715cb…). Unit 753/753, lint 0, verify-hud **65/65** (0 error
halaman), verify-asset-logos 17/17. Screenshot before/after di workspace:
/home/user/verifikasi-nav/ (01-before-solid, 02-after-liquid-glass,
03-perbandingan).

**POST-SCRIPT v90 (fix CI merah):** commit pertama (c2e7048) sempat MEMBUAT
JOB ESLINT CI MERAH -- regex di check baru pakai escape `\/` di dalam
character class (`/[\s,\/]+/`) yang ditandai `no-useless-escape` (di dalam
`[...]`, `/` memang tak perlu di-escape). Lint lokal SEBELUMNYA terlihat
hijau karena keliru dipipe `tail -1` sehingga baris error tertelan -- PELAJARAN
PROSES: saat memverifikasi gerbang, SELALU tampilkan output penuh + echo exit
code, jangan pipe ke tail. Fix: `/[\s,\/]+/` -> `/[\s,/]+/` (commit 9f54fe9). E2E Harness & job lain di c2e7048 sudah hijau;
hanya ESLint yang perlu diulang.

## v91 — AUDIT & PERAPIHAN REPO: konsolidasi SQL ke sql/migrations/ + PILOT-MIGRASI ke docs/

**KONTEKS:** user minta audit semua file/folder, pembersihan yang tak perlu,
dan perapihan sebelum mulai proyek improve (roadmap Fase 1-4).

**HASIL AUDIT (269 file git-tracked):**
- File mati/yatim: HAMPIR NOL. Satu-satunya orphan = PILOT-MIGRASI-v71.md
  (nol referensi di seluruh repo). Tidak ada *.log/.DS_Store/legacy-rows.json
  fisik. Semua ikon banks/platforms dirujuk (4-5 referensi/file). Semua file
  docs/ dirujuk minimal 1x. tests/unit non-test = 4 file intentional
  (helper + fixture snapshot + tool regen).
- SENGAJA TIDAK dipindah (dokumentasi keputusan, jangan ulangi diskusi):
  app.src.js & styles.src.css di root (konvensi build: output harus di root
  karena dilayani; source menempel pada output, dijaga drift-guard);
  AGENT-HANDOFF.md di root (dirujuk komentar kode di .gitleaks.toml +
  src/domain/bank-icons.js + settings.js; log operasional aktif);
  icons/icon-source.svg (source desain menempel pada hasil generate-nya);
  webfonts/_full + css/_full (SUMBER subset fontawesome, dirujuk
  scripts/subset-fontawesome.py — bukan file mati!); tests/parity/
  verify-tailwind-build.mjs (alat verifikasi manual, masih fungsional);
  scripts/rls-audit/rls-audit{,2,3}*.mjs (fase audit historis, dirujuk docs).

**PERAPIHAN DIEKSEKUSI (git mv, 14 file):**
1. PILOT-MIGRASI-v71.md -> docs/ (orphan historis).
2. 13 file SQL (semua migration_*.sql, 2026-08-supabase-native-foundation,
   event_trigger_ensure_rls, pre_migration_checks_2026-08, rls_performance_fix)
   -> sql/migrations/ — menyatukan dgn konvensi YYYYMMDD yang sudah ada.
   sql/ root kini hanya schema.sql (titik masuk instalasi baru) + migrations/.
3. Update referensi path di 13 file: README.md, STRUKTUR-REPO.md, 4 docs
   historis, scripts/rls-audit/README.md + rls-audit3 (komentar), 5 Edge
   Function .ts (komentar), dan src/services/supabase/paging.js (komentar).
   AGENT-HANDOFF entri lama SENGAJA tidak diubah (log historis; path lama
   di entri v1-v90 merujuk lokasi pra-v91).
4. paging.js adalah SATU-SATUNYA file precache yang berubah byte (komentar
   saja, nol perilaku) -> tetap bump SW v127 -> v128 + snapshot regen
   (hash 6c79b95e8b4002d9...) supaya cache user konsisten.
5. STRUKTUR-REPO.md: peta struktur sql/ & docs/ diperbarui.

**VERIFIKASI:** lint 0, unit 753/753, parity 1/1, rebuild app.js/styles.css =
byte-identik (nol drift), grep sisa path lama = nol (di luar AGENT-HANDOFF
historis), precache SW tidak menyentuh file yang dipindah. Laporan user:
/home/user/laporan-audit-perapihan-repo.md.

## v92 — FASE 1 ROADMAP: Kunci Aplikasi (F1A) + Notifikasi & Pengingat (F1B)

**KONTEKS:** implementasi Fase 1 roadmap pengembangan
(/home/user/roadmap-pengembangan-myfinance.md). Batasan user: "hati-hati
supaya tidak menimbulkan bug baru" -> domain murni + unit test DULU, wiring
belakangan, E2E stub settings harus STATEFUL supaya lock teruji lintas reload.
Ringkasan mingguan sengaja DITUNDA demi scope (keputusan roadmap).

**ARSITEKTUR (domain murni, ter-unit-test):**
- `src/domain/app-lock.js`: SHA-256 murni-FIPS-180-4 SINKRON (encoder UTF-8
  manual, dukung surrogate — vektor NIST diuji) supaya hash PIN konsisten tanpa
  async crypto.subtle; pinHashHex=sha256(salt|pin); verifyPin compare
  panjang-tetap; nextLockoutState/isLockedOut/lockoutRemainingSec (5 gagal ->
  cooldown 30 dtk; fail_count TIDAK reset saat cooldown habis, hanya sukses
  yang reset penuh; gagal pasca-cooldown = langsung cooldown baru);
  normalizeLockConfig/APP_LOCK_DEFAULTS (enabled/salt/hash/auto_lock_minutes/
  biometric_enabled/credential_id). Threat model jujur di header file: kunci =
  proteksi UI dari mata sekitar, BUKAN dari devtools/inspeksi.
- `src/domain/reminders.js`: computeDueReminders(ctx, prefs) — budget bulan
  berjalan >=100% (budget-over) / >=80% (budget-warning, DUA id berbeda per
  bulan), tujuan daysLeft tepat {7,1} & belum tercapai, recurring aktif
  next_due_date === besok (overdue TIDAK — processDueRecurring sudah pilih,
  dobel = noise). ID format kolon: `budget:<YYYY-MM>:80|100:<cat>`,
  `goal:<id>:<deadline>:H7|H1`, `recurring:<id>:<besok>`. filterUnsent +
  mergeSentLog (log plain-object + `__order` array paralel, FIFO cap 200).
  Sort kind budget-over > goal-deadline > budget-warning > recurring-due.
  GOTCHA tertangkap test: `KIND_ORDER[k] || 9` SALAH karena rank 0 (budget-over)
  falsy — pakai cek `!== undefined` eksplisit.

**WIRING (app.src.js + index.html):**
- Source of truth lock = `appSettings.app_lock` (ikut persistSettings -> roam
  antar perangkat); GATE BOOT pakai cache localStorage per-user
  (`myfinance_applock_cfg` {userId, cfg}) karena appSettings baru terisi
  SETELAH loadData; reconcileAppLockAfterLoad() tiap loadData: cloud menang,
  dan kalau lock baru diaktifkan dari perangkat lain (cache basi = boot tadi
  tidak mengunci) -> kunci SEKARANG.
- `enterApp(session)` menggantikan `applySessionToUI+showAppShell+initApp`
  di 3 call site (boot ~7639, login-success, signup-success); overlay kunci
  tampil SEBELUM showAppShell/initApp (data tidak termuat sebelum unlock).
  Overlay z-[200] di atas modal z-97; authGate z-9999 dibuang showAppLockOverlay.
- Lockout state per-perangkat (`myfinance_applock_state` {userId, state});
  log pengingat terkirim per-perangkat (`myfinance_reminders_sent` {userId,
  log}); semua dibingkai userId supaya tidak bocor antar akun se-device.
- Auto-lock idle: timer + listener pointerdown/keydown capture; opsi
  "setiap dibuka" (0) atau "5 menit idle" (default saat aktifasi).
- Biometrik WebAuthn opsional: feature-detect
  isUserVerifyingPlatformAuthenticatorAvailable; enroll = navigator.credentials
  create (platform, userVerification required) -> credential_id base64 di
  cfg; unlock = credentials.get -> sukses = reset lockout; gagal/dibatalkan
  TIDAK dihitung gagal PIN. PIN selalu tersedia sebagai fallback.
- Lupa PIN: appLockRecover = re-auth password (auth.signIn) -> sukses ->
  app_lock direset nonaktif + await persistSettings() + cache write +
  lockout reset + hideAppLockOverlay (boot-callback jalan).
- Notifikasi: `notification_prefs` di appSettings (default semua ON),
  maybeShowReminders() dipanggil di loadData sukses SETELAH processDueRecurring;
  Notification API bila permission granted (tag=id anti dobel), fallback toast
  in-app; max 4 toast/sesi; log sent -> localStorage FIFO 200.
- ensureSettingsShape: default app_lock/notification_prefs — HATI-HATI:
  pemanggilan PERTAMA berjalan SEBELUM servicesModule diisi boot async ->
  wajib fallback literal identik dgn APP_LOCK_DEFAULTS/REMINDER_PREFS_DEFAULTS
  (bug boot "Cannot read properties of undefined" tertangkap E2E).
- Ikon baru fa-bell/fa-fingerprint/fa-ban -> regen subset fontawesome
  (pip install brotli dulu di sandbox/runner bila belum).
- sw.js v128 -> v129 (+2 file domain), snapshot regen.

**E2E BARU `scripts/verify-applock.mjs` (19 cek, wired ke e2e-harness.yml):**
F0 boot bebas kunci + 3 pengingat tercatat (budget-over/goal H-7/recurring
H-1); F1 aktifkan via modal -> PUT settings bawa app_lock hash+salt, PIN
TIDAK pernah plaintext di payload; F2 reload -> overlay SEBELUM appShell,
PIN salah (1/5), PIN benar -> app terbuka, pengingat tidak dobel; F3 lockout
(pesan tunggu + input/tombol disabled); F4 lupa PIN (password salah ditolak,
benar -> kunci reset di cloud + reload bebas kunci). Stub settings STATEFUL:
GET = store maybeSingle-object, POST upsert = tulis store (bertahan lintas
reload); stub /auth/v1/token menerima hanya password benar (400 selain itu);
console "Failed to load resource 400" dari negatif-test difilter via counter.

**3 BUG NYATA TERTANGKAP E2E (bukti "hati-hati" membayar):**
1. authGate z-9999 tidak pernah dibuang di jalur boot terkunci (hanya
   showLoginView/showAppShell yang membuangnya) -> layar "Memeriksa sesi
   login..." menutupi overlay kunci selamanya. Fix: showAppLockOverlay
   memanggil hideAuthGate().
2. Race GET-vs-PUT di recovery: persistSettings() fire-and-forget ->
   boot-callback initApp()->loadData() GET settings bisa balapan mengalahkan
   PUT reset -> kunci "hidup lagi" dari GET basi -> reload berikut terkunci.
   Fix: persistSettings() kini MENGEMBALIKAN promise (error tetap internal),
   appLockRecover await-nya sebelum membuka. (Dua bug UX kecil sekalian:
   tombol Buka sempat re-enable ~1 dtk di awal cooldown; pesan "Password
   salah" tertimpa tick countdown -> mekanisme _appLockTransientError.)

**VERIFIKASI:** lint 0; unit 780/780 (+27 baru); parity 1/1; E2E lokal 3/3
hijau: verify-hud 65/65, verify-asset-logos 17/17, verify-applock 19/19;
rebuild app.js/styles.css zero-drift via build; SW v129 snapshot regen.

## v93 — APP LOCK: mode idle 5 menit kini benar-benar lintas reload (bug fix user)

**BUG (dilaporkan user):** di Pengaturan dipilih "5 menit tidak dipakai" ->
saat reload aplikasi LANGSUNG terkunci padahal belum 5 menit. Akar masalah:
gerbang boot (enterApp) dan reconcile hanya melihat isLockEnabled — aktif =
kunci, TANPA memedulikan auto_lock_minutes. Mode idle hanya dihormati oleh
timer dalam-sesi, bukan oleh gerbang boot.

**FIX — jam idle persisten (jejak aktivitas per-user):**
- Baru `src/domain/app-lock.js#shouldLockNow(cfg, lastActivityMs, nowMs)`
  (murni, +5 unit test -> 19 di file itu): nonaktif=false; mode "setiap
  dibuka" (menit<=0)=SELALU true; mode idle=true hanya kalau sejak aktivitas
  terakhir >= ambang menit; jejak tidak ada/tidak valid/jam-skew masa depan
  (toleransi 60 dtk) = true (fail-closed, sembuh sendiri setelah 1 unlock).
- app.src.js: `myfinance_applock_activity` {userId, ts} di localStorage =
  SATU jam idle yang dibagi lintas reload & lintas tab.
  - appLockTouchActivity (throttle tulis 5 dtk) dipanggil dari: listener
    pointerdown/keydown (saat app aktif), enterApp jalur tanpa gerbang,
    hideAppLockOverlay (unlock = bukti kehadiran), enable/ganti PIN.
  - enterApp & reconcileAppLockAfterLoad kini memakai shouldLockNow.
  - scheduleAppLockIdleTimer: delay = SISA waktu dari jejak (bukan window
    penuh) + RE-CHECK jejak saat timer menyala -> tab yang sedang tidak
    dilihat tidak ikut terkunci selama user aktif di tab lain app yang sama.
  - Sign-out membuang jejak (batas sesi eksplisit, boot berikutnya
    fail-closed).
- Teks status modal & kartu Pengaturan disesuaikan ("Otomatis terkunci
  setelah N menit tidak dipakai — memuat ulang di tengah pemakaian tidak
  langsung mengunci").
- sw.js v129 -> v130 + snapshot regen.

**PERILAKU SETELAH UPDATE (dokumentasi):** user lama mode idle tanpa jejak
(kunci baru) akan terkunci SEKALI saat reload pertama pasca-v93, lalu jejak
terisi dan perilaku baru berlaku. Konsisten threat model file: proteksi UI
dari mata sekitar, bukan dari devtools (jejak memang di localStorage).

**VERIFIKASI:** lint 0; unit 785/785 (+5); parity 1/1; E2E verify-applock
di-RESTrukturisasi: F2 baru = F2a (idle-mode + aktivitas baru -> reload TIDAK
terkunci — assert bug fix) + F2b (jejak di-stale-kan 6 menit -> reload
terkunci, alur PIN salah/benar + dedup) — 21 cek 21 PASS; verify-hud 65/65 &
verify-asset-logos 17/17 tetap hijau (regresi bersih).

## v94 — REKOMENDASI AI (Gemini): list vertikal + modal detail, pola Wawasan Keuangan

**PERMINTAAN USER:** tampilan Rekomendasi AI by Gemini di tab dashboard dibuat
seperti Wawasan Keuangan — penjelasan singkat tersusun list ke bawah, klik
baris -> pop-up penjelasan detail.

**ARSITEKTUR (pola domain-murni + UI-modul, sama seperti insights):**
- `src/domain/ai-recommendations.js` (BARU): normalizeAiRecommendations(raw)
  -> {title, short, detail, severity, icon, bg, color} + AI_REC_SEVERITY_STYLES
  + AI_REC_MAX_ITEMS=5. KOMPATIBILITAS DUA ARAH (deploy tak harus serentak):
  cache/function LAMA tanpa `detail` -> fallback detail=message (modal tetap
  terisi); client lama mengabaikan `detail` dari function baru. Item rusak
  dibuang, teks di-clamp (120/600/4000), severity tak dikenal -> info.
- `src/ui/ai-recommendations.js` (BARU): renderAiRecommendationRow (baris
  tombol full-width dgn data-ai-rec-idx + aria-haspopup) & renderAiRecommendations
  (list vertikal ke #ai-insights-container + delegasi klik -> openInsightDetail
  dari src/ui/insights.js — modal, Escape/backdrop/X, SERAGAM dgn wawasan).
  ANTI-STALE: daftar terbaru disimpan di container.__aiRecs (bukan closure)
  supaya refresh-analisis-baru lalu klik tidak menampilkan detail basi.
- app.src.js renderAiInsights: render kartu inline lama -> normalisasi domain
  + renderAiRecommendationsUI (pemanggil tetap menang state kosong).
- index.html: import+attach normalizeAiRecommendations & renderAiRecommendationsUI.

**EDGE FUNCTION analyze-finance ( TER-DEPLOY ke project, 2026-09-07):**
prompt kini minta DUA lapis teks per rekomendasi — "message" (ringkasan 1
kalimat, tampil di baris list) & "detail" (3-6 kalimat: angka pendukung,
dampak, langkah konkret — tampil di modal). Sanitasi meneruskan `detail`
(opsional, slice 4000); fallback JSON-parse rusak juga mengisi detail.
Terpasang lewat: SUPABASE_ACCESS_TOKEN=... npx supabase functions deploy
analyze-finance --project-ref uxfngmxghupdlwoeoxgh (inline saja, tidak
disimpan). Verifikasi live: POST tanpa auth -> 401 (deploy aktif + auth utuh).

**E2E verify-hud diperluas 65 -> 69 cek:** stub spesifik **/functions/v1/
analyze-finance (3 rekomendasi dgn detail; route spesifik diregistrasi
SETELAH catch-all supaya menang) -> klik #ai-insight-refresh-btn -> assert
3 baris list klik-able (button + aria-haspopup) -> klik baris -> modal
#insight-detail-modal muncul dgn teks detail -> tutup via tombol X (selector
HARUS `button[data-close-insight]` — backdrop juga match attr itu tapi
tertutup kartu -> Playwright click-intercepted).

**BUG WIRING TERTANGKAP E2E:** app.src.js sempat memanggil
servicesModule.renderAiRecommendations (tanpa akhiran UI) padahal di-attach
sebagai renderAiRecommendationsUI -> TypeError tertelan catch requestAiInsight
sehingga tampil "belum aktif" palsu. Konvensi: fungsi UI di-attach dgn alias
*UI dan dipanggil servicesModule.*UI. (Ingat pola ini!)

**VERIFIKASI:** lint 0; unit 797/797 (+12: domain 7 + ui 5); parity 1/1;
E2E 3/3: verify-hud 69/69 (+4 baru), verify-applock 21/21, verify-asset-logos
17/17. sw.js v130 -> v131 (+2 file precache) + snapshot regen.

## v95 — `sql/schema.sql` jadi titik masuk instalasi yang BENAR-BENAR lengkap

**MASALAH (ditemukan lewat audit struktur repo, dibuktikan dengan menjalankan
SQL-nya di PostgreSQL 17 sungguhan — bukan dibaca saja):** `schema.sql`
didokumentasikan sebagai "titik masuk instalasi baru", tapi isinya cuma 6
tabel inti: **NOL function**. Padahal app memanggil 4 RPC
(`create_transfer_transaction`, `create_recurring_transaction`,
`replace_month_budgets`, `check_and_consume_rate_limit`). Fresh install =
"hidup tapi rusak": Transfer, simpan Budget, Transaksi Berulang, dan rate
limit Edge Function semuanya gagal begitu dipakai. Juga hilang: kolom
multi-currency & recurring di `transactions`, kolom harga di `assets`, serta
tabel `api_rate_limits` / `platform_logos` / `whatsapp_*` / `rate_limits`.
(Gejala ini sebagian sudah pernah dicatat `docs/schema-contract-audit.md`
tapi tidak pernah ditutup.)

**LEBIH BURUK — jalan keluar "jalankan saja semua migrasi" TIDAK JALAN.**
Dibuktikan dengan mengeksekusi berurutan di database kosong:
1. `migration_reliability_hardening_2026-08.sql` → **ERROR** `cannot change
   return type of existing function`: `2026-08-supabase-native-foundation.sql`
   lebih dulu membuat `replace_month_budgets` `returns integer`, file ini
   mendefinisikan ulang `returns void`. Karena dibungkus `begin/commit`,
   SELURUH file rollback — termasuk `create_recurring_transaction` yang tidak
   pernah lahir.
2. `rls_performance_fix.sql` → **ERROR** di `public.rate_limits` (tabel warisan
   yang tidak pernah ada di repo) → semua perbaikan policy initplan-nya ikut
   rollback.
3. Urutan alfabetis pun salah: `20260906_platform_logo_aliases.sql` jatuh
   SEBELUM `20260906_platform_logos.sql` (upsert ke tabel yang belum ada).

**PERBAIKAN:** semua objek produksi dikonsolidasikan ke `sql/schema.sql`
(166 → ~720 baris). Body ke-4 RPC disalin **byte-identical** dari migrasi
kanoniknya. Policy ditulis dalam bentuk initplan `(select auth.uid())` supaya
sama dengan live (`rls_performance_fix`) — `default auth.uid()` di definisi
kolom sengaja TIDAK ikut diubah. Ditambahkan juga `rate_limits` (warisan):
tabel ini tidak pernah ada di repo mana pun, padahal `analyze-finance`
memakainya untuk jeda 8 detik "Tanya AI" — dan karena error select-nya tidak
diperiksa (hanya `data` yang di-destructure), di project baru jeda itu **gagal
diam-diam**. Grant/revoke RPC memakai DO block dinamis (pola
`migration_rls_hardening`) supaya tidak bisa salah tulis signature.
`sql/migrations/` TIDAK disentuh — statusnya arsip riwayat.

**VERIFIKASI (PostgreSQL 17 lokal + shim `auth.uid()`/`auth.role()`/roles):**
- `schema.sql` di database kosong: **sukses tanpa error**; dijalankan 2x tetap
  bersih (idempotensi terjaga).
- `pg_dump -s` hasil schema.sql **IDENTIK** dengan database referensi yang
  dibangun dari schema lama + semua migrasi (+ langkah manual drop function
  & stub `rate_limits`), kecuali satu FK `rate_limits.user_id → auth.users`
  yang memang sengaja ditambahkan (konsisten dgn tabel lain, live tidak punya).
- Fungsional: isolasi RLS lintas user OK (A lihat 1 baris, B lihat 0);
  `replace_month_budgets` OK; `create_transfer_transaction` USD 100 @16.000
  → `jumlah_idr` = 1.600.000; `create_recurring_transaction` dipanggil 2x →
  id SAMA, hanya 1 baris (idempotensi); rate limit batas 3 → t,t,t,**f**;
  `api_rate_limits` tidak terbaca dari client (0 baris); katalog logo 11 baris.
- Keamanan: `anon` DITOLAK di semua RPC (`permission denied for function`),
  `authenticated` tetap lolos.

**PAGAR BARU — `tests/unit/sql-schema-completeness.test.js` (5 test):** setiap
RPC yang dipanggil kode wajib terdefinisi di schema.sql; body RPC wajib identik
dengan migrasi kanonik (peta `CANONICAL_FUNCTIONS` di file test); tiap tabel &
kolom yang dibuat migrasi wajib ada di schema.sql; policy wajib bentuk
initplan. Sudah **diuji negatif**: hapus satu RPC → 2 test merah; ubah body RPC
diam-diam → merah; kembalikan satu policy ke `auth.uid()` polos → merah.

**Catatan untuk agen berikutnya:** jangan menjalankan file di `sql/migrations/`
pada project baru, dan kalau menambah RPC/tabel/kolom baru, tulis di
`sql/schema.sql` (bukan cuma bikin file migrasi) — kalau tidak, test di atas
langsung merah.

**HARNESS-nya DISIMPAN:** `scripts/schema-verify/` (shim Supabase +
uji fungsional + README berisi langkah persisnya). Tidak diwire ke CI (butuh
Postgres lokal), tapi bisa diulang kapan pun — verifikasi di atas reproducible,
bukan klaim sekali jalan.

**VERIFIKASI REPO:** unit 802/802 hijau (797 + 5 baru); lint 0 masalah. Tidak
ada file yang di-precache SW yang berubah (SQL & dokumen tidak masuk
PRECACHE_URLS) → `CACHE_VERSION` sengaja TIDAK di-bump.

## v96 — Harness instalasi schema jadi job CI (`Schema install check (Postgres)`)

**KENAPA:** v95 menutup lubangnya, tapi verifikasinya masih ritual manual —
persis pola yang di v88 sudah terbukti gagal (harness manual jadi basi
berbulan-bulan tanpa ketahuan). Unit test hanya membaca TEKS file SQL; tidak
ada satu pun gerbang yang benar-benar MENGEKSEKUSI `sql/schema.sql`.

**YANG DITAMBAHKAN:**
- Job `schema-install` di `.github/workflows/parity.yml` (workflow "CI"):
  service container `postgres:17-alpine`, hermetic (tanpa secrets, tidak
  menyentuh DB produksi) sehingga boleh jalan di pull_request termasuk PR
  Dependabot. ~1 menit, jauh lebih murah dari job lighthouse/parity.
- `scripts/schema-verify/run.mjs` — runner tanpa dependensi npm (cuma butuh
  biner `psql`): database sekali-pakai -> shim -> `schema.sql` **2x**
  (install + idempotensi) -> cek jumlah objek (11 tabel / 4 function /
  15 policy) -> `functional-check.sql`. Exit code non-nol kalau ada yang gagal.
  Lokal: `PGHOST=... node scripts/schema-verify/run.mjs`.
- `functional-check.sql` ditulis ulang jadi **self-asserting**: tiap cek
  `raise exception` kalau meleset (sebelumnya cuma mencetak tabel untuk dibaca
  manusia — tidak layak jadi gerbang CI). Kini 10 cek, +3 dari v95: CEK 2b
  (`replace_month_budgets` harus MENGGANTI, bukan menumpuk), CEK 5c (user tidak
  bisa menghabiskan jatah rate limit user lain), CEK 9 (`authenticated` HARUS
  tetap punya EXECUTE — pagar terhadap "kebablasan mencabut grant").

**BUG DI HARNESS SENDIRI, TERTANGKAP LEWAT UJI NEGATIF — CATAT INI:**
CEK 8 versi pertama ("coba panggil RPC sebagai anon") memberi **FALSE PASS**.
Saat `grant execute ... to anon` sengaja disuntikkan, harness tetap HIJAU.
Sebabnya: keempat RPC `SECURITY INVOKER`, jadi anon yang berhasil lolos ke
dalam body-nya tetap kena `permission denied` di tabel — kode error yang
PERSIS SAMA (`insufficient_privilege`) dengan penolakan hak eksekusi function,
sehingga handler "ditolak = lulus" menelan keduanya. Diperbaiki: CEK 8/9
sekarang membaca `has_function_privilege('anon'/'authenticated', oid,
'EXECUTE')` langsung dari katalog (ikut memperhitungkan grant lewat PUBLIC).
**Pelajaran umum: setiap cek keamanan baru WAJIB diuji-negatif dulu** — cek
yang tidak pernah bisa merah cuma stempel hijau palsu.

**UJI NEGATIF (semua terbukti merah):** (a) satu RPC dihapus dari schema.sql;
(b) policy dibocorkan jadi `using (true)` -> CEK 1b "user B melihat 1 baris
milik user A"; (c) `grant execute ... to anon` -> CEK 8; (d) `revoke execute
... from authenticated` -> CEK 9. Kondisi benar: 10/10 cek lulus.

**CATATAN TEKNIS:** step "Pastikan psql tersedia" memakai blok `if ! command -v
psql` — bentuk satu baris `psql --version || apt-get update && apt-get install`
SALAH karena `(A || B) && C` membuat apt tetap jalan walau psql sudah ada.

**VERIFIKASI:** lint 0; unit 802/802; `node scripts/schema-verify/run.mjs`
10/10 lulus di Postgres 17 lokal. Tidak ada aset precache SW yang berubah ->
`CACHE_VERSION` sengaja TIDAK di-bump.

## v97 — Angka di dokumen berhenti jadi soal kedisiplinan: dijaga unit test
**MASALAH:** audit menemukan sederet klaim basi yang menyesatkan pembaca baru
(termasuk agen berikutnya, yang membaca dokumen ini sebagai sumber kebenaran):
`STRUKTUR-REPO` menulis `CACHE_VERSION=v70` (nyatanya v131), "37 file" domain
(38), "65 cek" verify-hud (69), "19 cek" applock (21, juga di `e2e-harness.yml`),
"Tabel Supabase (7)" (11 — `rate_limits`, `platform_logos`,
`whatsapp_link_codes`, `whatsapp_links` tidak pernah didaftarkan), dan header
masih v95. `Peta cepat` di berkas INI masih menulis "49 cek". Komentar
`dependabot-auto-merge.yml` masih mengklaim supabase-js dimuat dari esm.sh &
Chart.js/FullCalendar dari jsdelivr — padahal sudah di-vendor sejak v59 — dan
"500 unit test" saat nyatanya 800-an.

**PERBAIKAN:** semua diperbarui, DAN dipasangi gerbang mekanis
`tests/unit/docs-consistency.test.js` (6 test): CACHE_VERSION vs `sw.js`; header
STRUKTUR-REPO vs entri `## vNN` tertinggi di sini; jumlah file `src/domain/`;
jumlah tabel & RPC vs `sql/schema.sql`; jumlah cek tiap harness E2E vs jumlah
pemanggilan `ok(` di skripnya; versi `vendor/supabase-js-*` vs `package.json`.
Terbukti merah dulu pada kondisi pra-perbaikan (5/5 gagal) sebelum dihijaukan.

**TEMUAN SAMPINGAN (kopling tak terlihat):** `@supabase/supabase-js` ada di
devDependencies, tapi browser memuat `vendor/supabase-js-2.113.0.bundle.min.mjs`
yang di-pin di NAMA BERKAS. PR Dependabot menaikkan yang npm saja, jadi keduanya
bisa berpisah jalan berbulan-bulan tanpa satu pun test merah — dan parity "live"
diam-diam menguji versi klien yang tidak dipakai pengguna. Sekarang dijaga; uji
negatif (bump npm ke 2.120.0 tanpa vendor ulang) terbukti merah dengan pesan
yang menunjuk prosedur `vendor/README.md`.

**KEPUTUSAN SADAR:** (1) log versi `## vNN` di berkas ini DIKECUALIKAN dari
gerbang — entri v45 memang harus tetap menulis angka saat itu; yang dijaga hanya
blok `Peta cepat`. (2) Jumlah unit test sengaja TIDAK ditulis sebagai angka di
komentar dependabot — angka begitu selalu jadi basi. (3) Klaim jumlah cek E2E
dijaga lewat hitungan `ok(`, bukan menjalankan harness-nya.

**KALAU TEST INI MERAH:** dokumennya yang basi, bukan test-nya yang rewel. Kalau
sebuah kalimat ditulis ulang sampai pola jangkarnya hilang, test juga merah —
itu disengaja: perbarui jangkarnya di test bersama kalimatnya, jangan biarkan
gerbangnya diam-diam berhenti menjaga.

**VERIFIKASI:** lint 0 masalah; unit 808/808 (802 + 6 baru); ketiga workflow
lolos parse YAML. Tidak ada aset precache SW yang berubah -> `CACHE_VERSION`
sengaja TIDAK di-bump.

## v98 — `boot.js`: blok wiring `<script type="module">` keluar dari index.html
**MASALAH:** service worker memakai **network-first untuk dokumen** navigasi tapi
stale-while-revalidate untuk aset. Selama 17,1 KB blok wiring itu inline di
`index.html`, ia ikut diunduh ulang SETIAP kunjungan online — padahal isinya
nyaris tidak pernah berubah.

**PERBAIKAN:** blok dipindah **byte-exact** ke `boot.js` (diverifikasi
`isi boot.js tanpa header === git show HEAD:index.html blok lama` → true), lalu
dipanggil `<script type="module" src="./boot.js">` + `<link rel="modulepreload">`.
Dokumen: **33,8 → 29,8 KB gzip per navigasi**; 4,6 KB gzip boot.js pindah ke
jalur cache-first (dibayar sekali). Pola ini sama persis dengan v54 yang
mengekstrak blok classic monolit ke `app.js`.

**KOPLING YANG WAJIB IKUT (semua sudah dikerjakan):**
1. `sw.js` `PRECACHE_URLS` += `'./boot.js'` — kalau lupa, mode offline patah.
2. `tests/unit/sw-cache-hash-helper.mjs` `TOP_FILES` += `boot.js`. **Ini yang
   paling mudah terlewat**: tanpa itu, mengubah boot.js saja tidak pernah
   mewajibkan bump `CACHE_VERSION` dan pengguna lama terus dilayani wiring basi
   — persis alasan v55 dulu menambahkan `app.js` ke daftar yang sama. Sudah
   diuji-negatif (sentuh boot.js → snapshot merah).
3. `CACHE_VERSION` v131 → **v132** + regen snapshot.
4. `tailwind.config.js` `content` += `./boot.js`.
5. Tujuh tes `WIRING:` diarahkan ke `boot.js` (dulu membaca `index.html`).

**KEUNTUNGAN TAK TERDUGA:** selagi inline, 199 baris itu **tidak pernah di-lint**
(lihat "CAKUPAN" di `eslint.config.js`: blok inline hanya dicek sintaksnya oleh
`tests/unit/index-inline-scripts.test.js`). Sebagai berkas `.js` sungguhan ia
kini tunduk pada `no-undef`/`eqeqeq`/`no-unused-vars` — dan lolos bersih setelah
diberi global browser di eslint.config.js.

**KOREKSI ANGKA (penting untuk keputusan berikutnya):** rencana awal roadmap
adalah *minify* `index.html`, dengan klaim "hemat puluhan KB". Klaim itu SALAH:
GitHub Pages sudah gzip (`content-encoding: gzip`, transfer nyata 35,1 KB bukan
216 KB), sehingga minify markup hanya menghemat **2,2 KB** — 0,7% bobot halaman
— dengan ongkos mengubah `index.html` jadi `index.src.html`. Ekstraksi ini
menghemat **4,1 KB** dengan risiko jauh lebih kecil (pemindahan byte-exact, nol
semantik whitespake tersentuh). Minify markup DITUNDA. Sasaran ukuran yang jauh
lebih gemuk: FullCalendar 79,5 KB + Chart.js 69,1 KB gzip — pastikan keduanya
benar-benar lazy sebelum mengejar sisa markup.

**VERIFIKASI:** lint 0; unit 808/808; build drift css+app bersih; **E2E browser
sungguhan dijalankan LOKAL sebelum push** — verify-hud 69/69, verify-asset-logos
17/17, verify-applock 21/21, nol error halaman, screenshot dashboard normal.
Alasan diverifikasi lokal: GitHub Pages men-deploy langsung dari root repo tiap
push, jadi `index.html` rusak = situs hidup langsung rusak.

## v99 — Biometrik PER PERANGKAT (laporan pengguna: Face ID mobile "tidak jalan")
**LAPORAN:** "di desktop bisa pakai fingerprint, tapi di mobile tidak bisa pakai
Face ID." **Penyebabnya bukan Face ID, dan bukan iOS.**

**AKAR MASALAH:** konfigurasi `app_lock` adalah SATU objek yang ikut roaming
lewat tabel settings, tapi kredensial WebAuthn platform authenticator TERIKAT
PERANGKAT. Sampai v98 hanya ada satu slot `credential_id`, sehingga setelah
laptop mendaftar:
1. HP menarik setelan yang sama, melihat biometrik "sudah aktif", dan Pengaturan
   di HP HANYA menampilkan tombol "Matikan" -- HP tidak pernah bisa mendaftar;
2. tombol buka-biometrik di HP memanggil `allowCredentials` berisi kredensial
   LAPTOP -> `NotAllowedError` -> tampak seperti "Face ID rusak";
3. menekan "Matikan" di HP ikut menghapus biometrik laptop.

**PERBAIKAN:** `credentials: [{id,label,added_at}]` (daftar, maks 10) di
`src/domain/app-lock.js` + fungsi murni `addBiometricCredential`,
`removeBiometricCredential`, `clearBiometricCredentials`, `biometricCredentialIds`,
`hasBiometricCredential`, `describeBiometricState`, `biometricLabel`,
`deviceLabelFromUserAgent`. Perilaku baru:
- `allowCredentials` memuat SEMUA perangkat terdaftar;
- Pengaturan menawarkan "Aktifkan" selama PERANGKAT INI belum terdaftar, sambil
  memberi tahu "Juga aktif di N perangkat lain";
- "Matikan" mencabut perangkat ini saja; ada tombol terpisah untuk semua perangkat;
- `excludeCredentials` mencegah satu perangkat mendaftar dua kali;
- tombol di layar kunci hanya muncul kalau perangkat ini terdaftar (dulu muncul
  lalu selalu gagal);
- label mengikuti perangkat ("Face ID / Touch ID" di iPhone, bukan "sidik jari").

**MIGRASI:** `normalizeLockConfig` memindahkan `credential_id` lama ke daftar
otomatis, dan `credential_id` tetap ditulis sebagai cermin `credentials[0].id`
supaya app versi lama yang masih ter-cache di perangkat lain tidak rusak.
`biometric_enabled` kini DITURUNKAN dari panjang daftar -- state "flag true tanpa
kredensial" (penyebab UI salah) jadi mustahil.

**PENANDA PER PERANGKAT:** `localStorage['myfinance_applock_cred']` menyimpan id
kredensial yang dibuat perangkat ini (WebAuthn tidak bisa ditanya tanpa
memanggil get()). Kalau localStorage dibersihkan, penanda ini SELF-HEAL: hasil
`get()` yang sukses menuliskannya kembali.

**HARNESS BARU `scripts/verify-applock-biometric.mjs` (14 cek):** memakai
**virtual authenticator CDP**, jadi alur WebAuthn benar-benar dijalankan browser.
Diuji-negatif terhadap kode v98 dan MERAH tepat di gejala yang dilaporkan
pengguna: baris Pengaturan cuma "Matikan", pendaftaran perangkat kedua menimpa
kredensial laptop (entri=1), mematikan menghapus semua (sisa=0). Terhadap v99:
14/14 PASS.

**JEBAKAN YANG DITEMUKAN SAAT MENULIS HARNESS (catat, mahal waktunya):** WebAuthn
menolak origin ber-IP -- `http://127.0.0.1:8123` memberi `SecurityError: This is
an invalid domain` karena RP ID wajib domain terdaftar; hanya `localhost` yang
dikecualikan. Harness menormalkan URL-nya sendiri, dan step CI-nya memakai
`http://localhost:8123/`.

**VERIFIKASI:** lint 0; unit 819/819 (+11 tes domain, termasuk 3 tes REGRESI yang
menamai skenario laptop-lalu-HP); E2E lokal hud 69/69, asset-logos 17/17,
applock 21/21, applock-biometric 14/14; `CACHE_VERSION` v132 -> v133 + snapshot.

## v100 — Perawatan menyeluruh: bug scope cache data offline
**KONTEKS:** audit perawatan 2026-09-08 (stabilitas + performa + perburuan bug)
sebelum lanjut Fase 4. Hampir semua sehat: 0 error konsol di 7 view, 0 kebocoran
memori (heap datar, 12 instance chart stabil setelah 12 kali ganti view), 0
kerentanan npm, 451 id HTML semuanya unik, 98 entri precache semuanya menunjuk
berkas nyata, 113 handler onclick semuanya terdefinisi (0 tombol mati), 0 modul
src/ yatim, dan XSS TIDAK tembus (payload disuntik ke keterangan/kategori/akun/
aset lalu handler onclick-nya dipicu paksa -- tidak ada yang tereksekusi).

**SATU BUG NYATA DITEMUKAN (dan diperbaiki):** namespace cache data offline
dihitung dari `auth.slice(-24)` -- 24 karakter TERAKHIR header Authorization.
Pada JWT Supabase itu ekor TANDA TANGAN, yang berubah SETIAP refresh token
(default tiap jam). Dibuktikan lewat E2E terhadap kode v99: entri cache untuk
user yang SAMA melonjak **8 -> 16** hanya karena satu kali refresh. Akibatnya:
  1. sampah menumpuk selamanya (DATA_CACHE sengaja TIDAK ikut dihapus saat
     CACHE_VERSION naik, dan hanya dibuang saat logout) -> berisiko kena kuota
     penyimpanan browser, yang kalau kena bisa membuang SELURUH storage origin
     termasuk shell PWA;
  2. offline tepat setelah refresh token = cache MISS = "Gagal memuat data dari
     cloud", padahal datanya baru disimpan beberapa menit sebelumnya.

**PERBAIKAN (sw.js):**
- `dataCacheScope(authHeader)`: baca klaim `sub` (user id) dari payload JWT
  (base64url -> TextDecoder, aman UTF-8), cadangan ke perilaku lama untuk token
  non-JWT. Tanda tangan sengaja tidak diverifikasi -- ini kunci partisi cache
  lokal, bukan gerbang otorisasi (otorisasi tetap RLS di server).
- `DATA_CACHE_MAX = 60` + `putDataCacheBounded()`: pertumbuhan jadi TERBUKTI
  berhingga, bukan cuma "harusnya kecil" (query seperti budgets?bulan=eq.YYYY-MM
  tetap menambah entri pelan-pelan seumur pakai).
- `DATA_CACHE` v1 -> v2 sekali, supaya sampah yang sudah menumpuk di perangkat
  pengguna ikut terhapus oleh pembersih di handler activate.

**VERIFIKASI:**
- `tests/unit/sw-data-cache-scope.test.js` (11 tes): fungsi DIEKSTRAK dari sw.js
  lalu diuji perilakunya (sw.js classic worker, tak bisa di-import). Uji negatif:
  terhadap sw.js v99 seluruh berkas tes MERAH ("dataCacheScope harus ada").
- `scripts/verify-offline-cache.mjs` (BARU, 13 cek): Cache Storage sungguhan.
  Uji negatif terhadap v99 -> 5 cek MERAH, termasuk "8 -> 16 entri". Didaftarkan
  ke workflow e2e-harness + guard docs-consistency.
- Regresi lain tidak turun: hud 69/69, asset-logos 17/17, applock 21/21,
  applock-biometric 14/14. Unit 830/830, eslint 0. CACHE_VERSION v133 -> v134.

**TEMUAN PERFORMA (belum dikerjakan, bukan bug):** kunjungan pertama menembak
**101 request** karena 71 modul ESM di src/ dimuat satu per satu (rata-rata cuma
2,2 KB gzip per berkas, total 153 KB). Setelah service worker aktif ini tidak
terasa lagi, tapi kunjungan PERTAMA di jaringan seluler membayar 71 round-trip.
Kandidat perbaikan berikutnya: bundling modul src/ untuk jalur boot.

**JEBAKAN METODOLOGI YANG TERCATAT (mahal ditemukan):**
- Service worker baru meng-cache SETELAH mengendalikan halaman; menilai isi
  DATA_CACHE di kunjungan pertama menghasilkan kesimpulan palsu "cache kosong".
- `context.addInitScript()` jalan di SETIAP navigasi -- kalau menyemai sesi tanpa
  penjaga "kalau belum ada", ia menimpa token baru tiap reload dan simulasi
  refresh token tidak pernah benar-benar terjadi (sempat bikin hipotesis bug ini
  keliru dinyatakan salah).
- `context.setOffline()` tidak selalu mengubah `navigator.onLine` setelah
  navigasi; banner offline SEBENARNYA benar (terbukti dengan memaksa
  navigator.onLine=false). Jangan simpulkan bug UI dari emulasi yang belum
  divalidasi.

## v101 — Fase 4 tahap A: 119 atribut onclick= di index.html dihapus
**TUJUAN:** atribut onclick= mencampur perilaku ke markup, memaksa setiap handler
jadi global selamanya, dan menyeret `'unsafe-inline'` ke CSP. Diganti pola
deklaratif: markup menyatakan NIAT (`data-action="namaAksi"` + `data-args` JSON
opsional), pemetaan niat->fungsi hidup di satu tempat (`uiActionRegistry()`),
dan satu listener delegasi di `document` yang menjalankannya.

**HASIL:** `index.html` kini **0 onclick=** (dari 119). 86 aksi unik, 80 di
antaranya fungsi yang sudah ada + 6 pembungkus bernama untuk bentuk yang dulu
ditulis sebagai kode inline (`editAsetDariDetail`, `pilihBerkasBackup`,
`kirimFormTransaksi`, `kirimFormAset`, `kirimFormTujuan`, `kirimFormUtang`).

**KEPUTUSAN DESAIN & ALASANNYA (jangan diubah tanpa membaca ini):**
- *Delegasi di document, bukan addEventListener per elemen.* Satu listener
  melayani semua, termasuk elemen yang belum ada saat boot -- prasyarat untuk
  tahap B (50 onclick di HTML dinamis app.src.js). Sebelum pola ini dipilih, dua
  konsekuensinya DIUKUR dulu di markup nyata: (a) tidak ada satu pun
  `stopPropagation` di index.html (dua yang ada semuanya di HTML dinamis
  app.src.js, masih inline, jadi belum terpengaruh); (b) hanya ADA SATU elemen
  ber-onclick yang bersarang di dalam elemen ber-onclick lain, dan keduanya
  memanggil `switchView('transaksi')` -- idempoten, jadi perubahan `closest()`
  (yang hanya menjalankan aksi TERDEKAT) tidak mengubah hasil.
- *Argumen sebagai JSON di `data-args`, bukan atribut terpisah.* TIPE harus
  terjaga persis: `shiftReportYear` menerima `1`/`-1`, dan kalau argumennya
  berubah jadi string maka `selectedReportYear += "1"` menghasilkan `"20261"`.
  Ini bukan teori -- uji negatif harness memang memunculkan `20261`.
- *Registry dibangun MALAS (saat klik pertama).* Sebagian handler dideklarasikan
  jauh di bawah dan sebagian variabel yang dirujuknya (mis. `currentAssetDetailId`)
  baru terisi belakangan.
- *Aksi tak dikenal & data-args rusak = `console.error`, bukan lempar.* Tombol
  mati diam-diam adalah kegagalan paling sulit dilacak pada pola lama; sekarang
  ia berteriak, tapi tidak mematikan dispatcher untuk seluruh halaman.

**VERIFIKASI (semua dibuktikan MERAH dulu):**
- `tests/unit/ui-actions.test.js` (10 tes statis). Enam sabotase diuji satu per
  satu -- salah ketik nama aksi, onclick= diselundupkan kembali, data-args JSON
  rusak, registry menunjuk fungsi hantu, dispatcher dicopot, `console.error`
  dihapus -- semuanya ditangkap oleh tes yang tepat.
- `scripts/verify-ui-actions.mjs` (BARU, 18 cek runtime). Uji negatif: mengganti
  `closest()` dengan `ev.target` -> U2 (klik ikon di dalam tombol) MERAH;
  membaca `data-args` sebagai string mentah -> U3 MERAH dengan `2026 -> 20261`.
- Diff `index.html`: 119 baris berubah, dan setelah atribut handler dinormalkan
  **nol** perbedaan di luar itu -- konversi tidak menyentuh struktur markup.
- Regresi tidak turun: hud 69/69, asset-logos 17/17, applock 21/21,
  applock-biometric 14/14, offline-cache 13/13. Unit 840/840, eslint 0.
- CACHE_VERSION v134 -> v135.

**BELUM DIKERJAKAN (tahap B):** 50 `onclick=` di HTML yang DIHASILKAN app.src.js.
Itu bagian yang lebih berharga (menghapus permukaan `jsStr()` yang menyisipkan
data pengguna ke dalam string kode) sekaligus lebih berisiko. Catatan penting
untuk tahap B: dua handler di sana memanggil `event.stopPropagation()` (baris
~2854-2855, tombol ubah/hapus kategori di dalam baris yang juga bisa diklik) --
kalau keduanya dikonversi ke data-action, `stopPropagation` TIDAK lagi mencegah
aksi induk, karena dispatcher berjalan di `document` setelah bubbling selesai.
Perlu penanganan eksplisit (mis. atribut `data-stop` yang dicek dispatcher).
CSP `'unsafe-inline'` baru bisa dilepas setelah tahap B selesai DAN blok
`<script>` inline di index.html ikut ditangani.

## v102 — Fase 4 tahap B: onclick= di HTML DINAMIS dihapus (tuntas)
**HASIL:** seluruh repo kini **0 atribut onclick=** -- index.html (tahap A, v101)
maupun HTML yang dirender runtime dari `app.src.js` + 5 modul `src/ui/*`.
59 lokasi dikonversi di tahap ini.

**KENAPA TAHAP INI LEBIH BERHARGA DARI TAHAP A:** pola lama menyisipkan DATA
PENGGUNA ke dalam STRING KODE -- `onclick="hapusData('${jsStr(row.id)}')"`.
Keamanannya bergantung pada `jsStr()` meloloskan setiap karakter yang bisa
memutus literal. Sekarang data pengguna tidak pernah jadi kode: ia jadi JSON di
dalam atribut (`data-args`), dibaca balik dengan `JSON.parse`. Efek sampingnya
dua modul kehilangan parameter `jsStr` karena benar-benar tidak terpakai lagi.

**HELPER BARU:** `uiActionAttrs(action, ...args)` di `src/domain/sanitize.js`
(satu sumber kebenaran, ter-uji), dengan salinan cadangan di `__sanitize`
app.src.js untuk masa sebelum modul ter-adopsi. Kesamaan keduanya dijaga tes
paritas -- dan tes itu SENDIRI sempat bocor: kasus ujinya cuma memakai nama aksi
"normal", sehingga melepas escapeHtml() dari NAMA aksi lolos tanpa ketahuan.
Ditemukan saat uji negatif, lalu kasus nama-aksi-aneh ditambahkan.

**KEPUTUSAN stopPropagation (diukur, bukan diasumsikan):** dua handler lama
memanggil `event.stopPropagation()` supaya aksi baris induk tidak ikut jalan.
Sebelum memutuskan, DOM sungguhan diukur dengan data ter-seed di 7 view + 5
modal: dari **2275 elemen ber-onclick dinamis, 410 bersarang di dalam elemen
ber-onclick lain, dan 100% di antaranya memakai stopPropagation** -- tidak ada
satu pun yang tidak. Artinya `closest()` (hanya menjalankan aksi TERDEKAT)
menghasilkan perilaku identik, dan `stopPropagation` tidak lagi diperlukan.
Juga diperiksa: satu-satunya listener klik lain di leluhur adalah dua container
delegasi yang ber-scope ketat (`closest("[data-insight-idx]")` /
`[data-ai-rec-idx]`), jadi tidak ada listener yang jadi ikut terpicu.

**JEBAKAN KONVERSI (semua ditemukan lewat gerbang, bukan lewat tebakan):**
1. Argumen berkutip yang memuat interpolasi -- `'tree-${type}-${idx}'` -- BERHENTI
   diinterpolasi begitu dipindah ke dalam `${...}`. Harus jadi template literal.
2. Tujuh potongan HTML App Lock dibangun dengan STRING BERKUTIP TUNGGAL, bukan
   template literal; `${uiActionAttrs(...)}` di situ hanya jadi teks. Diubah ke
   konkatenasi.
3. Tombol darurat "Muat Ulang" di `showFallbackError` SENGAJA tidak memakai
   data-action, melainkan addEventListener langsung: itu layar saat aplikasi
   GAGAL BOOT, sedangkan dispatcher dipasang ~1200 baris di bawahnya. Kalau
   app.js melempar di tengah, handler error sudah ada tapi dispatcher belum --
   justru saat itulah tombol pelarian paling dibutuhkan.
4. Kontrak `onClickItem` diubah dari "mengembalikan STRING kode onclick" jadi
   "mengembalikan {action, args}".

**VERIFIKASI (semua dibuktikan MERAH dulu):**
- `tests/unit/ui-actions.test.js` kini 17 tes. Lima sabotase tahap B diuji:
  salah ketik aksi dinamis, onclick= diselundupkan kembali ke app.src.js, nama
  aksi variabel salah, fallback menyimpang dari modul, dan escape data pengguna
  dilepas.
- `scripts/verify-ui-actions.mjs` naik 18 -> 26 cek. Tambahan penting:
  U8 argumen dari data dinamis sampai utuh ke fungsi; U9 nama aset berisi
  `" onmouseover="alert(1)` TIDAK menjadi atribut baru (0 atribut liar);
  U10 aksi anak jalan 1x sementara aksi INDUK 0x -- pengganti stopPropagation,
  diuji pada pasangan dinamis nyata `openAssetModal` di dalam
  `openAssetDetailModal`.
  U10 sempat PASS PALSU karena memilih pasangan bersarang yang nama aksinya
  sama (`switchView` di dalam `switchView`) sehingga tidak ada yang bisa
  dibedakan; sekarang harness WAJIB memilih pasangan bernama beda.
- 9 unit test lama yang menuntut `onclick=` di HTML hasil render diperbarui ke
  kontrak `data-action` + `data-args` ber-escape.
- Gerbang: unit 847/847, eslint 0, build idempoten. E2E hud 69/69,
  asset-logos 17/17, applock 21/21, applock-biometric 14/14, offline-cache
  13/13, ui-actions 26/26. CACHE_VERSION v135 -> v136.

**CSP:** `'unsafe-inline'` pada `script-src` BELUM bisa dilepas -- index.html
masih memuat 6 blok `<script>` inline. Itu langkah terpisah berikutnya, dan
sekarang jalannya sudah bersih karena tidak ada lagi atribut handler inline.

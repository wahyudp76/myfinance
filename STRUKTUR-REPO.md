# MyFinance — Peta Lengkap Struktur Repo

> Repo: `wahyudp76/myfinance` · branch `main` · ~417 commit · versi terbaru `v125`
> Sekali lihat: **SPA statis (tanpa server & tanpa bundler saat runtime) + Supabase backend + Edge Functions**.
> Browser memuat DUA berkas hasil build saja: `boot.bundle.js` (bundel ESM `boot.js` + 71 modul `src/**`, sejak v103) dan `app.js` (logika monolit). Keduanya di-commit, jadi deploy tetap cuma "salin file statis".

---

## 1. Ringkasan Arsitektur

Aplikasi ini adalah **single-page app (SPA) statis** yang di-deploy sebagai file statis
(Netlify Drop / Cloudflare Pages), dengan **Supabase** sebagai satu-satunya backend
(Postgres + RLS + Auth + Edge Functions).

- **Tidak ada `localStorage` sebagai database** — semua data (transaksi, aset, budget,
  pengaturan, profil) tersimpan di cloud per-akun dan otomatis sinkron.
- **Login & Dashboard** adalah dua "tampilan" di dalam satu `index.html`, ditukar lewat
  JavaScript tanpa reload — bukan dua file HTML terpisah.
- **Pola build "source → output di-commit"**: kamu mengedit file `.src.*`, lalu menjalankan
  build untuk menghasilkan file produksi. Hasil build **di-commit ke git** dan drift-nya
  dijaga oleh test CI (`git diff --exit-code`).

### Empat sumber kode → empat keluaran build (+ satu generator hash CSP)

| Sumber (kamu edit) | Build command | Hasil (dijalankan browser) | Guard drift |
|---|---|---|---|
| `app.src.js` | `npm run build:app` (terser) | `app.js` (−52,8% ukuran) | `tests/unit/app-minify.test.js` |
| `boot.js` + 71 modul `src/**` | `npm run build:boot` (esbuild) | `boot.bundle.js` (`vendor/` tetap external) | `tests/unit/boot-bundle.test.js` |
| `styles.src.css` | `npm run build:styles` (clean-css) | `styles.css` (−34,6%) | `tests/unit/styles-minify.test.js` |
| `css/tailwind.src.css` + pemindaian kelas | `npm run build:css` (tailwindcss) | `css/tailwind.css` (~55KB minified) | `tests/unit/tailwind-content.test.js` |
| blok `<script>` inline di `index.html` | `npm run build:csp` | 4 hash sha256 ditulis balik ke `index.html` **dan** `_headers` | `tests/unit/csp-hash.test.js` |

> **Aturan emas:** edit `app.src.js` / `boot.js` / `styles.src.css` /
> `css/tailwind.src.css`, **JANGAN** edit `app.js` / `boot.bundle.js` /
> `styles.css` / `css/tailwind.css` — itu output build.
> **Urutan penting:** kalau kelas Tailwind barumu ada di `app.src.js`, jalankan
> `build:app` DULU baru `build:css` — yang dipindai `tailwind.config.js` adalah
> `app.js` hasil build, bukan `app.src.js`.

---

## 2. Struktur Folder (tree)

```
myfinance/
├── index.html              # Markup 9 view + 19 modal (role="dialog"), meta CSP paling atas,
│                           #   jembatan bootstrap, loader Chart.js, registrasi SW.
│                           #   TANPA konfigurasi Supabase & TANPA atribut onclick= (v101-v102)
├── app.src.js              # SUMBER logika "monolit" (editor di sini) — juga tempat konstanta
│                           #   SUPABASE_URL / SUPABASE_ANON_KEY / WHATSAPP_BOT_NUMBER
├── app.js                  # OUTPUT build terser dari app.src.js (~265KB) — jangan diedit
├── boot.js                 # SUMBER wiring <script type="module"> (diekstrak dari index.html, v98)
├── boot.bundle.js          # OUTPUT build esbuild: boot.js + 71 modul src/ (~154KB, v103) —
│                           #   INI yang dimuat index.html; jangan diedit
├── styles.src.css          # SUMBER gaya visual kustom
├── styles.css              # OUTPUT build (clean-css)
├── sw.js                   # Service Worker (offline, precache, CACHE_VERSION=v153)
├── manifest.json           # Web App Manifest (PWA / Add to Home Screen)
├── _headers                # Header keamanan (Netlify/Cloudflare Pages): CSP, X-Frame-Options, dll
├── robots.txt              # Larang crawler (app privat)
├── tailwind.config.js      # Konfigurasi Tailwind (content scanning)
├── eslint.config.js        # ESLint 10 flat-config (ketat soal kebenaran, diam soal gaya)
├── .gitleaks.toml          # Guard agar secret tidak ter-commit
├── .nvmrc                  # Jalur Node 22 LTS; engines minimal >=22.19.0
├── package.json            # Script lint/test/build + devDependencies; Node >=22.19.0
│
├── src/                        # ★ Modul JS produksi (ES module) — di-import boot.js, lalu
│                               #   di-bundel jadi boot.bundle.js (v103) yang dimuat index.html
│   ├── auth/                   # Autentikasi Supabase
│   │   ├── client.js           # initAuthClient / getAuthClient
│   │   ├── session.js          # getSession, signIn, signUp, signOut
│   │   ├── guards.js           # onAuthStateChange, requireUser
│   │   ├── lifecycle.js        # createAuthLifecycle — ⚠️ TIDAK dipakai produksi (lihat bawah)
│   │   └── index.js            # Barrel re-export
│   ├── bootstrap/              # ⚠️ Boot & load pipeline — BELUM ter-wire ke produksi
│   │   ├── app.js              #   createAppBootstrap (start/stop + generation guard)
│   │   └── loader.js           #   createBootstrapLoader (de-dup in-flight + generation counter)
│   │                           #   KETIGANYA (bootstrap/app.js, bootstrap/loader.js,
│   │                           #   auth/lifecycle.js) tidak di-import boot.js → di-tree-shake
│   │                           #   HABIS dari boot.bundle.js, dan tidak punya satu pun unit test.
│   │                           #   Jalur boot produksi yang SEBENARNYA = IIFE bootstrapAuth()
│   │                           #   di app.src.js. lifecycle.js sengaja TIDAK dipakai: ia
│   │                           #   memanggil onAuthenticated di SETIAP event yang punya session
│   │                           #   (termasuk TOKEN_REFRESHED berkala) → showAppShell()+initApp()
│   │                           #   → seluruh loadData() terulang tiap refresh token. Kontrak
│   │                           #   yang belum dipenuhi: docs/production-loader-contract.md
│   ├── domain/                 # ★ Logika murni (pure functions) — 38 file, teruji unit
│   │   ├── transactions.js     # filter/cari, compute views, insertTransactionRow, dll
│   │   ├── accounts.js         # total/grafik/agregasi akun
│   │   ├── budgets.js          # realisasi vs anggaran, deteksi ambang
│   │   ├── assets.js           # portofolio + net worth
│   │   ├── asset-flows.js      # arus aset, self-heal akun bayangan
│   │   ├── recurring.js        # transaksi berulang + catchup
│   │   ├── app-lock.js         # PIN/lockout/idle; biometrik per-perangkat + metadata domain RP (v92-107)
│   │   ├── ai-recommendations.js # normalisasi rekomendasi Gemini utk list+modal detail, kompatibel cache lama (v94)
│   │   ├── reminders.js        # pengingat proaktif: budget >=80/100%, recurring H-1, tujuan H-7/H-1 (v92)
│   │   ├── goals-debts.js      # progress goal & utang
│   │   ├── reports.js          # ringkasan tahunan/bulanan/trend
│   │   ├── calendar.js         # ringkasan kalender, proyeksi jatuh tempo
│   │   ├── categories.js       # kategorisasi & proporsi sub-kategori
│   │   ├── dashboard.js        # agregasi data dashboard
│   │   ├── insights.js         # wawasan keuangan (hitung di browser, gratis; tiap insight punya `short`+`detail`)
│   │   ├── ai-summary.js       # rekomendasi Gemini (edge function)
│   │   ├── backup.js           # build/validate backup + restore
│   │   ├── export-csv.js       # ekspor CSV (dengan sanitasi formula injection)
│   │   ├── settings.js         # override ikon/gaya, sanitasi input tak tepercaya
│   │   ├── theme.js            # tema terang/gelap/sistem, preset warna
│   │   ├── market-sync.js      # kontrak nilai pasar (Bibit/CoinGecko/Yahoo)
│   │   ├── finance.js          # perhitungan finansial inti
│   │   ├── demo-data.js        # data demo (butuh SEMUA aset diimpor?) — DEMO_MARKER
│   │   ├── command-palette.js  # Ctrl/Cmd+K palette
│   │   ├── app-info.js         # ukuran data & info app
│   │   ├── chart-hud.js        # HUD chart
│   │   ├── chart-labels.js     # sparse labels utk chart sempit
│   │   ├── chart-palette.js    # palet colorblind-safe
│   │   ├── sparkline.js        # sparkline SVG
│   │   ├── format.js           # format angka/Rp, txIdrAmount, deepCloneDict, transferTargetAmount (family, adopsi __fmt)
│   │   ├── dates.js            # parseTgl/toDateStr/todayDateStr/currentMonthStr (family, adopsi __dates)
│   │   ├── category-style.js   # resolveBaseCategoryStyle/categorizeParentFromLookup (family, adopsi __catstyle)
│   │   ├── sanitize.js         # escapeHtml/jsStr murni (anti-XSS render, family, adopsi __sanitize)
│   │   ├── slugify.js          # slugify/slugifyCtx murni (family, adopsi __slugify)
│   │   ├── asset-icons.js      # detectAssetCategoryIcon/assetIconCtx murni (family, adopsi __assetIcon)
│   │   ├── bank-icons.js       # bankWalletDatabase + detectAutoAccountIcon (family, adopsi __bankIcon)
│   │   ├── platform-logos.js   # resolvePlatformLogoUrl: katalog logo platform DB (v86, adopsi __platformLogos)
│   │   └── account-currency.js # resolveAccountCurrency murni (map DI; adopsi __accountCurrency)
│   ├── services/               # ★ Akses data (Supabase / edge) + kontrak
│   │   ├── transactions.js     # createTransactionService, mapTransactionRow
│   │   ├── user-id.js          # identitas user
│   │   ├── parity/transactions.js   # pembanding legacy vs native (parity)
│   │   └── supabase/               # adapter per entity Supabase
│   │       ├── client.js        # createClient dari vendor/ (supabase-js 2.113.0)
│   │       ├── index.js         # barrel
│   │       ├── paging.js        # paginasi paralel (2 fase, MAX_PARALLEL_PAGES)
│   │       ├── assets.js / budgets.js / recurring.js / settings.js / transfers.js
│   │       ├── custom-icons.js  # ikon/logo & foto profil kustom
│   │       ├── platform-logos.js # listPlatformLogos (katalog global, v86)
│   │       ├── edge.js          # suggestCategory, getExchangeRate, scanReceipt
│   │       └── README.md        # kontrak lapisan service (tanpa service-role di sini)
│   └── ui/                      # ★ Render/DRY pengganti fungsi render duplikat — 12 file
│       ├── accounts.js / assets.js / budgets.js / calendar.js / categories.js
│       ├── charts.js / goals-debts.js / insights.js / recurring.js / ai-recommendations.js  # insights & rekomendasi AI: kartu compact + modal detail (v94)
│       ├── skeletons.js         # placeholder saat loading
│       └── modal-a11y.js        # aksesibilitas modal (focus trap, label)
│
├── css/
│   ├── tailwind.src.css     # SUMBER Tailwind (3 directive)
│   ├── tailwind.css         # OUTPUT build Tailwind
│   ├── fontawesome-all.min.css  # Font Awesome self-host
│   └── _full/               # versi lengkap, untuk subset
│
├── fonts/
│   └── plus-jakarta-sans-latin.woff2   # font self-host (27KB variable)
│
├── webfonts/
│   ├── fa-solid-900.woff2 / fa-brands-400.woff2  # subset Font Awesome
│   └── _full/              # versi lengkap
│
├── icons/
│   ├── favicon-16/32.png, apple-touch-icon.png, icon-192/512.png, icon-source.svg
│   ├── banks/              # logo bank & e-wallet self-hosted
│   │   ├── bca.svg / mandiri.svg / bri.svg / bni.png / bsi.svg
│   │   └── jago.svg / gopay.svg / ovo.svg / dana.svg / shopeepay.svg
│   └── platforms/          # logo platform investasi self-hosted (v86: dipulihkan + GoTo/Danamas baru)
│       └── bibit.svg / ajaib.ico / stockbit.svg / bareksa.svg / pluang.png /
│           indodax.png / tokocrypto.svg / pintu.png / mirae.svg / goto.svg / danamas-stabil.png
│
├── vendor/                 # ★ SEMUA dependensi pihak-3 self-hosted (v59) — esm.sh/jsdelivr/cdnjs hilang
│   ├── supabase-js-2.113.0.bundle.min.mjs
│   ├── esm-node-*.mjs      # polyfill Node (buffer, events, async_hooks, process, tty)
│   ├── chartjs-4.5.1.min.js
│   ├── chartjs-plugin-datalabels-2.0.0.min.js
│   ├── fullcalendar-6.1.10.min.js
│   └── README.md           # provenance & prosedur upgrade
│
├── sql/                    # Skema & migrasi Supabase (semua "if not exists" — aman di-run ulang)
│   ├── schema.sql          # ★ TITIK MASUK INSTALASI BARU — SATU KALI RUN CUKUP (v95).
│   │                       #   11 tabel (transactions, budgets, assets, settings, custom_icons,
│   │                       #   recurring_transactions, api_rate_limits, rate_limits, platform_logos,
│   │                       #   whatsapp_link_codes, whatsapp_links) + 4 RPC atomik
│   │                       #   (create_transfer_transaction, create_recurring_transaction,
│   │                       #   replace_month_budgets, check_and_consume_rate_limit)
│   │                       #   + 1 fungsi trigger (set_platform_logos_updated_at) + RLS
│   │                       #   bentuk initplan + seed katalog logo platform.
│   │                       #   Bentuk platform_logos MENGIKUTI PRODUKSI (audit drift
│   │                       #   live-vs-repo 2026-09-13): id bigint GENERATED BY DEFAULT
│   │                       #   AS IDENTITY, bukan uuid -- lihat komentar bagian 8.
│   └── migrations/         # ARSIP RIWAYAT — JANGAN dijalankan di project baru (v95: dua file
│                           #   di antaranya error di database kosong; lihat header schema.sql)
│       ├── 20260906_platform_logos.sql        # tabel katalog logo platform + RLS baca publik + seed (v86)
│       ├── 20260906_platform_logo_aliases.sql # contoh pola upsert katalog custom (GoTo, Danamas)
│       ├── 2026-08-supabase-native-foundation.sql
│       ├── migration_asset_price_columns_2026-08.sql
│       ├── migration_assets_tanggal_nav_2026-09.sql
│       ├── migration_composite_indexes_2026-09-02.sql
│       ├── migration_f1_rls_auto_enable_2026-08-31.sql
│       ├── migration_rate_limiting_2026-08.sql
│       ├── migration_reliability_hardening_2026-08.sql
│       ├── migration_rls_hardening_2026-08-31.sql
│       ├── migration_transfer_currency_2026-08.sql
│       ├── migration_whatsapp.sql
│       ├── pre_migration_checks_2026-08.sql
│       ├── rls_performance_fix.sql
│       └── event_trigger_ensure_rls.sql
│
├── supabase/functions/     # 5 Edge Function (Deno) + folder helper _shared/
│   ├── _shared/
│   │   ├── bibit.js         # API reksadana Bibit (en/decrypt AES-256-CBC)
│   │   ├── market-sync.js   # logika sinkronisasi harga pasar
│   │   └── price-sources.js # CoinGecko + Yahoo (Stooq mati — jangan dipakai)
│   ├── analyze-finance/index.ts    # rekomendasi AI (Gemini) presisi ke data
│   ├── refresh-asset-price/index.ts# auto-update nilai aset (Reksadana/Kripto/Saham)
│   ├── get-exchange-rate/index.ts
│   ├── scan-receipt/index.ts       # baca struk via Gemini vision
│   └── whatsapp-webhook/index.ts   # bot WhatsApp (Fonnte)
│
├── scripts/                # Perkakas dev: 4 build + 9 harness E2E + 3 folder alat
│   ├── build-app.mjs       # terser app.src.js → app.js
│   ├── build-boot.mjs      # esbuild boot.js + src/** → boot.bundle.js (v103)
│   ├── build-styles.mjs    # clean-css styles.src.css → styles.css
│   ├── build-csp.mjs       # hash sha256 <script> inline → index.html + _headers (v104)
│   ├── subset-fontawesome.py  # subset Font Awesome → webfonts/ (jebakan SAFELIST: AGENT-HANDOFF v51)
│   ├── bench-save-latency.mjs # benchmark alur simpan transaksi (v52)
│   ├── verify-hud.mjs      # E2E Playwright (70 cek) — dijalankan CI: .github/workflows/e2e-harness.yml
│   ├── verify-ui-actions.mjs  # E2E aksi UI deklaratif data-action (39 cek, v101)
│   ├── verify-applock-rpid.mjs # E2E RP ID WebAuthn, legacy & pindah domain (31 cek, v107)
│   ├── verify-applock.mjs  # E2E kunci aplikasi + pengingat, stub settings STATEFUL (21 cek, v92)
│   ├── verify-csp.mjs      # E2E Content-Security-Policy (17 cek, v109)
│   ├── verify-asset-logos.mjs # E2E logo platform aset (17 cek, v86)
│   ├── verify-applock-biometric.mjs # E2E biometrik multi-perangkat, virtual authenticator CDP (14 cek, v99)
│   ├── verify-offline-cache.mjs # E2E cache data offline/PWA (13 cek, v100)
│   ├── verify-ui-sweep.mjs # E2E sapu seluruh permukaan aksi (9 cek, v106)
│   ├── lighthouse/run.mjs      # pagar performa (ambang: performance 55, a11y 85, best-practices 90)
│   │   └── chrome-path.mjs     # validasi CHROME_PATH / Playwright tanpa path hardcode
│   ├── schema-verify/      # v95/v96: uji sql/schema.sql di Postgres NYATA — run.mjs
│   │                       #   (install dari nol + idempotensi + 10 cek RLS/RPC/grant).
│   │                       #   Jalan otomatis di CI: job "Schema install check (Postgres)"
│   │                       # v124: + drift-check.mjs (katalog vs snapshot di CI, vs
│   │                       #   PRODUKSI lewat --live-check manual) + catalog-queries.json
│   │                       #   + expected-catalog.json + sql-parse.mjs (parser bersama)
│   └── rls-audit/          # probe audit RLS + grants behavioral (4 skrip + README)
│
├── tests/                  # ★ Test (tanpa koneksi jaringan untuk unit)
│   ├── unit/               # 91 file *.test.js murni (node --test) — npm run test:unit
│   │   ├── sw-cache.snapshot            # snapshot hash aset precache SW
│   │   ├── sw-cache-hash-helper.mjs     # helper penghitung hash precache
│   │   ├── update-sw-cache-snapshot.mjs # regen snapshot SETELAH bump CACHE_VERSION + build
│   │   └── helpers/mock-supabase-client.js
│   └── parity/             # 6 file: banding legacy vs native (sebagian butuh secret live / opt-in)
│
├── docs/                   # Rencana migrasi, audit, kontrak — 14 dokumen
│   ├── SESSION-HANDOFF.md  # snapshot handoff 2026-08-31 (AGENT-HANDOFF.md ada di root)
│   ├── architecture-modernization-plan.md
│   ├── supabase-native-migration-plan.md
│   ├── current-data-flow-map.md    # HISTORIS: masih menyebut CDN — tidak berlaku sejak v59
│   ├── production-loader-contract.md
│   ├── schema-contract-audit.md    # HISTORIS: gap kolom yang disebut sudah ditutup schema.sql v95
│   ├── financial-invariants.md
│   ├── applock-webauthn-domain.md  # v107: kebijakan RP ID + panduan pindah domain
│   ├── db-migration-status-2026-09-01.md
│   ├── rls-grants-audit-2026-08-31.md
│   ├── audit-bug-analysis-2026-09-02.md
│   ├── audit-drift-live-vs-repo-2026-09-13.md  # v124: 12 temuan drift produksi vs
│   │                       #   sql/schema.sql + cara auditnya (dapat diulang)
│   ├── AUDIT_REPORT_2026-08.md
│   └── PILOT-MIGRASI-v71.md  (v91: dipindah dari root — dokumen historis pilot migrasi monolit→modul)
│
└── .github/
    ├── dependabot.yml          # npm + github-actions bulanan (minor/patch digrup, major dipisah)
    └── workflows/
        ├── parity.yml              # workflow bernama "CI": unit + secret-scan + lint
        │                           #   + build drift guard (CSS + app + bundel boot)
        │                           #   + schema-install (Postgres, v96) + lighthouse
        │                           #   + parity live (HANYA push, tidak pernah pull_request)
        ├── e2e-harness.yml         # menjalankan kesembilan harness E2E di CI (hermetic, tanpa secret)
        └── dependabot-auto-merge.yml  # merge otomatis PR Dependabot yang CI-nya hijau penuh
```

---

## 3. Alur Muat (Loader / Bootstrap)

1. **Konfigurasi Supabase** (URL + anon key) ada di **`app.src.js`** di bawah komentar
   "KONEKSI SUPABASE" — BUKAN di `index.html` (ikut pindah saat blok monolit diekstrak di v54).
   `index.html` hanya menyebut host project itu di meta CSP + `<link rel="preconnect">`.
   Urutan di `<head>`: `<meta charset>` → **meta CSP** (v104: wajib paling atas, sebelum skrip
   apa pun) → blok inline penentu tema (anti kedip) → preload/preconnect → stylesheet →
   blok inline pembuat 2 Promise jembatan → `<script type="module" src="./boot.bundle.js">`.
2. **`boot.bundle.js`** adalah bundel esbuild dari **`boot.js`** + 71 modul `src/**`
   (auth → services/domain/ui). Ia memapar ratusan fungsi lewat `window.__myfinanceAuth` &
   `window.__myfinanceServices`, lalu men-dispatch event `myfinance:auth-ready` /
   `myfinance:services-ready`. Module dieksekusi *deferred* (setelah seluruh dokumen).
   Riwayat: sampai v97 blok ini INLINE di `index.html`; v98 memindahkannya byte-exact ke
   `boot.js` (dokumen turun 33,8 → 29,8 KB gzip, karena SW memakai network-first untuk dokumen
   tapi stale-while-revalidate untuk aset); v103 mem-bundel-nya jadi SATU berkas (kunjungan
   pertama turun dari 101 → 30 request — 71 modul ESM kecil-kecil itu biaya latensi, bukan byte).
3. **`app.js`** adalah blok `<script>` **classic** di body (logika monolit). Ia menunggu kedua
   Promise jembatan itu lewat `Promise.all` + timeout 8 detik per modul (pesan error menyebut
   modul mana yang gagal), dengan jaring pengaman generik 12 detik → layar error + "Muat Ulang".
   Classic script (bukan module) karena ±394 fungsinya harus global: itulah kontrak
   **registry aksi `data-action=`** (169 aksi) + harness E2E, sehingga terser wajib
   `mangle.toplevel=false` + `keep_fnames=true`.
   Atribut **`onclick=` di markup sudah HABIS** (119 atribut dihapus di v101, sisanya di HTML
   yang dihasilkan runtime dihapus di v102) — diganti `data-action` + `data-args` JSON dan satu
   dispatcher delegasi di `document`. Itulah yang memungkinkan `'unsafe-inline'` dilepas dari
   `script-src` (v104) dan `style-src` (v109).
4. **Bootstrap produksi** = IIFE `bootstrapAuth()` di `app.src.js` — **bukan** `src/bootstrap/`.
   Urutannya: `initSupabaseClient()` (menunggu 2 Promise jembatan, lalu mengadopsi 10 helper
   domain kanonik) → `initStaticUIListeners()` → `initLoginForm()` → pasang listener
   `onAuthStateChange` yang **sengaja hanya bereaksi ke event `SIGNED_OUT`** (titik terpusat
   semua jalur logout: tombol manual, sesi kedaluwarsa, dicabut dari perangkat lain) →
   `auth.getSession()` → ada sesi: `enterApp()` (gerbang Kunci Aplikasi v92 diperiksa DULU,
   baru appShell + `loadData()`); tidak ada: `showLoginView()`.
   Pengaman lomba (race) di jalur ini diimplementasikan **di monolit sendiri**, dan kontrak
   `docs/production-loader-contract.md` memang terpenuhi — hanya bukan oleh `src/bootstrap/`:
   `_loadDataSeq` (v69) memberi nomor urut tiap panggilan `loadData()` sehingga hanya
   panggilan TERAKHIR yang boleh menimpa state (respons basi ditolak); `showLoginView()`
   memanggil `resetAppState()` (reset memori + bump generasi) lalu `clearOfflineDataCache()`
   (kirim pesan `MYFINANCE_CLEAR_DATA_CACHE` ke SW); `_pendingTxMutations` &
   `_txFetchInFlight` dikosongkan saat logout (v119: pending milik user sebelumnya tidak
   boleh ikut ke sesi berikutnya); dan `reconcileTxRowsWithPending()`
   (`src/domain/transactions.js`) mendamaikan baris hasil fetch dengan mutasi tertunda.
   `src/bootstrap/app.js` + `loader.js` adalah **modularisasi dari pola yang sama, belum
   dipasang** (lihat catatan ⚠️ di tree §2).
5. **`sw.js`** (service worker) meng-pre-cache app shell + aset, dan men-cache data GET
   `/rest/v1` di cache DATA terpisah (sengaja tidak ikut `CACHE_VERSION`). Ganti
   `CACHE_VERSION` lalu jalankan `node tests/unit/update-sw-cache-snapshot.mjs` SETELAH build.

---

## 4. Alur Data

```
UI (index.html: 9 view + 19 modal · data-action= deklaratif → 1 dispatcher delegasi
   │  di document → registry 169 aksi di app.src.js; src/ui/** merender HTML,
   │  src/domain/sanitize.js meng-escape)
   │
   ├── domain/**: logika murni (hitung, filter, agregasi) — tidak tahu Supabase
   │
   ├── services/**: kontrak data (satu-satunya boundary database)
   │     ├── user-id.js: getSession() dulu (hemat 1 RTT), fallback getUser()
   │     ├── supabase/paging.js: fetch-all 2 fase (halaman 1 + count=exact, sisanya
   │     │                       paralel maks 6 halaman, fallback berurutan)
   │     └── supabase/*: adapter per entity (createClient dari vendor/)
   │           └── supabase-js 2.113.0 (vendored) ──► Supabase REST/Realtime + RLS
   │                 └── 3 RPC atomik: create_transfer_transaction,
   │                     create_recurring_transaction, replace_month_budgets
   │
   └── services/supabase/edge.js ──► Edge Functions (supabase/functions/*, Deno)
           ├── analyze-finance      ──► Gemini AI (4 mode: insights / question /
           │                            monthly_summary / suggest_category)
           ├── refresh-asset-price  ──► Bibit / CoinGecko / Yahoo IDX
           ├── scan-receipt         ──► Gemini vision
           └── get-exchange-rate    ──► Frankfurter (ECB)

   whatsapp-webhook ◄── Fonnte (webhook server-ke-server, BUKAN dari browser):
                        verifikasi kode → link nomor↔akun → parse pesan → tabel transactions
```

**Aset & sumber harga:** kategori aset otomatis memilih sumber — Kripto→`coingecko`,
Saham→`yahoo_id_stock`, Reksadana→`reksadana_bibit` (via `ASSET_AUTO_UPDATE_CONFIG`).
Nilai baru = `round(harga_per_unit × jumlah_unit)`, riwayat di `value_history`
(dedupe per hari). `price-sources.js`: `yahooChartUrls` (2 mirror), `pickYahooMarketPrice`;
**Stooq mati — jangan dipakai.**

---

## 5. Keamanan & Kualitas

- **RLS** aktif di semua **11 tabel** (15 policy, bentuk `(select auth.uid())` = initplan,
  dievaluasi sekali per query bukan sekali per baris); tiap user hanya lihat/ubah datanya
  sendiri. Dijaga `sql/schema.sql` untuk instalasi baru, plus migrasi arsip
  `*_rls_hardening*`, `event_trigger_ensure_rls`, dan `pre_migration_checks`.
  Dua pengecualian yang disengaja: `api_rate_limits` **tanpa policy sama sekali** untuk
  anon/authenticated (jalan masuk sah hanya RPC SECURITY DEFINER atau service_role — kalau
  bisa dibaca, user tinggal DELETE barisnya untuk mereset limit), dan `whatsapp_links`
  **tanpa policy INSERT** (baris baru hanya boleh dibuat Edge Function setelah kode
  terverifikasi). CATATAN: `event_trigger_ensure_rls.sql` &
  `migration_f1_rls_auto_enable_*.sql` butuh hak superuser dan **SENGAJA tidak dijalankan
  otomatis** oleh `schema.sql` — lihat header file itu.
- **CSP** di `_headers` dan meta `index.html` harus **selalu sinkron** — dijaga
  `tests/unit/vendor-local.test.js` + `csp-hash.test.js`, dan keduanya ditulis ulang
  bersamaan oleh `npm run build:csp`. `'unsafe-eval'`, `script-src 'unsafe-inline'`, dan
  `style-src 'unsafe-inline'` semuanya sudah dibuang: `script-src` = `'self'` + **4 hash
  SHA-256** (blok `<script>` inline di `index.html`), `style-src` = `'self'` + **1 hash
  SHA-256** (untuk `<style>` kosong FullCalendar, supaya `insertRule()` via CSSOM tetap jalan
  tanpa membuka inline style umum). Atribut style dikunci `style-src-attr 'none'` — nilai
  visual dinamis dikirim sebagai `data-style-*`, divalidasi ketat (whitelist properti +
  regex + maks 300 char), lalu dipasang lewat `CSSStyleDeclaration.setProperty()`
  (`applyCspDynamicStyles()` + MutationObserver di `app.src.js`).
  **Soal domain:** `script-src` & `connect-src` kini HANYA `'self'` + Supabase (project
  `uxfngmxghupdlwoeoxgh`) karena semua pustaka sudah di-vendor (v59). `img-src` masih
  mengizinkan **12 host** = Supabase + 11 domain logo platform investasi (bibit.id,
  stockbit.com, images.bareksa.com, image-cdn.pluang.com, indodax.com, pintu.co.id,
  ajaib.co.id, www.indopremier.com, www.banksinarmas.com, commons.wikimedia.org,
  upload.wikimedia.org) — jalur fallback hotlink di luar katalog `platform_logos`/
  `icons/platforms/` yang self-hosted.
- **Hardening input tak tepercaya** (v60): sanitasi CSV formula injection, escape nama akun,
  validasi override ikon/gaya, fallback ikon netral.
- `.gitleaks.toml` mencegah secret ter-commit — dipindai dua kali di CI: working tree DAN seluruh riwayat commit. Tidak ada service-role key di kode browser.
- **Verifikasi wajib** sebelum merge:
  ```bash
  npm run lint          # ESLint (0 masalah)
  npm test              # lint + unit + parity
  node scripts/verify-hud.mjs   # 70 cek E2E (butuh: npx http-server . -p 8123 -c-1)
  node scripts/verify-asset-logos.mjs # 17 cek E2E logo aset (server sama)
  node scripts/verify-applock.mjs     # 21 cek E2E kunci aplikasi (server sama)
  node scripts/verify-applock-rpid.mjs # 31 cek RP ID, legacy & perpindahan domain (3 origin simulasi lokal)
  node scripts/verify-applock-biometric.mjs # 14 cek biometrik multi-perangkat (WAJIB lewat
                                      # http://localhost — WebAuthn menolak origin ber-IP)
  node scripts/verify-offline-cache.mjs # 13 cek cache data offline/PWA
  node scripts/verify-ui-actions.mjs  # 39 cek aksi UI deklaratif (data-action)
  node scripts/verify-csp.mjs         # 17 cek Content-Security-Policy
  node scripts/verify-ui-sweep.mjs    # 9 cek sapu seluruh permukaan aksi
  node scripts/schema-verify/run.mjs  # v96: install sql/schema.sql dari nol di
                                      # Postgres nyata + 10 cek RLS/RPC/grant
                                      # (butuh psql; lihat README di folder itu)
  node scripts/schema-verify/drift-check.mjs --check
                                      # v124: katalog hasil install == snapshot
                                      # (butuh psql). Tambah SUPABASE_ACCESS_TOKEN +
                                      # SUPABASE_PROJECT_REF lalu --live-check untuk
                                      # membandingkan dengan database PRODUKSI
  ```
- Build drift dijaga CI (job **"Build drift guard (CSS + app + bundel boot)"** di
  `parity.yml`): keempat build dijalankan ulang lalu `git diff --exit-code` per berkas —
  `build:css` → `css/tailwind.css` + `styles.css`, `build:app` → `app.js`,
  `build:boot` → `boot.bundle.js` (v103), `build:csp` → `index.html` (v104).
  Dua yang terakhir penting karena unit test mengimpor SUMBER (`boot.js`, `src/**`), jadi
  lupa rebuild akan lolos semua tes padahal yang tayang versi lama; dan blok skrip inline
  yang berubah tanpa hash CSP diperbarui akan DITOLAK browser tanpa error apa pun.
- Instalasi baru dijaga CI: job `Schema install check (Postgres)` menjalankan
  `sql/schema.sql` di container Postgres kosong tiap push/PR (v96) — hermetic,
  tanpa secrets. Ini pagar untuk kelas bug v95 ("schema.sql kelihatan lengkap
  tapi di database kosong menghasilkan 0 function").
- Harness E2E juga berjalan otomatis di CI via workflow **`E2E Harness`**
  (`.github/workflows/e2e-harness.yml`): push & pull_request ke `main`/`refactor/**`,
  jadwal mingguan (Minggu 18:00 UTC = Senin 01:00 WIB, untuk menangkap pergeseran
  environment runner/Chromium yang membuat harness pelan-pelan basi), dan
  `workflow_dispatch` manual — semuanya hermetic (stub Supabase, tanpa secrets),
  dengan `concurrency` cancel-in-progress. Kesembilan harness di daftar atas
  dijalankan di sini. Selain `verify-hud` + `verify-asset-logos`,
  ada `scripts/verify-applock-rpid.mjs` (v107, 31 cek): kompatibilitas kredensial
  tanpa rp.id lama, RP eksplisit, daftar ulang lintas domain, respons gagal
  tetap terkunci; tiga origin disimulasikan dari checkout lokal. Lalu
  ada `scripts/verify-applock-biometric.mjs` (v99, 14 cek): memakai virtual authenticator
  CDP untuk menguji biometrik PER PERANGKAT (bug v92-v98: kredensial roaming satu-slot
  membuat perangkat kedua tak pernah bisa mendaftar). Dan
  ada `scripts/verify-applock.mjs` (v92, 21 cek): menguji kunci aplikasi +
  pengingat end-to-end lintas reload — stub tabel settings-nya STATEFUL
  (upsert ditulis ke store memori) supaya konfigurasi kunci bertahan antar
  reload, persis cloud asli.

---

## 6. Fitur Terkait Struktur (rangkum)

- **PWA**: `manifest.json` (`lang: id`, `display: standalone`, `orientation: portrait-primary`)
  + ikon 192/512 (purpose `any` **dan** `maskable`) → "Add to Home Screen".
  Warna: `background_color` (splash) `#f8fafc`, `theme_color` `#151928`.
  ⚠️ **Catatan inkonsistensi yang belum dibereskan:** `<meta name="theme-color">` di
  `index.html` berisi `#05070f` (biru-gelap HUD), dan meta itulah yang dipakai browser
  untuk warna UI saat app dibuka — jadi warnanya TIDAK sama dengan `theme_color` manifest
  (`#151928`, dipakai saat install/splash). Keduanya sah, tapi kalau mau seragam,
  samakan salah satu.
- **Offline**: `sw.js` precache + banner offline.
- **Back Tap / Quick Add** iPhone: URL `?quickadd=1` membuka modal Catat Transaksi.
- **Pull-to-refresh**, tombol kembali ke atas, dark/light/system theme, command palette
  (Ctrl/Cmd+K), wawasan keuangan on-device, rekomendasi AI via Gemini, ekspor CSV
  (salah satunya dari menu Transaksi), profil + foto, maskot login SVG orisinal.
- **Kunci Aplikasi (v92)**: PIN 6 digit (hash SHA-256 + salt di
  `appSettings.app_lock` -> ikut roam), gerbang boot via cache localStorage
  per-user, lockout 5 gagal -> cooldown 30 dtk, biometrik WebAuthn opsional,
  lupa PIN -> verifikasi password. Sejak v107: RP ID mengikuti hostname
  persis, metadata domain baru disimpan sebagai `rp_id`; pindah domain wajib
  daftar ulang biometrik ([panduan](docs/applock-webauthn-domain.md)).
- **Notifikasi & Pengingat (v92)**: budget >=80%/100%, recurring H-1, tenggat
  tujuan H-7/H-1; toggle per jenis di Pengaturan; dedup log per-perangkat
  (`myfinance_reminders_sent`, FIFO 200).
- **Tabel Supabase (11)**: `transactions`, `budgets`, `assets`, `settings`,
  `custom_icons`, `recurring_transactions`, `api_rate_limits`, `rate_limits`,
  `platform_logos`, `whatsapp_link_codes`, `whatsapp_links`.

---

### Toolchain pengembangan

- Runtime yang didukung untuk `npm ci`, lint, unit/parity, build, Lighthouse, dan harness adalah **Node `>=22.19.0`**.
- `.nvmrc` tetap berisi `22`, sehingga CI memilih rilis terbaru dari jalur Node 22 LTS.
- Node 20 mungkin masih menjalankan sebagian tes murni, tetapi tidak didukung oleh seluruh toolchain npm (Lighthouse, Puppeteer, dan Supabase JS). Jangan menganggap hasil unit di Node 20 sebagai dukungan resmi.

### Catatan praktis untuk mulai berkontribusi
1. Fitur logika baru → tulis pure function di `src/domain/` + test di `tests/unit/`.
2. Render UI baru → `src/ui/`, lalu **re-export di `boot.js`** dengan alias `...UI` dan
   daftarkan di objek `window.__myfinanceServices` (itu satu-satunya jalur modul ES ke
   blok classic `app.js`) → `npm run build:boot`.
3. Akses data baru → `src/services/supabase/` + objek DB baru di `sql/schema.sql`
   (idempotent). Kalau menambah RPC: definisinya WAJIB ada di `schema.sql`, kalau tidak
   `tests/unit/sql-schema-completeness.test.js` akan merah — itu pagar supaya instalasi
   baru tidak pernah lagi "hidup tapi rusak".
4. Aksi UI baru → daftarkan namanya di `uiActionRegistry()` (`app.src.js`) lalu pakai
   `data-action="namaAksi"` (+ `data-args` JSON) di markup. **Jangan** menambah atribut
   `onclick=`/`onchange=` — `index.html` sudah 0 atribut handler, dan itu syarat
   `script-src` tanpa `'unsafe-inline'` (test: `ui-actions.test.js`, `index-inline-scripts.test.js`).
5. Ubah monolit → **edit `app.src.js`** → `npm run build:app`.
6. Ubah styling → **edit `styles.src.css`** → `npm run build:styles`. Ubah class Tailwind
   di `index.html`/`app.src.js`/`boot.js`/`src/**` → `npm run build:css`
   (`css/tailwind.src.css` sendiri cuma 3 directive `@tailwind`, jarang disentuh).
   **Urutan kalau kelasnya ada di `app.src.js`:** `build:app` dulu, baru `build:css`.
7. Setelah aset berubah → bump `CACHE_VERSION` di `sw.js` + jalankan
   `node tests/unit/update-sw-cache-snapshot.mjs` SETELAH build.
8. Kalau menambah CDN/domain → tambahkan di CSP `_headers` **dan** meta `index.html`
   (jalankan `npm run build:csp` supaya keduanya ditulis ulang bersamaan).
9. **Angka di dokumen dijaga mesin (v97, diperluas v122)**:
   `tests/unit/docs-consistency.test.js` (16 test) mencocokkan `CACHE_VERSION`, versi
   terbaru di header berkas ini vs entri terakhir `AGENT-HANDOFF.md`, jumlah file
   `src/domain/` + `src/ui/` + total modul `src/`, jumlah tabel/RPC di
   `sql/schema.sql`, jumlah cek tiap harness E2E, dan versi bundel `vendor/supabase-js-*`
   vs `package.json`.
   Perluasan v122 menagih klaim yang dulu cuma naratif dan terbukti bisa basi diam-diam —
   di berkas ini, di `README.md`, **dan di blok "Peta cepat" `AGENT-HANDOFF.md`** (entri
   `## vNN` di bawahnya tetap dikecualikan karena itu log historis):
   lokasi `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `WHATSAPP_BOT_NUMBER` (wajib di
   `app.src.js`, dilarang muncul di `index.html`), jumlah `role="dialog"` + jumlah view,
   jumlah file `tests/unit/*.test.js`, jumlah **dan nama** Edge Function, major versi
   ESLint, batas ukuran upload (8MB ikon/foto profil · 10MB foto struk), angka apa pun
   yang menempel pada frasa "atribut `onclick=`" — yang sudah habis dihapus dari markup
   sejak v101-v102 — dan status wiring `src/bootstrap/`
   (dua arah — kalau suatu saat benar-benar ter-wire, dokumen yang masih menandainya
   "⚠️ BELUM ter-wire ke produksi" ikut merah).
   Satu test di sana bukan soal dokumen melainkan soal markup:
   `markup: 0 handler inline, dan SEMUA data-action/data-on-* terdaftar di registry`.
   Ia menjaga `index.html` tetap bebas `on*=` (CSP `script-src` tanpa `'unsafe-inline'`
   akan menolak menjalankannya — fitur hilang tanpa error), dan memastikan **ketujuh**
   atribut aksi deklaratif punya entri di registry `__uiActionsCache` (`app.src.js`):
   `data-action` (119 atribut) plus enam atribut yang dilayani dispatcher
   `UI_EVENT_ATTR` — `data-on-change` (29), `data-on-input` (21), `data-on-submit` (7),
   `data-on-keydown` (6), `data-on-focus` (2), `data-on-blur` (2). Daftar enam itu
   **dibaca dari `UI_EVENT_ATTR` di sumbernya**, jadi menambah event kedelapan otomatis
   ikut terjaga. Aksi yang dihasilkan runtime lewat `uiActionAttrs()` diperiksa juga.
   Tanpa entri registry, handler-nya mati **tanpa error apa pun** — persis bahaya yang
   ditulis di komentar `app.src.js:1470-1474`. (Versi v122 guard ini hanya memeriksa
   `data-action`; 67 atribut `data-on-*` lolos tanpa pengawasan. Diperluas di v123.)
   Test terakhirnya meta: ia menghitung `test(` di dirinya sendiri dan menagih angka
   "(16 test)" di awal butir ini — menambah guard baru berarti menaikkan angka itu juga.
   Kalau test-test itu merah, dokumennya (atau markup-nya) yang basi — bukan test-nya
   yang rewel. Kalau sebuah kalimat ditulis ulang sampai pola jangkarnya hilang, test
   juga merah: perbarui jangkarnya di test itu bersama kalimatnya.

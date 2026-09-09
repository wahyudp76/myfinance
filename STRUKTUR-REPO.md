# MyFinance — Peta Lengkap Struktur Repo

> Repo: `wahyudp76/myfinance` · branch `main` · ~385 commit · versi terbaru `v113`
> Sekali lihat: **SPA statis (no build step untuk produksi) + Supabase backend + Edge Functions**.
> Browser tidak butuh bundler — `index.html` memuat modul ES `src/**` langsung, lalu `app.js` (output build) untuk logika monolit.

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

### Tiga sumber kode → tiga keluaran build

| Sumber (kamu edit)        | Build command                | Hasil (dijalankan browser)        |
|---------------------------|------------------------------|-----------------------------------|
| `app.src.js`              | `npm run build:app` (terser) | `app.js` (-49,7% ukuran)          |
| `styles.src.css`          | `npm run build:styles`      | `styles.css` (clean-css)          |
| `css/tailwind.src.css`    | `npm run build:css`         | `css/tailwind.css` (minified)     |

> **Aturan emas:** edit `app.src.js` / `styles.src.css` / `css/tailwind.src.css`,
> **JANGAN** edit `app.js` / `styles.css` / `css/tailwind.css` — itu output build.

---

## 2. Struktur Folder (tree)

```
myfinance/
├── index.html              # Markup + konfigurasi Supabase + modul ES + jembatan bootstrap
├── app.src.js              # SUMBER logika "monolit" (editor di sini)
├── app.js                  # OUTPUT build terser dari app.src.js (~223KB) — jangan diedit
├── boot.js                 # Blok <script type="module"> wiring (diekstrak dari index.html, v98)
├── styles.src.css          # SUMBER gaya visual kustom
├── styles.css              # OUTPUT build (clean-css)
├── sw.js                   # Service Worker (offline, precache, CACHE_VERSION=v144)
├── manifest.json           # Web App Manifest (PWA / Add to Home Screen)
├── _headers                # Header keamanan (Netlify/Cloudflare Pages): CSP, X-Frame-Options, dll
├── robots.txt              # Larang crawler (app privat)
├── tailwind.config.js      # Konfigurasi Tailwind (content scanning)
├── eslint.config.js        # ESLint 9 flat-config (kebenaran, bukan gaya)
├── .gitleaks.toml          # Guard agar secret tidak ter-commit
├── .nvmrc                  # Jalur Node 22 LTS; engines minimal >=22.19.0
├── package.json            # Script lint/test/build + devDependencies; Node >=22.19.0
│
├── src/                        # ★ Modul JS produksi (ES module) — di-import oleh index.html
│   ├── auth/                   # Autentikasi Supabase
│   │   ├── client.js           # initAuthClient / getAuthClient
│   │   ├── session.js          # getSession, signIn, signUp, signOut
│   │   ├── guards.js           # onAuthStateChange, requireUser
│   │   ├── lifecycle.js        # createAuthLifecycle (auth state machine)
│   │   └── index.js            # Barrel re-export
│   ├── bootstrap/              # Boot & load pipeline
│   │   ├── app.js              # createAppBootstrap (orchestrates start/stop, generation guard)
│   │   └── loader.js           # createBootstrapLoader (de-dup in-flight load + generation counter)
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
│   │       └── edge.js          # suggestCategory, getExchangeRate, scanReceipt
│   └── ui/                      # ★ Render/DRY pengganti fungsi render duplikat
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
│   │                       #   replace_month_budgets, check_and_consume_rate_limit) + RLS
│   │                       #   bentuk initplan + seed katalog logo platform.
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
├── supabase/functions/     # Edge Functions (Deno)
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
├── scripts/                # Perkakas dev
│   ├── build-app.mjs       # terser app.src.js → app.js
│   ├── build-styles.mjs    # clean-css styles.src.css → styles.css
│   ├── subset-fontawesome.py
│   ├── bench-save-latency.mjs
│   ├── verify-hud.mjs      # E2E Playwright (70 cek) — dijalankan CI: .github/workflows/e2e-harness.yml
│   ├── verify-asset-logos.mjs # E2E Playwright logo platform aset (v86, 17 cek) — juga di e2e-harness.yml
│   ├── lighthouse/run.mjs      # pagar performa + deteksi executable Chromium yang eksplisit
│   │   └── chrome-path.mjs     # validasi CHROME_PATH / Playwright tanpa path hardcode
│   ├── schema-verify/      # v95/v96: uji sql/schema.sql di Postgres NYATA — run.mjs
│   │                       #   (install dari nol + idempotensi + 10 cek RLS/RPC/grant).
│   │                       #   Jalan otomatis di CI: job "Schema install check (Postgres)"
│   └── rls-audit/          # probe audit RLS + grants behavioral (4 skrip + README)
│
├── tests/                  # ★ Test (tanpa koneksi jaringan untuk unit)
│   ├── unit/               # 50+ file uji murni (node --test) — :test:unit
│   │   ├── sw-cache.snapshot        # snapshot hash aset SW
│   │   └── helpers/mock-supabase-client.js
│   └── parity/             # banding legacy vs native (sebagian butuh secret live)
│
├── docs/                   # Rencana migrasi, audit, kontrak
│   ├── SESSION-HANDOFF.md / AGENT-HANDOFF.md  (root) — catatan antar-agen per versi
│   ├── architecture-modernization-plan.md
│   ├── supabase-native-migration-plan.md
│   ├── current-data-flow-map.md
│   ├── production-loader-contract.md
│   ├── schema-contract-audit.md
│   ├── financial-invariants.md
│   ├── db-migration-status-2026-09-01.md
│   ├── rls-grants-audit-2026-08-31.md
│   ├── audit-bug-analysis-2026-09-02.md
│   ├── AUDIT_REPORT_2026-08.md
│   └── PILOT-MIGRASI-v71.md  (v91: dipindah dari root — dokumen historis pilot migrasi monolit→modul)
│
└── .github/
    └── workflows/
        ├── parity.yml            # CI: lint + unit + parity + build drift guard (CSS + app)
        │                         #     + schema-install (Postgres, v96)
        └── dependabot-auto-merge.yml
```

---

## 3. Alur Muat (Loader / Bootstrap)

1. **`index.html`** berisi konfigurasi Supabase (URL + anon key) di komentar "KONEKSI SUPABASE".
2. **`boot.js`** (`<script type="module" src>`) meng-import ratusan fungsi dari `src/**`
   (auth → services/domain/ui) dan memaparkannya lewat `__myfinanceServices`. Module
   dieksekusi *deferred* (setelah seluruh dokumen). Sampai v97 blok ini INLINE di
   `index.html`; v98 memindahkannya byte-exact ke berkas terpisah karena SW memakai
   network-first untuk dokumen (jadi 17 KB itu diunduh ulang tiap kunjungan online)
   tapi stale-while-revalidate untuk aset — dokumen turun 33,8 → 29,8 KB gzip.
3. Blok `<script>` **classic** di body (logika monolit dari `app.js`) dipakai karena ada
   **200+ atribut `onclick=`** di markup — itu kontrak fungsi global yang wajib dipertahankan
   namanya oleh terser (`mangle.toplevel=false`, `keep_fnames=true`).
4. **Bootstrap** (`src/bootstrap/app.js`) mengorkestrasi: init auth → load data → init UI →
   tampilkan app, dengan *generation counter* agar penanganan login/logout cepat tidak saling
   menimpa. `loader.js` men-de-dup panggilan load yang sedang berjalan.
5. **`sw.js`** (service worker) meng-pre-cache app shell + aset, dan men-cache data GET
   `/rest/v1` di cache DATA terpisah (sengaja tidak ikut `CACHE_VERSION`). Ganti
   `CACHE_VERSION` lalu jalankan `node tests/unit/update-sw-cache-snapshot.mjs` SETELAH build.

---

## 4. Alur Data

```
UI (index.html / src/ui/**, onclick= di markup)
   │
   ├── domain/**: logika murni (hitung, filter, agregasi) — tidak tahu Supabase
   │
   ├── services/**: kontrak data
   │     └── services/supabase/*: adapter per entity (createClient dari vendor/)
   │           └── supabase-js 2.113.0 (vendored) ──► Supabase REST/Realtime
   │
   └── services/supabase/edge.js ──► Edge Functions (supabase/functions/*, Deno)
           ├── analyze-finance      ──► Gemini AI
           ├── refresh-asset-price  ──► Bibit / CoinGecko / Yahoo
           ├── scan-receipt         ──► Gemini vision
           ├── get-exchange-rate
           └── whatsapp-webhook
```

**Aset & sumber harga:** kategori aset otomatis memilih sumber — Kripto→`coingecko`,
Saham→`yahoo_id_stock`, Reksadana→`reksadana_bibit` (via `ASSET_AUTO_UPDATE_CONFIG`).
Nilai baru = `round(harga_per_unit × jumlah_unit)`, riwayat di `value_history`
(dedupe per hari). `price-sources.js`: `yahooChartUrls` (2 mirror), `pickYahooMarketPrice`;
**Stooq mati — jangan dipakai.**

---

## 5. Keamanan & Kualitas

- **RLS** aktif di semua tabel; tiap user hanya lihat/ubah datanya sendiri. Migrasi
  `*_rls_hardening*`, `event_trigger_ensure_rls`, `pre_migration_checks` menjaga ini.
- **CSP** di `_headers` dan meta `index.html` harus **selalu sinkron**; `'unsafe-eval'`
  dan `style-src 'unsafe-inline'` sudah dibuang. Atribut style dikunci dengan
  `style-src-attr 'none'`; satu hash SHA-256 untuk `<style>` kosong FullCalendar
  mengizinkan CSSOM `insertRule()` tanpa membuka inline style umum. Domain yang diizinkan
  kini hanya Supabase (project `uxfngmxghupdlwoeoxgh`).
- **Hardening input tak tepercaya** (v60): sanitasi CSV formula injection, escape nama akun,
  validasi override ikon/gaya, fallback ikon netral.
- `.gitleaks.toml` mencegah secret ter-commit. Tidak ada service-role key di kode browser.
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
  ```
- Build drift dijaga CI: `build:css` + `build:app` lalu `git diff --exit-code`.
- Instalasi baru dijaga CI: job `Schema install check (Postgres)` menjalankan
  `sql/schema.sql` di container Postgres kosong tiap push/PR (v96) — hermetic,
  tanpa secrets. Ini pagar untuk kelas bug v95 ("schema.sql kelihatan lengkap
  tapi di database kosong menghasilkan 0 function").
- Harness E2E juga berjalan otomatis di CI via workflow `E2E Harness`
  (`.github/workflows/e2e-harness.yml`): push/PR ke main, jadwal mingguan, dan
  manual — hermetic (stub Supabase, tanpa secrets). Selain dua harness di atas
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

- **PWA**: `manifest.json` + ikon → "Add to Home Screen"; splash `#151928`.
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
2. Render UI baru → `src/ui/` (re-export ke `index.html` dengan alias `...UI`).
3. Akses data baru → `src/services/supabase/` + objek DB baru di `sql/schema.sql`
   (idempotent). Kalau menambah RPC: definisinya WAJIB ada di `schema.sql`, kalau tidak
   `tests/unit/sql-schema-completeness.test.js` akan merah — itu pagar supaya instalasi
   baru tidak pernah lagi "hidup tapi rusak".
4. Ubah monolit → **edit `app.src.js`** → `npm run build:app`.
5. Ubah styling → **edit `styles.src.css`** → `npm run build:styles`; ubah class Tailwind →
   `css/tailwind.src.css` → `npm run build:css`.
6. Setelah aset berubah → bump `CACHE_VERSION` di `sw.js` + regen snapshot.
7. Kalau menambah CDN/domain → tambahan di CSP `_headers` **dan** meta `index.html`.
8. **Angka di dokumen dijaga mesin (v97)**: `tests/unit/docs-consistency.test.js`
   mencocokkan `CACHE_VERSION`, versi terbaru di header berkas ini vs entri terakhir
   `AGENT-HANDOFF.md`, jumlah file `src/domain/`, jumlah tabel/RPC di `sql/schema.sql`,
   jumlah cek tiap harness E2E, dan versi bundel `vendor/supabase-js-*` vs `package.json`.
   Kalau test itu merah, dokumennya yang basi — bukan test-nya yang rewel. Kalau sebuah
   kalimat ditulis ulang sampai pola jangkarnya hilang, test juga merah: perbarui
   jangkarnya di test itu bersama kalimatnya.

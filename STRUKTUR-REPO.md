# MyFinance — Peta Lengkap Struktur Repo

> Repo: `wahyudp76/myfinance` · branch `main` · ~318 commit · versi terbaru `v70`
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
├── styles.src.css          # SUMBER gaya visual kustom
├── styles.css              # OUTPUT build (clean-css)
├── sw.js                   # Service Worker (offline, precache, CACHE_VERSION=v70)
├── manifest.json           # Web App Manifest (PWA / Add to Home Screen)
├── _headers                # Header keamanan (Netlify/Cloudflare Pages): CSP, X-Frame-Options, dll
├── robots.txt              # Larang crawler (app privat)
├── tailwind.config.js      # Konfigurasi Tailwind (content scanning)
├── eslint.config.js        # ESLint 9 flat-config (kebenaran, bukan gaya)
├── .gitleaks.toml          # Guard agar secret tidak ter-commit
├── .nvmrc                  # Versi Node (>=22 <23)
├── package.json            # Script lint/test/build + devDependencies
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
│   ├── domain/                 # ★ Logika murni (pure functions) — 34 file, teruji unit
│   │   ├── transactions.js     # filter/cari, compute views, insertTransactionRow, dll
│   │   ├── accounts.js         # total/grafik/agregasi akun
│   │   ├── budgets.js          # realisasi vs anggaran, deteksi ambang
│   │   ├── assets.js           # portofolio + net worth
│   │   ├── asset-flows.js      # arus aset, self-heal akun bayangan
│   │   ├── recurring.js        # transaksi berulang + catchup
│   │   ├── goals-debts.js      # progress goal & utang
│   │   ├── reports.js          # ringkasan tahunan/bulanan/trend
│   │   ├── calendar.js         # ringkasan kalender, proyeksi jatuh tempo
│   │   ├── categories.js       # kategorisasi & proporsi sub-kategori
│   │   ├── dashboard.js        # agregasi data dashboard
│   │   ├── insights.js         # wawasan keuangan (hitung di browser, gratis)
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
│       ├── charts.js / goals-debts.js / insights.js / recurring.js
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
│   └── banks/              # logo bank & e-wallet self-hosted
│       ├── bca.svg / mandiri.svg / bri.svg / bni.png / bsi.svg
│       └── jago.svg / gopay.svg / ovo.svg / dana.svg / shopeepay.svg
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
│   ├── schema.sql          # SEMUA tabel inti + RLS (transactions, budgets, assets, settings, custom_icons, recurring_transactions, api_rate_limits)
│   ├── 2026-08-supabase-native-foundation.sql
│   ├── migration_asset_price_columns_2026-08.sql
│   ├── migration_assets_tanggal_nav_2026-09.sql
│   ├── migration_composite_indexes_2026-09-02.sql
│   ├── migration_f1_rls_auto_enable_2026-08-31.sql
│   ├── migration_rate_limiting_2026-08.sql
│   ├── migration_reliability_hardening_2026-08.sql
│   ├── migration_rls_hardening_2026-08-31.sql
│   ├── migration_transfer_currency_2026-08.sql
│   ├── migration_whatsapp.sql
│   ├── pre_migration_checks_2026-08.sql
│   ├── rls_performance_fix.sql
│   └── event_trigger_ensure_rls.sql
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
│   ├── verify-hud.mjs      # E2E Playwright (49 cek) terhadap http://localhost:8123
│   ├── lighthouse/run.mjs
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
│   └── AUDIT_REPORT_2026-08.md
│
└── .github/
    └── workflows/
        ├── parity.yml            # CI: lint + unit + parity + build drift guard (CSS + app)
        └── dependabot-auto-merge.yml
```

---

## 3. Alur Muat (Loader / Bootstrap)

1. **`index.html`** berisi konfigurasi Supabase (URL + anon key) di komentar "KONEKSI SUPABASE".
2. Ada `<script type="module">` besar yang meng-import ratusan fungsi dari `src/**`
   (auth → services/domain/ui). Module dieksekusi *deferred* (setelah seluruh dokumen).
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
  sudah dibuang (kode tidak pakai `eval`/`new Function`). Domain yang diizinkan kini hanya
  Supabase (project `uxfngmxghupdlwoeoxgh`).
- **Hardening input tak tepercaya** (v60): sanitasi CSV formula injection, escape nama akun,
  validasi override ikon/gaya, fallback ikon netral.
- `.gitleaks.toml` mencegah secret ter-commit. Tidak ada service-role key di kode browser.
- **Verifikasi wajib** sebelum merge:
  ```bash
  npm run lint          # ESLint (0 masalah)
  npm test              # lint + unit + parity
  node scripts/verify-hud.mjs   # 49 cek E2E (butuh: npx http-server . -p 8123 -c-1)
  ```
- Build drift dijaga CI: `build:css` + `build:app` lalu `git diff --exit-code`.

---

## 6. Fitur Terkait Struktur (rangkum)

- **PWA**: `manifest.json` + ikon → "Add to Home Screen"; splash `#151928`.
- **Offline**: `sw.js` precache + banner offline.
- **Back Tap / Quick Add** iPhone: URL `?quickadd=1` membuka modal Catat Transaksi.
- **Pull-to-refresh**, tombol kembali ke atas, dark/light/system theme, command palette
  (Ctrl/Cmd+K), wawasan keuangan on-device, rekomendasi AI via Gemini, ekspor CSV
  (salah satunya dari menu Transaksi), profil + foto, maskot login SVG orisinal.
- **Tabel Supabase (7)**: `transactions`, `budgets`, `assets`, `settings`,
  `custom_icons`, `recurring_transactions`, `api_rate_limits`.

---

### Catatan praktis untuk mulai berkontribusi
1. Fitur logika baru → tulis pure function di `src/domain/` + test di `tests/unit/`.
2. Render UI baru → `src/ui/` (re-export ke `index.html` dengan alias `...UI`).
3. Akses data baru → `src/services/supabase/` + migrasi `sql/` (idempotent).
4. Ubah monolit → **edit `app.src.js`** → `npm run build:app`.
5. Ubah styling → **edit `styles.src.css`** → `npm run build:styles`; ubah class Tailwind →
   `css/tailwind.src.css` → `npm run build:css`.
6. Setelah aset berubah → bump `CACHE_VERSION` di `sw.js` + regen snapshot.
7. Kalau menambah CDN/domain → tambahan di CSP `_headers` **dan** meta `index.html`.

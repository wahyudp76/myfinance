# SESSION HANDOFF — MyFinance (2026-08-31)

> Dokumen ini ditulis untuk **sesi chat baru** yang mulai dari nol tanpa memori
> percakapan sebelumnya. Baca file ini + `docs/` lain SEBELUM menyentuh kode.
> Segala hal penting sudah dibekukan di repo — sesi lama tidak diperlukan lagi.

## Status saat handoff

- HEAD: lihat `git log` (commit HUD cyberpunk menyusul setelah `d349895`; main ter-push, CI ✓, Pages ✓). Live: <https://wahyudp76.github.io/myfinance/>
- Service worker live: `myfinance-v32` (sinkron lokal). Suite: **456 unit + 1 smoke, semua hijau**.
- Semua tier improvement selesai (Tier 1–3), seluruh temuan audit (F1–F4) CLOSED.
- Worktree bersih; tidak ada pekerjaan menggantung.

## Cara memulai di sesi baru (untuk agen)

1. Workspace sesi baru kosong → `git clone https://github.com/wahyudp76/myfinance.git`
   (repo butuh PAT — **MINTA PAT BARU dari user**, lihat §Keamanan).
2. `npm ci` (+ `npx playwright install --with-deps chromium` bila akan verify browser).
3. Baca: file ini, `docs/AUDIT_REPORT_2026-08.md`, `docs/rls-grants-audit-2026-08-31.md`,
   `docs/architecture-modernization-plan.md`, `docs/supabase-native-migration-plan.md`.
4. Konfirmasi baseline: `npm test` harus 433+1 hijau.

## Fakta proyek (oken singkat)

- **Apa**: PWA keuangan pribadi (login wajib). Situs statis + Supabase (Auth, Postgres+RLS, Edge Functions).
- **Hosting**: GitHub Pages (deploy otomatis oleh CI). File `_headers` diabaikan GitHub Pages —
  keamanan aktif via `<meta>` CSP di `index.html`; `_headers` siap utk Netlify/Cloudflare Pages.
  **Dua salinan CSP itu WAJIB tetap sinkron** (domain: self, cdn.jsdelivr.net, **esm.sh**, supabase).
- **Bentuk kode**: `index.html` masih monolith besar (controller + markup; ekstraksi bertahap ke modul),
  `styles.css` (termasuk sistem override `.dark` kelas-per-kelas), `css/tailwind.css` (build statis),
  `sw.js` (navigate network-first; statis cache; GET `/rest/v1` network-first + fallback per-token;
  logout membuang cache data), `src/domain/*` (murni, selalu dgn unit test; termasuk `sparkline.js` (gelombang neon HUD) &
  `chart-hud.js` (DNA HUD semua chart: garis ala balanceTrend, batang gradasi
  neon + casing, segmen donut komet + glow violet, sumbu teknis), `src/ui/*` (render),
  `src/services/supabase/*` (adapter; supabase-js dimuat dari **esm.sh**), `scripts/` (lighthouse, rls-audit,
  `verify-hud.mjs` = verify browser nyata via stub Supabase di Playwright, TANPA service key),
  `sql/` (migrasi & referensi), `tests/unit/` (node:test).
- **Tema**: "Cyberpunk HUD" (v27 desktop, v28 paritas mobile/Android; default gelap utk semua pengguna; hanya `pref='light'` eksplisit
  yang keluar). Lapisan CSS di AKHIR `styles.css` ("CYBERPUNK HUD LAYER"): grid blueprint, panel kaca
  chamfer + bracket sudut, LED `LIVE/SYNCING/OFFLINE` (`setHudStatus()`), angka monospace glow,
  radar donat (`.hud-radar*`), bar nominal log transaksi; lapisan "MOBILE HUD PARITY" (drawer/
  bottom-sheet kaca neon, FAB chamfered, `color-scheme: dark` utk kontrol native). Kontrak visual lama tetap: tooltip #000,
  palet colorblind, Ctrl+K.
- **Supabase**: project `uxfngmxghupdlwoeoxgh`; 10 tabel, RLS semua aktif; **event trigger `ensure_rls`
  otomatis meng-ENABLE RLS tabel baru** (JANGAN di-drop — lihat `sql/event_trigger_ensure_rls.sql`);
  5 Edge Functions terpakai; anon key ada di `index.html` (public by design); service key TIDAK ada di repo.

## Ritual WAJIB (perintis sesi lama — jangan dilanggar)

1. **Verify browser nyata + suite penuh SEBELUM commit** (Playwright + `python3 -m http.server`,
   tanpa memblokir jaringan bila menguji hal yang menyentuh CDN). Bug nyata berkali-kali
   tertangkap di tahap ini, bukan di unit test.
2. Ubah aset → **bump `CACHE_VERSION` di `sw.js`** + `node tests/unit/update-sw-cache-snapshot.mjs`
   (ada guard test yang FAIL otomatis kalau lupa). Ubah kelas Tailwind → `npm run build:css`
   **sebelum** snapshot (urutan terbalik = drift hash).
3. Push pakai ritual PAT: `git remote set-url` (PAT) → push → **reset URL kembali**. Poll CI dengan
   **full SHA**. Jangan pernah commit PAT.
4. Edit anchor di `index.html` harus byte-presis; di heredoc shell, hindari backtick.
5. DDL Supabase TIDAK bisa via REST — buat file `sql/…`, user yang menjalankan manual di SQL Editor.

## Jebakan yang sudah terbukti (jangan diulang)

- `window.X = …` TIDAK mengubah binding `let X` di script (declarative environment menaungi) —
  seed data dari `page.evaluate` pakai assignment telanjang (`globalData = …`), bukan `window.globalData`.
- Tooltip eksternal Chart.js: wajib `external` + `animation:false` TANPA `enabled:false`;
  event sintetis tidak diterima → gunakan `page.mouse` sungguhan; `el.y` bar = tepi ATAS
  (pusat = `el.y + el.height/2`).
- Kustomisasi `Chart.defaults` hanya boleh lewat `applyChartStyleDefaults()` yang dipanggil loader
  `__mfChartLibReady` (Chart.js lazy — kode yang jalan sebelum lib termuat tidak melihat `Chart`).
- Runner Lighthouse: entry `node_modules/lighthouse/cli/index.js`; Chrome HANYA via env `CHROME_PATH`.
- Filter request verify: pakai `cdn.jsdelivr.net/npm/chart` (bukan sekadar 'chart' — ada `src/domain/chart-labels.js`).
- Sandbox ter-wipe → `npm ci` + `npx playwright install --with-deps chromium` sebelum Playwright.

## Kontrak tetap (jangan dilanggar diam-diam)

- Semua tooltip chart **hitam murni `#000`**; tooltip proporsi sub-kategori = kartu eksternal
  non-overlap di bawah donat.
- Data contoh: prefix keterangan `[Demo] `, tak pernah tanggal masa depan, tombol hapus massal di Pengaturan.
- Palet grafik: `default` | `colorblind` (Okabe-Ito) — pilihan user di Pengaturan (`appSettings.chartPalette`).
- 7 view utama; command palette Ctrl/Cmd+K (`src/domain/command-palette.js`).
- `noindex` by design (aplikasi pribadi) — SEO dicoret di ambang Lighthouse.

## Keamanan (BACA DULU)

- PAT GitHub + service key Supabase pernah terekspos di chat sesi lama → user diminta **rotasi**
  sebelum menutup sesi itu. **Jangan pakai token lama jika diberikan; minta yang baru.**
- Service key Supabase hanya untuk audit/operasi khusus (lihat `scripts/rls-audit/`), tidak pernah
  masuk kode/komit.

## Item terbuka (opsional, tidak memblokir apa pun)

- Keputusan hosting: tetap GitHub Pages vs pindah ke Netlify/Cloudflare Pages (`_headers` siap).
- Lanjutan ekstraksi monolith `index.html` (pola slice yang terbukti aman: lihat riwayat commit).

## Riwayat singkat (urut waktu, sebagian)

`4470191` tooltip #000 → `4587467` Lighthouse CI → `00268bb` onboarding → `8ac3e9d` palette Ctrl+K →
`e7598ed` data offline SW → `b220022` palet colorblind → `d2d33c9` dark menyeluruh + tooltip konsisten →
`c7f849c` meta CSP + esm.sh fix → `583b2bc` penutupan F1 (event trigger auto-RLS) →
`336d236` tema Neon Cyber → `a06579e` UI Cyberpunk HUD v27 (grid blueprint, panel kaca chamfer, radar
donat, sparkline neon, LED status, log terminal; suite 444+1; verify-hud.mjs 11 cek hijau).

Audit lengkap: `docs/AUDIT_REPORT_2026-08.md` + `docs/rls-grants-audit-2026-08-31.md`.

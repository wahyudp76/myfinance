# AGENT HANDOFF — MyFinance (Ai-Agen)

> Catatan antar-agen. Diisi ulang 2026-09-01 setelah file lama hilang akibat reset
> lingkungan kerja (riwayat v38–v40 dirangkum dari docs/SESSION-HANDOFF.md & log sesi).
> Status: semua fitur di bawah SUDAH teruji unit + E2E browser + (untuk Edge Function) live di produksi.

## Peta cepat
- App: SPA statis `index.html` + `src/**` (domain services, modul ES) + Tailwind build (`npm run build:css`) + service worker `sw.js` (bump `CACHE_VERSION` + jalankan `node tests/unit/update-sw-cache-snapshot.mjs` SETELAH build:css setiap kali aset berubah).
- Verifikasi wajib: `npm test` (suite unit) + `node scripts/verify-hud.mjs` (47 cek E2E Playwright terhadap `http://localhost:8123`, server via `npx http-server . -p 8123 -c-1`).
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
- Rate limit Edge: 30 request/jam/user (tabel `refresh_price_rate_limits`, RLS).

## Gotcha lingkungan
- Sandbox sering ter-reset tengah sesi: `.git` bisa kembali ke parent lama + file tracked ter-restore + `~/tools`/chromium hilang. Ritual: cek `git log --oneline -1` vs `origin/main`; `git fetch` + `git reset --mixed origin/main` (worktree aman); reinstall node22 (`~/tools/node-v22.23.2-linux-x64`) + `npm ci` + `npx playwright install chromium`; server 8123 via start_process.
- Test akun Supabase: signup butuh toggle `mailer_autoconfirm` (balikkan + verifikasi!) — hapus user hanya bisa via dashboard/Mgmt UI.
- Jangan commit kredensial; remote disimpan plain URL, PAT hanya via set-url sesaat.

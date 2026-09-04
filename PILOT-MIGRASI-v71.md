# Pilot Migrasi Monolit → Modul — Laporan Lengkap (v71→v81)

> Lokasi: sandbox lokal → **sudah di-push ke `main`** (v75 = `7e22e9c`, v76 = `3541cda`, v77 = `833f33f`, v78 = `edd3d77`, v79 = `0ab996a`, v80 = `22c4e76`, v81 = commit berikutnya).
> Ini hasil **3 langkah inkremental** yang diminta: ① adopsi swap call-site,
> ② konsolidasi/penghapusan definisi global, ③ ukur gain dengan Lighthouse.
> **Lanjutan:** pola yang sama diperluas ke helper **tanggal** (dates), **gaya/parent
> kategori** (category-style), **`transferTargetAmount`**, swap 4 call-site DI
> `categorizeParent`/`categorizeExpenseParent`, **escape string (escapeHtml/jsStr)**,
> **escaping field CSV (`csvField`→`csvEscape`, sekaligus menutup celah injection)**,
> **`slugify` + `detectAssetCategoryIcon`** (slugify.js, asset-icons.js),
> **`currentMonthStr` → keluarga `dates`** (dates.js), dan terakhir
> **`bankWalletDatabase` + `detectAutoAccountIcon` → keluarga `bank-icons`** (bank-icons.js).
> Semua tanpa menyentuh produksi; hanya dimuat & diuji di sandbox + browser headless.

---

## Ringkasan hasil (3 langkah + perluasan)

| Langkah | Status | Bukti |
|---|---|---|
| ① Adopsi — modul jadi sumber kebenaran | ✅ | **format**, **dates**, **category-style** semuanya di-adopt (`__fmt`, `__dates`, `__catstyle`) saat `servicesModule` siap. |
| ② Konsolidasi — global jadi delegasi tipis | ✅ | `formatRp/formatShortVal/txIdrAmount/deepCloneDict/transferTargetAmount`, `parseTgl/toDateStr/todayDateStr`, `resolveBaseCategoryStyle`, `categorizeParent/categorizeExpenseParent` kini delegasi ke modul ter-tes. Nama global dipertahankan (kontrak 200+ `onclick=` & harness E2E). |
| ③ Ukur dengan Lighthouse | ✅ | **perf 55–60 · a11y 100 · BP 100 · CLS 0** (semua ≥ ambang). Tidak ada regresi performa. |

### v75 & v76 (lanjutan pola, setelah di-push)

- **v75 — `transferTargetAmount` → modul `format.js`** (commit `7e22e9c`, di-push ke `main`).
  Helper ini sudah ada di `format.js` (teruji); diselesaikan dengan menambahkannya ke adaptor
  `__fmt` + delegator global (pola yang sama), sehingga hanya ada satu sumber kebenaran.
  SW bump `myfinance-v75`.
- **v76 — swap 4 call-site DI `categorizeParent`/`categorizeExpenseParent`** (commit `3541cda`).
  Empat call-site di `app.src.js` sebelumnya menulis arrow `(kategori, jenis) =>
  getCategoryStyle(...).parentName` — memanggil `getCategoryStyle` (stateful, baca
  `appSettings.categoryStyles`) hanya untuk membaca `.parentName`, padahal override gaya
  TIDAK pernah menyentuh `parentName` (hanya icon/bg/color/image). Tidak berlaku salah; namun
  redundan & tak-ter-uji. Diganti delegator murni `categorizeParent`/`categorizeExpenseParent`
  yang memanggil `__catstyle.categorizeParentFromLookup` (sudah ada di modul `category-style.js`,
  ter-uji). Konsumen DI: `reports.js` (`computeMonthlyBreakdown`/`computeCategoryTrend`),
  `insights.js`, `dashboard.js`. SW bump `myfinance-v76`.
- **v77 — helper escape string murni `escapeHtml`/`jsStr` → modul `sanitize.js`** (commit `833f33f`).
  Dua escaper ini dulu hanya hidup di monolit (tanpa rumah & unit test) padahal dipakai
  **~50× (escapeHtml) & ~20× (jsStr)** di seluruh render, termasuk pelolosan nilai user —
  lapisan anti-XSS/anti penyisipan sintaks. Di-pindah ke `src/domain/sanitize.js` (murni,
  total) + `sanitizeCtx()`, lalu monolit mengadopsinya via `__sanitize` (default = impl. asli)
  dan `escapeHtml`/`jsStr` global menjadi delegator tipis (kontrak dipertahankan).
  Guard konsistensi (modul == default monolit) + WIRING dijamin `tests/unit/sanitize-domain.test.js`.
  SW bump `myfinance-v77`.
- **v78 — konsolidasi escaping field CSV `csvField` → modul `csvEscape`** (commit `edd3d77`, di-push ke `main`).
  Monolit punya `csvField()` sendiri yang HANYA quote RFC-4180 (tanpa netralisasi formula),
  dipakai di `exportTransactionsCsv` & `exportAssetsCsv`; padahal `src/domain/export-csv.js`
  sudah punya `csvEscape()` ter-uji yang = csvField + guard **spreadsheet/formula injection**
  (sel `=`/`+`/`-`/`@`/TAB/CR dinetralisir kecuali angka polos). Ada duplikasi logika DAN
  inkonsistensi keamanan (jalur Pengaturan sudah memakai modul ber-guard, dua jalur lain
  versi lemah). Kini monolit mengadopsi modul via `__csv` + delegator `csvField`→`__csv.csvEscape`,
  sehingga semua jalur ekspor (transaksi & aset) memakai escaper ber-guard yang sama.
  Guard konsistensi + WIRING dijamin `tests/unit/csv-escape-domain.test.js`. SW bump `myfinance-v78`.
- **v79 — `slugify` → `slugify.js` dan `detectAssetCategoryIcon` → `asset-icons.js`** (commit `0ab996a`, di-push ke `main`).
  Dua helper murni/deterministik yang di-inject sebagai DI ke `src/ui/budgets.js` (`slugify`)
  dan `src/ui/assets.js` (`detectAssetCategoryIcon`) — dua modul UI yang **sudah ter-tes** dengan
  mock, sehingga helper tak-ber-rumah itu menjadi "makanan" bagi modul ter-tes. Kini keduanya
  punya rumah sendiri di `src/domain/` (`slugify.js`: `slugify`/`slugifyCtx`; `asset-icons.js`:
  `detectAssetCategoryIcon`/`assetIconCtx`), monolit mengadopsinya via `__slugify`/`__assetIcon`
  (default = impl. asli) dan global `slugify`/`detectAssetCategoryIcon` menjadi delegator tipis.
  Guard konsistensi (modul == default monolit) + WIRING dijamin `tests/unit/slugify-domain.test.js`
  & `tests/unit/asset-icons-domain.test.js`. SW bump `myfinance-v79`.
- **v80 — `currentMonthStr` → keluarga `dates` (dates.js)** (commit `22c4e76`, di-push ke `main`).
  `currentMonthStr()` (bulan berjalan `YYYY-MM`, dipakai di penyiapan cache budget & filter bulan)
  adalah helper **murni & state-free** yang sebelumnya hanya hidup di monolit tanpa rumah,
  padahal satu keluarga dengan `parseTgl`/`toDateStr`/`todayDateStr` yang SUDAH ada di
  `src/domain/dates.js`. Kini modul `dates.js` menambah `currentMonthStr()` ke `dateCtx()` +
  implementasi default `__dates` di monolit, dan global `currentMonthStr` menjadi delegator tipis.
  Guard konsistensi (modul == default monolit) + WIRING dijamin `tests/unit/dates-domain.test.js`.
  SW bump `myfinance-v80`.
- **v81 — `bankWalletDatabase` + `detectAutoAccountIcon` → keluarga `bank-icons` (bank-icons.js)** (commit berikutnya).
  `bankWalletDatabase` (daftar logo bank/e-wallet/platform investasi, SELF-HOSTED di `icons/banks/`
  atau badge huruf) & `detectAutoAccountIcon(name)` (deteksi ikon otomatis) sebelumnya hanya hidup
  di monolit tanpa unit test. `detectAutoAccountIcon` dipakai saat menampilkan ikon akun otomatis,
  dan `bankWalletDatabase` dipakai langsung oleh pencarian saran akun (`searchAccountModalSuggestions`)
  & saran platform aset (`searchAssetBankSuggestions`). Kini keduanya punya rumah kanonik di
  `src/domain/bank-icons.js` (`bankIconCtx()`), monolit mengadopsinya via `__bankIcon` (default =
  impl. asli) dan `detectAutoAccountIcon` global menjadi delegator tipis; `bankWalletDatabase` global
  menjadi mirror `__bankIcon.bankWalletDatabase` (disinkronkan saat adopsi) agar picker tetap pakai
  data yang sama. Guard konsistensi (modul == default monolit) + WIRING dijamin
  `tests/unit/bank-icons-domain.test.js`. SW bump `myfinance-v81`.

---

## Jawaban atas pertanyaan kunci

**Migrasi ini meningkatkan PERFORMANCE? Tidak (by design).** Bukti: Lighthouse tetap **60**
(ambang 55) — sama rentangnya dengan kalibrasi repo (login, mobile throttle). `app.js` memang
tumbuh dari 224.890 B → **226.066 B (+0,5%)** karena adaptor (`__fmt`/`__dates`/`__catstyle`).
Gain performa sesungguhnya sudah Anda raih di v59/v67 (self-host libs, lazy chart, no unsafe-eval).
**Jangan jual migrasi ini sebagai percepatan.**

**Migrasi ini meningkatkan STABILITY/Maintainability? Ya, nyata.** Sebelumnya helper `format*`,
`parseTgl/toDateStr/todayDateStr`, dan `resolveBaseCategoryStyle` hanya hidup di monolit **tanpa
rumah & tanpa unit test**, padahal di-inject sebagai DI ke fungsi `src/domain/**` yang **sudah
ter-tes**. Artinya modul ter-tes "diberi makan" helper tak-ber-test. Sekarang ada **satu sumber
kebenaran per keluarga** yang ter-tes, dan monolit pun mengadopsinya — **tanpa mengubah perilaku
satu bit** (dibuktikan guard konsistensi byte-compatible).

---

## Apa yang berubah (diff akhir)

```
 M app.src.js                 | +180 (3 adaptor + 3 adopt* + delegator + categorizeParent/ExpenseParent)
 M app.js                     |  +2   (build minified app.src.js, -51,1%)
 M index.html                 | +27   (import formatCtx/dateCtx/categoryStyleCtx + di servicesModule)
 M sw.js                      |  +2   (CACHE_VERSION v70 -> v76)
 M tests/unit/sw-cache.snapshot | regen (konvensi repo)
?? src/domain/format.js       |  baru (modul kanonik format/monetary, incl. transferTargetAmount)
?? src/domain/dates.js        |  baru (modul kanonik tanggal)
?? src/domain/category-style.js | baru (modul resolusi gaya/parent kategori, incl. categorizeParentFromLookup)
?? src/domain/sanitize.js       | baru (modul escape/pelolosan string murni: escapeHtml/jsStr)
?? src/domain/slugify.js        | baru (modul slug murni: slugify/slugifyCtx)
?? src/domain/asset-icons.js    | baru (modul ikon kategori aset: detectAssetCategoryIcon/assetIconCtx)
?? src/domain/bank-icons.js     | baru (modul bank/e-wallet: bankWalletDatabase + detectAutoAccountIcon/bankIconCtx)
?? tests/unit/format-domain.test.js    | baru (14 tes)
?? tests/unit/dates-domain.test.js     | (v80) +currentMonthStr (11 -> 14 tes, incl. guard konsistensi + WIRING)
?? tests/unit/category-style.test.js   | baru (14 tes, termasuk guard konsistensi + WIRING call-site)
?? tests/unit/sanitize-domain.test.js  | baru (9 tes, termasuk guard konsistensi + WIRING)
?? tests/unit/csv-escape-domain.test.js | baru (10 tes, termasuk guard konsistensi + WIRING)
?? tests/unit/slugify-domain.test.js     | baru (7 tes, termasuk guard konsistensi + WIRING)
?? tests/unit/asset-icons-domain.test.js | baru (7 tes, termasuk guard konsistensi + WIRING)
?? tests/unit/bank-icons-domain.test.js  | baru (11 tes, termasuk guard konsistensi data+logika + WIRING)
```

**Tidak menyentuh:** `styles.*`, `css/*`, `supabase/functions`, `sql/`, data. Tidak ada migrasi DB.

### Pola yang dipakai (konsisten untuk ketiga keluarga)

**① Adaptor** — default = implementasi asli (byte-compatible), lalu di-adopt dari modul:
```js
let __fmt = (function(){ /* default = implementasi asli */ })();
function adoptFormatModule(){
  if (servicesModule && typeof servicesModule.formatCtx === 'function'){
    try { __fmt = servicesModule.formatCtx(); } catch(e){ /* pakai default */ }
  }
}
```
(dipanggil di `initSupabaseClient()` segera setelah `servicesModule` siap).

**② Delegator** — mengganti isi, menjaga nama global (kontrak `onclick=`):
```js
function formatRp(angka){ return __fmt.formatRp(angka); }
function parseTgl(s){ return __dates.parseTgl(s); }
function resolveBaseCategoryStyle(catName, jenis){ return __catstyle.resolveBaseCategoryStyle({ categoryDict, subCategoryLookup, catName, jenis }); }
```

**③/① `index.html`** — import + tambah ke `window.__myfinanceServices` (jalur `services-ready`).

> **Catatan category-style:** karena `getCategoryStyle` & parent-name bergantung pada state
> monolit (`categoryDict`/`subCategoryLookup`/`appSettings`), modulnya murni **menerima lookups
> sebagai argumen** dan monolit men-delegasi dengan memasukkan state miliknya. Jadi logika
> keputusan (branching) kini ter-uji, sementara kepemilikan state tetap di monolit (perilaku identik).

---

## Bukti verifikasi (semua lolos)

| Check | Hasil |
|---|---|
| `node --test tests/unit/*.test.js` | **720 tests · 720 pass · 0 fail · 0 skip** |
| `npx eslint .` (seluruh repo) | **0 masalah** |
| `npm run build:app` (drift) | `app.js` **idempotent & identik** (`app.js` 227.881 B) |
| `node scripts/verify-hud.mjs` (E2E, :8123) | **64 PASS · 0 halaman error** |
| Runtime adopsi (headless) | `__fmt`, `__dates` (+`currentMonthStr`), `__catstyle`, `__sanitize`, `__slugify`, `__assetIcon`, `__csv`, `__bankIcon` **semuanya ter-adopsi ke modul**; `escapeHtml`/`jsStr`/`categorizeParent`/`slugify`/`detectAssetCategoryIcon`/`currentMonthStr`/`detectAutoAccountIcon` global ada & benar (0 pageerror) |
| Lighthouse | **perf 61 · a11y 100 · BP 100 · CLS 0** (PASS) |

**Bukti runtime paling kuat** (headless, 0 page error):
- `__fmtAdopted=true` (terbukti `__fmt.formatRibuanDigits` ada — hanya dimiliki modul),
  `window.formatRp(1234.5) === "1.234,5"`.
- `__datesAdopted=true` (`__dates.todayDateStr` ada), `window.toDateStr(new Date(2026,8,4)) === "2026-09-04"`.
- `__catstyleAdopted=true` (`__catstyle.resolveBaseCategoryStyle` ada), `window.resolveBaseCategoryStyle` tetap global.
- Ketiga keluarga global `formatRp/formatShortVal/txIdrAmount/deepCloneDict/parseTgl/toDateStr/todayDateStr/resolveBaseCategoryStyle`
  semua `typeof function` dan berfungsi benar.

---

## Kenapa definisi global TIDAK dihapus total (keputusan sadar & aman)
`formatRp`, `txIdrAmount`, `formatShortVal`, `deepCloneDict` dipakai **lintas seluruh fitur**
(bukan per-feature) DAN dirujuk oleh **200+ atribut `onclick=`/`onchange=`** di `index.html`
plus harness E2E sebagai global. Jadi:
- Menghapusnya = memutus kontrak global = berisiko besar pada app finansial.
- Solusi yang saya terapkan: **ganti isi → delegasi tipis ke modul.** Ini mencapai tujuan
  #2 ("satu sumber kebenaran, tanpa duplikasi logika") TANPA merusak kontrak. Nama dipertahankan,
  logika dihapus (single source = `format.js`).

Catatan kecil: keempat helper ini memang **cross-cutting**, jadi tidak bisa di-migrasi
"per-feature" — diselesaikan sebagai satu unit kecil yang teruji, bukan big-bang (sesuai
`docs/architecture-modernization-plan.md` Phase 4).

---

## Langkah berikut (kalau mau lanjut)
1. **Perluas pola yang sama** ke helper monolit lain yang DI-DI ke modul ter-tes namun masih
   belum diekstrak, mis. `formatInputRibuan` (DOM-bound). Kandidat terbaik berikutnya adalah
   yang **murni & sering dipakai**; ulangi: buat modul → tes konsistensi → adopt → delegasi → `verify-hud`.
2. **Pertimbangkan** memindahkan "bag" `servicesModule` ke modul terpusat agar `index.html`
   tidak terus melebar (juga memudahkan drафt pemborong 3 adaptor -> 1 objek).
3. **Ukur tiap kali** dengan Lighthouse (sudah ada `scripts/lighthouse/run.mjs`).

---

## Catatan keamanan token
Token yang Anda tempel sudah dipakai **sekali untuk push ke `main`** (atas izin Anda; dipakai
inline lewat URL, tidak disimpan). Karena sudah ada di riwayat percakapan & sudah dipakai,
**anggap terkompromi. Revoke di GitHub** → Settings → Developer settings → Fine-grained tokens,
lalu buat baru bila mau push lagi ke branch+PR nanti.

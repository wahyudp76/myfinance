# Audit & Analisis Bug — 2026-09-02 (v60)

Audit menyeluruh + perbaikan keamanan data pada aplikasi web MyFinance
(`index.html` + `src/**` + `app.src.js` → `app.js`). Semua perubahan di
commit ini **tidak mengubah perilaku untuk data sah**; guard hanya aktif
untuk input di luar bentuk normal.

## 1. Baseline sebelum audit (semua hijau)

| Gerbang | Hasil |
|---|---|
| `npm run lint` (ESLint 10) | 0 masalah |
| `npm run test:unit` | 565/565 pass |
| `scripts/verify-hud.mjs` (E2E Playwright, stub Supabase) | 64/64 PASS, 0 error halaman |
| `npm run build:app` + `npm run build:css` | tanpa drift (git clean) |
| Struktur | Sinkron dengan `origin/main` (HEAD `3fd26d4`) |

Kode sudah sangat terawat: escapeHtml dipakai konsisten di hampir semua
titik render, parse tanggal/angka sadar zona waktu WIB (`parseTgl`/
`toDateStr`), RLS + defense-in-depth `user_id` di service, dan ada banyak
guard CI (SW snapshot, drift CSS/app, subset ikon, vendor lokal). Audit ini
menemukan **3 celah kelas "input tak tepercaya → innerHTML"** yang lolos
dari pola umum karena jalur datanya tidak diperiksa ulang.

## 2. Temuan & perbaikan

### 2.1 [RENDAH] CSV formula injection pada Ekspor Transaksi
**Lokasi:** `src/domain/export-csv.js` — `csvEscape()`.

**Masalah:** sel CSV yang diawali `=`, `+`, `-`, `@`, TAB/CR tidak
dinetralkan. Kolom *Keterangan* (teks bebas) yang diawali karakter tersebut
dievaluasi spreadsheet (Excel/Google Sheets) sebagai **formula**, bukan
teks — pola `=cmd|...`, `=HYPERLINK(...)`, `@SUM(...)` dsb. (OWASP CSV /
spreadsheet injection).

**Perbaikan:** sel dengan karakter pembuka berbahaya (kecuali angka polos
— kolom Nominal tetap bisa di-`SUM`) diawali apostrof `'`; apostrof tidak
ditampilkan Excel/Sheets, hanya menandai sel sebagai teks. RFC-4180 quoting
tetap berjalan normal untuk sel berisi koma/petik/baris baru.

**Guard:** `tests/unit/export-csv.test.js` (baru, 7 kasus): netralisasi
tiap karakter pembuka, angka polos tak tersentuh, `buildTransactionsCsv`
end-to-end, `csvFileName`, `filterTransactionsForRange`.

### 2.2 [SEDANG] Dropdown "Akun" (form Catat) merender nama akun MENTAH
**Lokasi:** `app.src.js` — `updateFormOptions()`.

**Masalah:** satu-satunya titik render daftar akun yang **tidak** melewati
`escapeHtml` (semua titik lain sudah: daftar akun Pengaturan, kartu
dashboard, dropdown akun form berulang, kategori dsb.). Nama akun adalah
input user bebas: nama berisi `"`, `<`, `>` (mis. `Cash <100rb`, `Bank
"Mama"`) merusak markup `<select>` (option terpotong/berantakan), dan nama
yang direkayasa (mis. lewat restore backup) bisa menyuntik atribut/event
handler HTML ke DOM.

**Perbaikan:** `<option value="${escapeHtml(acc)}">${escapeHtml(acc)}</option>`
— pola identik dengan dropdown akun lain di file yang sama.

**Guard:** `tests/unit/form-options-escape.test.js` (baru, 3 kasus): pola
mentah tidak ada di `app.src.js` & `app.js` (regex backreference + toleran
mangle terser `acc`→`e`), pola ter-escape wajib ada di keduanya.

### 2.3 [RENDAH–SEDANG] Stored-XSS via override ikon/gaya dari restore backup
**Lokasi:** `src/domain/settings.js`, `app.src.js`
(`restoreBackup`, `renderAccountIconObj`, `categoryIconHtml`).

**Masalah:** `accountIcons` & `categoryStyles` adalah objek yang dirender
ke `innerHTML` (`src="..."`, atribut `class="..."`, teks badge) tanpa
validasi bentuk. Sumber datanya tidak sepenuhnya tepercaya:
1. restore backup JSON — `validateBackupFile()` hanya cek
   `app === 'MyFinance'` + `.settings`, lalu seluruh `settings`
   (termasuk override ikon) ditimpa mentah ke `appSettings` **dan
   dipersist ke cloud**;
2. tabel cloud `custom_icons` yang sudah terisi data direkayasa dari
   backup semacam itu.

Nilai seperti `x" onerror="...` di `image`, `bg`, atau `value` bisa lolos
keluar atribut saat dirender (ikon kategori muncul di baris transaksi,
donut, budget, dsb. — pemicu tanpa klik).

**Perbaikan (2 lapis, murni + teruji):**
1. **`src/domain/settings.js`** — fungsi validasi bentuk baru
   (`isSafeIconImageUrl`, `isSafeClassToken`, `isSafeFaIconToken`,
   `sanitizeIconOverride`, `sanitizeSettingsIconOverrides`). Pola yang
   diterima persis bentuk yang dihasilkan UI: data URL gambar
   raster/base64 (upload modal), path internal `icons/banks/*` (logo bank),
   token kelas Tailwind tunggal (palet), token `fa-*` (palet), teks badge
   pendek (huruf bank). Semua nilai lain → dibuang / fallback.
2. **Titik render** (`renderAccountIconObj`, `categoryIconHtml`) — setiap
   token divalidasi saat render; nilai mencurigakan di-fallback ke ikon
   netral (`fa-wallet`, `bg-white`, `text-slate-500` — kelas yang sudah ada
   di subset), sehingga data lama yang sudah terlanjur "kotor" di cloud pun
   tidak bisa menyuntik.
3. **Jalur restore** (`restoreBackup`) — override ikon/gaya dari backup
   disanitasi SEBELUM ditimpa ke `appSettings` & dipersist, supaya data
   direkayasa tidak ikut tersebar ke cloud.

**Guard:** `tests/unit/settings-domain.test.js` (+8 kasus): pola sah
diterima utuh (data URL jpeg/png/webp/gif/svg+xml-base64, path bank
internal, palet, badge), payload `onerror`/`<script>`/URL luar ditolak,
`alt` non-string dinormalisasi, sanitasi settings end-to-end tidak menyentuh
field lain (`accounts`, `hidden_categories`), toleran settings kosong.

## 3. Bukti langsung di browser (skenario serangan)

Script Playwright sekali pakai (tidak di-commit) menyuntikkan lewat stub
settings: nama akun `Cash <img src=x onerror="window.__xss=1"> "quote"`,
override ikon akun & gaya kategori berisi payload `onerror`. Hasil:
- `window.__xss` tetap 0 (payload **tidak** tereksekusi);
- dropdown Akun tetap utuh: 2 `<option>` dengan teks & `value` benar
  (payload tampil sebagai teks, bukan markup);
- tidak ada `<img src="x...">` yang dirender dari override mencurigakan
  (fallback ikon netral);
- seluruh render lain tidak error.

## 4. Verifikasi pasca-perubahan (semua hijau)

| Gerbang | Sebelum | Sesudah |
|---|---|---|
| `npm run lint` | 0 | 0 |
| `npm run test:unit` | 565/565 | **583/583** (+18: icon-safety 8, csv 7, form-options 3) |
| `scripts/verify-hud.mjs` | 64/64 | **64/64**, Error halaman: 0 |
| `npm run build:app` | 448.088 B → 224.269 B | 450.384 B → 224.574 B, tanpa drift |
| SW `CACHE_VERSION` | `myfinance-v58` | `myfinance-v59` + snapshot di-regen |

Ritual ikut dijalankan: `sw.js` di-bump (konten index.html/app.js berubah),
`node tests/unit/update-sw-cache-snapshot.mjs` dijalankan.

## 5. Observasi lain (tidak diubah, untuk pertimbangan)

1. **Toast budget vs bulan filter**: `getCategoryBudgetStatus()` membaca
   budget dari `currentMonthBudgetsCache` (bulan yang sedang difilter di
   tab Budget) sementara pengeluaran dihitung dari `lastInsightsCtx`
   (bulan berjalan saat data diproses). Bila user memfilter bulan lama lalu
   mencatat transaksi, notifikasi ambang bisa membandingkan dengan bulan
   yang berbeda — kosmetik, tidak merusak data.
2. **Kurs saat edit transaksi valas**: meng-edit transaksi mata uang asing
   memakai kurs yang tersimpan di baris (kurs saat transaksi dicatat),
   bukan kurs live. Untuk konsistensi riwayat ini justru lebih tepat —
   keputusan desain yang perlu disadari: nominal IDR hasil edit dihitung
   ulang dengan kurs lama.
3. **Presisi angka sangat besar**: input nominal > 15 digit melewati
   `Number()` (float) — presisi hilang di atas 2^53. Tidak realistis untuk
   Rupiah, dicatat saja.
4. **`removeDemoData()` / restore bulk** memakai insert/delete per tabel
   tanpa transaksi DB — bila gagal di tengah, sisa data yang sudah
   terlanjur masuk tetap ada (sebagian). Perilaku lama, sudah diinformasikan
   ke user lewat teks konfirmasi.

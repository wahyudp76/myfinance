# Audit Edge Functions & Batas Client–Server — 2026-09-14

**Tanggal:** 2026-09-14
**Repo:** `wahyudp76/myfinance` · branch `main` · HEAD `c7e6e90` (v125)
**Cakupan audit:** 5 Edge Function (`analyze-finance`, `scan-receipt`,
`refresh-asset-price`, `get-exchange-rate`, `whatsapp-webhook`) + folder
`supabase/functions/_shared/` + sisi client yang memanggilnya
(`src/services/supabase/edge.js`, `src/services/supabase/assets.js`,
penanganan hasil di `app.src.js`).
**Sifat audit:** read-only (statis). **Tidak ada satu pun berkas yang diubah**
dalam audit ini — laporan ini murni dokumentasi temuan, menunggu keputusan
pemilik repo sebelum perbaikan diterapkan.

> **Kenapa cakupan ini?** Audit v123 (bug/stabilitas/performa) menyasar
> monolit `app.src.js` + `src/**`, dan audit v124 (drift) menyasar `sql/`.
> Edge Functions hanya pernah diaudit per-fitur (v41–v43, v58, Phase 6) tapi
> belum pernah dibaca END-TO-END satu per satu sebagai satu kesatuan batas
> client–server. Laporan ini menutup celah cakupan itu.

> **STATUS TINDAK LANJUT (dikerjakan bertahap setelah persetujuan pemilik):**
> - ✅ **F1** — diterapkan 2026-09-14: guard kategori di
>   `scan-receipt/index.ts` (kategori AI hanya diterima bila anggota daftar
>   `categories` milik user). Menuntut deploy ulang `scan-receipt`.
> - ✅ **F5** — diterapkan 2026-09-14: hasil `upsert` `whatsapp_links`
>   diperiksa; kalau gagal (nomor sudah tertaut akun lain), kode TIDAK dihapus
>   dan user diberi pesan jujur. Menuntut deploy ulang `whatsapp-webhook`.
> - ✅ **F6** — diterapkan 2026-09-14: `keterangan` hasil Gemini di-cast ke
>   string (`typeof === "string"`), mencegah INSERT gagal total. Menuntut
>   deploy ulang `whatsapp-webhook`.
> - ✅ **F2** — diterapkan 2026-09-14: `total` (angka positif & finit) dan
>   `tanggal` (YYYY-MM-DD kalender valid via helper `isRealIsoDate`) dari AI
>   dinormalisasi di server. Menuntut deploy ulang `scan-receipt`.
> - ✅ **F3** — diterapkan 2026-09-14: `categories.slice(0, 100)` di
>   `scan-receipt`, selaras dengan `analyze-finance`. Menuntut deploy ulang
>   `scan-receipt`.
> - ✅ **F7** — diterapkan 2026-09-14: validasi `^[A-Z]{3}$` pada `mata_uang`
>   di `get-exchange-rate`. Menuntut deploy ulang `get-exchange-rate`.
> - ✅ **F4** — diterapkan 2026-09-14, dua sisi:
>   (a) client — kode LINK WA kini dibuat dari `crypto.getRandomValues`
>   (PRNG kriptografis), bukan `Math.random()`; `app.src.js` di-edit + `app.js`
>   di-rebuild (`npm run build:app`, diff 1 baris);
>   (b) server — perintah LINK dibatasi 5 percobaan per nomor per 10 menit
>   lewat RPC `check_and_consume_rate_limit` dengan kunci uuid deterministik
>   dari nomor pengirim (`senderToUuid`, SHA-256). Menuntut deploy ulang
>   `whatsapp-webhook`.

---

## 1. Ringkasan eksekutif

| Kategori | Hasil |
|---|---|
| Pola auth (5/5 Edge Function) | ✅ konsisten: `verify_jwt=true` + `auth.getUser()` manual sebagai lapis kedua |
| Pola rate-limit | ✅ konsisten: RPC `check_and_consume_rate_limit`, fail-open terdokumentasi |
| Sanitasi output Gemini | ✅ `analyze-finance` & `whatsapp-webhook` (parse) sudah jaga kontrak |
| Perbandingan secret webhook | ✅ constant-time (`constantTimeEqual`) |
| Dekripsi Bibit & ekstraksi Yahoo | ✅ helper murni teruji unit (`_shared/bibit.js`, `_shared/price-sources.js`) |
| **Konsistensi validasi antar-titik** | ❌ **7 temuan** — semuanya kelas "inkonsistensi / robustness", **bukan** celah keamanan kritis |

**Ringkasnya:** tidak ditemukan satu pun celah keamanan. Semua temuan adalah
**validasi yang tidak konsisten antar-titik** — guard yang sudah ada di satu
Edge Function / satu sisi, tapi belum ada di kembarannya. Pola yang berulang:
`analyze-finance` dan sisi client `app.src.js` sudah menulis *niat* yang benar
(di komentar), tapi `scan-receipt` / `whatsapp-webhook` tidak ikut menerapkan
niat yang sama.

**Temuan menurut berat:**

| # | Berat | Lokasi | Ringkasan |
|---|---|---|---|
| 1 | **SEDANG** | `scan-receipt/index.ts:168-173` | `kategori` hasil AI dikembalikan TANPA validasi keanggotaan (vs `analyze-finance:223` yang punya guard) → kategori hantu bisa tersimpan |
| 2 | RENDAH | `scan-receipt/index.ts:169-171` | `total` & `tanggal` tidak dinormalisasi di server (angka negatif / tanggal asal-asalan lolos) |
| 3 | RENDAH | `scan-receipt/index.ts:102` | `categories` tanpa `.slice(0,100)` (vs `analyze-finance:199`) |
| 4 | RENDAH | `app.src.js:1929` + `whatsapp-webhook/index.ts:178-195` | kode LINK WA pakai `Math.random()` + perintah LINK tanpa rate-limit |
| 5 | RENDAH | `whatsapp-webhook/index.ts:192-195` | hasil `upsert` `whatsapp_links` tidak dicek; kode tetap dihapus walau upsert gagal |
| 6 | RENDAH | `whatsapp-webhook/index.ts:143` | `keterangan` hasil Gemini tidak di-cast ke string (bisa membuat INSERT gagal total) |
| 7 | RENDAH | `get-exchange-rate/index.ts:87` | `mata_uang` tanpa validasi format `^[A-Z]{3}$` |

---

## 2. Metode (supaya bisa diulang)

1. Baca penuh kelima `supabase/functions/*/index.ts` + `_shared/{bibit,market-sync,price-sources}.js` baris per baris.
2. Baca sisi client yang memanggilnya: `src/services/supabase/edge.js`, `src/services/supabase/assets.js`, dan penanganan hasil di `app.src.js` (`handleStrukFileSelected`, `applyStrukResultToForm`, `setCategoryUIFromValue`, `submitForm`, `generateWhatsappLinkCode`).
3. Bandingkan **per pasangan kembar** (fitur yang sama di dua tempat) dan **per niat** (komentar/kontrak yang tertulis vs kode yang benar-benar dijalankan).
4. Setiap temuan dicatat dengan nomor baris persis dari HEAD `c7e6e90`.

Alat: pembacaan statis (tanpa run test — sandbox audit ini ber-Node v20,
bukan Node ≥22.19.0 yang menjadi runtime resmi repo, jadi suite test tidak
dipakai sebagai gerbang; ini murni audit kode).

---

## 3. Temuan, diurutkan menurut berat

### F1 — `scan-receipt` mengembalikan `kategori` tanpa validasi keanggotaan **[SEDANG]**

**Jenis:** inkonsistensi validasi · **Dampak:** kategori "hantu" bisa tersimpan permanen · **Lokasi:** `supabase/functions/scan-receipt/index.ts:168-173`

Bukti — kembarannya di `analyze-finance` punya guard, `scan-receipt` tidak:

```ts
// analyze-finance/index.ts:223  (SUDAH benar)
const kategori = (parsed?.kategori && categories.includes(parsed.kategori)) ? parsed.kategori : null;

// scan-receipt/index.ts:168-173  (BELUM ada guard)
return jsonResponse({
  merchant: parsed?.merchant ?? null,
  total: typeof parsed?.total === "number" ? parsed.total : null,
  tanggal: parsed?.tanggal ?? null,
  kategori: parsed?.kategori ?? null,   // ← apa adanya
});
```

Niat yang benar sudah tertulis di sisi client — `app.src.js:3820`:

```js
// Kategori Pengeluaran user ini sendiri (bukan daftar generik) -- supaya AI cuma
// boleh milih kategori yang BENAR-BENAR ada di akun user, tidak mengarang nama baru.
```

Tapi niat itu berhenti di prompt (meminta Gemini memilih dari daftar), dan tidak
ditegakkan di output. Rantai konsekuensinya:

1. Gemini berhalusinasi nama → `scan-receipt` mengembalikannya mentah →
   `applyStrukResultToForm` (`app.src.js:3860`) → `setCategoryUIFromValue` menulis
   langsung ke input `kategori`.
2. `submitForm` (`app.src.js:3948`) hanya memvalidasi `if(!catVal)` — **tidak ada
   cek keanggotaan di `categoryDict`**.
3. Transaksi tersimpan di `transactions.kategori` dengan nama yang **tidak ada di
   pohon kategori user** → tampil aneh di laporan/filter/chart/kalender dan tidak
   masuk agregasi sub-kategori (`src/domain/categories.js`).

**Perbaikan yang disarankan:** di `scan-receipt`, terapkan guard identik dengan
`analyze-finance:223` (validasi `categories.includes(...)` sebelum mengembalikan
`kategori`). Ini juga menyelaraskan perilaku dengan prompt-nya sendiri.

---

### F2 — `scan-receipt`: `total` & `tanggal` tidak dinormalisasi di server **[RENDAH]**

**Jenis:** robustness · **Dampak:** input semi-sah tapi janggal lolos (mitigasi client ada, tapi tidak lengkap) · **Lokasi:** `scan-receipt/index.ts:169-171`

```ts
total: typeof parsed?.total === "number" ? parsed.total : null,
tanggal: parsed?.tanggal ?? null,
```

- `total`: angka **negatif** atau **NaN/Infinity** lolos (`typeof === "number"`).
  Client memanggil `Math.round(hasil.total)` (app.src.js:3856) — `Math.round(NaN)`
  jadi `NaN`, dan angka negatif akan ditolak oleh constraint `jumlah >= 0` di DB
  **setelah** user menekan Simpan (membingungkan, tapi tidak berbahaya).
- `tanggal`: string bebas (tanpa pola `YYYY-MM-DD`). Client menahan sebagian lewat
  `new Date()` + `isNaN` (app.src.js:3852-3854), tapi tanggal di masa depan/lalu yang
  jauh tetap lolos dan langsung menjadi tanggal transaksi.

Prompt di function ini (baris 119-125) sudah meminta Gemini mengembalikan format
persis; guard output-nya saja yang tidak ada — beda dengan pola `pickYahooMarketPrice`
di `_shared/price-sources.js` yang menolak payload aneh (`!isFinite(price) || price <= 0`).

**Perbaikan yang disarankan:** `total` → `Number.isFinite(x) && x > 0`; `tanggal` →
validasi `^\d{4}-\d{2}-\d{2}$` + `isBibitNavDate`-style cek validitas tanggal.

---

### F3 — `scan-receipt`: `categories` tanpa batas ukuran **[RENDAH]**

**Jenis:** robustness · **Dampak:** prompt membesar untuk user berkategori ratusan · **Lokasi:** `scan-receipt/index.ts:102`

```ts
const categories: string[] = Array.isArray(body?.categories) ? body.categories : [];
```

vs kembarannya:

```ts
// analyze-finance/index.ts:199
const categories: string[] = Array.isArray(body?.categories) ? body.categories.slice(0, 100) : [];
```

`analyze-finance` membatasi input ke Gemini (`keterangan.slice(0,200)` +
`categories.slice(0,100)`), `scan-receipt` tidak. Bukan masalah keamanan (input
sudah milik user sendiri), murni konsistensi ukuran payload/prompt.

**Perbaikan yang disarankan:** `.slice(0, 100)` pada `categories`, selaras dengan
`analyze-finance`.

---

### F4 — Kode LINK WhatsApp memakai `Math.random()` & perintah LINK tanpa rate-limit **[RENDAH]**

**Jenis:** kriptografi lemah · **Dampak:** kode tebak-lebih-mudah · **Lokasi:** `app.src.js:1929` (pembuat kode) + `whatsapp-webhook/index.ts:178-195` (verifikator)

```js
// app.src.js:1929
const code = Math.floor(100000 + Math.random() * 900000).toString();
```

Kode ini adalah **token keamanan**: siapa pun yang mengirim `LINK <kode>` yang
benar (lewat WhatsApp) menautkan nomornya ke akun korban, lalu bisa mencatat
transaksi atas nama akun itu (lihat alur `whatsapp-webhook` baris 267-278 —
insert `transactions` dengan `user_id` korban, memakai `SERVICE_ROLE_KEY`).

Dua kelemahan bertumpuk:

1. `Math.random()` bukan PRNG kriptografis — sequence-nya bisa diprediksi.
   Bandingkan dengan satu-satunya pola aman di repo yang sudah ada untuk kasus
   serupa: tidak ada. (Sebagai referensi, pola yang benar: `crypto.getRandomValues`.)
2. Tidak ada pembatasan percobaan pada perintah `LINK` di webhook — tidak ada
   rate-limit, tidak ada pencatatan kegagalan. Ruang kode `10^6` dengan window
   10 menit (`expires_at` default `now() + 10 menit` di `schema.sql`).

**Dampak nyata tetap rendah** (kode single-use — dihapus setelah dipakai — dan
expiry 10 menit, plus korban harus punya bot yang aktif + nomornya sendiri belum
tertaut), tapi ini satu-satunya tempat di repo yang memakai PRNG untuk sesuatu
yang berfungsi sebagai kredensial.

**Perbaikan yang disarankan:** (a) ganti ke `crypto.getRandomValues` (6 digit
dari Uint32), (b) tambahkan counter percobaan `LINK` per sender di webhook
(mis. maks 5 percobaan gagal per 10 menit — bisa lewat tabel kecil atau
`api_rate_limits` dengan action baru).

---

### F5 — `whatsapp-webhook`: hasil `upsert` tidak dicek, kode tetap dihapus **[RENDAH]**

**Jenis:** robustness · **Dampak:** konfirmasi sukses palsu + kode hangus · **Lokasi:** `whatsapp-webhook/index.ts:192-195`

```ts
await supabase
  .from('whatsapp_links')
  .upsert({ user_id: codeRow.user_id, whatsapp_number: sender, linked_at: new Date().toISOString() }, { onConflict: 'user_id' });
await supabase.from('whatsapp_link_codes').delete().eq('code', code);

await sendReply(sender, '✅ Berhasil terhubung ke akun MyFinance kamu!...');
```

`whatsapp_links` punya `whatsapp_number text not null unique` (`schema.sql`). Kalau
nomor sender **sudah tertaut ke user lain**, `upsert` dengan `onConflict: 'user_id'`
gagal dengan unique violation pada `whatsapp_number` — **tapi error-nya tidak
diperiksa**. Kode tetap dihapus, dan sender tetap mendapat balasan "Berhasil
terhubung" padahal tidak terjadi apa-apa.

**Perbaikan yang disarankan:** tangkap `error` dari `upsert`; kalau ada, balas
pesan jujur ("nomor ini sudah tertaut ke akun lain") dan **jangan** hapus kodenya.

---

### F6 — `whatsapp-webhook`: `keterangan` hasil Gemini tidak di-cast ke string **[RENDAH]**

**Jenis:** robustness · **Dampak:** INSERT transaksi bisa gagal total · **Lokasi:** `whatsapp-webhook/index.ts:143`

```ts
return { jenis: parsed.jenis, jumlah, kategori: String(parsed.kategori), keterangan: parsed.keterangan || null };
```

`kategori` sudah di-`String(...)`, `keterangan` belum. Kalau Gemini membalas
`keterangan` berupa object/angka (halusinasi skema JSON), `supabase.from('transactions').insert`
dengan nilai non-string di kolom `keterangan text` akan ditolak PostgREST →
seluruh transaksi batal padahal jumlah/kategori-nya valid.

**Perbaikan yang disarankan:** `keterangan: typeof parsed.keterangan === "string" ? parsed.keterangan : null`.

---

### F7 — `get-exchange-rate`: `mata_uang` tanpa validasi format **[RENDAH]**

**Jenis:** robustness · **Dampak:** satu round-trip ekstra ke Frankfurter untuk input sampah · **Lokasi:** `get-exchange-rate/index.ts:87`

```ts
const mataUang = String(body?.mata_uang || "").trim().toUpperCase();
if (!mataUang) return jsonResponse({ error: "mata_uang wajib dikirim (mis. USD)." }, 400);
```

Tidak ada validasi `^[A-Z]{3}$`. Input seperti `"USD, JPY; DROP..."` atau
`"../../../"` diteruskan ke URL Frankfurter. Aman (Frankfurter membalas 422,
dan `encodeURIComponent` dipakai di baris 95), tapi validasi eksplisit akan
menghemat satu network call dan membuat pesan error lebih jujur. Bandingkan
dengan `whatsapp-webhook` yang punya `normalizePhone` (normalisasi input sebelum
dipakai).

**Perbaikan yang disarankan:** `if (!/^[A-Z]{3}$/.test(mataUang)) return 400`.

---

## 4. Non-temuan (sudah benar — dicatat supaya tidak diaudit ulang dari nol)

- **Pola auth 5/5 konsisten.** Semua Edge Function memakai `verify_jwt=true`
  (platform menolak request tanpa JWT valid sebelum kode jalan) + `auth.getUser()`
  manual sebagai lapis kedua. `analyze-finance` & `scan-receipt` & `get-exchange-rate`
  & `refresh-asset-price` memakai `SUPABASE_ANON_KEY` dengan client di-scope ke JWT
  user (RLS tetap berkuasa); `whatsapp-webhook` memakai `SERVICE_ROLE_KEY` karena
  user-nya di-resolve dari nomor WhatsApp (bukan JWT) — keduanya benar untuk
  tujuannya masing-masing.
- **Fail-open rate-limit di semua Edge Function** adalah keputusan yang
  **sengaja & terdokumentasi** (komentar `// Fail-open kalau RPC-nya sendiri error`).
  Bukan temuan.
- **`constantTimeEqual`** di `whatsapp-webhook` (baris 41-46) benar dan fail-closed
  (`!WEBHOOK_SECRET || !constantTimeEqual(...)` → 401).
- **`analyze-finance` sanitasi output** (baris 380-389) sudah menjaga kontrak
  `{title, message, detail?, severity}` dengan filter + `.slice()` + whitelist
  severity. Client lama & baru aman di-deploy tidak serentak.
- **`refresh-asset-price`** jalur `manual_nav` sudah dibersihkan (v20); harga dari
  ketiga sumber melewati helper yang menolak angka non-positif/non-finit
  (`pickYahooMarketPrice`, `parseBibitFund`). `value_history` dedupe-per-hari
  identik dengan `submitAsset()` di client.
- **`_shared/bibit.js`** validasi payload hex (`^[0-9a-fA-F]*$` + panjang genap)
  dan batas minimal panjang sebelum dekripsi — tidak ada jalur crash yang jelas.
- **`_shared/price-sources.js`** mirror Yahoo berurutan + pesan gagal yang
  membedakan "saham tak ditemukan" vs "sumber tumbang" — sudah rapi.

---

## 5. Status & rekomendasi tindak lanjut

Laporan ini **belum mengubah berkas apa pun**. Rekomendasi urutan pengerjaan
bila pemilik menyetujui perbaikan:

1. **F1** (prioritas — satu baris guard di `scan-receipt`, menyelaraskan dengan
   `analyze-finance` dan prompt-nya sendiri).
2. **F5 + F6** (dua baris di `whatsapp-webhook`, mencegah konfirmasi palsu & INSERT gagal).
3. **F2 + F3 + F7** (normalisasi input/output kecil).
4. **F4** (perubahan terbesar: PRNG → `crypto.getRandomValues` + rate-limit perintah LINK; perlu deploy ulang `whatsapp-webhook` **dan** rebuild `app.js`).

Semua perbaikan di Edge Function menuntut **deploy ulang** masing-masing function;
perbaikan F4 di sisi client menuntut `npm run build:app` + commit `app.src.js` +
`app.js` bersamaan (sesuai aturan emas repo). Bila F1-F7 dikerjakan, pertimbangkan
menambah unit test kecil untuk guard kategori `scan-receipt` (pola yang sudah ada:
`tests/unit/price-sources.test.js`, `tests/unit/bibit-market.test.js` menguji
helper `_shared`; guard kategori bisa diekstrak jadi helper murni di `_shared/`
supaya ikut teruji unit).

**Catatan operasional (bukan bagian F1-F7, sudah tercatat sebelumnya):**
`supabase functions delete smooth-processor` (Edge Function lama berisi versi
Claude yang masih live & bisa diakses publik) masih belum dieksekusi — lihat
komentar `analyze-finance/index.ts:18-23` dan catatan v124.

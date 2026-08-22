# Audit Menyeluruh — MyFinance
**Tanggal:** 22 Agustus 2026
**Cakupan:** Struktur repo, kode `index.html` (client), edge functions, skema SQL, dan pengecekan langsung ke project Supabase live (`My Finance`, `uxfngmxghupdlwoeoxgh`).

---

## 1. Ringkasan Eksekutif

| Kategori | Ditemukan | Sudah diperbaiki di file ini | Butuh aksi Anda |
|---|---|---|---|
| Dead code (client) | 2 fungsi | ✅ Ya | - |
| Bug fungsional (client) | 1 (WhatsApp bot number) | ✅ Ya | - |
| Duplikasi dokumentasi/SQL | 2 file basi | ✅ Ya (jadi stub) | Hapus manual dari Git (opsional) |
| RLS performance (live DB) | 14 policy | 📝 Draf siap | **Perlu approval Anda untuk dijalankan** |
| Data integrity (live DB) | 0 masalah | - | - |
| Migrasi belum diterapkan | 2 file | 📝 Sudah ada di repo | **Perlu approval Anda untuk dijalankan** |
| Auth security setting | 1 | - | Aktifkan manual di Dashboard |
| Edge function menggantung | 1 (`smooth-processor`) | - | Hapus manual di Dashboard (tidak ada tool hapus function) |
| Edge function tidak ter-backup di repo | 3 | - | Rekomendasi: `supabase functions download` |

---

## 2. Bug & Dead Code — Sudah Diperbaiki di `index.html`

### 2.1 Pinggiran putih pada logo custom (dari sesi sebelumnya)
`compressImageDataUrl()` selalu mengonversi gambar ke JPEG (tidak mendukung transparansi) dan mengisi background putih dulu — tepi semi-transparan hasil anti-aliasing logo PNG jadi "berpinggir putih". **Fix:** deteksi transparansi source image; kalau ada, ekspor PNG (transparansi utuh); kalau tidak, tetap JPEG (hemat ukuran).

### 2.2 `renderAiInsightError()` — dead code
Fungsi ini didefinisikan tapi tidak pernah dipanggil di mana pun — sudah digantikan sepenuhnya oleh `renderAiInsightSetupNeeded()` yang menampilkan detail error asli. **Fix:** dihapus.

### 2.3 `toggleSidebar()` — dead code
Sisa dari iterasi UI lama. Elemen `#sidebar` sekarang dikontrol murni lewat class Tailwind responsif (`hidden md:flex`), tidak ada lagi toggle manual. **Fix:** dihapus.

### 2.4 Bug: nomor bot WhatsApp placeholder ditampilkan apa adanya
**Ini kemungkinan besar akar masalah nyata** yang saya temukan di data Supabase (lihat §4.3): kode `WHATSAPP_BOT_NUMBER = '628XXXXXXXXXX'` adalah placeholder yang belum diganti, tapi UI tetap menampilkannya ke user sebagai "kirim pesan ke nomor ini" tanpa validasi apa pun. Kalau developer lupa mengganti, user diminta mengirim kode LINK ke nomor yang **tidak benar-benar ada** — kode akan selalu kadaluarsa tanpa penjelasan apa pun.

**Fix:**
- `isWhatsappBotNumberConfigured()` — validasi format sebelum dipakai.
- Kalau belum dikonfigurasi → tampilkan peringatan jelas ke user ("Bot WhatsApp belum dikonfigurasi"), bukan nomor palsu.
- Kalau sudah dikonfigurasi → **tambahan UX**: tombol "Buka WhatsApp & Kirim Otomatis" via deep-link `wa.me/...?text=LINK+xxxxxx`, jadi user tidak perlu copy-paste manual kode ke chat WhatsApp secara terpisah.

**Aksi Anda:** buka `index.html`, cari `WHATSAPP_BOT_NUMBER`, isi dengan nomor device Fonnte yang sebenarnya.

---

## 3. Kebersihan Repo — Sudah Diperbaiki

### 3.1 `sql/schema.sql` basi/duplikat
Ada dua file schema berbeda isi: `schema.sql` (root, terbaru — 7 tabel, multi-currency, `rate_limits`) vs `sql/schema.sql` (basi — 6 tabel, ketinggalan kolom multi-currency & tabel `rate_limits`). README sebelumnya justru menyuruh user menjalankan versi yang **basi**. **Fix:** `sql/schema.sql` diganti jadi file penanda deprecation; semua referensi di README diarahkan ke `schema.sql` (root).

### 3.2 `readme.md` vs `README.md`
Dua file berbeda isi (384 vs 472 baris) — riskan di filesystem case-insensitive (Windows/Mac) dan membingungkan siapa pun yang mengedit yang salah. **Fix:** `readme.md` diganti jadi stub pointer ke `README.md`. Rekomendasi: hapus manual lewat `git rm readme.md` kalau memang tidak dibutuhkan lagi.

---

## 4. Temuan dari Pengecekan Live Supabase

### 4.1 Data integrity — **bersih**
Dicek langsung ke database production:
- Tidak ada transaksi dengan jumlah negatif atau kurs tidak valid.
- Tidak ada budget duplikat (user_id + bulan + kategori).
- Tidak ada transaksi "orphan" (user_id yang usernya sudah tidak ada).
- 3 user terdaftar, ketiganya sudah punya baris `settings` lengkap (tidak ada yang "setengah onboarding").

### 4.2 RLS Performance — 14 policy perlu dioptimasi
Supabase Performance Advisor menandai **hampir semua RLS policy** (transactions ×4, budgets, assets, settings, custom_icons, recurring_transactions, rate_limits, whatsapp_link_codes ×2, whatsapp_links ×2) memanggil `auth.uid()` langsung, yang dievaluasi ULANG di setiap baris. Solusi standar Supabase: bungkus jadi `(select auth.uid())` — planner Postgres lalu menghitungnya sekali per query, bukan per baris. Efeknya makin terasa seiring jumlah baris per user bertambah.

Juga ditemukan foreign key tanpa index: `whatsapp_link_codes.user_id`.

**Saya sudah menyiapkan migrasinya** di `sql/rls_performance_fix.sql` — sudah saya validasi nama & isi tiap policy-nya **persis sama** dengan yang ada di database live Anda saat ini (jadi dijamin tidak salah target). Sifatnya murni rewrite policy (DROP + CREATE dengan efek akses yang identik) + tambah 1 index — **tidak menyentuh data sama sekali**.

➡️ **Belum saya jalankan ke database production** — ini perubahan ke database live, saya perlu konfirmasi Anda dulu. Bilang "jalankan RLS fix" kalau Anda setuju, dan saya eksekusi langsung lewat koneksi Supabase yang tersambung.

### 4.3 Bot WhatsApp: 10 percobaan link, 0 berhasil
Query ke `whatsapp_link_codes` menunjukkan 1 user sudah generate **10 kode berbeda** dalam rentang 3 hari (10, 11, 13 Agustus), **semuanya kadaluarsa**, dan tabel `whatsapp_links` **kosong total** — belum pernah ada yang berhasil ter-link. Edge function `whatsapp-webhook` sendiri sudah ter-deploy aktif (versi ke-11, jadi memang sudah beberapa kali diutak-atik).

Kesimpulan paling mungkin, dan **sudah dikonfirmasi lewat pembacaan kode**: `WHATSAPP_BOT_NUMBER` di `index.html` masih placeholder `628XXXXXXXXXX` (lihat §2.4) — user kemungkinan besar mengirim kode ke nomor itu apa adanya (karena itu yang ditampilkan UI), yang tidak pernah benar-benar sampai ke bot Fonnte manapun.

**Aksi Anda:**
1. Isi `WHATSAPP_BOT_NUMBER` dengan nomor device Fonnte asli (lihat §2.4).
2. Pastikan URL webhook di dashboard Fonnte (Device → Webhook URL) sudah menunjuk ke Edge Function `whatsapp-webhook` + `?token=<WHATSAPP_WEBHOOK_SECRET>`.
3. Pastikan secret `FONNTE_TOKEN` & `WHATSAPP_WEBHOOK_SECRET` sudah diset (`supabase secrets list`).

### 4.4 Migrasi yang sudah ditulis tapi belum diterapkan ke database
Dua file di `sql/` **belum pernah dijalankan** ke database (saya cek langsung — kolom & fungsi RPC-nya belum ada sama sekali):

- **`migration_reliability_hardening_2026-08.sql`** — menambahkan RPC `create_recurring_transaction` (mencegah Transaksi Berulang tercatat dobel kalau `processDueRecurring()` sempat berjalan 2x bersamaan) dan RPC `replace_month_budgets` (mengganti pola "hapus semua budget bulan ini lalu insert ulang" yang **tidak atomik** — kalau proses insert gagal di tengah jalan setelah delete berhasil, budget sebulan penuh bisa hilang).
- **`migration_transfer_currency_2026-08.sql`** — Transfer antar akun beda mata uang dicatat sebagai satu operasi atomik dengan kurs kedua sisi di-snapshot, lewat RPC `create_transfer_transaction`.

Kedua migrasi ini **aman & additive** (cuma menambah kolom/fungsi, tidak mengubah data yang sudah ada), tapi baru benar-benar berguna kalau `index.html` juga diperbarui untuk memanggil RPC-nya (saat ini `saveBudgetsCloudRemote()` & `processDueRecurring()` masih pakai jalur lama).

➡️ **Belum saya terapkan** — sama seperti §4.2, ini perubahan skema database production, butuh konfirmasi Anda dulu. Kalau Anda setuju, saya bisa (a) jalankan migrasinya via Supabase, DAN (b) sekaligus perbarui `index.html` untuk benar-benar memakai RPC barunya, supaya keduanya rilis bersamaan (sesuai catatan di file migrasinya sendiri — jangan diterapkan terpisah).

### 4.5 Keamanan: Leaked Password Protection nonaktif
Supabase Security Advisor menandai fitur "leaked password protection" (cek password terhadap database HaveIBeenPwned) masih nonaktif di project Auth Anda. Ini setting dashboard, bukan sesuatu yang bisa saya ubah lewat SQL.

**Aksi Anda:** Supabase Dashboard → Authentication → Policies/Providers → aktifkan "Leaked Password Protection".

### 4.6 Edge function menggantung: `smooth-processor`
Ditemukan edge function ter-deploy **aktif** bernama `smooth-processor`, tapi **tidak direferensikan sama sekali** di `index.html`, `index.ts`, atau `whatsapp-webhook.ts`. Saya baca isinya: ternyata ini **versi lama** dari fungsi AI insight yang sekarang bernama `analyze-finance` — bedanya, versi lama ini memanggil **Anthropic Claude** (butuh secret `ANTHROPIC_API_KEY`), sedangkan versi aktif sekarang (`analyze-finance`, di `index.ts`) sudah pindah ke **Gemini**. Kemungkinan besar ini sisa deploy awal yang ke-generate nama acak sebelum di-deploy ulang dengan nama yang benar.

Tidak berbahaya (butuh JWT valid untuk diakses, jadi tidak bisa dipanggil anonim), tapi ini "sampah" infra yang sebaiknya dibersihkan.

**Aksi Anda:** Supabase Dashboard → Edge Functions → `smooth-processor` → Delete. (Saya tidak punya tool untuk menghapus edge function, hanya deploy/lihat.)

### 4.7 3 dari 6 edge function tidak ada source-nya di repo GitHub
Project Supabase Anda punya 6 edge function aktif: `analyze-finance`, `whatsapp-webhook`, `get-exchange-rate`, `scan-receipt`, `refresh-asset-price`, dan `smooth-processor` (§4.6). Repo GitHub hanya menyimpan source untuk 2 yang pertama (`index.ts`, `whatsapp-webhook.ts`). Kalau suatu saat perlu redeploy dari nol / project Supabase hilang, source `get-exchange-rate`, `scan-receipt`, `refresh-asset-price` tidak akan bisa dipulihkan dari Git.

**Rekomendasi:** `supabase functions download <nama>` untuk masing-masing, lalu commit ke repo (folder `supabase/functions/<nama>/index.ts`) supaya jadi source of truth yang lengkap.

---

## 5. Rekomendasi Improvement Ke Depan (belum urgent, tidak saya kerjakan sekarang)

1. **Selesaikan integrasi RPC** (§4.4) — setelah migrasi diterapkan, update `saveBudgetsCloudRemote()` dan `processDueRecurring()` di `index.html` untuk memanggil `replace_month_budgets` / `create_recurring_transaction` lewat `supabaseClient.rpc(...)`, dan tambahkan alur "Transfer beda mata uang" di form transaksi yang memanggil `create_transfer_transaction`.
2. **Split kode dari satu file 640K** — README & `docs/architecture-modernization-plan.md` sudah mendokumentasikan rencana ini dengan baik (pendekatan bertahap, bukan big-bang rewrite). Tetap relevan untuk maintainability jangka panjang begitu fitur terus bertambah.
3. **CSP masih mengizinkan `unsafe-inline`/`unsafe-eval`** (di `_headers`) — ini kompromi yang masuk akal untuk arsitektur single-file tanpa build step, tapi kalau nanti pindah ke bundler (sejalan dengan rencana di poin 2), ini bisa diperketat.
4. **Lazy-load Chart.js/FullCalendar** — saat ini semua vendor CDN (termasuk FullCalendar, yang cuma dipakai di tab Kalender) dimuat di awal lewat `<script>` tag biasa. Karena `sw.js` sudah cache vendor-vendor ini dengan baik, dampaknya kecil untuk return visit, tapi first-load bisa sedikit lebih cepat kalau FullCalendar baru dimuat saat tab Kalender pertama kali dibuka.
5. **Backup edge function source** (§4.7).
6. **Hapus `smooth-processor`** (§4.6) dan `sql/schema.sql` + `readme.md` dari Git history (§3) setelah Anda yakin tidak ada yang masih bergantung padanya.

---

## 6. Yang Butuh Keputusan Anda

| # | Item | Risiko kalau dijalankan | Risiko kalau TIDAK dijalankan |
|---|---|---|---|
| 1 | Terapkan `sql/rls_performance_fix.sql` ke database live | Sangat rendah — hanya rewrite policy, sudah divalidasi cocok 1:1 dengan policy live saat ini | Query lambat kalau data per-user bertambah banyak |
| 2 | Terapkan 2 migrasi reliability/transfer + update client code sekaligus | Rendah — additive, tapi mengubah alur simpan budget & transaksi berulang | Bug budget-hilang (non-atomik) & duplikat transaksi berulang tetap ada |
| 3 | Aktifkan Leaked Password Protection | Tidak ada (setting Auth bawaan Supabase) | User bisa pakai password yang sudah bocor di database lain |
| 4 | Hapus `smooth-processor` | Tidak ada (tidak dipakai) | Tidak ada, cuma clutter |

Beri tahu saya item mana yang mau dijalankan — saya bisa langsung eksekusi #1 dan #2 lewat koneksi Supabase yang tersambung begitu Anda konfirmasi.

---

## 7. Update Lanjutan (22 Agustus 2026, sesi lanjutan)

Item #1–#3 di §6 **sudah diterapkan langsung ke database production** (RLS fix, migrasi reliability hardening, dan `index.html` sudah di-rewiring untuk memakai RPC barunya). Item #4 (transfer currency) masih sengaja ditahan — lihat §4.4/README bagian 12 untuk detail terbaru.

### 7.1 Lazy-load FullCalendar — diterapkan
FullCalendar (~280KB) sebelumnya dimuat via `<script src>` statis di `<head>`, ikut diparsing/dieksekusi di SETIAP load halaman walau tab Kalender belum tentu pernah dibuka di sesi itu. Sekarang dimuat lewat `loadFullCalendarLib()` — disisipkan ke DOM secara dinamis, hanya saat `renderCalendar()` pertama kali dipanggil (user benar-benar membuka tab Kalender). `sw.js` tetap precache URL-nya, jadi begitu dibutuhkan biasanya sudah ada di cache (nyaris instan), cuma parse/eksekusinya yang ditunda ke titik yang tepat.

### 7.2 Backup source 3 Edge Function yang belum ada di repo — diterapkan
`get-exchange-rate`, `scan-receipt`, `refresh-asset-price` sekarang tersimpan di `supabase/functions/<nama>/index.ts` (diambil persis dari kode yang ter-deploy live). Sebelumnya kalau project Supabase hilang, ketiga function ini tidak bisa dipulihkan dari Git sama sekali.

### 7.3 Audit tambahan yang dilakukan, hasilnya bersih (tidak perlu perbaikan)
- **XSS scan** pada semua penulisan `innerHTML` yang menyisipkan field data user (`keterangan`, `nama`, `kategori`, `akun`, dst) — sudah konsisten memakai `escapeHtml()`. 2 kandidat yang sempat mencurigakan dari scan otomatis ternyata false positive (satu pakai `textContent` yang otomatis aman, satu lagi data internal aplikasi, bukan input user).
- **Fetch data awal** (`getSyncData()`) sudah paralel lewat `Promise.all` (transactions, budgets, assets, custom icons, settings, recurring diambil bersamaan) — tidak ada waterfall request yang bikin loading lebih lambat dari seharusnya.
- **Debounce input** — kolom pencarian transaksi (300ms) dan saran kategori otomatis (700ms) sudah didebounce dengan baik, termasuk guard anti-request-duplikat.
- **Ukuran ikon PWA** (`icons/*.png`) sudah wajar (44KB utk 512×512, total 88KB semua ukuran) — tidak perlu dikompres ulang.
- **Chart.js TIDAK di-lazy-load** (beda dari FullCalendar) — sengaja dibiarkan dimuat statis karena tab Dashboard (yang langsung memakai Chart.js) adalah tampilan default saat app dibuka; me-lazy-load-nya justru akan MEMPERLAMBAT tampilan pertama, bukan mempercepat.

### 7.4 Temuan baru, SENGAJA belum diimplementasikan: pagination daftar transaksi
`filterTransactions()` merender **seluruh** transaksi yang cocok filter ke DOM sekaligus (dikelompokkan per tanggal, digabung jadi satu string `innerHTML`) — tidak ada pagination/virtualisasi. Saat ini datanya kecil (67 transaksi total di seluruh user), jadi **belum ada dampak nyata apa pun** ke performa. Tapi karena app ini secara desain mendukung riwayat multi-tahun (grafik tren, laporan bulanan, dst), ini berpotensi jadi masalah nyata kalau suatu saat seorang user sudah mencatat ribuan transaksi (misal setelah 2-3 tahun pemakaian aktif harian) — setiap kali mengetik di kolom pencarian atau pindah bulan, browser harus membangun ulang ribuan node DOM sekaligus.

**Kenapa belum saya kerjakan sekarang:** ini fitur UX baru (bukan sekadar tweak), perlu keputusan desain (misal: "muat 150 transaksi terbaru dulu, tombol 'muat lagi' di bawah" vs infinite scroll vs pindah ke server-side pagination lewat query Supabase langsung) dan menyentuh salah satu bagian kode yang paling sering dipakai di seluruh app. Saya lebih pilih tidak terburu-buru mengubah ini tanpa data user yang nyata menunjukkan sudah dibutuhkan, mengikuti prinsip sama seperti alasan saya menahan fitur transfer lintas mata uang (§4.4).

**Rekomendasi konkret:** kalau suatu saat jumlah transaksi seorang user tembus ~500–1000 baris, ini layak dikerjakan. Paling sederhana & rendah risiko: cap render awal ke 100-150 transaksi terbaru + tombol "Muat lebih banyak" di bawah daftar (variabel `lastFilteredTransactions` yang dipakai fitur Export CSV tetap berisi SEMUA data yang cocok filter, tidak ikut dibatasi — jadi export tidak akan pernah kepotong).

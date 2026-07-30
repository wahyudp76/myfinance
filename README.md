# MyFinance Dashboard — Full Supabase Edition (1 File)

Versi ini digabung kembali jadi **satu file `index.html` utuh** (HTML + CSS +
JS jadi satu, tidak ada lagi `login.html`/`css/style.css`/`js/*.js` terpisah),
dengan Login, dan **seluruh data aplikasi** (Transaksi, Dashboard, Budget,
Aset, Pengaturan akun & kategori, Profil, Ikon kustom) tersambung penuh ke
Supabase. **Tidak ada localStorage yang dipakai sebagai database** — semua
tersimpan di cloud, per akun, dan otomatis sinkron di perangkat mana pun kamu
login.

## 1. Struktur folder

```
myfinance-app/
├── index.html        # SATU FILE: halaman login + dashboard + seluruh CSS & JS
├── manifest.json      # Web App Manifest (buat "Add to Home Screen")
├── icons/               # Ikon PWA (192/512/apple-touch/favicon)
├── robots.txt            # Larangan crawling mesin pencari (app ini privat)
├── _headers               # Header keamanan (khusus hosting Netlify)
├── sql/
│   └── schema.sql        # SQL lengkap: 6 tabel + Row Level Security
└── README.md
```

`login.html`, `css/style.css`, dan `js/*.js` sudah tidak ada lagi — semua
isinya sudah dipindahkan ke dalam `index.html` (bagian `<style>` untuk CSS,
satu blok `<script>` besar di bagian bawah untuk seluruh logic). Login dan
Dashboard sekarang adalah dua tampilan di halaman yang sama, ditukar lewat
JavaScript (tanpa reload halaman) — bukan dua file HTML terpisah lagi.

> **PERLU AKSI kalau kamu sudah pernah setup Supabase sebelumnya**: versi ini
> menambah 1 tabel baru (`recurring_transactions`, untuk fitur Transaksi
> Berulang) dan 1 kolom baru (`value_history` di tabel `assets`, untuk
> riwayat performa tiap aset). `schema.sql` aman dijalankan ulang dari awal
> sampai akhir kapan pun (semua perintahnya pakai "if not exists" / "drop
> policy if exists"), jadi tinggal copy-paste **seluruh isi file itu lagi**
> ke SQL Editor dan Run — tabel & data kamu yang sudah ada TIDAK akan
> terhapus/berubah, cuma menambah yang belum ada.

## 2. Setup Supabase (sekali saja, atau ulangi kalau sebelumnya sudah pernah)

1. Buka project Supabase kamu di https://app.supabase.com.
2. Masuk ke menu **SQL Editor** → **New query**.
3. Copy-paste **seluruh isi file `sql/schema.sql`** lalu klik **Run**.
   Ini membuat 6 tabel berikut, semuanya dengan Row Level Security (RLS)
   aktif — jadi tiap user cuma bisa lihat & ubah datanya sendiri:
   - `transactions` — transaksi
   - `budgets` — anggaran per kategori per bulan
   - `assets` — portofolio aset/investasi, **+ riwayat performa** (kolom `value_history`)
   - `settings` — daftar akun & kategori kustom, **+ data profil (nama,
     no. HP, bio)** (1 baris per user)
   - `custom_icons` — ikon/logo kustom per akun, **+ foto profil** (1 baris
     tersendiri per user, memakai key khusus)
   - `recurring_transactions` — template **Transaksi Berulang** (langganan,
     gaji, cicilan, tagihan rutin)
4. Cek menu **Authentication → Providers**, pastikan **Email** aktif
   (biasanya sudah default aktif).
5. (Opsional, buat testing lebih cepat) Di **Authentication → Settings**,
   kamu bisa mematikan "Confirm email" supaya akun baru langsung bisa login
   tanpa perlu klik link konfirmasi di email dulu.

Konfigurasi URL & anon key sudah ditaruh di dalam `index.html` (cari komentar
"KONEKSI SUPABASE") — tidak perlu diubah kecuali kamu ganti project Supabase.

## 3. Menjalankan di VS Code

1. Install extension **Live Server** (oleh Ritwick Dey) di VS Code.
2. Klik kanan `index.html` → **Open with Live Server**.
3. Daftar akun baru dulu (tab **Daftar**) pakai email & password.
4. Setelah login, tampilan otomatis berpindah ke dashboard — tanpa pindah
   halaman/file.

Alternatif tanpa extension (pakai terminal):
```bash
cd myfinance-app
python3 -m http.server 5500
```
lalu buka `http://localhost:5500/index.html` di browser.

## 4. Membuka dari Android/HP & install sebagai app (PWA)

Aplikasi ini sudah dilengkapi `manifest.json` + ikon, jadi bisa "di-install"
ke home screen dan tampil seperti app biasa (tanpa address bar browser).

**Supaya bisa dibuka dari HP, filenya harus di-hosting dulu** (bukan
`file://` ataupun `localhost` di laptop) — cara termudah & gratis pakai
**Netlify Drop**:
1. Buka https://app.netlify.com/drop di browser laptop.
2. Drag & drop folder `myfinance-app` (isinya `index.html`, `manifest.json`,
   `icons/`, `robots.txt`, `_headers`, `sql/`) ke halaman itu.
3. Netlify langsung kasih link publik, misal `https://nama-acak.netlify.app`.

Lalu di HP Android (Chrome):
1. Buka link Netlify tadi.
2. Menu titik tiga (⋮) → **"Tambahkan ke Layar Utama" / "Install app"**.
3. Ikon MyFinance akan muncul di home screen, terbuka full-screen tanpa
   address bar, dengan warna splash screen sesuai brand (`#151928`).

Di iPhone (Safari): tombol **Share** (kotak dengan panah ke atas) →
**"Add to Home Screen"**.

> **Penting kalau "Confirm email" aktif di Supabase**: buka
> **Authentication → URL Configuration** di dashboard Supabase, lalu
> tambahkan link Netlify kamu ke **Redirect URLs**, supaya link konfirmasi
> di email mengarah ke domain yang benar.

### 4a. iPhone: Catat transaksi langsung lewat Back Tap (ketuk 2x di belakang HP)

Aplikasi ini bisa dibuka langsung ke form "Catat Transaksi" (persis modal yang
sama seperti tombol "+" biasa -- bukan tiruan terpisah, jadi kategori/akun
yang tampil selalu sesuai dengan yang kamu punya) lewat URL khusus:
`https://link-netlify-kamu.netlify.app/?quickadd=1`

Untuk menyambungkannya ke gestur **Back Tap** (ketuk 2x/3x di belakang
iPhone), butuh 1 Shortcut sederhana di app **Shortcuts** bawaan iOS (bukan
sesuatu yang bisa dikirim sebagai file jadi -- Shortcut dibuat lewat app
Shortcuts di iPhone kamu langsung, tapi cuma butuh 1 langkah di dalamnya):

1. Buka app **Shortcuts** di iPhone → tab **Shortcuts** → tombol **+** (buat baru).
2. Cari action **"Open URLs"** (atau **"Buka URL"**), tambahkan ke Shortcut.
3. Isi kolom URL-nya dengan: `https://link-netlify-kamu.netlify.app/?quickadd=1`
   (ganti dengan link Netlify kamu sendiri, tetap sertakan `?quickadd=1` di belakangnya).
4. Beri nama Shortcut-nya, misal **"Catat Transaksi"**, lalu simpan (ikon di
   pojok kanan atas).
5. Buka **Settings → Aksesibilitas (Accessibility) → Sentuhan (Touch) →
   Ketuk Belakang (Back Tap)**.
6. Pilih **Ketuk 2x (Double Tap)** atau **Ketuk 3x (Triple Tap)**, lalu pilih
   Shortcut **"Catat Transaksi"** yang baru dibuat tadi.

Selesai — sekarang ketuk 2x di belakang iPhone kapan saja akan langsung
membuka modal catat transaksi. Beberapa catatan jujur soal batasannya:

- Kalau sesi login kamu masih aktif di Safari/PWA, modalnya langsung
  terbuka. Kalau sesinya sudah habis, akan diminta login dulu -- setelah
  berhasil login, modal tetap otomatis terbuka, tidak perlu ketuk ulang.
- Ini sengaja TIDAK dibuat lewat pemanggilan API Supabase langsung dari
  dalam Shortcut (tanpa membuka halamannya sama sekali). Kedengarannya
  lebih "native", tapi butuh menyimpan token sesi login di dalam Shortcut
  yang cepat kedaluwarsa dan harus diperbarui manual berkala -- jauh lebih
  merepotkan dirawat dibanding cukup membuka URL seperti ini, dan hasil
  akhirnya sama-sama cepat.
- Perilaku persis "membuka app yang sudah ter-install di layar utama" vs
  "buka tab Safari baru" bisa sedikit berbeda tergantung versi iOS --
  coba dulu, dan kalau Shortcuts menawarkan opsi buka lewat ikon app yang
  sudah kamu install di layar utama (bukan cuma Safari), itu akan terasa
  paling mulus.

## 5. Fitur baru

- **Maskot kartun di layar login** — ilustrasi dompet ceria (SVG orisinal,
  bukan karakter berlisensi) supaya tampilan login lebih hidup, plus animasi
  mengambang & kerlip halus.
- **Edit Profil** (menu Pengaturan → kartu "Akun Saya" → tombol **Edit
  Profil**): ubah **foto profil** (upload gambar, maks 1MB), **nama
  lengkap**, **nomor HP/WhatsApp**, dan **tentang saya** singkat. Foto &
  nama langsung tampil di kartu Akun Saya dan di pojok sidebar.
- **Ekspor CSV** (menu Transaksi → tombol **Ekspor CSV**): mengunduh daftar
  transaksi yang sedang tampil (mengikuti filter & pencarian aktif) sebagai
  file `.csv` siap dibuka di Excel/Google Sheets.
- **Indikator kekuatan password** saat mendaftar akun baru — bantuan visual
  ringan (Lemah/Cukup/Baik/Kuat), bukan aturan keamanan tambahan (aturan
  sesungguhnya tetap dari Supabase Auth).
- **Notifikasi sukses**, bukan cuma error — menyimpan/menghapus transaksi,
  aset, budget, akun, atau profil sekarang menampilkan konfirmasi singkat,
  bukan cuma diam saja kalau berhasil.
- **Banner offline** — kalau koneksi internet terputus, muncul peringatan
  di atas layar supaya kamu tahu perubahan belum tersimpan, dan hilang lagi
  otomatis begitu online kembali.
- **Tema Terang / Gelap / Sistem** (menu Pengaturan → kartu "Tampilan"):
  pilih tema terang, gelap, atau ikut pengaturan perangkat/OS secara
  otomatis (termasuk kalau OS-nya berganti tema sesuai jadwal saat aplikasi
  masih terbuka). Preferensi disimpan di perangkat ini (bukan di akun
  Supabase) dan diterapkan sebelum tampilan sempat "berkedip" salah tema
  saat halaman dibuka.
- **Transaksi Berulang** (menu Pengaturan → kartu "Transaksi Berulang" →
  **Kelola**): buat template untuk transaksi yang rutin terjadi -- gaji
  bulanan, tagihan listrik/internet, langganan streaming, cicilan, dsb.
  Setiap kali aplikasi dibuka, transaksi yang sudah jatuh tempo otomatis
  tercatat sendiri (termasuk "mengejar" beberapa periode sekaligus kalau
  kamu belum buka aplikasi selama beberapa waktu), dan kamu akan mendapat
  notifikasi ringkas soal apa saja yang baru tercatat. Mendukung
  Pemasukan, Pengeluaran, maupun Transfer antar akun, dengan frekuensi
  harian/mingguan/bulanan/tahunan dan opsi tanggal berakhir.
- **Tren Saldo Kas & Rekening** (Dashboard, di bawah "Komposisi Kas &
  Rekening"): grafik garis saldo gabungan SEMUA akun di akhir tiap bulan,
  6 bulan terakhir -- beda dari grafik arus kas yang sudah ada (yang
  menunjukkan pemasukan/pengeluaran per periode), ini menunjukkan
  **pertumbuhan kekayaan tunai kamu dari waktu ke waktu**. Ikut menghitung
  saldo sebelum 6 bulan itu sebagai titik awal, dan bulan tanpa transaksi
  tetap membawa saldo sebelumnya (tidak "reset" ke nol). Transfer antar akun
  sendiri tidak mempengaruhi angka ini, karena uangnya tidak benar-benar
  bertambah/berkurang, cuma pindah tempat.
- **Riwayat & Detail Aset** (menu Aset -> klik salah satu aset di daftar):
  sekarang tiap kali nilai sebuah aset diperbarui, titik data baru tersimpan
  (bukan cuma menimpa angka lama), jadi ada grafik performa per aset dari
  waktu ke waktu -- bukan cuma snapshot nilai hari ini. Daftar aset kini
  diurutkan dari nilai terbesar, ada highlight **Cuan Terbesar / Rugi
  Terbesar** kalau kamu punya 2 aset atau lebih, dan tombol **Ekspor CSV**
  buat portofolio kamu, sama seperti di menu Transaksi.
- **Tarik untuk sinkron ulang (pull-to-refresh)**: di HP, tarik layar ke
  bawah dari posisi paling atas untuk memuat ulang data terbaru dari cloud,
  persis seperti kebiasaan di aplikasi mobile pada umumnya. Tidak aktif
  kalau ada modal yang sedang terbuka atau posisi belum benar-benar di
  paling atas, supaya tidak salah kepicu.
- **Tombol kembali ke atas**: muncul otomatis di pojok kanan bawah begitu
  kamu scroll cukup jauh ke bawah di halaman mana pun, tinggal tap untuk
  langsung kembali ke posisi paling atas.
- **Quick Add lewat URL** (`?quickadd=1`) -- dasar buat integrasi Back Tap
  di iPhone (lihat bagian 4a), membuka aplikasi langsung ke modal Catat
  Transaksi yang sama persis dengan tombol "+" biasa.
- **Wawasan Keuangan** (Dashboard, di bawah kartu ringkasan): kartu wawasan
  otomatis dari data yang sudah ada (peringatan anggaran vs laju bulan
  berjalan, kategori pengeluaran yang naik signifikan vs rata-rata 3 bulan,
  tingkat menabung vs bulan lalu, proyeksi pengeluaran akhir bulan) --
  instan & gratis, dihitung langsung di browser tanpa panggilan API apa pun.
- **Rekomendasi AI** (Dashboard, tepat di bawah Wawasan Keuangan): analisis
  lebih dalam dari Claude berdasarkan ringkasan keuangan bulan berjalan,
  otomatis diperbarui setiap ada transaksi baru (dengan jeda minimal 3
  menit antar panggilan otomatis, plus tombol refresh manual kapan saja).
  **Opsional** -- butuh setup tambahan sekali saja, lihat bagian 11 di bawah.

## 6. Peningkatan profesional & keamanan

Beberapa langkah pengerasan (*hardening*) berikut ditambahkan supaya aplikasi
lebih layak dipakai sehari-hari, bukan cuma prototipe:

- **Privasi**: `<meta name="robots" content="noindex, nofollow, noarchive">`
  ditambahkan di `index.html`, plus file `robots.txt` sebagai lapisan kedua.
  Ini aplikasi PRIBADI (data keuangan + login) — bukan situs publik — jadi
  sengaja diblokir total dari mesin pencari walau URL deploy-nya somehow
  ketahuan orang lain.
- **Header keamanan** (`_headers`, khusus efeknya kalau di-hosting di
  Netlify): Content-Security-Policy (dibatasi persis ke domain yang benar-
  benar dipakai index.html — Tailwind CDN, jsdelivr, cdnjs, Google Fonts,
  Wikimedia untuk logo bank/e-wallet, dan project Supabase kamu),
  `X-Frame-Options: DENY` (cegah situs lain nge-iframe halaman ini demi
  clickjacking), `Referrer-Policy`, `Permissions-Policy` (matikan akses
  kamera/mikrofon/lokasi yang memang tidak dipakai app ini).
  **Kalau ada yang aneh setelah deploy** (misal ada resource yang gagal
  dimuat), coba hapus dulu file `_headers` untuk isolasi apakah itu
  penyebabnya.
- **Aksesibilitas**: semua 8 modal sekarang punya `role="dialog"` +
  `aria-modal="true"`, tombol ber-ikon-saja (close modal, navigasi, tombol
  catat transaksi) dapat `aria-label` supaya pembaca layar (screen reader)
  tahu fungsinya, dan tombol **Escape** sekarang menutup modal yang sedang
  terbuka.
- **Toast pakai `aria-live="polite"`** supaya notifikasi sukses/error juga
  terbaca oleh pembaca layar, tidak cuma yang terlihat.

## 7. Peta fitur → tabel Supabase

| Fitur di aplikasi | Tabel Supabase | Catatan |
|---|---|---|
| Login/Daftar | `auth.users` (bawaan Supabase Auth) | email + password |
| Dashboard, ringkasan saldo & grafik | `transactions`, `budgets`, `assets` | digabung lewat `getSyncData()` |
| Transaksi (tambah/edit/hapus/filter/cari/ekspor CSV) | `transactions` | ekspor CSV terjadi di browser, tidak menyentuh Supabase |
| Budget bulanan | `budgets` | disimpan per (user, bulan, kategori) |
| Aset/Investasi | `assets` | |
| Pengaturan → daftar akun & kategori kustom | `settings` | disimpan sebagai satu JSON per user |
| Pengaturan → **profil (nama, no. HP, bio)** | `settings` | field `profile` di dalam JSON yang sama |
| Ikon/logo kustom akun | `custom_icons` | termasuk gambar hasil upload (base64) |
| **Foto profil** | `custom_icons` | disimpan dengan key khusus `__myfinance_profile_avatar__`, terpisah per user (RLS) |
| **Transaksi Berulang** (template) | `recurring_transactions` | transaksi NYATA hasil auto-catat tetap masuk ke `transactions` seperti biasa |
| **Riwayat performa Aset** | `assets` (kolom `value_history`) | array JSON `{tanggal, nilai}`, bertambah tiap kali nilai diperbarui |

Setiap tabel dibatasi dengan **Row Level Security**: query dari browser
(pakai anon key) hanya bisa menyentuh baris milik user yang sedang login —
bukan karena kode di sisi client "sopan" memfilter `user_id`, tapi karena
Supabase yang menegakkannya di level database. Ini juga yang membuat foto
profil aman disimpan dengan key yang SAMA (`__myfinance_profile_avatar__`)
untuk semua user — RLS menjamin tiap user cuma bisa baca/ubah/hapus baris
miliknya sendiri, walau key-nya identik.

## 8. Riwayat bug yang sudah diperbaiki

- **Quick Add (`?quickadd=1`) kadang cuma membuka web tanpa memunculkan
  modal** — dua penyebab sekaligus: (1) pemicunya ditaruh di baris PALING
  AKHIR dari rangkaian panjang render dashboard/laporan/grafik; kalau ada
  satu saja dari render itu gagal karena sebab apa pun, pemicunya tidak
  pernah tercapai walau dashboard-nya sendiri kelihatan normal-normal saja.
  Sekarang dipindah ke titik paling awal yang sebenarnya sudah cukup (segera
  setelah daftar akun & kategori siap), dan dibungkus try/catch supaya
  kegagalan di bagian lain tidak akan pernah lagi ikut menggagalkannya.
  (2) Kalau Shortcut/Safari cuma membawa tab yang SUDAH terbuka ke depan
  (bukan reload halaman penuh), kode lama cuma mengecek parameter URL SEKALI
  saat skrip pertama kali jalan, jadi tidak "sadar" ada permintaan baru.
  Sekarang ikut dicek ulang lewat event `pageshow` (yang tetap terpicu baik
  saat reload penuh maupun saat tab lama dihidupkan lagi dari cache).

- **Foto profil/ikon akun kadang gagal tersinkron ke cloud** — sebelumnya
  foto diunggah apa adanya (bisa sampai hampir 1MB mentah, jadi ~1.3MB+
  setelah di-base64 dalam satu payload), yang lebih rawan gagal tersinkron
  ke Supabase dibanding logo akun yang biasanya jauh lebih kecil secara
  alami. Sekarang semua gambar (foto profil maupun ikon akun) otomatis
  dikecilkan & dikompres di browser (maks 480px sisi terpanjang, JPEG 82%)
  sebelum diunggah -- hasilnya jauh lebih kecil (biasanya puluhan-ratusan KB)
  dan jauh lebih andal tersinkron. Batas ukuran file mentah yang boleh
  dipilih juga dinaikkan dari 1MB ke 8MB karena kompresinya otomatis.

- **Ikon next/prev bulan di Kalender tidak muncul (kotak kosong)** — FullCalendar
  memuat ikon panah tombolnya sendiri lewat font ikon custom yang di-encode
  sebagai `data:` URI (bukan file terpisah). Header keamanan `_headers` yang
  ditambahkan di versi sebelumnya membatasi `font-src` tanpa mengizinkan
  `data:`, jadi browser diam-diam MEMBLOKIR font ikon itu — tombolnya tetap
  ada dan berfungsi, tapi kotak ikonnya kosong. Sudah diperbaiki dengan
  menambahkan `data:` ke `font-src` di `_headers`. Ini juga sebabnya bug ini
  sempat lolos dari pengujian sebelumnya — pengujian otomatis yang dipakai
  menjalankan JavaScript-nya saja, bukan benar-benar merender CSS/font/CSP
  di browser sungguhan, jadi kelas bug seperti ini cuma ketahuan dari
  screenshot langsung.
- **Tombol next/prev bulan di Kalender "ngebug"** (kadang balik lagi ke
  bulan ini sendiri) — kalender selalu dibuat ulang dari nol setiap kali
  jendela browser resize (termasuk resize kecil, mis. address bar HP yang
  muncul/hilang saat scroll), dan pembuatan ulang itu tidak pernah mengingat
  bulan yang sedang dilihat, jadi selalu "reset" balik ke bulan ini. Ditambah,
  pindah ke bulan dengan jumlah baris minggu berbeda (5 vs 6 baris) mengubah
  tinggi halaman cukup untuk memicu scrollbar muncul/hilang, yang di banyak
  browser ikut memicu event resize itu sendiri — jadi klik "next" bisa terasa
  "melompat balik" tak lama setelah diklik. Sekarang kalender mengingat
  tanggal yang sedang dilihat setiap kali di-render ulang, dan resize kecil
  yang tidak mengubah tampilan mobile/desktop cukup menyesuaikan ukuran saja
  tanpa membuat ulang kalendernya.
- **PENYEBAB UTAMA stuck di "Memeriksa sesi login..."**: layar loading
  (`#authGate`) disembunyikan dengan menambah class `hidden`, tapi elemen ini
  punya atribut `style="display:flex"` yang ditulis langsung (inline). Aturan
  CSS lewat atribut `style=""` **selalu menang** melawan class apa pun
  (termasuk `hidden` bawaan Tailwind), berapa pun urutannya di stylesheet —
  jadi secara visual layar loading **tidak akan pernah benar-benar hilang**,
  walaupun proses pengecekan sesi di baliknya sudah selesai sempurna. Elemen
  ini sekarang dihapus total dari halaman (bukan cuma disembunyikan) begitu
  proses cek sesi selesai. Kasus serupa di `#loginView` turut diperbaiki.
- **Stuck permanen di "Memeriksa sesi login..." (penyebab lain, versi
  sebelumnya)** — ada variabel yang dipakai (lewat `initLoginForm()`)
  sebelum baris deklarasinya sendiri sempat jalan (*temporal dead zone*),
  yang selalu melempar error di setiap kali halaman dibuka. Ditambah, kalau
  CDN Chart.js gagal dimuat, baris setup tema chart juga ikut melempar error
  dan menghentikan proses yang sama. Keduanya sudah diperbaiki, dan sebagai
  jaring pengaman tambahan, sekarang ada penanganan: kalau ada error tak
  terduga *apa pun* (atau proses macet lebih dari 12 detik), layar loading
  akan berubah jadi pesan error + tombol "Muat Ulang" — bukan diam
  selamanya seperti sebelumnya.
- **Aplikasi bisa "diam" di layar loading** — inisialisasi dashboard dulu
  dipasang lewat `window.onload`, padahal dipanggil SETELAH pengecekan sesi
  login async selesai, sehingga event `load` browser bisa saja sudah lebih
  dulu selesai duluan dan `window.onload` tidak pernah terpanggil. Sekarang
  diganti jadi pemanggilan fungsi `initApp()` langsung dari alur login/sesi.
- **Pengaturan lama bisa bikin aplikasi error** — kalau data pengaturan yang
  tersimpan di cloud belum punya field terbaru, bagian lain kode bisa mencoba
  mengakses field yang tidak ada dan melempar error diam-diam. Sekarang ada
  pemeriksaan (`ensureSettingsShape()`) yang dijalankan ulang setiap kali
  data dari cloud selesai dimuat, bukan cuma sekali di awal.
- **Nama akun/kategori dengan tanda kutip bisa merusak tampilan** — memilih
  kategori transaksi atau akun tujuan Transfer yang namanya mengandung tanda
  kutip (`'` atau `"`) bisa merusak tombolnya. Sekarang di-escape dengan
  benar, konsisten dengan bagian lain aplikasi.
- **Reset data saat ganti akun di perangkat yang sama** — karena login/logout
  tidak lagi memuat ulang seluruh halaman, ditambahkan pengosongan data di
  memori (`resetAppState()`) setiap kali kembali ke layar login.

## 9. Yang perlu kamu tahu

- User baru otomatis diberi 7 akun contoh (Tunai, BCA, Mandiri, GoPay, OVO,
  ShopeePay, Bibit) sebagai starting point di tabel `settings` — supaya form
  transaksi langsung bisa dipakai tanpa harus setting akun dulu. Ini
  sepenuhnya bisa diedit/dihapus dari halaman Pengaturan.
- Selain daftar akun contoh di atas, **tidak ada data dummy lain** —
  transaksi, budget, dan aset user baru mulai dari kosong.
- Kolom `tanggal` transaksi pakai tipe `date` (tanpa jam), sama seperti
  input form aslinya (`<input type="date">`).
- Ikon kustom akun & foto profil berupa gambar upload disimpan sebagai
  base64 di kolom `jsonb` — cukup untuk logo/ikon/foto ukuran wajar, tapi
  hindari upload gambar beresolusi sangat besar (dibatasi maks 1MB).
- **Kustomisasi ikon/warna/gambar per kategori** (tombol palet di halaman
  Pengaturan > Kategori) juga disimpan di tabel `custom_icons` yang sama —
  lewat key khusus berawalan `__myfinance_category_style__`, sama seperti
  foto profil pakai `__myfinance_profile_avatar__`. Jadi **tidak perlu
  migrasi SQL tambahan** kalau kamu sudah menjalankan skema di bawah ini.
- **Tailwind CSS dimuat dari CDN** (`cdn.tailwindcss.com`), yang menurut
  dokumentasi Tailwind sendiri **tidak disarankan untuk produksi jangka
  panjang** (lebih lambat, ukuran file CSS tidak teroptimasi) — dipilih di
  sini demi kemudahan "1 file, tanpa proses build". Kalau nanti mau upgrade
  ke setup build Tailwind yang proper (di komputer kamu sendiri, karena
  butuh `npm`/koneksi internet saat build), tanya saja dan bisa disiapkan
  konfigurasinya.

## 10. Kalau ada error saat login/memuat data

- **"Gagal memuat data dari cloud"** → cek koneksi internet, dan pastikan
  `sql/schema.sql` sudah dijalankan lengkap (kelima tabelnya) di project
  Supabase kamu.
- **"Email atau password salah"** → pastikan sudah mendaftar dulu lewat tab
  **Daftar**.
- **"Sesi login tidak ditemukan"** saat menyimpan sesuatu → sesi kamu
  kadaluarsa, silakan logout lalu login ulang.
- **Ada yang gagal dimuat / blank setelah deploy** → coba hapus dulu file
  `_headers` untuk memastikan bukan Content-Security-Policy yang jadi
  penyebabnya, lalu deploy ulang.
- Buka **Console** browser (klik kanan → Inspect → tab Console) untuk lihat
  detail error teknis kalau ada masalah yang tidak jelas pesannya.

## 11. Setup "Rekomendasi AI" (opsional)

Fitur **Rekomendasi AI** di Dashboard memanggil Claude (Anthropic) lewat
internet untuk menganalisis keuangan bulan berjalan kamu. Ini **opsional**
-- kalau belum di-setup, section-nya cuma menampilkan pesan "belum aktif"
dan sisa aplikasi tetap berjalan normal (termasuk "Wawasan Keuangan" yang
rule-based di atasnya, yang selalu jalan tanpa setup apa pun).

**Kenapa butuh Edge Function, tidak langsung dari `index.html` saja?**
API key Anthropic harus dirahasiakan di server. Kalau ditaruh di kode
`index.html`, siapa pun yang buka DevTools browser bisa mencurinya dan
memakainya atas nama akun Anthropic-mu. Edge Function berjalan di server
Supabase, menyimpan key itu lewat "secret" yang tidak pernah dikirim ke
browser.

**Langkah setup (sekali saja):**

1. Punya API key Anthropic (https://console.anthropic.com → **API Keys**),
   biasanya diawali `sk-ant-...`.
2. Install Supabase CLI kalau belum ada:
   `npm install -g supabase` (butuh Node.js) atau lihat cara lain di
   https://supabase.com/docs/guides/cli
3. Login & hubungkan ke project-mu (jalankan di folder project ini, yang
   sudah ada folder `supabase/functions/analyze-finance/`):
   ```
   supabase login
   supabase link --project-ref <project-ref-kamu>
   ```
   `<project-ref-kamu>` bisa dilihat di URL dashboard Supabase-mu
   (`https://app.supabase.com/project/<project-ref>`).
4. Simpan API key sebagai secret (JANGAN ditaruh di `index.html` atau kode
   apa pun yang ke browser):
   ```
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
   ```
5. Deploy Edge Function-nya:
   ```
   supabase functions deploy analyze-finance
   ```
6. Selesai! Buka Dashboard, section "Rekomendasi AI" akan otomatis mencoba
   memanggilnya. Kalau masih menampilkan "belum aktif", cek log lewat
   `supabase functions logs analyze-finance` untuk lihat error detailnya.

**Soal biaya:** setiap panggilan ke Claude dikenakan biaya sesuai tarif
Anthropic (model default yang dipakai: **Claude Haiku**, model tercepat
& termurah, cukup untuk menganalisis ringkasan angka bulanan). Frekuensi
panggilan otomatis dibatasi jeda minimal 3 menit per sesi, jadi biayanya
tetap terkendali meski kamu aktif mencatat banyak transaksi. Mau pakai
model lain (mis. Sonnet untuk analisis lebih dalam)? Tinggal ganti nilai
`model` di `supabase/functions/analyze-finance/index.ts`, lalu deploy
ulang (langkah 5).


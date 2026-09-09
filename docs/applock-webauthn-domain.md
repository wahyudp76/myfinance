# Kunci Aplikasi: RP ID WebAuthn dan perpindahan domain

Berlaku sejak **v107**. Ini aturan biometrik untuk **App Lock**, bukan pengganti
login akun Supabase. Kunci UI melindungi layar saat perangkat dipinjam; bukan
perlindungan terhadap orang yang menguasai DevTools/perangkat.

## Kebijakan RP ID

Satu sumber nilai RP API adalah `appLockRpId()` di `app.src.js`, yang
mengembalikan **`window.location.hostname` persis**:

| Alamat aplikasi | `create().publicKey.rp.id` dan `get().publicKey.rpId` |
| --- | --- |
| `https://wahyudp76.github.io/myfinance/` | `wahyudp76.github.io` |
| `http://localhost:8123/` | `localhost` |
| `https://uang.example.test/finance/` (contoh domain kustom) | `uang.example.test` |
| `https://app.example.com/` | `app.example.com`, **bukan** `example.com` |

- RP ID tidak mengandung skema, port, maupun path `/myfinance`.
- Tidak boleh dipersempit/diperluas diam-diam ke domain lain, termasuk induk
  `github.io`. Hardcode `wahyudp76.github.io` untuk semua hosting juga salah:
  localhost, preview, dan domain kustom bukan domain tersebut.
- HTTPS diperlukan; `localhost` merupakan pengecualian pengembangan. Gunakan
  `localhost`, bukan `127.0.0.1`, untuk harness WebAuthn.
- Metadata dari cloud/backup **tidak pernah** dipakai menentukan nilai RP pada
  panggilan API. Browser/authenticator tetap memeriksa pengikatan RP sebenarnya.

Sebelum v107, kedua nilai itu tidak dikirim sehingga browser memakai hostname
sebagai default. Nilai eksplisit sekarang **sama** dengan default lama.
Kredensial existing di `wahyudp76.github.io` tidak perlu didaftarkan ulang.

## Batas yang tidak dapat dihilangkan hanya dengan menambahkan `rp.id`

Kredensial WebAuthn terikat pada RP saat dibuat. Mengubah `rp.id` tidak menulis
ulang pengikatan kredensial yang sudah ada. Memaksakan RP GitHub Pages dari
domain kustom yang tidak berhubungan akan ditolak browser pada alur standar.

**v107 tidak mengimplementasikan Related Origin Requests (ROR) maupun migrasi
passkey lintas domain.** Dukungan dan konfigurasi lintas-origin semacam itu
memerlukan rancangan tersendiri. Jalur yang dipakai aplikasi ini tetap
sederhana: login akun yang sama, PIN bila diminta, lalu daftar ulang biometrik.
Jangan menjanjikan biometrik otomatis ikut pindah domain.

Mengganti path atau port tidak mengubah RP apabila hostname tetap sama. Namun,
**localStorage dibatasi origin**, sehingga perubahan port/skema atau pembersihan
storage bisa menghilangkan penanda perangkat. Ketersediaan/sinkronisasi passkey
bergantung authenticator; daftar di cloud bukan bukti passkey tersedia di
setiap browser/perangkat.

## Bentuk data dan kompatibilitas

Konfigurasi cloud `appSettings.app_lock` tetap mempertahankan PIN, kebijakan
idle, dan model multi-perangkat v99. Entri baru:

```js
{
  id: 'base64-rawId',
  label: 'iPhone',
  added_at: '2026-09-09T00:00:00.000Z',
  rp_id: 'wahyudp76.github.io'
}
```

Penanda lokal `localStorage['myfinance_applock_cred']`:

```js
{ userId: 'id-akun', credentialId: 'base64-rawId', rpId: 'wahyudp76.github.io' }
```

- Selalu baca melalui `normalizeLockConfig()`, bukan JSON mentah.
- Entri lama tanpa `rp_id` dinormalkan menjadi `rp_id: ''` (**domain tidak
  diketahui**). Tidak diasumsikan milik GitHub Pages maupun domain tempat backup
  dipulihkan. Bentuk satu-slot `credential_id` dan daftar v99 tetap diterima.
- Penanda lokal lama tanpa `rpId` tetap kompatibel. Setelah assertion yang valid,
  penanda lokal diperbarui dengan hostname sekarang. Cloud legacy tidak ditulis
  ulang secara spekulatif saat gerbang boot masih mengandalkan cache.
- `biometricCredentialIds(cfg, rpId)` memfilter kredensial **yang diketahui**
  berasal dari domain lain. Kredensial legacy yang belum diketahui domainnya
  tetap dapat dicoba; browser memeriksa RP aslinya. Pemanggil tanpa argumen RP
  tetap mendapat semua ID demi kompatibilitas API domain lama.
- Filter yang sama dipakai untuk `allowCredentials`, `excludeCredentials`, dan
  status UI. Penanda lokal yang diketahui berasal dari domain lain juga ditolak,
  termasuk ketika klien lama menghilangkan metadata cloud saat menulis settings.
- Daftar eligible kosong **tidak dikirim** ke `get()`: `allowCredentials: []`
  berarti semua discoverable credential, bukan tidak ada kredensial yang boleh.
- Respons `get()` kosong atau `rawId` di luar daftar eligible tidak membuka
  overlay dan tidak mengubah penanda lokal. Kegagalan biometrik tidak dihitung
  sebagai kegagalan PIN.
- `credential_id` tetap cermin entri pertama untuk klien lama; tidak dihapus.
  Tidak ada migrasi tabel SQL atau reset PIN.

Daftar pendaftaran tetap dibatasi **10 entri total** seperti v99. Pendaftaran
baru di domain lain memakai satu slot juga. Perilaku batas lama dipertahankan:
entri terbaru ditaruh di depan dan entri paling lama bisa tergeser bila penuh.
Jadi jaminan kredensial asal tidak tertimpa berlaku selama kapasitas masih cukup;
ini bukan penyimpanan lintas-domain tak terbatas. Tombol **Matikan di semua
perangkat** memang mencabut seluruh daftar (termasuk domain lain).

## Panduan jika benar-benar pindah domain

1. Pastikan bisa login ke akun Supabase yang sama dan ingat PIN. Buat cadangan
   data sesuai prosedur biasa; backup tidak memindahkan private key WebAuthn.
2. Siapkan hosting HTTPS domain baru. Perbarui pengaturan URL situs/redirect
   autentikasi Supabase sesuai metode login yang dipakai. Jangan mengganti
   `appLockRpId()` agar mengembalikan domain lama atau mengambil RP dari backup.
3. Buka domain baru dan login ke akun yang sama. Jika diminta kunci aplikasi,
   gunakan **PIN**. Jika lupa PIN, gunakan pemulihan melalui password akun.
4. Buka **Pengaturan → Kunci Aplikasi → Atur → Aktifkan** pada baris biometrik.
   Daftarkan ulang di setiap perangkat/browser yang digunakan. Teks di baris itu
   menyebut hostname yang sedang berlaku dan pendaftaran domain lain bila diketahui.
5. Periksa biometrik domain baru bisa membuka kunci. Selama kapasitas daftar
   mencukupi, pendaftaran ini menambah entri, bukan menghapus domain lama.
   Pertahankan akses domain lama selama transisi bila dibutuhkan; menghapus
   domain lama bukan syarat pendaftaran di domain baru.

Untuk legacy tanpa metadata, aplikasi mungkin hanya tahu ada pendaftaran di
perangkat lain, bukan domain asalnya. Jika tidak ada penanda lokal, tetap masuk
lewat PIN dan gunakan menu pendaftaran. Jangan menganggap flag cloud
`biometric_enabled: true` berarti biometrik tersedia di browser sekarang.

## Pagar regresi

```bash
node --test tests/unit/app-lock-domain.test.js tests/unit/app-lock-rpid.test.js
node scripts/verify-applock-rpid.mjs
APPLOCK_URL=http://localhost:8123/ node scripts/verify-applock-biometric.mjs
```

`verify-applock-rpid.mjs` menjalankan **31 cek** di Chromium dengan virtual
platform authenticator CDP. Origin localhost, origin HTTPS produksi, dan origin
HTTPS kustom disimulasikan menggunakan aset dari checkout lokal. Seluruh
request Supabase diberi stub; service worker diblokir supaya tidak ada jalur
network di luar intersepsi. **Tidak menghubungi atau menulis produksi.**

Menguji parameter API sekaligus RP di authenticator dan kenaikan signature
counter; bukan hanya memeriksa string sumber. Kredensial legacy benar-benar
dibuat tanpa `rp.id`, kemudian dipakai membuka aplikasi setelah reload.
Harness ini ikut workflow **E2E Harness**. Pengujian sensor virtual bukan
sertifikasi bahwa seluruh model iPhone/Android/browser fisik telah diuji.

## Referensi spesifikasi/API

- [MDN — opsi pendaftaran, `rp.id`](https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions#rp)
- [MDN — opsi autentikasi, `rpId` dan `allowCredentials`](https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialRequestOptions)
- [W3C WebAuthn — Relying Party Identifier](https://www.w3.org/TR/webauthn-2/#relying-party-identifier)

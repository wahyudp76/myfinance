// Service Worker MyFinance
// =========================
// TUJUAN: (1) supaya app ini memenuhi syarat "installable PWA" yang sesungguhnya di
// Chrome/Android (salah satu syarat wajibnya: ada service worker terdaftar dengan
// fetch handler -- tanpa ini, prompt "Tambahkan ke Layar Utama" bisa tidak muncul sama
// sekali di sebagian browser meski manifest.json & ikon sudah lengkap), dan (2) bikin
// load kedua-dst jadi jauh lebih cepat (file2 besar -- app + vendor lokal --
// tidak perlu didownload ulang tiap buka app; sejak v59 SEMUA vendor lokal).
//
// PENTING -- supaya TIDAK mengulang masalah "file lama nyangkut di cache" yang sudah
// beberapa kali kejadian di project ini (soal GitHub Pages/browser cache):
//   - index.html (dokumen utama) SELALU dicoba ambil dari NETWORK dulu, cache cuma
//     dipakai sebagai fallback kalau benar2 offline. Jadi versi terbaru yang kamu
//     upload akan SELALU langsung kepakai selama ada koneksi internet -- tidak akan
//     pernah "nyangkut" di versi lama.
//   - File vendor yang jarang berubah (Tailwind, Chart.js, dst -- sejak v59
//     semuanya lokal di vendor/) dipakai cache
//     dulu (supaya cepat) TAPI tetap di-update di background tiap kunjungan
//     (stale-while-revalidate) -- jadi tetap ikut update, cuma tidak bikin loading
//     pertama nunggu network.
//   - Ganti CACHE_VERSION di bawah kalau suatu saat pola caching ini sendiri perlu
//     diubah -- versi lama otomatis dibersihkan saat versi baru aktif.

// v3: CSS aplikasi dipindah dari inline <style> di index.html ke file terpisah
// styles.css (Phase 7, "split monolith") -- ditambahkan ke precache list di bawah.
// v69: guard stabilitas sinkronisasi (generasi commit, null-safe DOM, cancel saat
// logout) -> app.js berubah, bump versi supaya pengguna mengambil bundle baru.
// v70: fix clear cache data saat logout, DATA_CACHE tidak lagi terhapus tiap deploy,
// navigasi hanya cache respons OK, escape badge kategori aset.
// v85: pagination riwayat detail akun & kategori (pengeluaran/pemasukan).
// v86: fix logo platform aset tidak muncul -- ikon self-hosted icons/platforms/*
// dipulihkan & di-precache, modul ikon/logo yang terlewat (bank-icons, asset-icons,
// account-currency, category-style, dates, format, sanitize, slugify, platform-logos
// domain + service) dilengkapi agar kunjungan pertama offline tetap utuh.
// v87: pembulatan logo mengikuti outline box-nya per logo (rounded-[inherit] di
// renderAccountIconObj + overflow-hidden di kotak logo kartu aset/detail/modal akun
// + saran pencarian akun/platform) -> app.js, index.html, css/tailwind.css berubah.
// v90: nav bawah mobile dibuat jauh lebih transparan ala liquid glass (dark
// alpha 0.90 -> 0.45 + blur 28px; light 0.72 -> 0.62; chip aktif 0.14 -> 0.18)
// -> styles.css berubah.
// v91: perapihan repo (13 file SQL pindah ke sql/migrations/, PILOT-MIGRASI-v71.md
// ke docs/) -> satu-satunya file precache yang berubah byte-nya adalah
// src/services/supabase/paging.js (komentar path referensi saja, nol perilaku),
// tetap di-bump supaya cache user konsisten dgn isi repo.
const CACHE_VERSION = 'myfinance-v141'; // v109: refactor style-src tanpa atribut style inline
// Cache DATA user (GET /rest/v1) -- sengaja TIDAK ikut versi CACHE_VERSION agar
// tidak terbuang tiap deploy; dibersihkan eksplisit saat logout.
// v100: dinaikkan v1 -> v2 SEKALI supaya sampah yang sudah terlanjur menumpuk di
// perangkat pengguna (akibat bug scope di bawah) ikut terhapus oleh pembersih di
// handler activate -- 'myfinance-data-v1' tidak lagi sama dengan CACHE_VERSION
// maupun DATA_CACHE, jadi otomatis kena caches.delete().
const DATA_CACHE = 'myfinance-data-v2';

// Batas atas jumlah entri cache data. Pertahanan berlapis: scope yang benar sudah
// menghentikan pertumbuhan liar, tapi query yang mengandung parameter berubah
// (mis. budgets?bulan=eq.2026-09) tetap menambah entri pelan-pelan seumur pakai.
// Dengan batas ini pertumbuhannya TERBUKTI berhingga, bukan cuma "harusnya kecil".
const DATA_CACHE_MAX = 60;

// ---------------------------------------------------------------------------
// SCOPE CACHE DATA = IDENTITAS USER, BUKAN POTONGAN TOKEN
// ---------------------------------------------------------------------------
// BUG v99 (ditemukan audit perawatan 2026-09-08): scope dulu dihitung dari
// `auth.slice(-24)` -- 24 karakter TERAKHIR header Authorization. Pada JWT
// Supabase itu ekor TANDA TANGAN, yang BERUBAH setiap kali token di-refresh
// (default tiap 1 jam). Akibat nyata yang sudah dibuktikan lewat E2E:
//   1. tiap refresh token melahirkan namespace cache BARU -> entri lama jadi
//      sampah abadi (DATA_CACHE sengaja tidak ikut dihapus tiap deploy), jumlah
//      entri tumbuh tanpa batas sampai berisiko kena kuota penyimpanan browser;
//   2. begitu token baru terbit, cache lama tak pernah kena lagi -> offline
//      tepat setelah refresh = MISS = "Gagal memuat data dari cloud", padahal
//      datanya baru saja disimpan beberapa menit sebelumnya.
// Perbaikan: pakai klaim `sub` (user id) yang STABIL sepanjang akun sama.
// Tujuan keamanan aslinya tetap terpenuhi: dua akun berbeda punya `sub` berbeda,
// jadi tidak pernah berbagi entri cache.
// Catatan: tanda tangan JWT sengaja TIDAK diverifikasi di sini -- ini cuma kunci
// partisi cache lokal, bukan gerbang otorisasi (otorisasi tetap di server lewat
// RLS). Siapa pun yang bisa memalsukan isi localStorage sudah menguasai origin
// ini sepenuhnya dan bisa membaca Cache Storage langsung.
function dataCacheScope(authHeader) {
  const auth = String(authHeader || '');
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length === 3 && parts[1]) {
    try {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const bin = atob(padded);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      if (payload && typeof payload.sub === 'string' && payload.sub) return payload.sub;
    } catch (_e) {
      // token bukan JWT yang bisa dibaca -> jatuh ke cadangan di bawah
    }
  }
  // Cadangan untuk token non-JWT (mis. stub di harness E2E): perilaku lama.
  return token.slice(-24);
}

// Simpan ke cache data sambil menjaga jumlah entri tetap di bawah DATA_CACHE_MAX.
// cache.keys() mengembalikan entri sesuai urutan penyisipan, jadi yang dibuang
// adalah yang paling lama masuk (FIFO).
async function putDataCacheBounded(cache, key, res) {
  await cache.put(key, res);
  const keys = await cache.keys();
  const lebih = keys.length - DATA_CACHE_MAX;
  for (let i = 0; i < lebih; i += 1) await cache.delete(keys[i]);
}

// App shell + file vendor CDN yang dipakai index.html -- disimpan ke cache saat
// service worker pertama kali terpasang, supaya kunjungan berikutnya (termasuk saat
// offline) tetap bisa langsung tampil tanpa nunggu semuanya didownload ulang.
//
// v2: Supabase client sekarang dimuat lewat ES module (src/auth/* + src/services/
// supabase/client.js -> jsdelivr +esm), bukan lagi <script classic src="...">
// -- lihat "AUTH MODULE BRIDGE" di index.html. URL classic-nya diganti dengan
// modul-modul lokal itu + URL +esm yang sekarang benar-benar dipakai.
const PRECACHE_URLS = [
  './',
  './index.html',
  './app.js', // blok classic monolit yang diekstrak dari index.html (v54)
  // v103: satu bundel ESM menggantikan boot.js + 71 modul src/ yang dulu
  // masing-masing jadi satu entri di sini. Selain memangkas 71 request saat
  // kunjungan pertama, ini juga memangkas 71 fetch saat INSTALL service worker.
  './boot.bundle.js',
  './manifest.json',
  './styles.css',
  './fonts/plus-jakarta-sans-latin.woff2',
  './css/tailwind.css',
  './css/fontawesome-all.min.css',
  './webfonts/fa-solid-900.woff2',
  './webfonts/fa-brands-400.woff2',
  // v59 (2026-09-02): SEMUA library JS pihak ketiga kini vendored LOKAL di
  // vendor/ (pinned): Chart.js 4.5.1, datalabels 2.0.0, FullCalendar 6.1.10,
  // supabase-js 2.113.0 (+ polyfill esm-node-*). URL CDN (jsdelivr/esm.sh)
  // DIHAPUS -- nol origin pihak ketiga di jalur kritis; versi terpin
  // (sebelumnya chart.js & supabase-js@2 FLOATING = bisa berubah diam-diam).
  './vendor/chartjs-4.5.1.min.js',
  './vendor/chartjs-plugin-datalabels-2.0.0.min.js',
  './vendor/fullcalendar-6.1.10.min.js',
  // v59: supabase-js bundle lokal + polyfill Node yang dibutuhkannya (rantai
  // import relatif ./esm-node-*.mjs -- path import absolut esm.sh sudah
  // ditulis ulang saat vendoring, lihat vendor/README.md). Keenam file ini
  // PERSIS yang diimpor src/services/supabase/client.js.
  './vendor/supabase-js-2.113.0.bundle.min.mjs',
  './vendor/esm-node-process.mjs',
  './vendor/esm-node-buffer.mjs',
  './vendor/esm-node-events.mjs',
  './vendor/esm-node-tty.mjs',
  './vendor/esm-node-async_hooks.mjs',
  // Semua modul runtime app (domain/ui/services) -- precache LENGKAP sejak install
  // supaya app utuh walau kunjungan pertama langsung offline (audit 2026-09).
  // v86: modul keluarga helper/ikon yang sebelumnya TERLEWAT dari precache --
  // semuanya di-import index.html di jalur kritis (adopsi __fmt/__dates/__sanitize/
  // __slugify/__catstyle/__assetIcon/__bankIcon/__accountCurrency/__platformLogos),
  // jadi tanpa ini "kunjungan pertama lalu offline" gagal boot di tengah jalan.
  // v86: logo platform aset self-hosted (lihat src/domain/bank-icons.js) --
  // sama statusnya dengan icons/banks/*: aset statis jalur kritis tab Aset.
  './icons/platforms/ajaib.ico',
  './icons/platforms/bareksa.svg',
  './icons/platforms/bibit.svg',
  './icons/platforms/danamas-stabil.png',
  './icons/platforms/goto.svg',
  './icons/platforms/indodax.png',
  './icons/platforms/mirae.svg',
  './icons/platforms/pintu.png',
  './icons/platforms/pluang.png',
  './icons/platforms/stockbit.svg',
  './icons/platforms/tokocrypto.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // addAll akan gagal semua kalau SATU URL saja gagal -- dipecah per-URL supaya
      // satu vendor yang gagal (mis. lagi down) tidak menggagalkan seluruh precache.
      return Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)));
    }).then(() => self.skipWaiting()) // langsung aktif, tidak nunggu semua tab lama ditutup
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      // v70 BUG FIX: DATA_CACHE dulu ikut terhapus di sini tiap deploy (bertentangan
      // dgn komentar di atas) -> data offline pengguna hilang setiap rilis.
      names.filter((n) => n !== CACHE_VERSION && n !== DATA_CACHE).map((n) => caches.delete(n))
    )).then(() => self.clients.claim())
  );
});

// Logout (atau ganti akun): buang seluruh cache data user supaya tidak pernah
// bisa dibaca oleh sesi berikutnya di perangkat yang sama.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'MYFINANCE_CLEAR_DATA_CACHE') {
    caches.delete(DATA_CACHE);
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/PUT/dst (mis. ke Supabase) dibiarkan lewat apa adanya

  const url = new URL(req.url);

  // Abaikan skema selain http/https -- bisa muncul kalau ada browser extension yang
  // menyisipkan resource (font, script, dst) ke halaman lewat chrome-extension://. Cache API
  // browser cuma dukung http/https, jadi cache.put() di bawah akan throw (Uncaught TypeError)
  // kalau dibiarkan lolos sampai ke situ -- request itu sendiri bukan urusan app ini sama
  // sekali, jadi paling aman dibiarkan lewat apa adanya tanpa campur tangan service worker.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // ============ DATA OFFLINE (Tier-3 #10): GET /rest/v1/* Supabase ============
  // NETWORK-FIRST + fallback cache saat offline (bukan SWR buta: angka keuangan
  // TIDAK boleh basi saat online). Cache key di-scope PER-USER lewat dataCacheScope()
  // -- klaim `sub` JWT, BUKAN potongan token (lihat catatan bug di atas) -- supaya
  // 2 akun di perangkat sama TIDAK pernah berbagi data, sekaligus supaya refresh
  // token tidak melahirkan namespace cache baru;
  // logout membuang seluruh cache data (pesan MYFINANCE_CLEAR_DATA_CACHE).
  if (url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/v1/') && req.method === 'GET') {
    const auth = req.headers.get('authorization') || '';
    if (auth) {
      const scope = encodeURIComponent(dataCacheScope(auth));
      const key = new Request(url.pathname + url.search + (url.search ? '&' : '?') + 'u=' + scope, { method: 'GET' });
      event.respondWith(
        fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(DATA_CACHE).then((cache) => putDataCacheBounded(cache, key, copy));
          }
          return res;
        }).catch(() => caches.match(key).then((cached) => cached || new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } })))
      );
      return;
    }
  }

  // Panggilan Supabase LAINNYA (auth/session/rpc) jangan pernah di-cache.
  if (url.hostname.endsWith('.supabase.co')) return;

  // Dokumen HTML utama (navigasi) -- NETWORK-FIRST. Ini kunci supaya update selalu
  // langsung kepakai selama online; cache cuma jaring pengaman saat offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        // v70 BUG FIX: hanya simpan respons OK -- halaman error (404/503 saat GitHub
        // Pages sedang deploy) sebelumnya ikut di-cache & jadi fallback offline.
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // Aset statis lain (vendor CDN, font, ikon) -- STALE-WHILE-REVALIDATE: langsung
  // balas dari cache kalau ada (cepat), sambil diam2 ambil versi terbaru dari network
  // buat kunjungan BERIKUTNYA. Kalau belum ada di cache sama sekali, tunggu network.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

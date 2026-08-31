// Service Worker MyFinance
// =========================
// TUJUAN: (1) supaya app ini memenuhi syarat "installable PWA" yang sesungguhnya di
// Chrome/Android (salah satu syarat wajibnya: ada service worker terdaftar dengan
// fetch handler -- tanpa ini, prompt "Tambahkan ke Layar Utama" bisa tidak muncul sama
// sekali di sebagian browser meski manifest.json & ikon sudah lengkap), dan (2) bikin
// load kedua-dst jadi jauh lebih cepat (file2 vendor besar dari CDN tidak perlu
// didownload ulang tiap buka app).
//
// PENTING -- supaya TIDAK mengulang masalah "file lama nyangkut di cache" yang sudah
// beberapa kali kejadian di project ini (soal GitHub Pages/browser cache):
//   - index.html (dokumen utama) SELALU dicoba ambil dari NETWORK dulu, cache cuma
//     dipakai sebagai fallback kalau benar2 offline. Jadi versi terbaru yang kamu
//     upload akan SELALU langsung kepakai selama ada koneksi internet -- tidak akan
//     pernah "nyangkut" di versi lama.
//   - File vendor dari CDN (Tailwind, Chart.js, dst) yg jarang berubah dipakai cache
//     dulu (supaya cepat) TAPI tetap di-update di background tiap kunjungan
//     (stale-while-revalidate) -- jadi tetap ikut update, cuma tidak bikin loading
//     pertama nunggu network.
//   - Ganti CACHE_VERSION di bawah kalau suatu saat pola caching ini sendiri perlu
//     diubah -- versi lama otomatis dibersihkan saat versi baru aktif.

// v3: CSS aplikasi dipindah dari inline <style> di index.html ke file terpisah
// styles.css (Phase 7, "split monolith") -- ditambahkan ke precache list di bawah.
const CACHE_VERSION = 'myfinance-v17';

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
  './manifest.json',
  './styles.css',
  './fonts/plus-jakarta-sans-latin.woff2',
  './css/tailwind.css',
  './css/fontawesome-all.min.css',
  './webfonts/fa-solid-900.woff2',
  './webfonts/fa-brands-400.woff2',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0',
  'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
  './src/auth/index.js',
  './src/auth/client.js',
  './src/auth/session.js',
  './src/auth/guards.js',
  './src/auth/lifecycle.js',
  './src/services/supabase/client.js',
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
      names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))
    )).then(() => self.clients.claim())
  );
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

  // Jangan PERNAH campur tangan panggilan ke Supabase (data selalu harus fresh/real-time,
  // dan sebagian bisa berupa auth/session yg tidak boleh ke-cache).
  if (url.hostname.endsWith('.supabase.co')) return;

  // Dokumen HTML utama (navigasi) -- NETWORK-FIRST. Ini kunci supaya update selalu
  // langsung kepakai selama online; cache cuma jaring pengaman saat offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
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

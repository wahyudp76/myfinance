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
const CACHE_VERSION = 'myfinance-v55';
// Cache DATA user (GET /rest/v1) -- sengaja TIDAK ikut versi CACHE_VERSION agar
// tidak terbuang tiap deploy; dibersihkan eksplisit saat logout.
const DATA_CACHE = 'myfinance-data-v1';

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
  // BUG FIX (2026-09-01): baris ini dulu menunjuk ke
  //   https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm
  // padahal app SAMA SEKALI tidak pernah meminta URL itu -- src/services/supabase/
  // client.js (dan semua Edge Function) mengimpor dari esm.sh. Akibatnya dua-duanya
  // rugi: (a) setiap instalasi SW mengunduh satu bundel besar yang tidak akan pernah
  // dipakai, dan (b) library yang BENAR-BENAR dibutuhkan tidak pernah ikut precache,
  // sehingga skenario "kunjungan pertama lalu langsung offline" -- yang justru jadi
  // alasan blok precache ini ada -- tetap gagal boot karena client Supabase tak
  // termuat. URL di bawah kini PERSIS sama dengan yang diimpor client.js.
  'https://esm.sh/@supabase/supabase-js@2',
  './src/auth/index.js',
  './src/auth/client.js',
  './src/auth/session.js',
  './src/auth/guards.js',
  './src/auth/lifecycle.js',
  './src/services/supabase/client.js',
  // Semua modul runtime app (domain/ui/services) -- precache LENGKAP sejak install
  // supaya app utuh walau kunjungan pertama langsung offline (audit 2026-09).
  './src/domain/accounts.js',
  './src/domain/asset-flows.js',
  './src/domain/assets.js',
  './src/domain/backup.js',
  './src/domain/app-info.js',
  './src/domain/export-csv.js',
  './src/domain/market-sync.js',
  './supabase/functions/_shared/price-sources.js',
  './src/domain/budgets.js',
  './src/domain/calendar.js',
  './src/domain/categories.js',
  './src/domain/chart-hud.js',
  './src/domain/chart-labels.js',
  './src/domain/chart-palette.js',
  './src/domain/command-palette.js',
  './src/domain/dashboard.js',
  './src/domain/demo-data.js',
  './src/domain/finance.js',
  './src/domain/goals-debts.js',
  './src/domain/insights.js',
  './src/domain/recurring.js',
  './src/domain/reports.js',
  './src/domain/settings.js',
  './src/domain/sparkline.js',
  './src/domain/theme.js',
  './src/domain/transactions.js',
  './src/services/supabase/assets.js',
  './src/services/supabase/budgets.js',
  './src/services/supabase/custom-icons.js',
  './src/services/supabase/edge.js',
  './src/services/supabase/recurring.js',
  './src/services/supabase/settings.js',
  './src/services/supabase/transfers.js',
  './src/services/transactions.js',
  './src/services/user-id.js', // resolver user_id bersama (v52) -- dipakai 5 service
  './src/ui/accounts.js',
  './src/ui/assets.js',
  './src/ui/budgets.js',
  './src/ui/calendar.js',
  './src/ui/categories.js',
  './src/ui/goals-debts.js',
  './src/ui/insights.js',
  './src/ui/modal-a11y.js',
  './src/ui/recurring.js',
  './src/ui/skeletons.js',
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
  // TIDAK boleh basi saat online). Cache key di-scope PER-TOKEN (segmen akhir header
  // Authorization = sub user) supaya 2 akun di perangkat sama TIDAK pernah berbagi
  // data; logout membuang seluruh cache data (pesan MYFINANCE_CLEAR_DATA_CACHE).
  if (url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/v1/') && req.method === 'GET') {
    const auth = req.headers.get('authorization') || '';
    if (auth) {
      const scope = encodeURIComponent(auth.slice(-24));
      const key = new Request(url.pathname + url.search + (url.search ? '&' : '?') + 'u=' + scope, { method: 'GET' });
      event.respondWith(
        fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(DATA_CACHE).then((cache) => cache.put(key, copy));
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

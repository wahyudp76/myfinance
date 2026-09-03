
// ============================================================================
// app.src.js -- SUMBER MANUAL app.js (v55+)
// JANGAN EDIT app.js: itu hasil build (terser). Ubah file INI, lalu:
//     npm run build:app
// dan commit KEDUANYA (app.src.js + app.js) bersamaan.
// Nama fungsi global TIDAK di-mangle (mangle.toplevel=false + keep_fnames)
// karena itu kontrak untuk onclick= di index.html & harness E2E -- dijaga
// tests/unit/app-minify.test.js + job CI "Build drift guard".
// ============================================================================

// --------------------------------------------------------------------------
// JARING PENGAMAN -- SENGAJA JADI KODE PALING PERTAMA di seluruh script gabungan
// ini, SEBELUM baris apa pun yang lain (termasuk sebelum koneksi Supabase
// dibuat). Kalau ADA SAJA error tak terduga di mana pun (termasuk kalau CDN
// library gagal dimuat sama sekali), jangan biarkan pengguna terjebak selama-
// nya di layar "Memeriksa sesi login..." tanpa penjelasan apa pun.
// --------------------------------------------------------------------------
function showFallbackError(detail) {
    var gate = document.getElementById('authGate');
    if (!gate || gate.classList.contains('hidden')) return; // sudah lewat tahap loading, abaikan
    var detailText = detail ? String(detail && detail.message ? detail.message : detail) : 'Tidak diketahui';
    gate.innerHTML =
        '<div style="max-width:300px;text-align:center;padding:24px;font-family:\'Plus Jakarta Sans\',sans-serif;">' +
            '<i class="fas fa-triangle-exclamation" style="font-size:26px;color:#f43f5e;"></i>' +
            '<p style="color:#334155;font-weight:700;font-size:14px;margin-top:12px;">Gagal memuat aplikasi</p>' +
            '<p style="color:#94a3b8;font-size:12px;margin-top:6px;">Coba muat ulang (kalau perlu, hard refresh: Ctrl/Cmd+Shift+R). Kalau masih terjadi, buka tab Console di DevTools browser untuk detail lengkapnya.</p>' +
            '<p style="color:#cbd5e1;font-size:10px;margin-top:10px;word-break:break-word;">' + detailText.replace(/</g, '&lt;') + '</p>' +
            '<button onclick="window.location.reload(true)" style="margin-top:16px;background:#151928;color:#fff;border:none;padding:10px 20px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;">Muat Ulang</button>' +
        '</div>';
}
window.addEventListener('error', function (e) { showFallbackError(e.error || e.message); });
window.addEventListener('unhandledrejection', function (e) { showFallbackError(e.reason); });
// Jaring pengaman terakhir: kalau setelah 12 detik authGate MASIH kelihatan
// (mis. request ke Supabase yang menggantung tanpa pernah resolve/reject),
// tetap tampilkan pesan yang sama.
setTimeout(function () { showFallbackError('Waktu tunggu habis (12 detik) -- kemungkinan koneksi ke Supabase lambat/gagal, atau salah satu library CDN tidak termuat.'); }, 12000);

// ==========================================================================
// KONEKSI SUPABASE
// ==========================================================================
// Client dibuat lewat modul src/auth/ (lihat <script type="module"> di <head>,
// bagian "AUTH MODULE BRIDGE"), bukan lagi window.supabase.createClient()
// langsung -- window.supabase (global dari CDN classic) sudah tidak dimuat
// sama sekali di versi ini.
//
// Catatan keamanan: SUPABASE_ANON_KEY di bawah ini AMAN untuk ditaruh di
// kode sisi client (browser) — ini bukan kunci rahasia. Yang menjaga data
// tiap user tetap privat adalah Row Level Security (RLS) yang diaktifkan
// lewat schema.sql, BUKAN kerahasiaan key ini. Jangan pernah menaruh
// "service_role key" di sisi client, hanya "anon public key" seperti ini.
// ==========================================================================

const SUPABASE_URL = 'https://uxfngmxghupdlwoeoxgh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4Zm5nbXhnaHVwZGx3b2VveGdoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0NzUwMDAsImV4cCI6MjEwMDA1MTAwMH0.0ICtfkrGwajHnpWFoTFNGC7OpMxVSvEeyJTyEAhjvqw';

// Diisi oleh initSupabaseClient() di bawah -- SELALU sebelum dipakai, karena bootstrapAuth()
// (di bagian AUTH & BOOTSTRAP, dekat akhir file ini) meng-await fungsi itu sebagai langkah
// PERTAMA sebelum baris lain yang menyentuh supabaseClient/authModule sempat jalan.
let supabaseClient;
let authModule; // { initAuthClient, getSession, getCurrentUser, signIn, signUp, signOut, onAuthStateChange, requireUser } -- lihat src/auth/index.js
let servicesModule; // { createTransactionService, createTransfer, createRecurringTransaction, replaceMonthBudgets } -- lihat src/services/*
let transactionService; // instance: servicesModule.createTransactionService(supabaseClient), dibuat sekali di initSupabaseClient()

// Bungkus sebuah Promise dengan timeout yang melempar pesan SPESIFIK -- dipakai untuk auth &
// services module (lihat pemakaiannya di bawah), supaya kalau salah satu modul ES gagal dimuat,
// pesan errornya jelas modul MANA yang bermasalah, bukan cuma pesan umum generik. Timeout 8
// detik SENGAJA lebih cepat dari jaring pengaman generik 12 detik di atas
// (baris showFallbackError(... 'Waktu tunggu habis (12 detik)' ...)).
function withLoadTimeout(promise, message) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 8000)),
    ]);
}

async function initSupabaseClient() {
    // window.__myfinanceAuthReady & window.__myfinanceServicesReady sudah pasti ada di titik
    // ini (dibuat oleh <script> classic di <head>, SEBELUM <script type="module"> apa pun --
    // lihat komentar "AUTH MODULE BRIDGE"). Dimuat paralel (Promise.all), bukan berurutan,
    // supaya waktu tunggu totalnya tidak dobel kalau keduanya lambat bersamaan.
    [authModule, servicesModule] = await Promise.all([
        withLoadTimeout(window.__myfinanceAuthReady, 'Modul auth (src/auth/*, file lokal) gagal dimuat dalam 8 detik -- cek koneksi ke server hosting app, atau buka DevTools Console utk error modul.'),
        withLoadTimeout(window.__myfinanceServicesReady, 'Modul data (src/services/*, file lokal) gagal dimuat dalam 8 detik -- cek koneksi ke server hosting app, atau buka DevTools Console utk error modul.'),
    ]);
    supabaseClient = authModule.initAuthClient({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
    transactionService = servicesModule.createTransactionService(supabaseClient);
    return authModule;
}

// ==========================================================================
// AUTENTIKASI (Supabase Auth)
// ==========================================================================
// Dipakai oleh tampilan Login DAN tampilan Dashboard yang sekarang berada
// dalam SATU halaman yang sama (lihat bagian "AUTH & BOOTSTRAP" di app.js).
// Membutuhkan js/supabase-client.js dimuat terlebih dahulu.
//
// Catatan penting versi "1 file": sebelumnya login/logout melakukan
// navigasi penuh antar halaman (login.html <-> index.html), jadi memori
// JavaScript otomatis kosong tiap kali ganti akun. Sekarang keduanya jadi
// satu halaman (SPA), jadi listener HANYA dipasang sekali (lihat
// initStaticUIListeners() di app.js) dan state aplikasi (transaksi, aset,
// pengaturan, dsb) SENGAJA direset lewat resetAppState() setiap kali logout,
// supaya data akun sebelumnya tidak pernah "nyangkut" kalau ada akun lain
// login di tab/perangkat yang sama tanpa me-refresh browser.
// ==========================================================================

const auth = {
    /**
     * Login dengan email & password.
     * @returns {Promise<{user, session}>}
     */
    async signIn(email, password) {
        return await authModule.signIn(email, password);
    },

    /**
     * Daftar akun baru dengan email & password.
     * @returns {Promise<{user, session}>}
     */
    async signUp(email, password) {
        return await authModule.signUp(email, password);
    },

    /**
     * Logout. Transisi UI kembali ke layar login ditangani secara terpusat
     * oleh listener onAuthStateChange di bootstrapAuth() (app.js), supaya
     * semua jalur logout (tombol manual, sesi kedaluwarsa, dll) konsisten.
     */
    async signOut() {
        try {
            await authModule.signOut();
        } catch (error) {
            // signOut() SENGAJA "fire and forget" -- dipanggil dari tombol logout tanpa
            // await/catch (lihat initStaticUIListeners()). Transisi ke layar login tetap
            // terjadi lewat listener SIGNED_OUT di bootstrapAuth() apa pun hasil panggilan
            // ini, jadi error di sini cukup dicatat, BUKAN dilempar ulang -- kalau dilempar,
            // itu jadi unhandledrejection dan salah memicu layar "Gagal memuat aplikasi"
            // padahal logout-nya sendiri sebenarnya sudah beres di sisi client.
            console.warn('signOut() bermasalah (diabaikan, lihat komentar di atas):', error);
        }
    },

    /**
     * Ambil session yang sedang aktif (null kalau belum login).
     */
    async getSession() {
        try {
            return await authModule.getSession();
        } catch (error) {
            console.warn('Gagal mengambil session:', error);
            return null;
        }
    },

    /**
     * Terjemahkan pesan error Supabase Auth ke Bahasa Indonesia yang lebih
     * ramah untuk ditampilkan ke user.
     */
    translateError(error) {
        const msg = (error && error.message) || '';
        if (msg.includes('Invalid login credentials')) return 'Email atau password salah.';
        if (msg.includes('User already registered')) return 'Email ini sudah terdaftar. Silakan login.';
        if (msg.includes('Password should be at least')) return 'Password minimal 6 karakter.';
        if (msg.includes('Unable to validate email address')) return 'Format email tidak valid.';
        if (msg.includes('Email not confirmed')) return 'Email belum dikonfirmasi. Cek inbox/spam untuk link konfirmasi.';
        return msg || 'Terjadi kesalahan. Coba lagi.';
    }
};

// ==========================================================================
// LAPISAN API (menggantikan peran google.script.run dari versi Apps Script -- kini service layer src/services/*)
// ==========================================================================
// Status: SEMUA data aplikasi sudah tersambung penuh ke Supabase — tidak
// ada lagi localStorage yang dipakai sebagai database. Tabel yang dipakai:
//   - transactions   (transaksi)
//   - budgets        (anggaran per bulan per kategori)
//   - assets         (portofolio aset/investasi)
//   - settings       (daftar akun & kategori kustom, 1 baris per user)
//   - custom_icons   (ikon/logo kustom per akun)
//
// Jalur data: SEMUA pemanggilan kini langsung ke service layer ES module
// src/services/* (di-export lewat window.__myfinanceServices di <head>) --
// adapter `api` gaya google.script.run yang dulu berdiri di sini sudah
// dipensiunkan & dihapus utuh (seri commit "refactor(api-seam)").
// ==========================================================================

// BUG FIX: currentUserId() sengaja ditaruh di scope GLOBAL (SEBELUM IIFE `api` di bawah), bukan
// di dalamnya -- supaya bisa diakses baik dari dalam IIFE (lewat closure, dipakai banyak fungsi
// *Remote() di bawah) MAUPUN dari luar (dipakai restoreBackup() utk fitur Restore Backup, yang
// sebelumnya ReferenceError krn fungsi ini dulu privat di dalam IIFE).
async function currentUserId() {
    const user = await authModule.getCurrentUser().catch(() => null);
    if (!user) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');
    return user.id;
}

// ADAPTER `api` (pola google.script.run) SUDAH DIPENSIUNKAN & DIHAPUS UTUH --
// seri commit "refactor(api-seam)" 7a6ce0d..8c26719 memindahkan semua jalur data
// ke service layer src/services/* (transactions.js, supabase/{budgets,settings,
// custom-icons,assets,recurring,transfers,edge}.js) & getSyncData di-inline di
// loadData(). currentUserId() di atas TETAP ada (dipakai restoreBackup() dkk).

// ==========================================================================
// APP.JS — Logic utama aplikasi (UI, render, kalkulasi, event handler)
// ==========================================================================
// File ini adalah hasil pemisahan dari <script> tunggal versi gabungan.
// Semua pemanggilan data sekarang lewat service layer src/services/* --
// adapter "api.run" gaya google.script.run sudah pensiun utuh (lihat komentar pengganti di atas).
// Urutan pemuatan WAJIB: supabase-client.js -> auth.js -> api.js -> app.js
// ==========================================================================

        const defaultCategoryDict = {
            pengeluaran: {
                "Makanan & Minuman": { icon: "fa-hamburger", bg: "bg-orange-100", color: "text-orange-500", subs: [
                    { name: "Restoran", icon: "fa-utensils" }, { name: "Kafe & Kopi", icon: "fa-coffee" },
                    { name: "Pesan Antar", icon: "fa-motorcycle" }, { name: "Camilan", icon: "fa-ice-cream" }
                ]},
                "Transportasi": { icon: "fa-bus", bg: "bg-yellow-100", color: "text-yellow-500", subs: [
                    { name: "Bensin", icon: "fa-gas-pump" }, { name: "Tol", icon: "fa-road" },
                    { name: "Taksi/Ojol", icon: "fa-taxi" }, { name: "Kendaraan Umum", icon: "fa-bus-alt" }
                ]},
                "Belanja Bulanan": { icon: "fa-shopping-cart", bg: "bg-green-100", color: "text-green-600", subs: [
                    { name: "Supermarket", icon: "fa-store" }, { name: "Pasar", icon: "fa-store-alt" }, { name: "Kebutuhan Rumah", icon: "fa-broom" }
                ]},
                "Tagihan & Biaya": { icon: "fa-file-invoice-dollar", bg: "bg-teal-100", color: "text-teal-600", subs: [
                    { name: "Listrik", icon: "fa-bolt" }, { name: "Air", icon: "fa-tint" },
                    { name: "Internet", icon: "fa-wifi" }, { name: "Langganan", icon: "fa-play-circle" }
                ]},
                "Hiburan": { icon: "fa-film", bg: "bg-amber-100", color: "text-amber-500", subs: [
                    { name: "Bioskop", icon: "fa-ticket-alt" }, { name: "Game", icon: "fa-gamepad" }, { name: "Streaming", icon: "fa-tv" }
                ]},
                "Keluarga & Pribadi": { icon: "fa-users", bg: "bg-pink-100", color: "text-pink-500", subs: [
                    { name: "Anak", icon: "fa-child" }, { name: "Hewan Peliharaan", icon: "fa-paw" }, { name: "Pakaian", icon: "fa-tshirt" }
                ]},
                "Belanja": { icon: "fa-shopping-bag", bg: "bg-purple-100", color: "text-purple-500", subs: [
                    { name: "Belanja Online", icon: "fa-cart-arrow-down" }, { name: "Elektronik", icon: "fa-laptop" }, { name: "Fashion", icon: "fa-shopping-bag" }
                ]},
                "Kesehatan": { icon: "fa-medkit", bg: "bg-rose-100", color: "text-rose-500", subs: [
                    { name: "Dokter", icon: "fa-user-md" }, { name: "Obat", icon: "fa-pills" }, { name: "Gym & Kebugaran", icon: "fa-dumbbell" }
                ]},
                "Rumah": { icon: "fa-home", bg: "bg-stone-200", color: "text-stone-600", subs: [
                    { name: "Sewa/Kosan", icon: "fa-home" }, { name: "Perabotan", icon: "fa-couch" }
                ]},
                "Edukasi": { icon: "fa-graduation-cap", bg: "bg-blue-100", color: "text-blue-500", subs: [
                    { name: "Uang Sekolah", icon: "fa-graduation-cap" }, { name: "Buku", icon: "fa-book" }, { name: "Kursus", icon: "fa-chalkboard-teacher" }
                ]},
                "Hadiah & Donasi": { icon: "fa-gift", bg: "bg-red-100", color: "text-red-500", subs: [
                    { name: "Ulang Tahun", icon: "fa-birthday-cake" }, { name: "Amal", icon: "fa-hand-holding-heart" }
                ]},
                "Mobil/Motor": { icon: "fa-car", bg: "bg-sky-100", color: "text-sky-500", subs: [
                    { name: "Parkir", icon: "fa-parking" }, { name: "Servis", icon: "fa-wrench" }
                ]},
                "Lain-lain": { icon: "fa-box-open", bg: "bg-slate-200", color: "text-slate-600", subs: [] }
            },
            pemasukan: {
                "Gaji": { icon: "fa-money-bill-wave", bg: "bg-emerald-100", color: "text-emerald-600", subs: [
                    { name: "Gaji Pokok", icon: "fa-dollar-sign" }, { name: "Bonus", icon: "fa-star" }, { name: "Lembur", icon: "fa-clock" }
                ]},
                "Penghasilan Tambahan": { icon: "fa-money-check", bg: "bg-green-100", color: "text-green-500", subs: [
                    { name: "Freelance", icon: "fa-laptop" }, { name: "Bisnis Sampingan", icon: "fa-briefcase" }, { name: "Jualan", icon: "fa-tags" }
                ]},
                "Investasi": { icon: "fa-chart-line", bg: "bg-orange-100", color: "text-orange-500", subs: [
                    { name: "Dividen", icon: "fa-chart-pie" }, { name: "Bunga", icon: "fa-percent" }, { name: "Capital Gain", icon: "fa-arrow-up" }
                ]},
                "Saldo Awal": { icon: "fa-piggy-bank", bg: "bg-indigo-100", color: "text-indigo-500", subs: [] },
                "Lain-lain": { icon: "fa-box-open", bg: "bg-slate-200", color: "text-slate-600", subs: [] }
            }
        };

        let categoryDict = {};
        function deepCloneDict(d) { return JSON.parse(JSON.stringify(d)); }

        let subCategoryLookup = {};
        function buildLookupTable() {
            subCategoryLookup = {};
            for(let type in categoryDict) {
                for(let parentName in categoryDict[type]) {
                    let parent = categoryDict[type][parentName];
                    parent.subs.forEach(sub => {
                        subCategoryLookup[sub.name] = { parentName: parentName, icon: sub.icon, bg: parent.bg, color: parent.color, type: type };
                    });
                }
            }
        }

        const defaultSettings = {
            accounts: ["Tunai (Cash)", "Bank BCA", "Bank Mandiri", "GoPay", "OVO", "ShopeePay", "Bibit"],
            accountIcons: {},
            // Mata uang per akun (fitur Growth "Multi-currency") -- key = nama akun, value = kode 3
            // huruf (mis. "USD"). Akun yang TIDAK ada di sini dianggap IDR (default). Dipisah dari
            // appSettings.accounts (bukan diubah jadi array of object) SENGAJA -- supaya semua kode
            // lama yang masih mengasumsikan appSettings.accounts = array of string tetap jalan
            // tanpa perlu diubah satu-satu.
            account_currencies: {},
            // Warna aksen UI (fitur "Warna Aksen" di Pengaturan > Tampilan) -- null = zamrud
            // bawaan (tanpa override CSS sama sekali). Nilai: hex '#rrggbb' yang sudah dinormalisasi.
            themeColor: null,
            custom_categories: {
                pengeluaran: { parents: [], subs: {} },
                pemasukan: { parents: [], subs: {} }
            },
            // Kategori/sub-kategori BAWAAN (dari defaultCategoryDict) yang dihapus/disembunyikan user --
            // disimpan terpisah dari custom_categories karena defaultCategoryDict sendiri hardcoded di
            // kode (bukan data per-user), jadi "menghapus" kategori bawaan sebenarnya cuma menyembunyikan
            // namanya di sini, lalu rebuildCategoryDict() menyaringnya keluar. Transaksi lama yang masih
            // memakai kategori itu tidak hilang -- cuma tidak bisa dipilih lagi untuk transaksi baru
            // (persis seperti kategori custom yang dihapus).
            hidden_categories: {
                pengeluaran: { parents: [], subs: {} },
                pemasukan: { parents: [], subs: {} }
            },
            // Override ikon/warna/gambar kustom per kategori (Pengeluaran & Pemasukan terpisah supaya
            // nama kategori yang kebetulan sama di keduanya tidak saling tertukar gayanya). Nilainya
            // TIDAK diisi di sini -- dihidrasi dari tabel custom_icons saat load (lihat
            // CATEGORY_STYLE_KEY_PREFIX di bawah), bukan dari tabel settings.
            categoryStyles: { pengeluaran: {}, pemasukan: {} },
            budgets: {},
            // Data diri pengguna (nama, no. HP, bio singkat). Foto profil TIDAK disimpan di sini
            // supaya payload pengaturan utama tetap ringan -- foto disimpan lewat mekanisme yang
            // sama seperti ikon akun kustom (tabel custom_icons), dengan key khusus PROFILE_AVATAR_KEY.
            profile: { full_name: '', phone: '', bio: '' }
        };

        // Key khusus (bukan nama akun asli manapun) yang dipakai untuk menyimpan foto
        // profil pengguna lewat mekanisme custom_icons yang sudah ada (saveCustomIcon/deleteCustomIcon).
        // Aman dari tabrakan karena daftar akun asli (appSettings.accounts) tidak pernah memuat key ini.
        const PROFILE_AVATAR_KEY = '__myfinance_profile_avatar__';

        // Override ikon/warna/gambar kustom per KATEGORI juga dititipkan di tabel custom_icons yang
        // sama (bukan tabel baru) -- lewat key dengan awalan khusus ini, supaya tidak perlu migrasi
        // SQL tambahan di Supabase. "account_name" pada tabel itu berfungsi sebagai key generik untuk
        // "objek ikon custom apapun", bukan cuma nama akun -- persis seperti PROFILE_AVATAR_KEY di atas.
        const CATEGORY_STYLE_KEY_PREFIX = '__myfinance_category_style__';
        function categoryStyleKey(jenisKey, catName) { return CATEGORY_STYLE_KEY_PREFIX + jenisKey + '::' + catName; }

        // Catatan: appSettings TIDAK lagi diinisialisasi dari localStorage.
        // Nilai default di bawah cuma placeholder sebelum loadData() selesai
        // mengambil pengaturan asli dari Supabase (lihat api.js -> getSyncData).
        let appSettings = deepCloneDict(defaultSettings);
        let cloudBudgets = {}; 
        
        let globalData = []; 
        let globalAssets = [];
        let charts = {}; 
        let calendarInstance;
        let _calendarWasMobile = null; // breakpoint mobile/desktop terakhir kali renderCalendar() penuh dijalankan 
        let currentAccountDetail = null;
        let currentEditId = null; 
        let currentAssetEditId = null;
        // Flag "Simpan & Catat Lagi": diset oleh tombol repeat, dibaca & langsung di-reset
        // di awal submitForm() -- jadi tidak pernah "nyangkut" ke submit berikutnya.
        let _pendingRepeatSave = false;
        let activeCategoryTab = 'Pengeluaran'; 
        let activeFormType = 'Pengeluaran';
        let currentSession = null; // Sesi Supabase yang sedang aktif, diisi oleh applySessionToUI()

        // "Tarik Cepat" (Quick Add) lewat URL -- dipakai integrasi Shortcut iPhone (mis. Back Tap):
        // membuka index.html?quickadd=1 langsung memicu modal "Catat Transaksi" begitu data selesai
        // dimuat, IDENTIK dengan modal yang sama persis dipakai lewat tombol "+" biasa -- bukan
        // tiruan terpisah, jadi otomatis selalu sinkron dengan kategori/akun kustom apa pun yang
        // sedang dipakai, tanpa perlu dirawat terpisah tiap kali kategori/akun berubah.
        let _pendingQuickAdd = false;

        function checkQuickAddFromUrl() {
            if (new URLSearchParams(window.location.search).get('quickadd') !== '1') return;
            // Bersihkan parameter dari address bar segera supaya refresh manual tidak memicu modal
            // berulang -- niat "quick add"-nya sudah "diingat" lewat variabel _pendingQuickAdd.
            window.history.replaceState(null, '', window.location.pathname + window.location.hash);
            _pendingQuickAdd = true;
            // Kalau app sudah siap (sudah login, appShell sudah tampil) SAAT INI JUGA -- bukan baru
            // mau memuat -- langsung buka modalnya sekarang, tidak perlu menunggu loadData() lagi.
            // Ini menutupi skenario di mana Shortcut/Safari cuma membawa tab yang SUDAH terbuka ke
            // depan (tanpa reload penuh) alih-alih memuat halaman dari awal.
            const shell = document.getElementById('appShell');
            if (shell && !shell.classList.contains('hidden')) { handlePendingQuickAdd(); }
        }
        function handlePendingQuickAdd() {
            if (!_pendingQuickAdd) return;
            _pendingQuickAdd = false;
            setTimeout(() => { openModal(); }, 250);
        }
        // "pageshow" terpicu baik saat halaman dimuat pertama kali MAUPUN saat "dihidupkan lagi" dari
        // cache browser (bfcache) -- dicek di sini (bukan cuma sekali di awal script) supaya Quick Add
        // tetap terpicu walau kunjungan berikutnya lewat Shortcut ternyata bukan reload penuh.
        window.addEventListener('pageshow', checkQuickAddFromUrl);

        // Menjamin appSettings selalu punya semua field yang app.js butuhkan, walaupun data yang
        // baru saja diambil dari Supabase (settings lama / akun lama) belum punya field terbaru
        // (mis. "profile" baru ditambahkan belakangan). Dipanggil saat startup DAN setiap kali
        // appSettings ditimpa oleh data cloud di loadData() -- sebelumnya fungsi ini cuma IIFE
        // yang jalan sekali di awal, jadi field baru yang hilang dari data lama bisa bikin error
        // (mis. "Cannot read properties of undefined") begitu bagian lain kode mengaksesnya.
        function ensureSettingsShape() {
            if (!appSettings.financial_goals) appSettings.financial_goals = []; // fitur Tujuan Keuangan -- array murni di appSettings, tanpa tabel/migrasi Supabase baru
            if (!appSettings.debts) appSettings.debts = []; // fitur Utang & Cicilan -- pola yang sama persis dengan financial_goals
            if (!appSettings.custom_categories) appSettings.custom_categories = { pengeluaran: { parents: [], subs: {} }, pemasukan: { parents: [], subs: {} } };
            ['pengeluaran', 'pemasukan'].forEach(type => {
                if (!appSettings.custom_categories[type]) appSettings.custom_categories[type] = { parents: [], subs: {} };
                if (!appSettings.custom_categories[type].parents) appSettings.custom_categories[type].parents = [];
                if (!appSettings.custom_categories[type].subs) appSettings.custom_categories[type].subs = {};
            });
            if (!appSettings.accounts) appSettings.accounts = deepCloneDict(defaultSettings.accounts);
            if (!appSettings.accountIcons) appSettings.accountIcons = {};
            // NORMALISASI: account_currencies dulu satu-satunya peta ber-key nama akun yang TIDAK
            // diinisialisasi di sini -- 3 tempat lain yang memakainya (getAccountCurrency,
            // submitAccountModal, pruneAccountKeyedMaps) semuanya terpaksa jaga-jaga sendiri2 dgn
            // defensive check `appSettings.account_currencies && ...`. Sekarang satu sumber
            // kebenaran di sini, sama seperti accountIcons/categoryStyles/dll di atas & bawah ini.
            if (!appSettings.account_currencies) appSettings.account_currencies = {};
            if (typeof appSettings.themeColor !== 'string') appSettings.themeColor = null; // fitur Warna Aksen -- settings cloud lama belum punya field ini
            if (!appSettings.categoryStyles) appSettings.categoryStyles = { pengeluaran: {}, pemasukan: {} };
            ['pengeluaran', 'pemasukan'].forEach(type => { if (!appSettings.categoryStyles[type]) appSettings.categoryStyles[type] = {}; });
            if (!appSettings.hidden_categories) appSettings.hidden_categories = { pengeluaran: { parents: [], subs: {} }, pemasukan: { parents: [], subs: {} } };
            ['pengeluaran', 'pemasukan'].forEach(type => {
                if (!appSettings.hidden_categories[type]) appSettings.hidden_categories[type] = { parents: [], subs: {} };
                if (!appSettings.hidden_categories[type].parents) appSettings.hidden_categories[type].parents = [];
                if (!appSettings.hidden_categories[type].subs) appSettings.hidden_categories[type].subs = {};
            });
            if (!appSettings.budgets) appSettings.budgets = {};
            if (!appSettings.profile || typeof appSettings.profile !== 'object') appSettings.profile = { full_name: '', phone: '', bio: '' };
            if (typeof appSettings.profile.full_name !== 'string') appSettings.profile.full_name = '';
            if (typeof appSettings.profile.phone !== 'string') appSettings.profile.phone = '';
            if (typeof appSettings.profile.bio !== 'string') appSettings.profile.bio = '';
            // Cache hasil AI (Rekomendasi AI & Ringkasan Bulanan) -- disimpan di Supabase (ikut
            // tersinkron appSettings), BUKAN localStorage, supaya device lain (HP/laptop lain, akun
            // yang sama) juga langsung dapat hasil yang sama tanpa perlu manggil Gemini ulang.
            // null = belum pernah digenerate; { insights/summary, timestamp } = hasil terakhir.
            if (appSettings.ai_insight_cache === undefined) appSettings.ai_insight_cache = null;
            if (appSettings.monthly_summary_cache === undefined) appSettings.monthly_summary_cache = null;
            // Tier-3 #11: palet grafik proporsi -- 'default' | 'colorblind' (Okabe-Ito)
            if (typeof appSettings.chartPalette !== 'string' || !['default', 'colorblind'].includes(appSettings.chartPalette)) appSettings.chartPalette = 'default';
            updateChartPaletteButtonsUI(appSettings.chartPalette);
        }
        ensureSettingsShape();

        const newParentIconPalette = [
            { icon: 'fa-star', bg: 'bg-indigo-100', color: 'text-indigo-500' },
            { icon: 'fa-heart', bg: 'bg-pink-100', color: 'text-pink-500' },
            { icon: 'fa-gem', bg: 'bg-cyan-100', color: 'text-cyan-600' },
            { icon: 'fa-leaf', bg: 'bg-lime-100', color: 'text-lime-600' },
            { icon: 'fa-bolt', bg: 'bg-amber-100', color: 'text-amber-600' },
            { icon: 'fa-music', bg: 'bg-fuchsia-100', color: 'text-fuchsia-500' }
        ];

        // Palet ikon khusus untuk akun dompet/e-wallet/investasi yang tidak punya logo otomatis
        const accountIconPalette = [
            { icon: 'fa-building-columns', bg: 'bg-blue-100', color: 'text-blue-600' },
            { icon: 'fa-piggy-bank', bg: 'bg-pink-100', color: 'text-pink-500' },
            { icon: 'fa-credit-card', bg: 'bg-indigo-100', color: 'text-indigo-500' },
            { icon: 'fa-wallet', bg: 'bg-amber-100', color: 'text-amber-600' },
            { icon: 'fa-coins', bg: 'bg-yellow-100', color: 'text-yellow-600' },
            { icon: 'fa-sack-dollar', bg: 'bg-emerald-100', color: 'text-emerald-600' },
            { icon: 'fa-landmark', bg: 'bg-slate-200', color: 'text-slate-600' },
            { icon: 'fa-mobile-screen-button', bg: 'bg-purple-100', color: 'text-purple-500' },
            { icon: 'fa-gem', bg: 'bg-cyan-100', color: 'text-cyan-600' },
            { icon: 'fa-chart-line', bg: 'bg-orange-100', color: 'text-orange-500' },
            { icon: 'fa-hand-holding-dollar', bg: 'bg-teal-100', color: 'text-teal-600' },
            { icon: 'fa-cash-register', bg: 'bg-rose-100', color: 'text-rose-500' }
        ];

        // Palet ikon+warna untuk kustomisasi kategori Pengeluaran/Pemasukan (Pengaturan > Kategori).
        // Dipakai bareng utk kategori UTAMA (icon+bg+color) maupun SUB-kategori (cuma bentuk icon-nya,
        // warna dikunci ikut kategori utama -- lihat renderCategoryStylePalette()). Warna yg dipakai
        // di sini SENGAJA cuma dari 18 warna yg sudah py aturan dark-mode (lihat .dark [class*=...]
        // di <style>), jadi kombinasi apa pun otomatis kebaca benar di kedua tema tanpa perlu nambah
        // CSS baru lagi.
        const categoryIconPalette = [
            // -- Makanan & Minuman --
            { icon: 'fa-utensils', bg: 'bg-orange-100', color: 'text-orange-500' },
            { icon: 'fa-mug-hot', bg: 'bg-orange-100', color: 'text-orange-600' },
            { icon: 'fa-pizza-slice', bg: 'bg-amber-100', color: 'text-amber-600' },
            { icon: 'fa-burger', bg: 'bg-yellow-100', color: 'text-yellow-600' },
            { icon: 'fa-wine-glass', bg: 'bg-rose-100', color: 'text-rose-500' },
            // -- Belanja & Gaya Hidup --
            { icon: 'fa-cart-shopping', bg: 'bg-pink-100', color: 'text-pink-500' },
            { icon: 'fa-bag-shopping', bg: 'bg-fuchsia-100', color: 'text-fuchsia-500' },
            { icon: 'fa-shirt', bg: 'bg-purple-100', color: 'text-purple-500' },
            { icon: 'fa-ring', bg: 'bg-violet-100', color: 'text-violet-500' },
            { icon: 'fa-glasses', bg: 'bg-slate-200', color: 'text-slate-600' },
            // -- Transportasi --
            { icon: 'fa-car', bg: 'bg-blue-100', color: 'text-blue-500' },
            { icon: 'fa-motorcycle', bg: 'bg-sky-100', color: 'text-sky-600' },
            { icon: 'fa-bus', bg: 'bg-cyan-100', color: 'text-cyan-600' },
            { icon: 'fa-train', bg: 'bg-indigo-100', color: 'text-indigo-500' },
            { icon: 'fa-gas-pump', bg: 'bg-amber-100', color: 'text-amber-500' },
            { icon: 'fa-square-parking', bg: 'bg-blue-100', color: 'text-blue-600' },
            { icon: 'fa-bicycle', bg: 'bg-teal-100', color: 'text-teal-600' },
            // -- Rumah & Tagihan --
            { icon: 'fa-house', bg: 'bg-amber-100', color: 'text-amber-600' },
            { icon: 'fa-bolt', bg: 'bg-yellow-100', color: 'text-yellow-600' },
            { icon: 'fa-droplet', bg: 'bg-sky-100', color: 'text-sky-500' },
            { icon: 'fa-wifi', bg: 'bg-indigo-100', color: 'text-indigo-500' },
            { icon: 'fa-couch', bg: 'bg-orange-100', color: 'text-orange-500' },
            { icon: 'fa-broom', bg: 'bg-teal-100', color: 'text-teal-500' },
            { icon: 'fa-screwdriver-wrench', bg: 'bg-slate-200', color: 'text-slate-600' },
            // -- Kesehatan --
            { icon: 'fa-heart-pulse', bg: 'bg-rose-100', color: 'text-rose-500' },
            { icon: 'fa-pills', bg: 'bg-emerald-100', color: 'text-emerald-500' },
            { icon: 'fa-stethoscope', bg: 'bg-cyan-100', color: 'text-cyan-600' },
            { icon: 'fa-tooth', bg: 'bg-sky-100', color: 'text-sky-500' },
            { icon: 'fa-spa', bg: 'bg-pink-100', color: 'text-pink-500' },
            // -- Hiburan & Hobi --
            { icon: 'fa-film', bg: 'bg-purple-100', color: 'text-purple-500' },
            { icon: 'fa-tv', bg: 'bg-violet-100', color: 'text-violet-500' },
            { icon: 'fa-gamepad', bg: 'bg-indigo-100', color: 'text-indigo-500' },
            { icon: 'fa-music', bg: 'bg-fuchsia-100', color: 'text-fuchsia-500' },
            { icon: 'fa-book', bg: 'bg-amber-100', color: 'text-amber-600' },
            { icon: 'fa-palette', bg: 'bg-rose-100', color: 'text-rose-500' },
            { icon: 'fa-camera', bg: 'bg-slate-200', color: 'text-slate-600' },
            { icon: 'fa-dumbbell', bg: 'bg-teal-100', color: 'text-teal-600' },
            { icon: 'fa-futbol', bg: 'bg-lime-100', color: 'text-lime-600' },
            // -- Keluarga & Anak --
            { icon: 'fa-graduation-cap', bg: 'bg-indigo-100', color: 'text-indigo-500' },
            { icon: 'fa-baby', bg: 'bg-pink-100', color: 'text-pink-500' },
            { icon: 'fa-child', bg: 'bg-cyan-100', color: 'text-cyan-500' },
            { icon: 'fa-paw', bg: 'bg-lime-100', color: 'text-lime-600' },
            { icon: 'fa-hand-holding-heart', bg: 'bg-rose-100', color: 'text-rose-500' },
            // -- Pekerjaan & Keuangan --
            { icon: 'fa-briefcase', bg: 'bg-slate-200', color: 'text-slate-600' },
            { icon: 'fa-mobile-screen', bg: 'bg-cyan-100', color: 'text-cyan-600' },
            { icon: 'fa-coins', bg: 'bg-emerald-100', color: 'text-emerald-600' },
            { icon: 'fa-chart-line', bg: 'bg-green-100', color: 'text-green-600' },
            { icon: 'fa-piggy-bank', bg: 'bg-amber-100', color: 'text-amber-500' },
            { icon: 'fa-sack-dollar', bg: 'bg-emerald-100', color: 'text-emerald-500' },
            { icon: 'fa-hand-holding-dollar', bg: 'bg-teal-100', color: 'text-teal-600' },
            { icon: 'fa-file-invoice-dollar', bg: 'bg-blue-100', color: 'text-blue-500' },
            { icon: 'fa-shield-halved', bg: 'bg-indigo-100', color: 'text-indigo-600' },
            { icon: 'fa-landmark', bg: 'bg-slate-200', color: 'text-slate-600' },
            // -- Liburan & Lainnya --
            { icon: 'fa-plane', bg: 'bg-sky-100', color: 'text-sky-500' },
            { icon: 'fa-suitcase-rolling', bg: 'bg-orange-100', color: 'text-orange-500' },
            { icon: 'fa-gift', bg: 'bg-fuchsia-100', color: 'text-fuchsia-500' },
            { icon: 'fa-cake-candles', bg: 'bg-pink-100', color: 'text-pink-500' },
            { icon: 'fa-star', bg: 'bg-violet-100', color: 'text-violet-500' }
        ];

        function rebuildCategoryDict() {
            categoryDict = deepCloneDict(defaultCategoryDict);
            ['pengeluaran', 'pemasukan'].forEach(type => {
                // Buang kategori/sub-kategori BAWAAN yang sudah dihapus/disembunyikan user (lihat
                // appSettings.hidden_categories) -- dilakukan SEBELUM merge custom, supaya custom
                // categories tidak pernah kena efek penyaringan ini (mereka dihapus lewat mekanisme
                // sendiri di removeParentCategory/removeSub).
                const hidden = appSettings.hidden_categories && appSettings.hidden_categories[type];
                if (hidden) {
                    (hidden.parents || []).forEach(pName => { delete categoryDict[type][pName]; });
                    Object.keys(hidden.subs || {}).forEach(pName => {
                        if (categoryDict[type][pName]) {
                            const hiddenSubNames = new Set(hidden.subs[pName]);
                            categoryDict[type][pName].subs = categoryDict[type][pName].subs.filter(s => !hiddenSubNames.has(s.name));
                        }
                    });
                }

                const cc = appSettings.custom_categories[type];
                (cc.parents || []).forEach((p, idx) => {
                    if (!categoryDict[type][p.name]) {
                        const theme = newParentIconPalette[idx % newParentIconPalette.length];
                        categoryDict[type][p.name] = { icon: p.icon || theme.icon, bg: p.bg || theme.bg, color: p.color || theme.color, subs: [] };
                    }
                });
                Object.keys(cc.subs || {}).forEach(parentName => {
                    const target = categoryDict[type][parentName] ? parentName : 'Lain-lain';
                    (cc.subs[parentName] || []).forEach(subName => {
                        if(!categoryDict[type][target].subs.some(s => s.name === subName)){
                            categoryDict[type][target].subs.push({ name: subName, icon: 'fa-tag' });
                        }
                    });
                });
            });
            buildLookupTable();
        }

        // Logo bank/e-wallet kini SELF-HOSTED di icons/banks/ (tidak lagi hotlink Wikimedia --
        // 5 dari 10 URL lama sudah 404: Mandiri/BNI/Jago/GoPay/ShopeePay). File SVG dari
        // Wikimedia Commons (nama file saat diunduh), ShopeePay = marka buatan-sendiri.
        const bankWalletDatabase = [
            { name: "Bank Central Asia (BCA)", category: "Bank", keywords: ["bca","central asia"], url: "icons/banks/bca.svg" },
            { name: "Bank Mandiri", category: "Bank", keywords: ["mandiri"], url: "icons/banks/mandiri.svg" },
            { name: "Bank Rakyat Indonesia (BRI)", category: "Bank", keywords: ["bri","rakyat indonesia"], url: "icons/banks/bri.svg" },
            { name: "Bank Negara Indonesia (BNI)", category: "Bank", keywords: ["bni","negara indonesia"], url: "icons/banks/bni.png" },
            { name: "Bank Syariah Indonesia (BSI)", category: "Bank", keywords: ["bsi","syariah indonesia"], url: "icons/banks/bsi.svg" },
            { name: "Bank Jago", category: "Bank", keywords: ["jago", "bank jago"], url: "icons/banks/jago.svg" },
            { name: "GoPay", category: "E-Wallet", keywords: ["gopay","go-pay"], url: "icons/banks/gopay.svg" },
            { name: "OVO", category: "E-Wallet", keywords: ["ovo"], url: "icons/banks/ovo.svg" },
            { name: "DANA", category: "E-Wallet", keywords: ["dana"], url: "icons/banks/dana.svg" },
            { name: "ShopeePay", category: "E-Wallet", keywords: ["shopeepay","shopee pay"], url: "icons/banks/shopeepay.svg" },
            // Tambahan untuk Platform Aset/Investasi (Bisa jadi akun juga)
            { name: "Bibit", category: "Investasi", keywords: ["bibit", "reksa dana bibit"], badge: "BB", color: "bg-green-600" },
            { name: "Ajaib", category: "Investasi", keywords: ["ajaib"], badge: "AJ", color: "bg-blue-500" },
            { name: "Stockbit", category: "Investasi", keywords: ["stockbit"], badge: "SB", color: "bg-emerald-500" },
            { name: "Bareksa", category: "Investasi", keywords: ["bareksa"], badge: "BR", color: "bg-teal-600" },
            { name: "Pluang", category: "Investasi", keywords: ["pluang"], badge: "PL", color: "bg-slate-800" },
            { name: "Indodax", category: "Investasi", keywords: ["indodax", "kripto"], badge: "ID", color: "bg-blue-600" },
            { name: "Tokocrypto", category: "Investasi", keywords: ["tokocrypto", "kripto"], badge: "TC", color: "bg-blue-400" },
            { name: "Pintu", category: "Investasi", keywords: ["pintu", "kripto pintu"], badge: "PT", color: "bg-slate-900" },
            { name: "IPOT", category: "Investasi", keywords: ["ipot", "indopremier"], badge: "IP", color: "bg-indigo-600" },
            { name: "Mirae", category: "Investasi", keywords: ["mirae", "hots"], badge: "MR", color: "bg-orange-500" }
        ];

        // Menghitung gaya BAWAAN kategori (tanpa override kustom user) -- dipakai oleh getCategoryStyle()
        // dan juga oleh modal kustomisasi kategori saat user klik "Reset ke Bawaan" (perlu tahu tampilan
        // aslinya tanpa override, sebelum override itu dihapus).
        function resolveBaseCategoryStyle(catName, jenis) {
            if (jenis === 'Transfer') {
                return { icon: "fa-exchange-alt", bg: "bg-blue-100", color: "text-blue-500", parent: "Transfer", parentName: "Transfer" };
            }
            let found = subCategoryLookup[catName];
            if (found) return found;
            if (jenis === 'Pengeluaran' && categoryDict.pengeluaran[catName]) {
                let p = categoryDict.pengeluaran[catName];
                return { icon: p.icon, bg: p.bg, color: p.color, parent: catName, parentName: catName };
            }
            if (jenis === 'Pemasukan' && categoryDict.pemasukan[catName]) {
                let p = categoryDict.pemasukan[catName];
                return { icon: p.icon, bg: p.bg, color: p.color, parent: catName, parentName: catName };
            }
            if (jenis === 'Pemasukan') return { icon: "fa-arrow-down", bg: "bg-emerald-100", color: "text-emerald-500", parent: "Lain-lain", parentName: "Lain-lain" };
            return { icon: "fa-arrow-up", bg: "bg-rose-100", color: "text-rose-500", parent: "Lain-lain", parentName: "Lain-lain" };
        }

        function getCategoryStyle(catName, jenis) {
            let base = resolveBaseCategoryStyle(catName, jenis);

            // Override ikon/warna/gambar kustom yang dipilih user lewat Pengaturan (lihat
            // categoryStyleKey()) -- kalau ada gambar kustom, icon/bg/color bawaan tetap disertakan
            // sebagai fallback untuk tempat yang belum mendukung render gambar (lihat categoryIconHtml()).
            const jenisKey = jenis === 'Pemasukan' ? 'pemasukan' : 'pengeluaran';
            const override = jenis !== 'Transfer' && appSettings.categoryStyles && appSettings.categoryStyles[jenisKey] && appSettings.categoryStyles[jenisKey][catName];
            if (override) {
                if (override.type === 'image') return Object.assign({}, base, { image: override.value });
                // catName ADALAH nama parent-nya sendiri -> ini kustomisasi level KATEGORI UTAMA, bebas
                // pilih warna sendiri (dari override.bg/color yang tersimpan).
                const parentName = base.parentName || base.parent;
                if (parentName === catName) {
                    return Object.assign({}, base, { icon: override.value, bg: override.bg, color: override.color, image: null });
                }
                // catName adalah SUB-kategori -> warnanya WAJIB ikut warna kategori utama SAAT INI
                // (rekursif ke parent, bukan bg/color yang mungkin tersimpan lama di override sub ini
                // sendiri), supaya kalau warna parent diganti, semua sub-nya otomatis ikut berubah.
                const parentStyle = getCategoryStyle(parentName, jenis);
                return Object.assign({}, base, { icon: override.value, bg: parentStyle.bg, color: parentStyle.color, image: null });
            }
            return base;
        }

        // ========================== UTILITIES ==========================
        function setDateHeader() {
            document.getElementById('currentDate').innerText = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            document.getElementById('tanggal').valueAsDate = new Date();
            let n = new Date(); 
            document.getElementById('reportFilterMonth').value = `${n.getFullYear()}-${(n.getMonth() + 1).toString().padStart(2, '0')}`;
            if (document.getElementById('txFilterMonthYear')) { document.getElementById('txFilterMonthYear').value = `${n.getFullYear()}-${(n.getMonth() + 1).toString().padStart(2, '0')}`; }
            if (document.getElementById('budgetFilterMonth')) { document.getElementById('budgetFilterMonth').value = `${n.getFullYear()}-${(n.getMonth() + 1).toString().padStart(2, '0')}`; }
        }
        
        function showLoading(show) { document.getElementById('loading').style.display = show ? 'flex' : 'none'; }

        // ---------- SKELETON SYNC-LOADING (slice design #3) ----------
        // loadData() memakai state ini, bukan showLoading() langsung: saat tab Dashboard
        // terlihat, tampil SKELETON berbentuk konten (app terasa hidup saat sinkronisasi);
        // di tab lain jatuh kembali ke overlay #loading seperti biasa. Kontrak lama utk
        // indikator pull-to-refresh (memantau "loading selesai") dijaga lewat
        // body[data-sync-loading] -- lihat setupPullToRefresh().
        function setSyncLoading(active) {
            const skel = document.getElementById('dashboard-skeleton');
            const dash = document.getElementById('view-dashboard');
            const dashVisible = !!(dash && dash.classList.contains('block'));
            if (active) {
                document.body.dataset.syncLoading = '1';
                setHudStatus('sync');
                // Overlay logo berputar di TENGAH kini tampil utk SEMUA tab (revisi
                // slice sync-logo: permintaan pemilik -- animasi loading terpusat &
                // jelas terlihat). Skeleton Dashboard tetap diisi di belakang overlay
                // (lapisan struktural, siap dipakai bila overlay tidak diinginkan).
                showLoading(true);
                if (skel && dashVisible) {
                    if (!skel.dataset.ready) { skel.innerHTML = servicesModule.dashboardSkeletonHtml(); skel.dataset.ready = '1'; }
                    skel.classList.remove('hidden');
                }
            } else {
                delete document.body.dataset.syncLoading;
                setHudStatus('live');
                if (skel) skel.classList.add('hidden');
                showLoading(false); // no-op kalau overlay memang tidak menyala
            }
        }

        // Toast notifikasi (error/sukses/info) — showErrorToast() lama dipertahankan sebagai
        // pembungkus tipis supaya seluruh pemanggilan yang sudah ada di kode tetap jalan apa adanya.
        let _errorToastTimeout = null;
        const TOAST_THEME = {
            error:   { ring: 'ring-rose-100',    bg: 'bg-rose-100',    text: 'text-rose-500',    icon: 'fa-triangle-exclamation' },
            success: { ring: 'ring-emerald-100', bg: 'bg-emerald-100', text: 'text-emerald-500', icon: 'fa-circle-check' },
            info:    { ring: 'ring-blue-100',    bg: 'bg-blue-100',    text: 'text-blue-500',    icon: 'fa-circle-info' }
        };
        function showToast(message, type) {
            const theme = TOAST_THEME[type] || TOAST_THEME.error;
            if (theme === TOAST_THEME.error) { showLoading(false); } // error selalu mematikan loading spinner juga
            const wrap = document.getElementById('errorToast');
            const card = document.getElementById('errorToastCard');
            const msgEl = document.getElementById('errorToastMsg');
            const iconWrap = document.getElementById('errorToastIconWrap');
            const iconEl = document.getElementById('errorToastIcon');
            if (!wrap || !card || !msgEl) { console.error(message); return; }

            card.classList.remove('ring-rose-100', 'ring-emerald-100', 'ring-blue-100');
            card.classList.add(theme.ring);
            if (iconWrap) {
                iconWrap.classList.remove('bg-rose-100', 'text-rose-500', 'bg-emerald-100', 'text-emerald-500', 'bg-blue-100', 'text-blue-500');
                iconWrap.classList.add(theme.bg, theme.text);
            }
            if (iconEl) {
                iconEl.classList.remove('fa-triangle-exclamation', 'fa-circle-check', 'fa-circle-info');
                iconEl.classList.add(theme.icon);
            }
            msgEl.innerText = message;
            wrap.classList.remove('hidden');
            requestAnimationFrame(() => { card.classList.remove('opacity-0', '-translate-y-3'); });
            if (_errorToastTimeout) clearTimeout(_errorToastTimeout);
            _errorToastTimeout = setTimeout(hideErrorToast, type === 'error' ? 5000 : 3000);
        }
        function showErrorToast(message) { showToast(message, 'error'); }
        function showSuccessToast(message) { showToast(message, 'success'); }
        function showInfoToast(message) { showToast(message, 'info'); }
        function hideErrorToast() {
            const wrap = document.getElementById('errorToast');
            const card = document.getElementById('errorToastCard');
            if (card) card.classList.add('opacity-0', '-translate-y-3');
            setTimeout(() => { if (wrap) wrap.classList.add('hidden'); }, 300);
            if (_errorToastTimeout) { clearTimeout(_errorToastTimeout); _errorToastTimeout = null; }
        }

        // Banner offline/online — feedback langsung kalau koneksi internet putus, supaya user
        // tidak bingung kenapa perubahan tidak tersimpan. Muncul lagi saat online.
        function updateOfflineBanner() {
            const banner = document.getElementById('offlineBanner');
            if (!banner) return;
            banner.classList.toggle('hidden', navigator.onLine !== false);
        }
        window.addEventListener('online', () => { updateOfflineBanner(); showSuccessToast('Koneksi internet kembali normal.'); });
        window.addEventListener('offline', () => { updateOfflineBanner(); });

        function switchView(viewName) {
            ['dashboard', 'transaksi', 'budget', 'laporan', 'aset', 'kalender', 'akun-detail', 'kategori-detail', 'pengaturan'].forEach(v => {
                let el = document.getElementById('view-' + v); if(el) { el.classList.add('hidden'); el.classList.remove('block'); }
                let nav = document.getElementById('nav-' + v); if(nav) { nav.classList.remove('menu-active'); nav.classList.add('menu-inactive'); }
                let mobNav = document.getElementById('mobile-nav-' + v); if(mobNav) { mobNav.classList.remove('text-[#151928]', 'font-bold', 'liquid-glass-nav-active'); mobNav.classList.add('text-slate-400'); }
            });
            document.getElementById('view-' + viewName).classList.remove('hidden'); document.getElementById('view-' + viewName).classList.add('block');
            
            let activeNavId = viewName;
            if (viewName === 'akun-detail') activeNavId = 'dashboard';
            if (viewName === 'kategori-detail') activeNavId = 'laporan';
            
            let navActive = document.getElementById('nav-' + activeNavId); if(navActive) { navActive.classList.add('menu-active'); navActive.classList.remove('menu-inactive'); }
            let mobActive = document.getElementById('mobile-nav-' + activeNavId); if(mobActive) { mobActive.classList.remove('text-slate-400'); mobActive.classList.add('text-[#151928]', 'font-bold', 'liquid-glass-nav-active'); }

            if(viewName === 'dashboard') { processDataForUI(globalData); } 
            else if(viewName === 'laporan') { renderReportTab(); requestMonthlySummary(false); } 
            else if(viewName === 'kalender') { setTimeout(() => renderCalendar(globalData), 100); }
            else if(viewName === 'transaksi') { filterTransactions(); }
            else if(viewName === 'budget') { renderBudgetView(); }
            else if(viewName === 'aset') { renderAssetView(); }

            updateScrollToTopVisibility();
        }

        function formatRp(angka) { return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0 }).format(angka); }

        // Fitur Growth "Multi-currency": nilai IDR-equivalent 1 transaksi, dipakai utk SEMUA total
        // gabungan lintas akun/kategori (Dashboard, grafik, dll). Transaksi lama (sebelum fitur ini
        // ada) tidak punya jumlah_idr -> otomatis fallback ke jumlah apa adanya (yang memang selalu
        // IDR untuk transaksi lama). Untuk saldo 1 akun spesifik, JANGAN pakai ini -- pakai t.jumlah
        // (native) langsung, karena saldo akun ya dalam mata uang akun itu sendiri.
        function txIdrAmount(t) {
            const v = (t && t.jumlah_idr != null) ? t.jumlah_idr : (t ? t.jumlah : 0);
            return Number(v) || 0;
        }

        // Animasi angka Rp menghitung naik/turun secara halus tiap kali nilainya berubah,
        // alih-alih langsung "meloncat" ke angka baru. Nilai awal dibaca dari teks yang SEDANG
        // tampil di elemen itu, jadi transisinya terasa alami (bukan selalu mulai dari 0).
        const _rupiahAnimTokens = new WeakMap();
        function animateRupiah(el, targetValue, maskable) {
            if (!el) return;
            targetValue = Number(targetValue) || 0;

            // Batalkan animasi sebelumnya pada elemen yang sama, supaya tidak tabrakan/flicker
            // kalau fungsi ini terpanggil beruntun (mis. resize cepat, ganti tab cepat).
            const prevToken = _rupiahAnimTokens.get(el);
            if (prevToken) cancelAnimationFrame(prevToken);

            // Elemen yang ditandai "maskable" (saldo akun) disamarkan langsung tanpa animasi
            // hitung naik/turun kalau mode Sembunyikan Saldo aktif -- lihat toggleNominalVisibility().
            if (maskable && nominalHidden) {
                _rupiahAnimTokens.delete(el);
                el.innerText = 'Rp ••••••';
                return;
            }

            const prevDigits = (el.innerText || '').replace(/[^0-9-]/g, '');
            const startValue = prevDigits ? parseInt(prevDigits, 10) : 0;
            if (!isFinite(startValue) || startValue === targetValue) {
                el.innerText = 'Rp ' + formatRp(targetValue);
                return;
            }

            const duration = 700;
            const startTime = performance.now();
            function tick(now) {
                const progress = Math.min((now - startTime) / duration, 1);
                const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
                const current = Math.round(startValue + (targetValue - startValue) * eased);
                el.innerText = 'Rp ' + formatRp(current);
                if (progress < 1) {
                    _rupiahAnimTokens.set(el, requestAnimationFrame(tick));
                } else {
                    el.innerText = 'Rp ' + formatRp(targetValue);
                    _rupiahAnimTokens.delete(el);
                }
            }
            _rupiahAnimTokens.set(el, requestAnimationFrame(tick));
        }
        // ---------- SEMBUNYIKAN SALDO (ikon mata) ----------
        // Sama seperti preferensi tema: disimpan di localStorage (bukan Supabase) karena ini
        // pengaturan PERANGKAT/browser ini, bukan data akun. Cuma memengaruhi nominal yang
        // berkaitan langsung dengan SALDO AKUN -- kartu Total Saldo & Total Investasi Aset,
        // Pemasukan/Pengeluaran bulan ini, Saldo Per Akun, dan halaman detail akun. Nominal di
        // tab Transaksi/Budget/Aset/Laporan tetap tampil apa adanya (bukan bagian dari privasi
        // saldo akun, dan cukup sering justru dibutuhkan tetap kelihatan mis. saat cek budget).
        const NOMINAL_HIDDEN_KEY = 'myfinance-hide-nominal';
        function getStoredNominalHiddenPref() {
            let v = null;
            try { v = localStorage.getItem(NOMINAL_HIDDEN_KEY); } catch (e) { /* localStorage bisa diblokir di mode privat ketat */ }
            return v === '1';
        }
        let nominalHidden = getStoredNominalHiddenPref();

        function updateNominalToggleUI() {
            document.querySelectorAll('.nominal-eye-icon').forEach(icon => {
                icon.classList.toggle('fa-eye', !nominalHidden);
                icon.classList.toggle('fa-eye-slash', nominalHidden);
            });
            document.querySelectorAll('.nominal-eye-btn').forEach(btn => {
                const label = nominalHidden ? 'Tampilkan saldo' : 'Sembunyikan saldo';
                btn.title = label; btn.setAttribute('aria-label', label);
            });
        }

        function toggleNominalVisibility() {
            nominalHidden = !nominalHidden;
            try { localStorage.setItem(NOMINAL_HIDDEN_KEY, nominalHidden ? '1' : '0'); } catch (e) { showInfoToast('Preferensi tidak bisa disimpan di perangkat ini (mode privat?), tapi tetap diterapkan untuk sesi ini.'); }
            const prefCb = document.getElementById('pref-hide-nominal');
            if (prefCb) prefCb.checked = nominalHidden; // toggle bisa dipicu dari ikon mata di halaman lain
            updateNominalToggleUI();

            // Render ulang bagian yang sedang tampil supaya nominalnya langsung berubah tanpa reload.
            if (document.getElementById('view-dashboard').classList.contains('block')) processDataForUI(globalData);
            if (document.getElementById('view-akun-detail').classList.contains('block') && currentAccountDetail) openAccountDetail(currentAccountDetail);
        }

        function formatShortVal(angka) { if(Math.abs(angka) >= 1000000) return (angka/1000000).toFixed(1) + 'M'; if(Math.abs(angka) >= 1000) return (angka/1000).toFixed(0) + 'K'; return angka; }
        
        function formatInputRibuan(input, hiddenId = null) { 
            let value = input.value.replace(/[^0-9]/g, ''); 
            if (value) { 
                if(hiddenId && document.getElementById(hiddenId)) { document.getElementById(hiddenId).value = value; }
                input.value = new Intl.NumberFormat('id-ID').format(value); 
            } else { 
                if(hiddenId && document.getElementById(hiddenId)) { document.getElementById(hiddenId).value = ''; }
                input.value = ''; 
            } 
        }

        // Mendeteksi logo otomatis dari database bank/e-wallet berdasarkan nama akun.
        // Mengembalikan null kalau tidak ada yang cocok (logo tidak ditemukan).
        function detectAutoAccountIcon(name) {
            if (!name) return null;
            const n = name.toLowerCase();
            if (n.includes('tunai') || n.includes('cash')) return { type: 'icon-plain', value: 'fa-money-bill-wave', color: 'text-emerald-500' };
            if (n.includes('investasi') || n.includes('saham') || n.includes('reksadana')) return { type: 'icon-plain', value: 'fa-chart-line', color: 'text-purple-600' };
            let match = null, bestLen = 0;
            bankWalletDatabase.forEach(item => {
                item.keywords.forEach(kw => { if (n.includes(kw) && kw.length > bestLen) { match = item; bestLen = kw.length; } });
            });
            if (match) {
                if (match.url) return { type: 'image', value: match.url, alt: name };
                if (match.badge) return { type: 'badge', value: match.badge, color: match.color };
            }
            return null;
        }

        // Merender objek ikon (auto-detect ATAU kustom pilihan/upload user) jadi HTML.
        //
        // PENTING: elemen pembungkus di bawah SENGAJA <span> (bukan <div>) untuk yg butuh ukuran
        // w-full/h-full + flex -- karena HTML MELARANG <div> ditaruh di dalam <p> (atau <span> yg
        // notabene juga phrasing content). Kalau tetap dipaksa <div>, browser akan DIAM-DIAM
        // menutup <p>/<span> pembungkusnya lebih awal saat parsing, dan ikonnya "lepas" ke posisi
        // lain di DOM -- persis bug yg pernah muncul di badge ikon akun kecil (Riwayat Transaksi
        // dkk, yg memang selalu ditaruh di dalam <p>). <span class="inline-flex ...  w-3 h-3"> aman
        // dipakai di situ karena tetap elemen sebaris (inline-level), beda dari <div>.
        function renderAccountIconObj(obj, sizeClass) {
            sizeClass = sizeClass || 'text-xl';
            // Keamanan berlapis: objek ikon bisa berasal dari SETTINGS CLOUD / restore backup
            // (bentuk tidak sepenuhnya tepercaya). Validasi bentuk di titik render ini -- nilai
            // di luar pola sah (upload modal / palet / logo bank internal) di-fallback ke ikon
            // dompet netral, sehingga data yang direkayasa tidak bisa menyuntikkan atribut HTML.
            const safeObj = servicesModule.sanitizeIconOverride(obj);
            if (!safeObj) return `<i class="fas fa-wallet text-slate-500 ${sizeClass}"></i>`;
            obj = safeObj;
            if (obj.type === 'image') return `<img src="${obj.value}" class="w-full h-full object-contain" alt="${escapeHtml(obj.alt || '')}" onerror="this.outerHTML='<i class=\\'fas fa-wallet text-slate-400 ${sizeClass}\\'></i>';">`;
            if (obj.type === 'badge') return `<span class="w-full h-full rounded-full ${obj.color} text-white inline-flex items-center justify-center font-extrabold text-[10px] tracking-tight leading-none">${escapeHtml(obj.value)}</span>`;
            if (obj.type === 'icon') return `<span class="w-full h-full rounded-full ${obj.bg} ${obj.color} inline-flex items-center justify-center"><i class="fas ${obj.value} text-[11px]"></i></span>`;
            // 'icon-plain' (akun Tunai/Cash & Investasi/Saham) -- ukuran ikon di-fix kecil & wrapper
            // selalu w-full h-full biar SELALU pas & center di kotak manapun ia ditaruh (termasuk
            // badge sekecil w-3/12px), tidak lagi ikut sizeClass yg bisa kegedean di kotak kecil.
            if (obj.type === 'icon-plain') return `<span class="w-full h-full inline-flex items-center justify-center"><i class="fas ${obj.value} ${obj.color} text-[11px]"></i></span>`;
            return `<i class="fas fa-wallet text-slate-500 ${sizeClass}"></i>`;
        }

        function getAccountLogo(name) {
            const override = appSettings.accountIcons && appSettings.accountIcons[name];
            if (override) return renderAccountIconObj(override, 'text-lg');
            return renderAccountIconObj(detectAutoAccountIcon(name), 'text-xl');
        }

        // Merender lingkaran ikon kategori: gambar kustom (kalau style.image ada, dari override user)
        // atau ikon Font Awesome biasa (style.icon) di atas warna latar (style.bg/style.color).
        // wrapClass = ukuran+rounded+margin dsb (TANPA bg/color, karena itu diatur di sini sendiri
        // supaya gambar kustom bisa tampil di atas latar putih netral, bukan warna kategori).
        // iconSizeClass = kelas ukuran teks khusus untuk ikonnya (opsional).
        function categoryIconHtml(style, wrapClass, iconSizeClass) {
            iconSizeClass = iconSizeClass || '';
            // Keamanan berlapis: gaya kategori (termasuk gambar upload) bisa berasal dari settings
            // cloud / restore backup JSON. Tiap token divalidasi di titik render ini -- gambar di
            // luar pola data-URL/base64 & path ikon internal dibuang; token kelas/ikon yang
            // mencurigakan di-fallback ke tampilan netral. Data normal (palet & upload modal)
            // selalu lolos pola, jadi tidak ada perubahan tampilan utk data sah.
            const s = style || {};
            const safeImage = servicesModule.isSafeIconImageUrl(s.image);
            const icon = servicesModule.isSafeFaIconToken(s.icon) ? s.icon : 'fa-wallet';
            const bg = servicesModule.isSafeClassToken(s.bg) ? s.bg : 'bg-white';
            const color = servicesModule.isSafeClassToken(s.color) ? s.color : 'text-slate-500';
            if (safeImage) {
                return `<div class="${wrapClass} overflow-hidden bg-white ring-1 ring-slate-100"><img src="${safeImage}" class="w-full h-full object-cover" alt="" onerror="this.parentElement.className='${jsStr(wrapClass)} ${bg} ${color}'; this.outerHTML='<i class=\\'fas ${icon} ${iconSizeClass}\\'></i>';"></div>`;
            }
            return `<div class="${wrapClass} ${bg} ${color}"><i class="fas ${icon} ${iconSizeClass}"></i></div>`;
        }

        // ========================== SETTINGS AND SYNC ACTIONS ==========================
        function escapeHtml(str) { return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
        function jsStr(str) { return String(str).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
        function slugify(str) { return String(str).replace(/[^a-zA-Z0-9]/g, '_'); }

        // Kolom "tanggal" transaksi/aset di database bertipe DATE (tanpa jam), jadi selalu berbentuk
        // string polos "YYYY-MM-DD" (lihat sql/schema.sql). Kalau string tanggal SEPERTI INI langsung
        // dibungkus new Date(...) tanpa komponen jam, JS menafsirkannya sebagai tengah malam UTC (bukan
        // tengah malam waktu lokal) -- lalu getDate()/getMonth()/toLocaleDateString() dst membacanya
        // balik ke zona waktu LOKAL browser. Untuk zona waktu dengan offset NEGATIF dari UTC (mis. Amerika),
        // ini bisa membuat tanggalnya mundur satu hari (mis. "2026-01-15" terbaca sebagai 14 Januari malam).
        // Untuk WIB/WITA/WIT (offset UTC+7/+8/+9, sama seperti mayoritas pengguna app ini) kebetulan tidak
        // pernah kelihatan gejalanya karena offsetnya positif -- tapi tetap rapuh/tidak portable. Semua
        // parsing tanggal transaksi di seluruh app SEHARUSNYA lewat fungsi ini (bukan `new Date(x.tanggal)`
        // langsung), supaya selalu dibaca sebagai tengah malam WAKTU LOKAL, konsisten di zona waktu manapun.
        function parseTgl(tanggalStr) {
            if (!tanggalStr) return new Date(NaN);
            return new Date(String(tanggalStr).split('T')[0] + 'T00:00:00');
        }

        // Pasangan resmi utk parseTgl() -- ubah objek Date jadi teks "YYYY-MM-DD" pakai KOMPONEN
        // LOKAL (getFullYear/getMonth/getDate), BUKAN d.toISOString().slice(0,10).
        // KENAPA PENTING: toISOString() selalu mengonversi ke UTC dulu. Untuk zona waktu yang lebih
        // cepat dari UTC (WIB/WITA/WIT semua UTC+7/8/9), tengah malam waktu lokal itu masih SORE HARI
        // SEBELUMNYA di UTC -- jadi toISOString().slice(0,10) diam-diam mundur SATU HARI. Ini bikin
        // bug nyata & bukan cuma teori: advanceDueDate() menjadwalkan transaksi berulang H-1 dari
        // yang seharusnya, dan pengecekan "todayStr" bisa salah selama jam 00:00-06:59 WIB (masih
        // dianggap "kemarin"). toDateStr() di bawah ini aman dipakai kapan pun/zona waktu mana pun.
        function toDateStr(d) {
            return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        }

        // "Hari ini" dalam bentuk teks YYYY-MM-DD yang AMAN zona waktu -- pengganti pola lama
        // `new Date().toISOString().slice(0,10)` yang tersebar di banyak tempat (lihat toDateStr()).
        function todayDateStr() {
            return toDateStr(new Date());
        }

        function renderSettings() {
            rebuildCategoryDict();
            renderUserIdentity();
            renderAccountList();
            renderCategoryTree('pemasukan');
            renderCategoryTree('pengeluaran');
            populateParentSelect('pemasukan');
            populateParentSelect('pengeluaran');
            updateFormOptions();
            renderWhatsappLinkStatus();
            const accEl = document.getElementById('settings-stat-accounts'); if (accEl) accEl.innerText = appSettings.accounts.length;
            const catEl = document.getElementById('settings-stat-categories'); if (catEl) catEl.innerText = Object.keys(categoryDict.pemasukan).length + Object.keys(categoryDict.pengeluaran).length;
            renderThemePicker();
            renderDataPrefs();
            renderAppInfo();
        }

        // ---------- WARNA AKSEN (tema warna UI) ----------
        // Pasang/lepas tema: menghitung shade dari appSettings.themeColor lewat domain
        // module murni (teruji unit), menaruhnya sebagai CSS variables di <html>, lalu
        // menandai <body data-theme-accent> yang mengaktifkan blok override di styles.css.
        // themeColor null/tanpa atribut = nol rule aktif = tampilan bawaan persis asli.
        function applyThemeColor() {
            try {
                const hex = servicesModule.normalizeThemeColor(appSettings && appSettings.themeColor);
                const root = document.documentElement;
                const body = document.body;
                const meta = document.querySelector('meta[name="theme-color"]');
                const shadeKeys = ['50', '100', '300', '400', '500', '600', '700'];
                const extraProps = ['--accent-contrast', '--accent-dark-chip', '--accent-faint-10', '--accent-50-60'];
                if (!hex) {
                    delete body.dataset.themeAccent;
                    shadeKeys.forEach((k) => root.style.removeProperty('--accent-' + k));
                    extraProps.forEach((p) => root.style.removeProperty(p));
                    if (meta) meta.setAttribute('content', '#151928'); // warna asli sebelum fitur ini
                    return;
                }
                const shades = servicesModule.buildAccentShades(hex);
                shadeKeys.forEach((k) => root.style.setProperty('--accent-' + k, shades[k]));
                root.style.setProperty('--accent-contrast', shades.contrastText);
                root.style.setProperty('--accent-dark-chip', shades.darkChipRgba);
                root.style.setProperty('--accent-faint-10', shades.faint10Rgba);
                root.style.setProperty('--accent-50-60', shades.shade50Alpha60Rgba);
                body.dataset.themeAccent = hex;
                if (meta) meta.setAttribute('content', shades['600']); // warna bilah browser di HP
            } catch (e) {
                console.error('Gagal menerapkan warna tema:', e);
            }
        }

        // Warna utk chart/ikon/grafik yang mengikuti Warna Aksen. Mengembalikan null
        // kalau tema tidak aktif ATAU warna aksen bakal TABRAK dgn warna semantik chart
        // (aksen rose utk batang "Masuk" = tak terbedakan dari "Keluar"; aksen amber utk
        // ring budget "safe" = tertukar dgn status "warning") -- pemanggil fallback ke
        // warna asli. Semua nilai dibaca dari CSS variables yang dipasang applyThemeColor().
        function themeAccentColor(kind) {
            try {
                if (!document.body.dataset.themeAccent) return null;
                const cs = getComputedStyle(document.documentElement);
                const v = (prop, fallback) => (cs.getPropertyValue(prop) || '').trim() || fallback;
                const a500 = v('--accent-500', '#10b981');
                const clashRed = servicesModule.isColorCloseToAny(a500, servicesModule.CHART_EXPENSE_REDS, 110);
                switch (kind) {
                    case 'incomeBar':   return clashRed ? null : v('--accent-400', '#34d399');
                    case 'income500':   return clashRed ? null : a500;
                    case 'income600':   return clashRed ? null : v('--accent-600', '#059669');
                    case 'incomeLabel': return clashRed ? null : v('--accent-700', '#047857');
                    case 'incomeLabelDark': return clashRed ? null : v('--accent-300', '#a7f3d0');
                    case 'budgetSafe':  return servicesModule.isColorCloseToAny(a500, servicesModule.CHART_EXPENSE_REDS.concat(['#fbbf24']), 110) ? null : v('--accent-400', '#34d399');
                    case 'eventBg':     return v('--accent-100', '#d1fae5');
                    case 'eventText':   return v('--accent-700', '#059669');
                    case 'paletteIn':   return clashRed ? null : [v('--accent-400', '#34D399'), a500, v('--accent-600', '#059669'), v('--accent-700', '#047857'), v('--accent-300', '#6EE7B7'), v('--accent-100', '#A7F3D0')];
                }
            } catch (e) { console.error('Gagal membaca warna aksen chart:', e); }
            return null;
        }

        function setThemeColor(color, silent) {
            appSettings.themeColor = servicesModule.normalizeThemeColor(color); // null kalau reset/input tak valid
            applyThemeColor();
            renderThemePicker();
            // silent = live preview color picker (oninput): jangan spam simpan cloud /
            // re-render chart di tiap geseran -- finalize (onchange / klik preset) yang
            // menyimpan & menyegarkan chart (pola yang sama dgn ganti dark mode).
            if (!silent) {
                persistSettings(); // ikut pipeline settings yang sama -> sinkron ke semua device
                showSuccessToast(appSettings.themeColor ? 'Warna tema diperbarui \u2728' : 'Kembali ke warna bawaan');
                if (typeof rerenderVisibleCharts === 'function') rerenderVisibleCharts();
            }
        }

        function renderThemePicker() {
            const wrap = document.getElementById('theme-accent-swatches');
            if (!wrap) return;
            const current = servicesModule.normalizeThemeColor(appSettings && appSettings.themeColor);
            wrap.innerHTML = servicesModule.PRESET_THEMES.map((t) => {
                const active = current === t.color;
                return `<button type="button" onclick="setThemeColor('${t.color}')" title="Tema ${t.label}" aria-label="Tema ${t.label}" aria-pressed="${active}"`
                    + ` class="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${active ? 'border-slate-700 scale-110 ring-2 ring-slate-300 ring-offset-1' : 'border-slate-200'}"`
                    + ` style="background:${t.color}"></button>`;
            }).join('');
            const custom = document.getElementById('theme-color-custom');
            if (custom && current) custom.value = current; // sinkronkan color picker dgn pilihan aktif
        }

        // ========================== BOT WHATSAPP (Fonnte) ==========================
        // GANTI dengan nomor WhatsApp device Fonnte kamu sendiri (format 62xxx, tanpa +/spasi)
        // -- cuma dipakai buat ditampilkan sbg instruksi ke user, tidak mempengaruhi logika.
        const WHATSAPP_BOT_NUMBER = '628XXXXXXXXXX';
        // BUG FIX: sebelumnya nomor placeholder di atas ditampilkan APA ADANYA ke user kalau
        // developer lupa menggantinya -- user diminta kirim kode LINK ke nomor yang sebenarnya
        // tidak ada, jadi kode SELALU kadaluarsa tanpa penjelasan (bot tidak pernah menerimanya).
        // Sekarang dicek dulu: kalau masih placeholder, tampilkan peringatan jelas alih-alih
        // nomor palsu, supaya masalahnya langsung ketahuan alih-alih terlihat seperti bug lain.
        function isWhatsappBotNumberConfigured() {
            return /^\d{8,15}$/.test(WHATSAPP_BOT_NUMBER);
        }

        async function renderWhatsappLinkStatus() {
            const container = document.getElementById('whatsapp-link-status');
            if (!container) return;
            try {
                const user = await authModule.getCurrentUser().catch(() => null);
                if (!user) return;
                const { data } = await supabaseClient.from('whatsapp_links').select('whatsapp_number, linked_at').eq('user_id', user.id).maybeSingle();
                if (data) {
                    container.innerHTML = `
                        <div class="bg-emerald-50 rounded-xl p-3 flex items-center justify-between gap-2">
                            <div class="min-w-0">
                                <p class="text-xs font-bold text-emerald-700">Terhubung</p>
                                <p class="text-[11px] text-emerald-600 truncate">+${escapeHtml(data.whatsapp_number)}</p>
                            </div>
                            <button onclick="unlinkWhatsapp()" class="text-[11px] font-semibold text-rose-500 hover:text-rose-600 flex-shrink-0">Putuskan</button>
                        </div>`;
                } else {
                    container.innerHTML = `<button onclick="generateWhatsappLinkCode()" class="w-full bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white text-xs md:text-sm font-bold py-2.5 rounded-xl transition">Hubungkan WhatsApp</button>`;
                }
            } catch (e) {
                container.innerHTML = `<p class="text-[11px] text-slate-400 text-center">Gagal memuat status.</p>`;
            }
        }

        async function generateWhatsappLinkCode() {
            const container = document.getElementById('whatsapp-link-status');
            try {
                const user = await authModule.getCurrentUser().catch(() => null);
                if (!user) { showErrorToast('Sesi login tidak ditemukan.'); return; }
                const code = Math.floor(100000 + Math.random() * 900000).toString();
                const { error } = await supabaseClient.from('whatsapp_link_codes').insert({ user_id: user.id, code });
                if (error) { showErrorToast('Gagal membuat kode. Coba lagi.'); return; }

                if (!isWhatsappBotNumberConfigured()) {
                    // Developer belum mengganti WHATSAPP_BOT_NUMBER dari placeholder -- kode di atas
                    // TETAP tersimpan (jadi tidak salah data), tapi user diberi tahu jujur bahwa
                    // fitur ini belum siap, bukan diminta kirim pesan ke nomor yang tidak ada.
                    container.innerHTML = `
                        <div class="bg-amber-50 rounded-xl p-3 text-center border border-amber-200">
                            <p class="text-[11px] font-bold text-amber-700 mb-1"><i class="fas fa-triangle-exclamation mr-1"></i>Bot WhatsApp belum dikonfigurasi</p>
                            <p class="text-[10px] text-amber-600 leading-relaxed">Developer perlu mengganti <code class="bg-amber-100 px-1 rounded">WHATSAPP_BOT_NUMBER</code> di index.html dengan nomor WhatsApp device Fonnte yang sebenarnya sebelum fitur ini bisa dipakai.</p>
                        </div>`;
                    return;
                }

                // wa.me menerima pesan pre-filled lewat parameter ?text= -- user tinggal tap
                // "Kirim" di WhatsApp, tidak perlu ngetik/copy-paste manual kode LINK-nya sendiri.
                const waLink = `https://wa.me/${WHATSAPP_BOT_NUMBER}?text=${encodeURIComponent('LINK ' + code)}`;
                container.innerHTML = `
                    <div class="bg-slate-50 rounded-xl p-3 text-center">
                        <p class="text-[10px] text-slate-400 mb-1">Kirim pesan ini ke WhatsApp bot (${escapeHtml(WHATSAPP_BOT_NUMBER)}):</p>
                        <p class="text-base font-mono font-extrabold text-slate-800 mb-1 tracking-wide">LINK ${code}</p>
                        <p class="text-[10px] text-slate-400 mb-2">Kode berlaku 10 menit.</p>
                        <a href="${waLink}" target="_blank" rel="noopener" class="inline-block w-full bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white text-xs font-bold py-2 rounded-lg transition mb-2"><i class="fab fa-whatsapp mr-1.5"></i>Buka WhatsApp & Kirim Otomatis</a>
                        <button onclick="renderWhatsappLinkStatus()" class="text-[11px] font-semibold text-indigo-500 hover:text-indigo-600">Sudah kirim? Cek status</button>
                    </div>`;
            } catch (e) {
                showErrorToast('Gagal membuat kode. Coba lagi.');
            }
        }

        function unlinkWhatsapp() {
            showConfirm('Putuskan nomor WhatsApp dari akun ini? Kamu bisa hubungkan lagi kapan saja.', async () => {
                const user = await authModule.getCurrentUser().catch(() => null);
                if (!user) return;
                await supabaseClient.from('whatsapp_links').delete().eq('user_id', user.id);
                showSuccessToast('WhatsApp berhasil diputuskan.');
                renderWhatsappLinkStatus();
            });
        }

        // ========================== BACKUP & RESTORE ==========================
        // Bentuk payload, validasi file, ringkasan jumlah & pemetaan baris restore
        // kini di src/domain/backup.js (murni, ter-unit-test); bagian DOM/unduh/
        // FileReader/insert Supabase tetap di sini.
        // Ekspor: satu file JSON berisi SEMUA data (pengaturan + transaksi + aset + berulang) --
        // murni baca dari state yg sudah ada di memori (appSettings/globalData/globalAssets/
        // globalRecurring), tanpa fetch tambahan.
        function exportFullBackup() {
            // bentuk payload kini di src/domain/backup.js (slice backup); `now`
            // tidak dikirim -> default new Date(), persis perilaku lama.
            const backup = servicesModule.buildBackupPayload({
                settings: appSettings,
                transactions: globalData,
                assets: globalAssets,
                recurring: globalRecurring,
            });
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `myfinance-backup-${todayDateStr()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            markBackupDownloaded();
            showSuccessToast('Backup berhasil diunduh.');
        }

        // ---------- DATA & CADANGAN: penanda unduhan + ekspor CSV ----------
        // "Terakhir diunduh" dicatat di localStorage (informasional, per perangkat).
        const BACKUP_LAST_KEY = 'myfinance-backup-last';
        function markBackupDownloaded() {
            try { localStorage.setItem(BACKUP_LAST_KEY, new Date().toISOString()); } catch (e) { /* mode privat */ }
            const el = document.getElementById('backup-last-download');
            if (el) el.textContent = formatBackupLastDownload();
        }
        function formatBackupLastDownload() {
            let raw = null;
            try { raw = localStorage.getItem(BACKUP_LAST_KEY); } catch (e) { /* mode privat */ }
            if (!raw) return 'belum pernah';
            try {
                return new Date(raw).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            } catch (e) { return raw; }
        }
        // Ekspor CSV transaksi per rentang -- builder murni di src/domain/export-csv.js
        // (teruji unit); di sini hanya pengambilan rentang, unduhan blob, dan toast.
        function exportTransactionsCsv() {
            const rangeEl = document.getElementById('csv-export-range');
            const range = (rangeEl && rangeEl.value) || 'month';
            const rows = servicesModule.filterTransactionsForRange(globalData, range, todayDateStr());
            if (!rows.length) { showErrorToast('Tidak ada transaksi pada rentang ini.'); return; }
            const csv = servicesModule.buildTransactionsCsv(rows, { txIdrAmount });
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = servicesModule.csvFileName('myfinance-transaksi', todayDateStr());
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            markBackupDownloaded();
            showSuccessToast(rows.length + ' transaksi diekspor ke CSV.');
        }

        // ---------- PREFERENSI (privasi nominal + tampilan awal) ----------
        // Sinkronkan UI kartu Preferensi dengan state nyata (dipanggil renderSettings
        // dan setelah toggleNominalVisibility dari mana pun -- ikon mata di halaman
        // detail akun dan checkbox di Pengaturan adalah satu state yang sama).
        function renderDataPrefs() {
            const cb = document.getElementById('pref-hide-nominal');
            if (cb) cb.checked = !!nominalHidden;
            const sel = document.getElementById('pref-default-view');
            if (sel) sel.value = appSettings.default_view || 'dashboard';
            const last = document.getElementById('backup-last-download');
            if (last) last.textContent = formatBackupLastDownload();
        }
        function setDefaultView(view) {
            const valid = ['dashboard', 'transaksi', 'budget', 'laporan'];
            if (!valid.includes(view)) return;
            appSettings.default_view = view;
            persistSettings();
            showSuccessToast('Tampilan awal disimpan.');
        }
        // Terapkan default_view SEKALI per pemuatan halaman -- loadData bisa terpanggil
        // lagi (mis. setelah impor), dan tidak boleh merampas tab yang sedang dibuka user.
        function applyDefaultViewOnce() {
            if (window.__defaultViewApplied) return;
            window.__defaultViewApplied = true;
            const dv = appSettings.default_view;
            if (dv && ['transaksi', 'budget', 'laporan'].includes(dv)) switchView(dv);
        }

        // ---------- TENTANG APLIKASI & PENYIMPANAN ----------
        // Hitungan via summarizeAppData (murni, teruji); versi dibaca dari nama cache
        // service worker yang aktif -- satu sumber kebenaran, tanpa konstanta duplikat.
        function renderAppInfo() {
            const catCount = Object.keys(categoryDict.pemasukan).length + Object.keys(categoryDict.pengeluaran).length;
            const s = servicesModule.summarizeAppData({
                transactions: globalData, accounts: appSettings.accounts,
                categories: catCount, assets: globalAssets, recurring: globalRecurring,
            });
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
            set('appinfo-tx', s.transactions);
            set('appinfo-accounts', s.accounts);
            set('appinfo-categories', s.categories);
            set('appinfo-assets', s.assets);
            (async () => {
                try {
                    const keys = (window.caches && await caches.keys()) || [];
                    const ver = keys.find((k) => k.indexOf('myfinance-v') === 0);
                    set('app-version', ver || 'web (tanpa cache)');
                } catch (e) { set('app-version', 'web'); }
                try {
                    if (navigator.storage && navigator.storage.estimate) {
                        const est = await navigator.storage.estimate();
                        set('appinfo-storage', servicesModule.formatBytes(est.usage || 0) + ' terpakai');
                    } else { set('appinfo-storage', 'tidak tersedia'); }
                } catch (e) { set('appinfo-storage', 'tidak tersedia'); }
            })();
        }
        function checkForAppUpdate() {
            showInfoToast('Memeriksa pembaruan aplikasi…');
            try {
                navigator.serviceWorker.getRegistration().then((reg) => {
                    if (!reg) { showInfoToast('Aplikasi berjalan tanpa service worker (mode dev).'); return; }
                    reg.update().then(() => showSuccessToast('Selesai diperiksa. Jika ada versi baru, akan dimuat saat aplikasi dibuka berikutnya.'));
                }).catch(() => showErrorToast('Gagal memeriksa pembaruan.'));
            } catch (e) { showErrorToast('Gagal memeriksa pembaruan.'); }
        }

        // ---------- GANTI KATA SANDI (modal Edit Profil) ----------
        // Validasi murni di src/domain/settings.js (validatePasswordChange, teruji unit);
        // eksekusi lewat supabase.auth.updateUser -- sesi tetap valid, perangkat lain
        // tidak dilogout paksa oleh Supabase (hanya refresh token perangkat ini).
        async function submitPasswordChange() {
            const pwEl = document.getElementById('profile-modal-password');
            const cfEl = document.getElementById('profile-modal-password-confirm');
            const check = servicesModule.validatePasswordChange(pwEl.value, cfEl.value);
            if (!check.valid) { showErrorToast(check.error); return; }
            try {
                const { error } = await supabaseClient.auth.updateUser({ password: pwEl.value });
                if (error) { showErrorToast('Gagal mengganti kata sandi: ' + error.message); return; }
                pwEl.value = ''; cfEl.value = '';
                showSuccessToast('Kata sandi berhasil diganti.');
            } catch (e) {
                console.error('Ganti kata sandi gagal:', e);
                showErrorToast('Gagal mengganti kata sandi. Periksa koneksi internet kamu.');
            }
        }

        function handleBackupFileSelect(event) {
            const file = event.target.files[0];
            event.target.value = ''; // supaya file yg sama bisa dipilih lagi kalau perlu diulang
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                let parsed;
                try { parsed = JSON.parse(e.target.result); }
                catch (err) { showErrorToast('Gagal membaca file -- pastikan file JSON backup yang benar.'); return; }
                // aturan validasi (app==='MyFinance' + wajib .settings) kini di
                // src/domain/backup.js -- hasil identik dengan cek inline lama.
                const v = servicesModule.validateBackupFile(parsed);
                if (!v.ok) {
                    showErrorToast('File ini bukan file backup MyFinance yang valid.');
                    return;
                }
                confirmAndRestoreBackup(v.backup);
            };
            reader.readAsText(file);
        }

        function confirmAndRestoreBackup(backup) {
            const { txCount, assetCount, recurCount } = servicesModule.summarizeBackupCounts(backup);
            showConfirm(
                `File ini berisi pengaturan (akun/kategori/tujuan/utang), ${txCount} transaksi, ${assetCount} aset, dan ${recurCount} transaksi berulang.\n\nPengaturan akan MENIMPA yang sekarang. Transaksi/aset/berulang akan DITAMBAHKAN (bukan menimpa) -- kalau file ini pernah diimpor sebelumnya, datanya bisa dobel. Lanjutkan?`,
                () => restoreBackup(backup)
            );
        }

        async function restoreBackup(backup) {
            showLoading(true);
            try {
                const user_id = await currentUserId();
                if (!user_id) { showErrorToast('Sesi login sudah berakhir, coba login ulang.'); return; }

                // 1) Pengaturan: TIMPA penuh, lalu backfill field baru yg mungkin belum ada
                //    di backup lama (mis. backup dari sebelum fitur Tujuan Keuangan ada).
                //    Keamanan: file backup JSON adalah input tak tepercaya -- override ikon/gaya
                //    (accountIcons/categoryStyles) yang bentuknya di luar pola sah (berisi tanda
                //    kutip/karakter markup, dsb) DIBUANG dulu di sini, supaya tidak ikut tersimpan
                //    ke cloud lalu menyuntik saat dirender (lihat juga guard render di
                //    categoryIconHtml/renderAccountIconObj).
                const restoredSettings = Object.assign({}, backup.settings);
                servicesModule.sanitizeSettingsIconOverrides(restoredSettings);
                appSettings = restoredSettings;
                ensureSettingsShape();
                await persistSettings();

                // 2) Transaksi/aset/berulang: TAMBAH baris baru (bulk insert), bukan timpa --
                //    id lama & user_id lama dibuang, diganti id baru (auto) & user_id akun ini,
                //    supaya restore ke akun BERBEDA pun aman (tidak nabrak/klaim data user lain).
                if (backup.transactions && backup.transactions.length > 0) {
                    const rows = servicesModule.mapRestoreRows(backup.transactions, user_id);
                    const { error } = await supabaseClient.from('transactions').insert(rows);
                    if (error) throw error;
                }
                if (backup.assets && backup.assets.length > 0) {
                    const rows = servicesModule.mapRestoreRows(backup.assets, user_id);
                    const { error } = await supabaseClient.from('assets').insert(rows);
                    if (error) throw error;
                }
                if (backup.recurring && backup.recurring.length > 0) {
                    const rows = servicesModule.mapRestoreRows(backup.recurring, user_id);
                    const { error } = await supabaseClient.from('recurring_transactions').insert(rows);
                    if (error) throw error;
                }

                showSuccessToast('Restore berhasil! Memuat ulang data...');
                loadData();
            } catch (e) {
                console.error('Restore backup gagal:', e);
                showErrorToast('Gagal restore data. Coba lagi, atau cek Console browser (F12) buat detail errornya.');
            } finally {
                showLoading(false);
            }
        }

        function persistSettings() {
            // accountIcons & categoryStyles SENGAJA tidak ikut dikirim di sini — keduanya
            // disinkronkan terpisah lewat saveCustomIcon()/deleteCustomIcon() ke tabel custom_icons,
            // supaya payload pengaturan utama tetap ringan meski ada banyak logo/gambar upload.
            const settingsForCloud = Object.assign({}, appSettings);
            delete settingsForCloud.accountIcons;
            delete settingsForCloud.categoryStyles;
            // Pensyahan api.run (slice settings+icons): service langsung, callback persis versi lama.
            servicesModule.saveSettings(supabaseClient, settingsForCloud).catch((err) => {
                console.error('api.run.saveSettingsCloud gagal:', err);
                showErrorToast('Gagal menyimpan pengaturan ke Supabase. Periksa koneksi internet kamu.');
            });
        }

        // ==================== COMMAND PALETTE (Tier-3 #9, Ctrl/Cmd+K) ====================
        // Indeks & pencarian murni di src/domain/command-palette.js (ter-unit-test);
        // controller DOM/keyboard di sini. Modal memakai role=dialog+aria-modal sehingga
        // otomatis dikelola infra modal-a11y (focus-trap). Kategori/akun/transaksi diambil
        // dari state global saat palette DIBUKA (segar tanpa langkah sinkron tambahan).
        let _paletteIndex = [], _paletteResults = [], _paletteSel = 0;
        const PALETTE_ICON = { view: 'fa-location-arrow', category: 'fa-tag', account: 'fa-wallet', transaction: 'fa-receipt' };
        function paletteEnsureIndex() {
            const views = [
                { name: 'dashboard', label: 'Dashboard' }, { name: 'transaksi', label: 'Riwayat Transaksi' },
                { name: 'budget', label: 'Budget' }, { name: 'laporan', label: 'Analisis' },
                { name: 'aset', label: 'Aset' }, { name: 'kalender', label: 'Kalender' },
                { name: 'pengaturan', label: 'Pengaturan' },
            ];
            const recentTx = [...(globalData || [])].sort((a, b) => String(b.tanggal || '').localeCompare(String(a.tanggal || ''))).slice(0, 200);
            _paletteIndex = servicesModule.buildCommandIndex({ views, categoryDict, accounts: appSettings.accounts || [], transactions: recentTx });
        }
        function paletteRender() {
            const box = document.getElementById('paletteResults');
            if (!_paletteResults.length) {
                box.innerHTML = '<p class="text-center text-xs text-slate-400 py-6">Tidak ada hasil. Coba kata kunci lain.</p>';
                return;
            }
            box.innerHTML = _paletteResults.map((c, i) => `
                <button type="button" role="option" aria-selected="${i === _paletteSel}" onclick="palettePick(${i})" onmousemove="paletteHover(${i})" class="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl transition ${i === _paletteSel ? 'bg-indigo-50' : 'hover:bg-slate-50'}">
                    <span class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0"><i class="fas ${PALETTE_ICON[c.type] || 'fa-circle'} text-slate-500 text-xs"></i></span>
                    <span class="min-w-0 flex-1">
                        <span class="block text-xs md:text-sm font-bold text-slate-700 truncate">${escapeHtml(c.label)}</span>
                        <span class="block text-[10px] text-slate-400 truncate">${escapeHtml(c.sub || '')}</span>
                    </span>
                </button>`).join('');
            const el = box.querySelector('[aria-selected="true"]');
            if (el) el.scrollIntoView({ block: 'nearest' });
        }
        function paletteSearch(q) {
            _paletteResults = servicesModule.searchCommands(_paletteIndex, q, { limit: 10 });
            _paletteSel = 0;
            paletteRender();
        }
        function openCommandPalette() {
            paletteEnsureIndex();
            document.getElementById('modalPalette').classList.remove('hidden');
            const input = document.getElementById('paletteInput');
            input.value = '';
            paletteSearch('');
            input.focus();
        }
        function closeCommandPalette() { document.getElementById('modalPalette').classList.add('hidden'); }
        function paletteHover(i) { if (i >= 0 && i !== _paletteSel) { _paletteSel = i; paletteRender(); } }
        function palettePick(i) {
            const c = _paletteResults[i];
            if (!c) return;
            closeCommandPalette();
            if (c.type === 'view') switchView(c.view);
            else if (c.type === 'category') openCategoryDetail(c.catName, c.jenis);
            else if (c.type === 'account') openAccountDetail(c.accountName);
            else if (c.type === 'transaction') {
                switchView('transaksi');
                const inp = document.getElementById('txSearchInput');
                if (inp) { inp.value = c.label; debouncedFilterTransactions(); }
            }
        }
        // Wire input sekali (markup palette ada sebelum blok script ini dieksekusi).
        (function () {
            const inp = document.getElementById('paletteInput');
            if (inp) inp.addEventListener('input', (e) => paletteSearch(e.target.value));
        })();

        document.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
                e.preventDefault();
                const m = document.getElementById('modalPalette');
                if (m && !m.classList.contains('hidden')) closeCommandPalette();
                else openCommandPalette();
                return;
            }
            const m = document.getElementById('modalPalette');
            if (!m || m.classList.contains('hidden')) return;
            if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeCommandPalette(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); _paletteSel = Math.min(_paletteSel + 1, _paletteResults.length - 1); paletteRender(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); _paletteSel = Math.max(_paletteSel - 1, 0); paletteRender(); }
            else if (e.key === 'Enter') { e.preventDefault(); palettePick(_paletteSel); }
        });

        // ==================== DATA CONTOH (onboarding Tier-3 #8) ====================
        // Seeder memakai src/domain/demo-data.js (murni, deterministik, ter-unit-test):
        // seluruh baris diberi prefix keterangan "[Demo] " supaya mudah dibersihkan
        // massal oleh removeDemoData() TANPA menyentuh transaksi asli user.
        async function seedDemoData() {
            const jumlah = servicesModule.buildDemoTransactions({ today: new Date(), accounts: appSettings.accounts || [] }).length;
            showConfirm(
                `Ini akan menambahkan ${jumlah} transaksi contoh (gaji, belanja, tagihan, makan, transport; bulan lalu + bulan ini) ke akunmu. Semuanya bertanda [Demo] dan bisa dihapus massal dari Pengaturan > Data & Backup. Lanjutkan?`,
                doSeedDemoData
            );
        }
        async function doSeedDemoData() {
            showLoading(true);
            try {
                const user_id = await currentUserId();
                if (!user_id) { showErrorToast('Sesi login sudah berakhir, coba login ulang.'); return; }
                const rows = servicesModule.buildDemoTransactions({ today: new Date(), accounts: appSettings.accounts || [] })
                    .map((r) => ({ ...r, user_id }));
                const { error } = await supabaseClient.from('transactions').insert(rows);
                if (error) throw error;
                showSuccessToast('Data contoh berhasil ditambahkan! Memuat ulang...');
                loadData();
            } catch (e) {
                console.error('Seed data contoh gagal:', e);
                showErrorToast('Gagal menambahkan data contoh. Periksa koneksi internet kamu.');
            } finally {
                showLoading(false);
            }
        }
        async function removeDemoData() {
            showConfirm(
                'Hapus SEMUA transaksi contoh bertanda [Demo] dari akunmu? Transaksi asli kamu tidak akan tersentuh.',
                async () => {
                    showLoading(true);
                    try {
                        const user_id = await currentUserId();
                        if (!user_id) { showErrorToast('Sesi login sudah berakhir, coba login ulang.'); return; }
                        const { error } = await supabaseClient.from('transactions').delete()
                            .eq('user_id', user_id)
                            .like('keterangan', servicesModule.DEMO_MARKER + '%');
                        if (error) throw error;
                        showSuccessToast('Data contoh dihapus. Memuat ulang...');
                        loadData();
                    } catch (e) {
                        console.error('Hapus data contoh gagal:', e);
                        showErrorToast('Gagal menghapus data contoh. Coba lagi.');
                    } finally {
                        showLoading(false);
                    }
                }
            );
        }
        // Toggle kartu onboarding: hanya tampil saat user belum punya SATU transaksi pun.
        // Dipanggil di akhir loadData sukses (setelah globalData terisi) -- status lain
        // (mis. baris demo barusan dihapus sampai habis) otomatis konsisten.
        function updateDashboardEmptyState() {
            const el = document.getElementById('dashboard-empty-state');
            if (el) el.classList.toggle('hidden', !(Array.isArray(globalData) && globalData.length === 0));
        }

        // ---------- AKUN ----------
        function renderAccountList() {
            const ul = document.getElementById('list-accounts');
            if (appSettings.accounts.length === 0) {
                ul.innerHTML = `<li class="text-center text-[11px] text-slate-400 py-8">Belum ada akun.<br>Yuk tambahin dulu 👛</li>`;
                return;
            }
            // Dibangun sebagai array lalu digabung sekali di akhir (bukan innerHTML += per item di
            // dalam loop) -- innerHTML += berulang membuat browser mem-parse ulang SELURUH isi <ul>
            // dari nol di tiap iterasi, jadi O(n²) padahal cukup O(n).
            ul.innerHTML = appSettings.accounts.map((item, i) => `
                    <li class="group flex justify-between items-center gap-2 bg-slate-50 hover:bg-slate-100/80 p-2 rounded-2xl text-sm font-semibold text-slate-700 transition" id="acc-row-${i}">
                        <span class="flex items-center min-w-0">
                            <span class="w-7 h-7 mr-2.5 flex-shrink-0 flex items-center justify-center rounded-full overflow-hidden bg-white ring-1 ring-slate-100">${getAccountLogo(item)}</span>
                            <span class="truncate">${escapeHtml(item)}</span>
                        </span>
                        <span class="flex items-center gap-1 flex-shrink-0">
                            <button onclick="openAccountModal(${i})" aria-label="Ubah akun" class="w-9 h-9 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 active:scale-90 transition flex items-center justify-center"><i class="fas fa-pencil text-xs"></i></button>
                            <button onclick="removeSetting('accounts', ${i})" aria-label="Hapus akun" class="w-9 h-9 rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-50 active:scale-90 transition flex items-center justify-center"><i class="fas fa-trash text-xs"></i></button>
                        </span>
                    </li>`).join('');
        }

        // ---------- MODAL TAMBAH / EDIT AKUN (icon kustom + saldo awal) ----------
        let editAccountIndex = null;
        let accountIconOverride = null;

        function openAccountModal(index) {
            editAccountIndex = (typeof index === 'number') ? index : null;
            const isEdit = editAccountIndex !== null;
            const currentName = isEdit ? appSettings.accounts[editAccountIndex] : '';

            document.getElementById('accModalTitle').innerText = isEdit ? 'Edit Akun' : 'Tambah Akun Baru';
            document.getElementById('accModalSubmitBtn').innerText = isEdit ? 'Simpan Perubahan' : 'Simpan Akun';
            document.getElementById('acc-modal-name').value = currentName;
            document.getElementById('acc-modal-currency').value = (appSettings.account_currencies && appSettings.account_currencies[currentName]) || 'IDR';
            document.getElementById('acc-modal-saldo-wrap').classList.toggle('hidden', isEdit);
            document.getElementById('acc-modal-saldo').value = '';
            document.getElementById('acc-modal-saldo-display').value = '';
            document.getElementById('acc-modal-upload-input').value = '';
            closeAccountModalSuggestions();

            const existingIcon = (appSettings.accountIcons && appSettings.accountIcons[currentName]) || null;
            accountIconOverride = existingIcon ? Object.assign({}, existingIcon) : null;

            setAccIconTab(accountIconOverride && accountIconOverride.type === 'image' ? 'upload' : 'palette');
            refreshAccountIconPreview();

            const modal = document.getElementById('modalAccount'); const content = document.getElementById('modalAccountContent');
            modal.classList.remove('hidden');
            setTimeout(() => { content.classList.remove('translate-y-full', 'md:scale-95', 'opacity-0'); }, 10);
            setTimeout(() => { document.getElementById('acc-modal-name').focus(); }, 300);
        }

        function closeAccountModal() {
            const content = document.getElementById('modalAccountContent');
            content.classList.add('translate-y-full', 'md:scale-95', 'opacity-0');
            setTimeout(() => { document.getElementById('modalAccount').classList.add('hidden'); }, 300);
            closeAccountModalSuggestions();
        }

        function setAccIconTab(tab) {
            document.getElementById('acc-icon-panel-palette').classList.toggle('hidden', tab !== 'palette');
            document.getElementById('acc-icon-panel-upload').classList.toggle('hidden', tab !== 'upload');
            document.getElementById('acc-icon-tab-palette').className = `flex-1 py-1.5 rounded-lg transition-all ${tab==='palette' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`;
            document.getElementById('acc-icon-tab-upload').className = `flex-1 py-1.5 rounded-lg transition-all ${tab==='upload' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`;
        }

        function renderAccountIconPalette() {
            const wrap = document.getElementById('acc-icon-panel-palette'); if (!wrap) return;
            wrap.innerHTML = accountIconPalette.map(p => {
                const isSelected = accountIconOverride && accountIconOverride.type === 'icon' && accountIconOverride.value === p.icon && accountIconOverride.bg === p.bg;
                return `<button type="button" onmousedown="event.preventDefault();" onclick="pickAccountIconPalette('${p.icon}','${p.bg}','${p.color}')" aria-label="Pilih ikon dan warna ini" class="aspect-square rounded-xl ${p.bg} ${p.color} flex items-center justify-center transition ${isSelected ? 'ring-2 ring-offset-2 ring-blue-500' : 'hover:scale-105'}"><i class="fas ${p.icon} text-sm"></i></button>`;
            }).join('');
        }

        function pickAccountIconPalette(icon, bg, color) {
            accountIconOverride = { type: 'icon', value: icon, bg: bg, color: color };
            refreshAccountIconPreview();
        }

        function resetAccountIconToAuto() {
            accountIconOverride = null;
            document.getElementById('acc-modal-upload-input').value = '';
            refreshAccountIconPreview();
        }

        function handleAccountIconUpload(e) {
            const file = e.target.files && e.target.files[0]; if (!file) return;
            if (!file.type.startsWith('image/')) { alert('File harus berupa gambar (PNG/JPG).'); e.target.value = ''; return; }
            if (file.size > 8 * 1024 * 1024) { alert('Ukuran gambar maksimal 8MB ya (akan otomatis dikecilkan setelah dipilih).'); e.target.value = ''; return; }
            const reader = new FileReader();
            reader.onload = function (ev) {
                compressImageDataUrl(ev.target.result, 480, 0.82).then(function (compressed) {
                    accountIconOverride = { type: 'image', value: compressed, alt: document.getElementById('acc-modal-name').value };
                    refreshAccountIconPreview();
                }).catch(function () {
                    if (file.size > 1024 * 1024) { alert('Gagal memproses gambar ini. Coba gambar lain.'); e.target.value = ''; return; }
                    accountIconOverride = { type: 'image', value: ev.target.result, alt: document.getElementById('acc-modal-name').value };
                    refreshAccountIconPreview();
                });
            };
            reader.readAsDataURL(file);
        }

        function refreshAccountIconPreview() {
            const name = document.getElementById('acc-modal-name').value;
            const previewEl = document.getElementById('acc-modal-preview');
            const statusEl = document.getElementById('acc-modal-status');
            const resetBtn = document.getElementById('acc-modal-reset-auto');
            const autoObj = detectAutoAccountIcon(name);

            if (accountIconOverride) {
                previewEl.innerHTML = renderAccountIconObj(accountIconOverride, 'text-2xl');
                statusEl.innerHTML = '<i class="fas fa-pen mr-1.5"></i> Pakai ikon kustom';
                statusEl.className = 'text-[10px] font-bold text-indigo-500 flex items-center -mt-3';
                resetBtn.classList.toggle('hidden', !autoObj);
            } else if (autoObj) {
                previewEl.innerHTML = renderAccountIconObj(autoObj, 'text-2xl');
                statusEl.innerHTML = '<i class="fas fa-circle-check mr-1.5"></i> Logo terdeteksi otomatis';
                statusEl.className = 'text-[10px] font-bold text-emerald-500 flex items-center -mt-3';
                resetBtn.classList.add('hidden');
            } else {
                previewEl.innerHTML = renderAccountIconObj(null, 'text-2xl');
                statusEl.innerHTML = name.trim()
                    ? '<i class="fas fa-triangle-exclamation mr-1.5"></i> Logo tidak ditemukan, pilih ikon sendiri di bawah'
                    : 'Ketik nama akun, atau langsung pilih ikon sendiri di bawah';
                statusEl.className = `text-[10px] font-bold ${name.trim() ? 'text-amber-500' : 'text-slate-400'} flex items-center -mt-3`;
                resetBtn.classList.add('hidden');
            }
            renderAccountIconPalette();
        }

        // ===== Modal Kustomisasi Kategori (ikon/warna/gambar kustom) =====
        // Aturan: KATEGORI UTAMA bebas pilih ikon+warna. SUB-KATEGORI cuma bisa pilih bentuk ikon --
        // warnanya terkunci ikut warna kategori utamanya (lihat getCategoryStyle() untuk resolusinya).
        let categoryStyleOverride = null; // null = pakai gaya bawaan; { type:'icon', value, bg, color } (parent) / { type:'icon', value } (sub) / { type:'image', value }
        let categoryStyleContext = { jenisKey: null, catName: null, jenisProper: null, parentName: null, isSub: false, lockedBg: null, lockedColor: null };

        function openCategoryStyleModal(jenisKey, catName, parentName) {
            const jenisProper = jenisKey === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran';
            const isSub = !!parentName && parentName !== catName;
            const lockedStyle = isSub ? getCategoryStyle(parentName, jenisProper) : null;
            categoryStyleContext = { jenisKey: jenisKey, catName: catName, jenisProper: jenisProper, parentName: parentName || null, isSub: isSub, lockedBg: lockedStyle ? lockedStyle.bg : null, lockedColor: lockedStyle ? lockedStyle.color : null };
            const existing = appSettings.categoryStyles && appSettings.categoryStyles[jenisKey] && appSettings.categoryStyles[jenisKey][catName];
            categoryStyleOverride = existing ? Object.assign({}, existing) : null;
            document.getElementById('catstyle-modal-subtitle').innerText = isSub ? `${catName} (bagian dari ${parentName})` : catName;
            document.getElementById('catstyle-upload-input').value = '';
            const colorNote = document.getElementById('catstyle-color-lock-note');
            const sectionLabel = document.getElementById('catstyle-section-label');
            if (isSub) {
                sectionLabel.innerText = 'Bentuk Ikon';
                colorNote.classList.remove('hidden');
            } else {
                sectionLabel.innerText = 'Ikon & Warna';
                colorNote.classList.add('hidden');
            }
            setCatStyleTab('palette');
            refreshCategoryStylePreview();
            const modal = document.getElementById('modalCategoryStyle');
            modal.classList.remove('hidden');
            requestAnimationFrame(() => document.getElementById('modalCategoryStyleContent').classList.remove('translate-y-full', 'md:scale-95', 'opacity-0'));
        }

        function closeCategoryStyleModal() {
            const content = document.getElementById('modalCategoryStyleContent');
            content.classList.add('translate-y-full', 'md:scale-95', 'opacity-0');
            setTimeout(() => { document.getElementById('modalCategoryStyle').classList.add('hidden'); }, 300);
        }

        function setCatStyleTab(tab) {
            document.getElementById('catstyle-panel-palette').classList.toggle('hidden', tab !== 'palette');
            document.getElementById('catstyle-panel-upload').classList.toggle('hidden', tab !== 'upload');
            document.getElementById('catstyle-tab-palette').className = `flex-1 py-1.5 rounded-lg transition-all ${tab==='palette' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`;
            document.getElementById('catstyle-tab-upload').className = `flex-1 py-1.5 rounded-lg transition-all ${tab==='upload' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`;
        }

        function renderCategoryStylePalette() {
            const wrap = document.getElementById('catstyle-panel-palette'); if (!wrap) return;
            if (categoryStyleContext.isSub) {
                // Terkunci: semua pilihan dirender pakai warna kategori utama, cuma bentuk ikonnya yang beda.
                const bg = categoryStyleContext.lockedBg, color = categoryStyleContext.lockedColor;
                wrap.innerHTML = categoryIconPalette.map(p => {
                    const isSelected = categoryStyleOverride && categoryStyleOverride.type === 'icon' && categoryStyleOverride.value === p.icon;
                    return `<button type="button" onmousedown="event.preventDefault();" onclick="pickCategoryStyleIconOnly('${p.icon}')" aria-label="Pilih ikon ini" class="aspect-square rounded-xl ${bg} ${color} flex items-center justify-center transition ${isSelected ? 'ring-2 ring-offset-2 ring-blue-500' : 'hover:scale-105'}"><i class="fas ${p.icon} text-sm"></i></button>`;
                }).join('');
            } else {
                wrap.innerHTML = categoryIconPalette.map(p => {
                    const isSelected = categoryStyleOverride && categoryStyleOverride.type === 'icon' && categoryStyleOverride.value === p.icon && categoryStyleOverride.bg === p.bg;
                    return `<button type="button" onmousedown="event.preventDefault();" onclick="pickCategoryStylePalette('${p.icon}','${p.bg}','${p.color}')" aria-label="Pilih ikon dan warna ini" class="aspect-square rounded-xl ${p.bg} ${p.color} flex items-center justify-center transition ${isSelected ? 'ring-2 ring-offset-2 ring-blue-500' : 'hover:scale-105'}"><i class="fas ${p.icon} text-sm"></i></button>`;
                }).join('');
            }
        }

        function pickCategoryStylePalette(icon, bg, color) {
            categoryStyleOverride = { type: 'icon', value: icon, bg: bg, color: color };
            refreshCategoryStylePreview();
        }

        // Khusus sub-kategori -- TIDAK menyimpan bg/color sama sekali (warnanya selalu diambil ulang
        // dari kategori utama saat ditampilkan, lihat getCategoryStyle()), jadi kalau warna kategori
        // utama diganti nanti, semua sub-nya otomatis ikut berubah tanpa perlu disimpan ulang.
        function pickCategoryStyleIconOnly(icon) {
            categoryStyleOverride = { type: 'icon', value: icon };
            refreshCategoryStylePreview();
        }

        function resetCategoryStyleToDefault() {
            categoryStyleOverride = null;
            document.getElementById('catstyle-upload-input').value = '';
            refreshCategoryStylePreview();
        }

        function handleCategoryStyleUpload(e) {
            const file = e.target.files && e.target.files[0]; if (!file) return;
            if (!file.type.startsWith('image/')) { alert('File harus berupa gambar (PNG/JPG).'); e.target.value = ''; return; }
            if (file.size > 8 * 1024 * 1024) { alert('Ukuran gambar maksimal 8MB ya (akan otomatis dikecilkan setelah dipilih).'); e.target.value = ''; return; }
            const reader = new FileReader();
            reader.onload = function (ev) {
                compressImageDataUrl(ev.target.result, 480, 0.82).then(function (compressed) {
                    categoryStyleOverride = { type: 'image', value: compressed };
                    refreshCategoryStylePreview();
                }).catch(function () {
                    if (file.size > 1024 * 1024) { alert('Gagal memproses gambar ini. Coba gambar lain.'); e.target.value = ''; return; }
                    categoryStyleOverride = { type: 'image', value: ev.target.result };
                    refreshCategoryStylePreview();
                });
            };
            reader.readAsDataURL(file);
        }

        function refreshCategoryStylePreview() {
            const previewEl = document.getElementById('catstyle-preview');
            const baseStyle = resolveBaseCategoryStyle(categoryStyleContext.catName, categoryStyleContext.jenisProper);
            let previewStyle;
            if (!categoryStyleOverride) {
                previewStyle = baseStyle;
            } else if (categoryStyleOverride.type === 'image') {
                previewStyle = Object.assign({}, baseStyle, { image: categoryStyleOverride.value });
            } else if (categoryStyleContext.isSub) {
                // Warna preview sub SELALU ikut warna kategori utama saat ini, bukan bg/color di
                // override (yang untuk sub memang sengaja tidak disimpan).
                previewStyle = Object.assign({}, baseStyle, { icon: categoryStyleOverride.value, bg: categoryStyleContext.lockedBg, color: categoryStyleContext.lockedColor, image: null });
            } else {
                previewStyle = Object.assign({}, baseStyle, { icon: categoryStyleOverride.value, bg: categoryStyleOverride.bg, color: categoryStyleOverride.color, image: null });
            }
            previewEl.innerHTML = categoryIconHtml(previewStyle, 'w-full h-full flex items-center justify-center', 'text-2xl');
            renderCategoryStylePalette();
        }

        function submitCategoryStyleModal() {
            const { jenisKey, catName } = categoryStyleContext;
            if (!appSettings.categoryStyles) appSettings.categoryStyles = { pengeluaran: {}, pemasukan: {} };
            if (!appSettings.categoryStyles[jenisKey]) appSettings.categoryStyles[jenisKey] = {};
            const key = categoryStyleKey(jenisKey, catName);

            if (categoryStyleOverride) {
                appSettings.categoryStyles[jenisKey][catName] = categoryStyleOverride;
                // Pensyahan api.run (slice settings+icons): service langsung, callback persis versi lama.
                servicesModule.saveCustomIcon(supabaseClient, key, categoryStyleOverride).catch((err) => {
                    console.error('api.run.saveCustomIcon gagal:', err);
                    showErrorToast('Gagal menyimpan kustomisasi kategori ke cloud. Coba lagi.');
                });
            } else {
                delete appSettings.categoryStyles[jenisKey][catName];
                servicesModule.deleteCustomIcon(supabaseClient, key).catch((err) => {
                    console.error('api.run.deleteCustomIcon gagal:', err);
                    showErrorToast('Gagal menghapus kustomisasi kategori di cloud. Coba lagi.');
                });
            }

            closeCategoryStyleModal();
            showSuccessToast('Gaya kategori berhasil diperbarui.');
            // Refresh tampilan yang paling langsung kelihatan efeknya -- data di memori (globalData/
            // categoryDict) tidak berubah sama sekali, jadi cukup render ulang, tanpa perlu apapun dari
            // server.
            renderCategoryTree(jenisKey);
            if (typeof filterTransactions === 'function' && document.getElementById('view-transaksi') && document.getElementById('view-transaksi').classList.contains('block')) filterTransactions();
            if (typeof processDataForUI === 'function') processDataForUI(globalData);
        }

        function searchAccountModalSuggestions(query) {
            const box = document.getElementById('acc-modal-suggestions'); if (!box) return;
            const q = query.trim().toLowerCase();
            const results = q
                ? bankWalletDatabase.filter(item => item.name.toLowerCase().includes(q) || item.keywords.some(k => k.includes(q))).slice(0, 8)
                : bankWalletDatabase.slice(0, 8);
            if (results.length === 0) { box.classList.add('hidden'); box.innerHTML = ''; return; }
            box.innerHTML = `<div class="text-[10px] font-bold text-slate-400 uppercase tracking-wide px-2.5 pt-1 pb-1.5">${q ? 'Hasil Pencarian' : 'Populer di Indonesia'}</div>` +
                results.map(item => {
                    const iconHtml = item.url
                        ? `<div class="w-7 h-7 rounded-full overflow-hidden bg-white ring-1 ring-slate-100 flex-shrink-0 flex items-center justify-center p-1"><img src="${item.url}" class="w-full h-full object-contain" onerror="this.style.visibility='hidden'"></div>`
                        : `<div class="w-7 h-7 rounded-full ${item.color} text-white flex items-center justify-center font-extrabold text-[10px] flex-shrink-0">${item.badge}</div>`;
                    return `<div onmousedown="pickAccountModalSuggestion('${jsStr(item.name)}')" class="flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-slate-50 cursor-pointer transition">
                        ${iconHtml}
                        <div class="min-w-0">
                            <p class="text-xs font-bold text-slate-700 truncate">${escapeHtml(item.name)}</p>
                            <p class="text-[10px] text-slate-400">${item.category}</p>
                        </div>
                    </div>`;
                }).join('');
            box.classList.remove('hidden');
        }

        function pickAccountModalSuggestion(name) {
            const input = document.getElementById('acc-modal-name'); if (!input) return;
            input.value = name;
            accountIconOverride = null; // nama dari database dikenali -> pakai logo otomatis
            closeAccountModalSuggestions();
            refreshAccountIconPreview();
            input.focus();
        }

        function closeAccountModalSuggestions() {
            const box = document.getElementById('acc-modal-suggestions'); if (box) box.classList.add('hidden');
        }

        function submitAccountModal() {
            const nameInput = document.getElementById('acc-modal-name');
            const name = nameInput.value.trim();
            if (!name) { alert('Nama akun tidak boleh kosong ya.'); nameInput.focus(); return; }

            const isEdit = editAccountIndex !== null;
            const oldName = isEdit ? appSettings.accounts[editAccountIndex] : null;

            if (!appSettings.accountIcons) appSettings.accountIcons = {};
            const hadCustomIconBefore = isEdit && !!appSettings.accountIcons[oldName];

            if (isEdit) {
                appSettings.accounts[editAccountIndex] = name;
                // pruneAccountKeyedMaps membuang entri lama (accountIcons DAN account_currencies
                // sekaligus) saat nama akun berubah -- lihat src/domain/settings.js. Sengaja
                // dipakai juga di removeSetting() (hapus akun) supaya kedua alur ini tidak lagi
                // punya 2 salinan logic pembersihan yang bisa diam-diam berbeda satu sama lain.
                if (oldName !== name) servicesModule.pruneAccountKeyedMaps(appSettings, oldName);
            } else {
                appSettings.accounts.push(name);
            }

            // Simpan mata uang akun (kosong/"IDR" -> hapus dari map, biar map-nya cuma isi
            // pengecualian non-IDR, konsisten dengan pola accountIcons di atas).
            if (!appSettings.account_currencies) appSettings.account_currencies = {};
            const currencyInput = (document.getElementById('acc-modal-currency').value || '').trim().toUpperCase();
            if (currencyInput && currencyInput !== 'IDR') { appSettings.account_currencies[name] = currencyInput; }
            else { delete appSettings.account_currencies[name]; }

            // Update cache lokal dulu (tampilan langsung berubah), baru sinkronkan ke Spreadsheet.
            if (accountIconOverride) { appSettings.accountIcons[name] = accountIconOverride; }
            else { delete appSettings.accountIcons[name]; }

            persistSettings();
            renderSettings();
            if (globalData.length > 0) processDataForUI(globalData);

            // ---- Sinkronkan gambar/ikon custom (base64 upload/pilihan palet) ----
            {
                const onIconSyncFail = function() { showErrorToast('Ikon tersimpan di perangkat ini, tapi gagal sinkron ke cloud.'); };
                if (isEdit && oldName !== name && hadCustomIconBefore) {
                    servicesModule.deleteCustomIcon(supabaseClient, oldName).catch((err) => { console.error('api.run.deleteCustomIcon gagal:', err); onIconSyncFail(err); });
                }
                if (accountIconOverride) {
                    // Pensyahan api.run (slice settings+icons): service langsung, callback persis versi lama.
                    servicesModule.saveCustomIcon(supabaseClient, name, accountIconOverride).catch((err) => { console.error('api.run.saveCustomIcon gagal:', err); onIconSyncFail(err); });
                } else if (hadCustomIconBefore) {
                    servicesModule.deleteCustomIcon(supabaseClient, name).catch((err) => { console.error('api.run.deleteCustomIcon gagal:', err); onIconSyncFail(err); });
                }
            }

            const saldoAwal = parseInt(document.getElementById('acc-modal-saldo').value) || 0;
            closeAccountModal();
            showSuccessToast(isEdit ? 'Akun berhasil diperbarui.' : 'Akun berhasil ditambahkan.');

            if (!isEdit && saldoAwal > 0) {
                showLoading(true);
                const data = {
                    jenis: 'Pemasukan', tanggal: todayDateStr(),
                    jumlah: String(saldoAwal), akun: name, kategori: 'Saldo Awal', keterangan: 'Saldo awal saat akun dibuat'
                };
                // Pensyahan api.run (slice transactions): service langsung, mapping payload di
                // servicesModule.toCreateRecord (body addTransactionRemote adapter lama), callback persis.
                // Tidak perlu refresh penuh: baris hasil simpan (dari server) dipakai echo lokal.
                transactionService.create(servicesModule.toCreateRecord(data))
                    .then((row) => { applyLocalTxEcho('insert', row, null, null); })
                    .catch((err) => {
                        console.error('api.run.addTransaction gagal:', err);
                        showErrorToast('Akun tersimpan, tapi gagal mencatat saldo awal. Silakan tambahkan manual lewat menu Tambah Transaksi.');
                    });
            }
        }

        function removeSetting(type, i) {
            const doRemove = () => {
                const removedName = type === 'accounts' ? appSettings[type][i] : null;
                appSettings[type].splice(i, 1);
                if (removedName) {
                    // BUG FIX: dulu di sini cuma appSettings.accountIcons yang dibersihkan --
                    // appSettings.account_currencies untuk nama akun yang dihapus TIDAK ikut
                    // dibuang. Efeknya: kalau nanti user bikin akun BARU dengan nama PERSIS SAMA
                    // dengan akun lama yang sudah dihapus (mis. akun lama "Rekening USD" pernah
                    // di-set currency USD), akun baru itu diam-diam ikut dianggap USD juga oleh
                    // getAccountCurrency() -- padahal user mengira ini akun IDR biasa. Sekarang
                    // pakai fungsi yang sama dengan alur rename (submitAccountModal) supaya kedua
                    // tempat ini tidak lagi bisa divergen satu sama lain.
                    const hadEntry = servicesModule.pruneAccountKeyedMaps(appSettings, removedName);
                    if (hadEntry.accountIcons) {
                        servicesModule.deleteCustomIcon(supabaseClient, removedName).catch((err) => {
                            console.error('api.run.deleteCustomIcon gagal:', err);
                            showErrorToast('Akun terhapus, tapi ikon kustomnya gagal dibersihkan dari cloud.');
                        });
                    }
                }
                persistSettings(); renderSettings(); if(globalData.length > 0) processDataForUI(globalData);
            };

            if (type === 'accounts') {
                const accName = appSettings.accounts[i];
                // BUG FIX: sebelumnya menghapus akun langsung jalan tanpa peringatan apa pun kalau
                // akun itu masih dipakai transaksi -- user mengira transaksinya IKUT terhapus (jadi
                // "hilang"), padahal transaksinya TIDAK dihapus dari database sama sekali. Yang
                // sebenarnya terjadi: begitu nama akun itu tidak ada lagi di daftar, transaksi2
                // tersebut jadi "yatim" -- tidak lagi muncul di kartu ringkasan Akun & tidak bisa
                // dibuka lewat Detail Akun (kartunya sudah tidak ada), saldo per-akunnya juga tidak
                // lagi dihitung -- walau transaksinya sendiri tetap ada & tetap muncul apa adanya di
                // Riwayat Transaksi/Laporan. Sekarang dicek dulu berapa transaksi yang terdampak,
                // supaya user bisa memutuskan lanjut atau batal dengan info yang benar.
                const affectedCount = (globalData || []).filter(t => servicesModule.isTransactionForAccount(t, accName)).length;
                const message = affectedCount > 0
                    ? `Akun "${accName}" masih dipakai di ${affectedCount} transaksi. Transaksinya TIDAK ikut terhapus (tetap ada di Riwayat Transaksi), tapi tidak lagi tampil di ringkasan & Detail Akun setelah akun ini dihapus. Lanjutkan hapus akun ini?`
                    : `Hapus akun "${accName}" dari pengaturan?`;
                showConfirm(message, doRemove);
                return;
            }

            showConfirm('Hapus item ini dari pengaturan?', doRemove);
        }

        // ---------- TEMA TAMPILAN (Terang/Gelap/Sistem) ----------
        // Preferensi disimpan di localStorage, BUKAN di Supabase -- ini pengaturan PERANGKAT/browser
        // yang sedang dipakai, bukan data akun (makanya salah satu pilihannya "Sistem", ikut OS).
        // Penerapan awal (sebelum konten pertama dirender) sudah ditangani oleh skrip kecil di
        // <head>; fungsi-fungsi di sini menangani perpindahan tema SETELAH app berjalan (lewat
        // menu Pengaturan) dan sinkronisasi kalau preferensi "Sistem" dipilih lalu OS-nya berganti
        // tema saat aplikasi masih terbuka.
        const THEME_STORAGE_KEY = 'myfinance-theme';
        const _systemDarkMql = window.matchMedia('(prefers-color-scheme: dark)');

        function getStoredThemePref() {
            let v = null;
            try { v = localStorage.getItem(THEME_STORAGE_KEY); } catch (e) { /* localStorage bisa diblokir di mode privat ketat */ }
            return (v === 'light' || v === 'dark' || v === 'system') ? v : 'system';
        }

        function resolveIsDark(pref) {
            if (pref === 'dark') return true;
            if (pref === 'light') return false;
            return _systemDarkMql.matches; // 'system'
        }

        // Dipakai oleh konfigurasi chart (Chart.js tidak ikut aturan CSS, jadi warnanya
        // perlu diatur manual lewat JS setiap kali chart dibuat/diperbarui).
        function chartGridColor() { return document.documentElement.classList.contains('dark') ? 'rgba(148,163,184,0.12)' : '#e8ebfb'; }
        function chartEmptyColor() { return document.documentElement.classList.contains('dark') ? '#1c2942' : '#e8ebfb'; } // ring donut chart saat data kosong
        function chartBorderColor() { return document.documentElement.classList.contains('dark') ? '#0d1424' : '#ffffff'; } // garis pemisah antar-segmen donut, menyatu dgn warna kartu

        // Ikon per kategori aset -- tidak seperti kategori pengeluaran/pemasukan, kategori aset (Saham,
        // Reksadana, dst) bebas diketik user jadi tidak ada tabel ikon tetapnya. Ini cuma tebakan
        // heuristik berdasarkan nama, dengan fallback ikon permata generik (senada dengan ikon
        // "Belum ada aset" di kondisi kosong).
        function detectAssetCategoryIcon(kategori) {
            const k = String(kategori || '').toLowerCase();
            if (k.includes('saham')) return 'fa-chart-line';
            if (k.includes('reksa')) return 'fa-layer-group';
            if (k.includes('emas') || k.includes('logam')) return 'fa-coins';
            if (k.includes('kripto') || k.includes('crypto') || k.includes('bitcoin')) return 'fa-bitcoin-sign';
            if (k.includes('properti') || k.includes('tanah') || k.includes('rumah')) return 'fa-house';
            if (k.includes('deposito') || k.includes('tabungan')) return 'fa-piggy-bank';
            if (k.includes('obligasi') || k.includes('bond')) return 'fa-file-contract';
            return 'fa-gem';
        }

        // Helper bersama untuk pola "donut ringkas + legend 2 teratas + daftar rincian" yang dipakai di
        // 5 tempat (Komposisi Kas & Rekening, Alokasi Aset per Kategori, Distribusi Pengeluaran/Pemasukan
        // di tab Laporan, dan Distribusi Pengeluaran per Kategori di detail akun) -- supaya kelimanya
        // konsisten & tidak menduplikasi markup yang sama 5 kali.
        // opts: { legendEl, listEl, totalEl, entries:[{label,val,iconHtml}], palette:[warna hex...],
        //         onClickItem: (label)=>string-onclick (opsional), emptyMessage }
        function renderDonutBreakdown(opts) {
            const { legendEl, listEl, totalEl, entries, palette, onClickItem, emptyMessage } = opts;
            const total = entries.reduce((s, e) => s + e.val, 0);
            if (totalEl) totalEl.innerText = 'Rp ' + formatRp(total);

            if (!entries.length || total <= 0) {
                if (legendEl) legendEl.innerHTML = '';
                if (listEl) listEl.innerHTML = `<div class="text-center text-slate-400 py-8 stagger-item"><i class="fas fa-chart-pie text-2xl mb-2 opacity-60"></i><p class="text-xs">${emptyMessage || 'Belum ada data.'}</p></div>`;
                return;
            }

            if (legendEl) {
                legendEl.innerHTML = entries.slice(0, 2).map((e, i) => `
                    <div class="flex items-center justify-between gap-3 py-1.5">
                        <div class="flex items-center gap-2 min-w-0"><span class="w-3 h-3 rounded-full flex-shrink-0" style="background:${palette[i % palette.length]}"></span><span class="text-xs md:text-sm font-bold text-slate-600 truncate">${escapeHtml(e.label)}</span></div>
                        <span class="text-xs md:text-sm font-bold text-slate-800 flex-shrink-0">${Math.round(e.val / total * 100)}%</span>
                    </div>`).join('');
            }

            if (listEl) {
                listEl.innerHTML = entries.map((e, i) => {
                    const pct = Math.round(e.val / total * 100);
                    const chartColor = palette[i % palette.length];
                    const clickable = typeof onClickItem === 'function';
                    return `<div ${clickable ? `onclick="${onClickItem(e.label)}"` : ''} class="flex items-center gap-2.5 md:gap-3 py-2.5 px-1 -mx-1 rounded-lg ${clickable ? 'cursor-pointer hud-breakdown-row transition' : ''}">
                        <span class="text-[10px] md:text-xs font-bold text-white rounded-lg px-2 py-1 flex-shrink-0 w-10 md:w-11 text-center" style="background:${chartColor}">${pct}%</span>
                        ${e.iconHtml}
                        <span class="text-xs md:text-sm font-bold text-slate-700 flex-1 min-w-0 truncate">${escapeHtml(e.label)}</span>
                        <span class="text-xs md:text-sm font-bold text-slate-600 flex-shrink-0 whitespace-nowrap">Rp ${formatShortVal(e.val)}</span>
                        ${clickable ? `<i class="fas fa-chevron-right text-slate-300 text-[10px] flex-shrink-0"></i>` : ''}
                    </div>`;
                }).join('');
            }
        }

        function updateThemeButtonsUI(pref) {
            ['light', 'dark', 'system'].forEach(p => {
                const btn = document.getElementById('theme-btn-' + p);
                if (btn) btn.classList.toggle('theme-btn-active', p === pref);
            });
        }

        // Tier-3 #11: palet grafik proporsi (Standar | Ramah Buta Warna / Okabe-Ito).
        function updateChartPaletteButtonsUI(pref) {
            ['default', 'colorblind'].forEach(p => {
                const btn = document.getElementById('chart-palette-btn-' + p);
                if (btn) btn.classList.toggle('theme-btn-active', p === pref);
            });
        }

        function setChartPalette(pref) {
            appSettings.chartPalette = (pref === 'colorblind') ? 'colorblind' : 'default';
            updateChartPaletteButtonsUI(appSettings.chartPalette);
            persistSettings();
            // Donat proporsi ikut di-render ulang bila sedang terlihat (rerenderVisibleCharts
            // tidak mencakup view kategori-detail).
            if (document.getElementById('view-kategori-detail') && !document.getElementById('view-kategori-detail').classList.contains('hidden')) {
                renderCategoryDetailMonthData();
            }
            rerenderVisibleCharts();
            showInfoToast('Palet grafik: ' + servicesModule.chartPaletteLabel(appSettings.chartPalette));
        }

        function rerenderVisibleCharts() {
            if (globalData.length === 0) return;
            if (document.getElementById('view-dashboard').classList.contains('block')) { processDataForUI(globalData); }
            if (document.getElementById('view-laporan').classList.contains('block')) { renderReportTab(); }
            if (document.getElementById('view-akun-detail').classList.contains('block')) { renderAccountDetailCharts(); }
            if (document.getElementById('view-kalender').classList.contains('block')) { renderCalendar(globalData); }
            // Tier-1 #2 (dark mode menyeluruh): view dg chart sendiri JUGA wajib
            // di-render ulang saat ganti tema, kalau tidak grid/sumbunya masih
            // memakai warna tema lama (terlihat jelas terang-di-gelap / sebaliknya).
            if (document.getElementById('view-budget').classList.contains('block')) { renderBudgetView(); }
            if (document.getElementById('view-aset').classList.contains('block')) { renderAssetView(); }
            if (document.getElementById('view-kategori-detail') && !document.getElementById('view-kategori-detail').classList.contains('hidden')) { renderCategoryDetailMonthData(); }
        }

        function applyTheme(pref, rerenderCharts) {
            const isDark = resolveIsDark(pref);
            document.documentElement.classList.toggle('dark', isDark);
            if (typeof Chart !== 'undefined') { Chart.defaults.color = document.documentElement.classList.contains('dark') ? '#a6b4d2' : '#64748b'; } // kontrasnya sudah cukup di kedua tema, tetap disegarkan tiap ganti tema
            updateThemeButtonsUI(pref);
            if (rerenderCharts) rerenderVisibleCharts();
        }

        function setThemePref(pref) {
            try { localStorage.setItem(THEME_STORAGE_KEY, pref); } catch (e) { showInfoToast('Preferensi tema tidak bisa disimpan di perangkat ini (mode privat?), tapi tetap diterapkan untuk sesi ini.'); }
            applyTheme(pref, true);
        }

        // Kalau preferensi "Sistem" aktif dan OS berganti tema (mis. jadwal dark mode otomatis HP)
        // SAAT aplikasi masih terbuka, ikut menyesuaikan tanpa perlu refresh.
        _systemDarkMql.addEventListener('change', () => {
            if (getStoredThemePref() === 'system') applyTheme('system', true);
        });


        // Menampilkan email/nama/foto profil ke semua elemen yang punya atribut
        // data-user-email / data-user-name / data-user-avatar di halaman manapun
        // (sidebar, kartu "Akun Saya", modal edit profil). Dipanggil dari renderSettings()
        // (jadi otomatis ter-refresh tiap kali loadData()/persistSettings terjadi) dan
        // dari applySessionToUI() saat login pertama kali.
        function renderUserIdentity() {
            const email = (currentSession && currentSession.user && currentSession.user.email) || '';
            const profile = appSettings.profile || {};
            const displayName = (profile.full_name && profile.full_name.trim()) ? profile.full_name.trim() : (email ? email.split('@')[0] : 'Pengguna');

            document.querySelectorAll('[data-user-email]').forEach(el => { el.textContent = email || '-'; });
            document.querySelectorAll('[data-user-name]').forEach(el => { el.textContent = displayName; });

            const avatarObj = (appSettings.accountIcons && appSettings.accountIcons[PROFILE_AVATAR_KEY]) || null;
            document.querySelectorAll('[data-user-avatar]').forEach(el => {
                // Simpan markup fallback ASLI milik elemen ini (beda-beda tiap tempat: chip sidebar
                // pakai ikon putih di atas lingkaran gradien, kartu Pengaturan pakai ikon abu-abu
                // polos, dst) supaya saat foto dihapus, elemen kembali ke tampilan aslinya masing-
                // masing -- bukan satu gaya fallback yang dipaksakan sama untuk semua elemen.
                if (el.dataset.avatarDefaultHtml === undefined) { el.dataset.avatarDefaultHtml = el.innerHTML; }
                el.innerHTML = avatarObj ? renderAccountIconObj(avatarObj, 'text-lg') : el.dataset.avatarDefaultHtml;
            });
        }

        let profileAvatarOverride = undefined; // undefined = tidak diubah, null = dihapus, object = foto baru

        function openProfileModal() {
            const profile = appSettings.profile || { full_name: '', phone: '', bio: '' };
            document.getElementById('profile-modal-name').value = profile.full_name || '';
            document.getElementById('profile-modal-phone').value = profile.phone || '';
            document.getElementById('profile-modal-bio').value = profile.bio || '';
            document.getElementById('profile-modal-upload-input').value = '';
            profileAvatarOverride = undefined;
            refreshProfileAvatarPreview();
            const u = (currentSession && currentSession.user) || {};
            const emailEl = document.getElementById('profile-modal-email');
            if (emailEl) emailEl.textContent = u.email || '-';
            const sinceEl = document.getElementById('profile-modal-since');
            if (sinceEl) {
                try { sinceEl.textContent = u.created_at ? new Date(u.created_at).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : '-'; }
                catch (e) { sinceEl.textContent = '-'; }
            }

            const modal = document.getElementById('modalProfile'); const content = document.getElementById('modalProfileContent');
            modal.classList.remove('hidden');
            setTimeout(() => { content.classList.remove('translate-y-full', 'md:scale-95', 'opacity-0'); }, 10);
        }

        function closeProfileModal() {
            const content = document.getElementById('modalProfileContent');
            content.classList.add('translate-y-full', 'md:scale-95', 'opacity-0');
            setTimeout(() => { document.getElementById('modalProfile').classList.add('hidden'); }, 300);
        }

        function currentProfileAvatarObj() {
            if (profileAvatarOverride === null) return null; // ditandai untuk dihapus
            if (profileAvatarOverride) return profileAvatarOverride; // foto baru dipilih
            return (appSettings.accountIcons && appSettings.accountIcons[PROFILE_AVATAR_KEY]) || null; // foto lama
        }

        function refreshProfileAvatarPreview() {
            const previewEl = document.getElementById('profile-modal-preview');
            const removeBtn = document.getElementById('profile-modal-remove-photo');
            const obj = currentProfileAvatarObj();
            previewEl.innerHTML = obj
                ? renderAccountIconObj(obj, 'text-3xl')
                : `<i class="fas fa-user text-3xl text-slate-300"></i>`;
            if (removeBtn) removeBtn.classList.toggle('hidden', !obj);
        }

        // Mengecilkan & mengompres gambar lewat <canvas> sebelum diunggah -- gambar HP modern
        // (apalagi foto profil dari kamera) gampang mendekati batas 1MB mentah, yang begitu
        // di-base64 jadi ~1.3MB+ dalam SATU payload JSON. Ikon logo akun biasanya jauh lebih kecil
        // secara alami, makanya masalah ini lebih sering muncul di foto profil. Dikecilkan ke maks
        // 480px sisi terpanjang (lebih dari cukup untuk avatar bulat kecil) & JPEG kualitas 82%,
        // biasanya turun jadi puluhan-ratusan KB saja -- jauh lebih andal buat tersinkron ke cloud.
        function compressImageDataUrl(dataUrl, maxDim, quality) {
            return new Promise(function (resolve, reject) {
                const img = new Image();
                img.onload = function () {
                    let w = img.width, h = img.height;
                    if (w > maxDim || h > maxDim) {
                        if (w >= h) { h = Math.round(h * (maxDim / w)); w = maxDim; }
                        else { w = Math.round(w * (maxDim / h)); h = maxDim; }
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    // Gambar dulu ke canvas yang MASIH transparan (tanpa fill warna apa pun) supaya
                    // kita bisa mendeteksi apakah sumbernya punya area transparan (mis. logo PNG yang
                    // background-nya sudah dihapus).
                    ctx.drawImage(img, 0, 0, w, h);

                    let hasTransparency = false;
                    try {
                        const { data } = ctx.getImageData(0, 0, w, h);
                        for (let i = 3; i < data.length; i += 4) {
                            if (data[i] < 255) { hasTransparency = true; break; }
                        }
                    } catch (err) {
                        // getImageData bisa gagal kalau canvas "tainted" (mis. isu CORS). Kalau begitu
                        // anggap tidak transparan supaya tetap fallback ke alur lama (JPEG).
                        hasTransparency = false;
                    }

                    if (hasTransparency) {
                        // PENTING: kalau sumbernya punya area transparan, JANGAN dikonversi ke JPEG.
                        // JPEG tidak punya alpha channel, jadi tiap pixel semi-transparan di tepi logo
                        // (hasil anti-aliasing saat background dihapus) akan "dicampur" dengan warna
                        // fill di belakangnya dan muncul sebagai pinggiran putih/pudar di sekeliling
                        // logo. Ekspor sebagai PNG supaya transparansi -- termasuk di tepi -- tetap
                        // terjaga persis seperti aslinya.
                        try { resolve(canvas.toDataURL('image/png')); }
                        catch (err) { reject(err); }
                    } else {
                        // Tidak ada transparansi sama sekali (mis. hasil foto/JPEG) -- aman dan lebih
                        // hemat ukuran file kalau dikompres sebagai JPEG.
                        try { resolve(canvas.toDataURL('image/jpeg', quality)); }
                        catch (err) { reject(err); }
                    }
                };
                img.onerror = function () { reject(new Error('Gagal memuat gambar')); };
                img.src = dataUrl;
            });
        }

        function handleProfileAvatarUpload(e) {
            const file = e.target.files && e.target.files[0]; if (!file) return;
            if (!file.type.startsWith('image/')) { alert('File harus berupa gambar (PNG/JPG).'); e.target.value = ''; return; }
            if (file.size > 8 * 1024 * 1024) { alert('Ukuran file maksimal 8MB ya (akan otomatis dikecilkan setelah dipilih).'); e.target.value = ''; return; }
            const reader = new FileReader();
            reader.onload = function (ev) {
                compressImageDataUrl(ev.target.result, 480, 0.82).then(function (compressed) {
                    profileAvatarOverride = { type: 'image', value: compressed, alt: 'Foto profil' };
                    refreshProfileAvatarPreview();
                }).catch(function () {
                    // Fallback langka: kompresi gagal -- tetap terima asal masih di bawah 1MB mentah.
                    if (file.size > 1024 * 1024) { alert('Gagal memproses gambar ini. Coba foto lain.'); e.target.value = ''; return; }
                    profileAvatarOverride = { type: 'image', value: ev.target.result, alt: 'Foto profil' };
                    refreshProfileAvatarPreview();
                });
            };
            reader.readAsDataURL(file);
        }

        function removeProfileAvatarSelection() {
            profileAvatarOverride = null;
            document.getElementById('profile-modal-upload-input').value = '';
            refreshProfileAvatarPreview();
        }

        function submitProfileModal() {
            const full_name = document.getElementById('profile-modal-name').value.trim();
            const phone = document.getElementById('profile-modal-phone').value.trim();
            const bio = document.getElementById('profile-modal-bio').value.trim();

            appSettings.profile = { full_name, phone, bio };
            persistSettings();

            const hadCustomAvatarBefore = !!(appSettings.accountIcons && appSettings.accountIcons[PROFILE_AVATAR_KEY]);
            const onAvatarSyncFail = function() { showErrorToast('Profil tersimpan, tapi foto gagal sinkron ke cloud.'); };

            if (profileAvatarOverride === null) {
                // Pengguna menghapus foto profilnya
                if (appSettings.accountIcons) delete appSettings.accountIcons[PROFILE_AVATAR_KEY];
                if (hadCustomAvatarBefore) {
                    servicesModule.deleteCustomIcon(supabaseClient, PROFILE_AVATAR_KEY).catch((err) => { console.error('api.run.deleteCustomIcon gagal:', err); onAvatarSyncFail(err); });
                }
            } else if (profileAvatarOverride) {
                // Foto baru dipilih
                if (!appSettings.accountIcons) appSettings.accountIcons = {};
                appSettings.accountIcons[PROFILE_AVATAR_KEY] = profileAvatarOverride;
                servicesModule.saveCustomIcon(supabaseClient, PROFILE_AVATAR_KEY, profileAvatarOverride).catch((err) => { console.error('api.run.saveCustomIcon gagal:', err); onAvatarSyncFail(err); });
            }
            // profileAvatarOverride === undefined -> foto tidak diubah sama sekali, tidak perlu sync apapun

            profileAvatarOverride = undefined;
            renderUserIdentity();
            closeProfileModal();
            showSuccessToast('Profil berhasil disimpan.');
        }

        function searchAssetBankSuggestions(query) {
            const box = document.getElementById('asset-platform-suggestions'); if(!box) return;
            const q = query.trim().toLowerCase();
            const results = q
                ? bankWalletDatabase.filter(item => item.category === "Investasi" && (item.name.toLowerCase().includes(q) || item.keywords.some(k => k.includes(q)))).slice(0, 5)
                : bankWalletDatabase.filter(item => item.category === "Investasi").slice(0, 5);
            
            if (results.length === 0) { box.classList.add('hidden'); box.innerHTML = ''; return; }
            box.innerHTML = results.map(item => {
                const iconHtml = item.url
                    ? `<div class="w-5 h-5 rounded flex-shrink-0 bg-white ring-1 ring-slate-100 flex items-center justify-center p-0.5"><img src="${item.url}" class="w-full h-full object-contain"></div>`
                    : `<div class="w-5 h-5 rounded ${item.color} text-white flex items-center justify-center font-bold text-[7px] flex-shrink-0">${item.badge}</div>`;
                return `<div onmousedown="pickAssetBankSuggestion('${jsStr(item.name)}')" class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer transition">
                    ${iconHtml}
                    <span class="text-xs font-bold text-slate-700 truncate">${escapeHtml(item.name)}</span>
                </div>`;
            }).join('');
            box.classList.remove('hidden');
        }
        function pickAssetBankSuggestion(name) {
            const input = document.getElementById('aset_platform'); if(!input) return;
            input.value = name;
            document.getElementById('asset-platform-suggestions').classList.add('hidden');
        }

        // ---------- KATEGORI ----------
        const categoryTreeTheme = {
            pemasukan:   { focusRing: 'ring-emerald-300', solidBtn: 'bg-emerald-500 hover:bg-emerald-600', activeText: 'text-emerald-600' },
            pengeluaran: { focusRing: 'ring-rose-300', solidBtn: 'bg-rose-500 hover:bg-rose-600', activeText: 'text-rose-600' }
        };

        function setCatFormMode(type, mode) {
            const theme = categoryTreeTheme[type];
            document.getElementById(`catform-${type}-sub`).classList.toggle('hidden', mode !== 'sub');
            document.getElementById(`catform-${type}-parent`).classList.toggle('hidden', mode !== 'parent');
            document.getElementById(`catmode-${type}-sub`).className = `flex-1 py-1.5 rounded-lg transition-all ${mode==='sub' ? 'bg-white shadow-sm '+theme.activeText : 'text-slate-400'}`;
            document.getElementById(`catmode-${type}-parent`).className = `flex-1 py-1.5 rounded-lg transition-all ${mode==='parent' ? 'bg-white shadow-sm '+theme.activeText : 'text-slate-400'}`;
        }

        function populateParentSelect(type) {
            const sel = document.getElementById('parent-select-' + type); if(!sel) return;
            const prevVal = sel.value;
            sel.innerHTML = Object.keys(categoryDict[type]).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
            if (Object.keys(categoryDict[type]).includes(prevVal)) sel.value = prevVal;
        }

        function toggleSettingsAccordion(id) {
            const el = document.getElementById(id); const ic = document.getElementById('icon-' + id); if(!el) return;
            el.classList.toggle('expanded'); if(ic) ic.classList.toggle('expanded');
        }

        function renderCategoryTree(type) {
            const container = document.getElementById('list-tree-' + type); if(!container) return;
            const dict = categoryDict[type];
            const jenisProper = type === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran';
            const customParentNames = new Set((appSettings.custom_categories[type].parents || []).map(p => p.name));
            const customSubsMap = appSettings.custom_categories[type].subs || {};

            // Dikumpulkan ke array dulu, digabung sekali di akhir -- lihat catatan di renderAccountList().
            const parentHtmlList = Object.keys(dict).map((parentName, idx) => {
                const parent = dict[parentName];
                const parentStyle = getCategoryStyle(parentName, jenisProper);
                const isCustomParent = customParentNames.has(parentName);
                const customSubsForParent = customSubsMap[parentName] || [];
                const slug = slugify(parentName);

                let subsHtml = parent.subs.map(sub => {
                    const subIdx = customSubsForParent.indexOf(sub.name);
                    const isCustomSub = subIdx !== -1;
                    const subStyle = getCategoryStyle(sub.name, jenisProper);
                    const subIconHtml = categoryIconHtml(subStyle, 'w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0', 'text-[10px]');
                    const styleBtnHtml = `<button onclick="openCategoryStyleModal('${type}','${jsStr(sub.name)}','${jsStr(parentName)}')" aria-label="Ubah ikon sub-kategori" class="w-4 h-4 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-indigo-500" title="Ubah bentuk ikon"><i class="fas fa-palette text-[10px]"></i></button>`;
                    if (isCustomSub) {
                        return `<span class="inline-flex items-center gap-1 bg-white ring-1 ring-slate-200 rounded-full pl-1 pr-1 py-1 text-[10px] font-semibold text-slate-600 m-0.5" id="sub-${type}-${slug}-${subIdx}">
                            ${subIconHtml}
                            ${escapeHtml(sub.name)}
                            ${styleBtnHtml}
                            <button onclick="startEditSub('${type}','${jsStr(parentName)}',${subIdx})" aria-label="Ubah nama sub-kategori" class="w-4 h-4 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-blue-500"><i class="fas fa-pencil text-[10px]"></i></button>
                            <button onclick="removeSub('${type}','${jsStr(parentName)}','${jsStr(sub.name)}')" aria-label="Hapus sub-kategori" class="w-4 h-4 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-rose-500"><i class="fas fa-xmark text-[10px]"></i></button>
                        </span>`;
                    }
                    return `<span class="inline-flex items-center gap-1 bg-slate-50 ring-1 ring-slate-100 rounded-full pl-1 pr-1 py-1 text-[10px] font-semibold text-slate-500 m-0.5">
                        ${subIconHtml}
                        ${escapeHtml(sub.name)}
                        ${styleBtnHtml}
                        <button onclick="removeSub('${type}','${jsStr(parentName)}','${jsStr(sub.name)}')" aria-label="Hapus sub-kategori" class="w-4 h-4 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-rose-500"><i class="fas fa-xmark text-[10px]"></i></button>
                    </span>`;
                }).join('');
                if (!subsHtml) subsHtml = `<span class="text-[10px] text-slate-300 italic px-1">Belum ada sub-kategori</span>`;

                return `
                    <div class="bg-slate-50/70 rounded-2xl overflow-hidden ring-1 ring-slate-100">
                        <div class="flex items-center justify-between p-2.5 cursor-pointer select-none" onclick="toggleSettingsAccordion('tree-${type}-${idx}')">
                            <div class="flex items-center min-w-0">
                                ${categoryIconHtml(parentStyle, 'w-7 h-7 rounded-lg flex items-center justify-center mr-2 flex-shrink-0', 'text-[11px]')}
                                <span class="text-xs font-bold text-slate-700 truncate">${escapeHtml(parentName)}</span>
                                ${isCustomParent ? `<span class="ml-1.5 text-[10px] bg-indigo-100 text-indigo-500 px-1.5 py-0.5 rounded-full font-bold flex-shrink-0">custom</span>` : ''}
                            </div>
                            <div class="flex items-center gap-1 flex-shrink-0">
                                <button onclick="event.stopPropagation(); openCategoryStyleModal('${type}','${jsStr(parentName)}')" aria-label="Ubah ikon kategori" class="w-6 h-6 rounded-lg text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 flex items-center justify-center" title="Ubah ikon/warna/gambar"><i class="fas fa-palette text-[10px]"></i></button>
                                ${parentName !== 'Lain-lain' ? `<button onclick="event.stopPropagation(); removeParentCategory('${type}','${jsStr(parentName)}')" aria-label="Hapus kategori utama" class="w-6 h-6 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 flex items-center justify-center" title="Hapus kategori"><i class="fas fa-trash text-[10px]"></i></button>` : ''}
                                <i id="icon-tree-${type}-${idx}" class="fas fa-chevron-down text-slate-400 text-[10px] accordion-icon"></i>
                            </div>
                        </div>
                        <div id="tree-${type}-${idx}" class="accordion-content">
                            <div class="px-2.5 pb-2.5 pt-0.5 border-t border-slate-100 flex flex-wrap">${subsHtml}</div>
                        </div>
                    </div>`;
            });
            container.innerHTML = parentHtmlList.join('');
        }

        function addParentCategory(type) {
            const inputEl = document.getElementById('new-parent-' + type); const val = inputEl.value.trim();
            if (!val) return;
            if (categoryDict[type][val]) { alert(`Kategori "${val}" sudah ada.`); return; }
            appSettings.custom_categories[type].parents.push({ name: val });
            persistSettings(); inputEl.value = ''; renderSettings();
        }

        function addSubCategory(type) {
            const sel = document.getElementById('parent-select-' + type); const parentName = sel.value;
            const inputEl = document.getElementById('new-sub-' + type); const val = inputEl.value.trim();
            if (!val || !parentName) return;
            if (!appSettings.custom_categories[type].subs[parentName]) appSettings.custom_categories[type].subs[parentName] = [];
            appSettings.custom_categories[type].subs[parentName].push(val);
            persistSettings(); inputEl.value = ''; renderSettings();
        }

        function startEditSub(type, parentName, idx) {
            const slug = slugify(parentName);
            const span = document.getElementById(`sub-${type}-${slug}-${idx}`); if(!span) return;
            const oldVal = appSettings.custom_categories[type].subs[parentName][idx];
            const theme = categoryTreeTheme[type];
            span.outerHTML = `
                <span class="inline-flex items-center gap-1 bg-white ring-2 ${theme.focusRing} rounded-full pl-2 pr-1 py-0.5 text-[10px] font-semibold m-0.5" id="sub-${type}-${slug}-${idx}">
                    <input type="text" id="sub-edit-input-${type}-${slug}-${idx}" value="${escapeHtml(oldVal)}" class="w-20 outline-none bg-transparent text-[10px]"
                        onkeydown="if(event.key==='Enter'){saveEditSub('${type}','${jsStr(parentName)}',${idx});} if(event.key==='Escape'){renderCategoryTree('${type}');}">
                    <button onclick="saveEditSub('${type}','${jsStr(parentName)}',${idx})" aria-label="Simpan nama sub-kategori" class="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center flex-shrink-0"><i class="fas fa-check text-[10px]"></i></button>
                </span>`;
            const inp = document.getElementById(`sub-edit-input-${type}-${slug}-${idx}`); inp.focus(); inp.select();
        }

        function saveEditSub(type, parentName, idx) {
            const slug = slugify(parentName);
            const inp = document.getElementById(`sub-edit-input-${type}-${slug}-${idx}`); const val = inp.value.trim();
            if (!val) { renderCategoryTree(type); return; }
            appSettings.custom_categories[type].subs[parentName][idx] = val;
            persistSettings(); renderSettings();
        }

        function removeSub(type, parentName, subName) {
            showConfirm(`Hapus sub-kategori "${subName}"?`, () => {
                const customArr = appSettings.custom_categories[type].subs[parentName];
                const customIdx = customArr ? customArr.indexOf(subName) : -1;
                if (customIdx !== -1) {
                    // Sub-kategori custom buatan sendiri -> hapus langsung dari daftarnya.
                    customArr.splice(customIdx, 1);
                } else {
                    // Sub-kategori BAWAAN -> "hapus" berarti disembunyikan (lihat rebuildCategoryDict()),
                    // transaksi lama yang masih memakainya tetap aman, cuma tidak bisa dipilih lagi.
                    if (!appSettings.hidden_categories[type].subs[parentName]) appSettings.hidden_categories[type].subs[parentName] = [];
                    if (!appSettings.hidden_categories[type].subs[parentName].includes(subName)) appSettings.hidden_categories[type].subs[parentName].push(subName);
                }
                persistSettings(); renderSettings();
                if (globalData.length > 0) processDataForUI(globalData);
            });
        }

        function removeParentCategory(type, parentName) {
            if (parentName === 'Lain-lain') {
                alert('Kategori "Lain-lain" tidak bisa dihapus karena dipakai sebagai kategori cadangan di seluruh aplikasi.');
                return;
            }
            const isCustomParent = (appSettings.custom_categories[type].parents || []).some(p => p.name === parentName);
            showConfirm(`Hapus kategori "${parentName}" beserta semua sub-kategorinya?`, () => {
                if (isCustomParent) {
                    // Kategori custom buatan sendiri -> hapus langsung.
                    appSettings.custom_categories[type].parents = appSettings.custom_categories[type].parents.filter(p => p.name !== parentName);
                    delete appSettings.custom_categories[type].subs[parentName];
                } else {
                    // Kategori BAWAAN -> disembunyikan (lihat rebuildCategoryDict()), bukan dihapus dari kode.
                    if (!appSettings.hidden_categories[type].parents.includes(parentName)) appSettings.hidden_categories[type].parents.push(parentName);
                }
                persistSettings(); renderSettings();
                if (globalData.length > 0) processDataForUI(globalData);
            });
        }

        // ========================== BOTTOM SHEET CATEGORY SELECTOR ==========================
        function handleFormTypeChange() {
            activeFormType = document.querySelector('input[name="jenis"]:checked').value;
            updateFormOptions();
        }
        function updateFormOptions() {
            const akunSelect = document.getElementById('akun');
            // Nama akun adalah input user (bisa mengandung karakter markup) & nilainya ditaruh di
            // atribut value + teks <option> -- WAJIB di-escape (pola yang sama dgn select akun di
            // form berulang/recurring, lihat openRecurringFormModal). Sebelumnya tidak di-escape di
            // sini: nama akun berisi tanda kutip/<> merusak markup dropdown ini.
            akunSelect.innerHTML = appSettings.accounts.map(acc => `<option value="${escapeHtml(acc)}">${escapeHtml(acc)}</option>`).join('');
            handleAccountChangeForCurrency(); // sinkronkan info mata uang/kurs ke akun yg kepilih (default: pertama)
            
            document.getElementById('kategori').value = '';
            document.getElementById('selected-category-display').innerHTML = `<div class="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center mr-2"><i class="fas fa-question text-[10px]"></i></div>Pilih Kategori`;
            // Akun tujuan ikut direset di atas -> state kurs tujuannya juga harus ikut direset,
            // supaya tidak ada sisa kurs dari akun tujuan pilihan SEBELUMNYA yang nyangkut.
            currentTxMataUangTujuan = null; currentTxKursTujuan = 1;
            currentTransferDestIsAsset = false; currentTransferDestAssetId = null; // tujuan direset -> bukan setor aset
            updateTransferDestCurrencyHintUI(currentTxMataUang, null, 1);
            
            let labelKat = document.getElementById('label-kategori');
            if (activeFormType === 'Pengeluaran') { labelKat.innerText = "Kategori Pengeluaran"; } 
            else if (activeFormType === 'Pemasukan') { labelKat.innerText = "Sumber Pemasukan"; } 
            else { labelKat.innerText = "Akun Tujuan (Ke)"; }
        }

        // ========================== MULTI-CURRENCY (akun & transaksi) ==========================
        let currentTxMataUang = null; // null = IDR (default/mayoritas akun)
        let currentTxKurs = 1;
        // Sisi TUJUAN -- CUMA relevan kalau jenis transaksi = Transfer & akun tujuannya beda mata
        // uang dari akun sumber. Diisi oleh handleTransferDestAccountChangeForCurrency() saat user
        // memilih akun tujuan transfer lewat selector kategori (lihat selectCategoryItem()).
        let currentTxMataUangTujuan = null;
        let currentTxKursTujuan = 1;

        // SETOR KE ASET: transfer yg tujuannya ASET (mis. Bibit), bukan akun. Di-set saat
        // selector tujuan memilih aset; dipakai submitForm utk jalur setor -- transaksi
        // Transfer biasa + update nilai/modal/value_history aset (src/domain/asset-flows.js).
        let currentTransferDestIsAsset = false;
        let currentTransferDestAssetId = null;

        // Nilai yang MASUK ke akun tujuan pada transaksi Transfer -- pakai transfer_jumlah_tujuan
        // (nominal dlm mata uang akun TUJUAN, sudah dikonversi) kalau ada (transfer lintas mata uang,
        // dicatat via RPC create_transfer_transaction), fallback ke `jumlah` (asumsi sama besar dgn
        // sisi sumber) utk transfer historis dari SEBELUM fitur multi-currency transfer ada -- lihat
        // catatan "IMPORTANT APPLICATION NOTES" #3 di migration_transfer_currency_2026-08.sql.
        // HARUS di scope GLOBAL (bukan di dalam IIFE `api`) krn dipanggil dari processDataForUI(),
        // openAccountDetail(), dan buildAccountSeries() yang semuanya di luar closure itu.
        function transferTargetAmount(row) {
            return row.transfer_jumlah_tujuan != null ? row.transfer_jumlah_tujuan : row.jumlah;
        }

        function getAccountCurrency(akun) {
            return (appSettings.account_currencies && appSettings.account_currencies[akun]) || 'IDR';
        }

        function updateCurrencyHintUI(mataUang, kurs, tanggalKurs, loading, error) {
            const prefix = document.getElementById('jumlah-currency-prefix');
            const hint = document.getElementById('akun-currency-hint');
            if (!prefix || !hint) return;
            if (!mataUang) { prefix.innerText = 'Rp'; hint.classList.add('hidden'); return; }
            prefix.innerText = mataUang;
            hint.classList.remove('hidden');
            if (loading) { hint.innerText = 'Mengambil kurs terkini...'; return; }
            if (error || !kurs) { hint.innerText = 'Gagal ambil kurs terkini. Coba pilih ulang akunnya, atau cek koneksi internet.'; return; }
            hint.innerText = `Kurs: 1 ${mataUang} = Rp ${new Intl.NumberFormat('id-ID').format(Math.round(kurs))}` + (tanggalKurs ? ` (${tanggalKurs})` : '');
        }

        // Dipanggil tiap user GANTI PILIHAN akun secara aktif (termasuk saat form baru dibuka dgn akun
        // default) -- BEDA dari saat edit transaksi lama (lihat editDataForm), yang sengaja TIDAK
        // manggil ini supaya kurs HISTORIS transaksi lama tidak tertimpa kurs hari ini secara diam2.
        function handleAccountChangeForCurrency() {
            const akunEl = document.getElementById('akun');
            if (!akunEl || !akunEl.value) { currentTxMataUang = null; currentTxKurs = 1; updateCurrencyHintUI(null, 1); return; }
            const cur = getAccountCurrency(akunEl.value);
            if (cur === 'IDR') { currentTxMataUang = null; currentTxKurs = 1; updateCurrencyHintUI(null, 1); return; }

            updateCurrencyHintUI(cur, null, null, true);
            // Pensyahan api.run (slice edge): service langsung (src/services/supabase/edge.js), callback persis.
            servicesModule.getExchangeRate(supabaseClient, cur)
                .then((hasil) => {
                    currentTxMataUang = cur; currentTxKurs = hasil.rate;
                    updateCurrencyHintUI(cur, hasil.rate, hasil.tanggal, false);
                })
                .catch((err) => {
                    console.error('api.run.getExchangeRate gagal:', err);
                    currentTxMataUang = cur; currentTxKurs = null; // ditandai null -> submitForm() akan menolak submit sampai berhasil
                    updateCurrencyHintUI(cur, null, null, false, true);
                });
        }

        // Sisi TUJUAN dari handleAccountChangeForCurrency() -- dipanggil dari selectCategoryItem()
        // saat jenis=Transfer & user memilih akun tujuan. TIDAK dipanggil saat form edit dibuka
        // (setCategoryUIFromValue() dipisah khusus utk itu, sama seperti pola akun sumber) supaya
        // kurs HISTORIS transaksi lama tidak tertimpa kurs hari ini secara diam2.
        function updateTransferDestCurrencyHintUI(mataUangSumber, mataUangTujuan, kursTujuan, loading, error) {
            const hint = document.getElementById('transfer-dest-currency-hint');
            if (!hint) return;
            // Cuma tampil kalau BENAR2 lintas mata uang (tujuan beda dari sumber) -- transfer antar
            // akun yang sama2 IDR (mayoritas kasus) atau sama2 mata uang tujuan == sumber tidak perlu
            // hint tambahan apa pun, jumlahnya otomatis sama persis di kedua sisi.
            const sumberEfektif = mataUangSumber || 'IDR';
            const tujuanEfektif = mataUangTujuan || 'IDR';
            if (sumberEfektif === tujuanEfektif) { hint.classList.add('hidden'); return; }
            hint.classList.remove('hidden');
            if (loading) { hint.innerText = `Mengambil kurs ${tujuanEfektif}...`; return; }
            if (error || !kursTujuan) { hint.innerText = `Gagal ambil kurs ${tujuanEfektif}. Coba pilih ulang akun tujuannya.`; return; }
            hint.innerText = `Akun tujuan pakai ${tujuanEfektif} -- jumlah otomatis dikonversi saat disimpan.`;
        }

        function handleTransferDestAccountChangeForCurrency(destAccountName) {
            const cur = getAccountCurrency(destAccountName);
            if (cur === 'IDR') {
                currentTxMataUangTujuan = null; currentTxKursTujuan = 1;
                updateTransferDestCurrencyHintUI(currentTxMataUang, null, 1);
                return;
            }
            updateTransferDestCurrencyHintUI(currentTxMataUang, cur, null, true);
            // Pensyahan api.run (slice edge): service langsung, callback persis versi lama.
            servicesModule.getExchangeRate(supabaseClient, cur)
                .then((hasil) => {
                    currentTxMataUangTujuan = cur; currentTxKursTujuan = hasil.rate;
                    updateTransferDestCurrencyHintUI(currentTxMataUang, cur, hasil.rate, false);
                })
                .catch((err) => {
                    console.error('api.run.getExchangeRate gagal:', err);
                    currentTxMataUangTujuan = cur; currentTxKursTujuan = null; // null -> submitForm() menolak submit sampai berhasil
                    updateTransferDestCurrencyHintUI(currentTxMataUang, cur, null, false, true);
                });
        }

        function openCategorySelector() {
            activeCategoryTab = activeFormType;
            document.getElementById('modalCategorySelector').classList.remove('hidden');
            setTimeout(() => {
                document.getElementById('modalCategorySelectorContent').classList.remove('translate-y-full', 'md:scale-95', 'opacity-0');
            }, 10);
            renderCategoryTabs();
        }
        function closeCategorySelector() {
            document.getElementById('modalCategorySelectorContent').classList.add('translate-y-full', 'md:scale-95', 'opacity-0');
            setTimeout(() => { document.getElementById('modalCategorySelector').classList.add('hidden'); }, 300);
        }

        // ========================== CONFIRM MODAL ==========================
        let _confirmCallback = null;
        function showConfirm(message, callback) {
            document.getElementById('modalConfirmText').innerText = message;
            _confirmCallback = callback;
            document.getElementById('modalConfirm').classList.remove('hidden');
            setTimeout(() => { document.getElementById('modalConfirmContent').classList.remove('scale-95', 'opacity-0'); }, 10);
        }
        function closeConfirmModal() {
            document.getElementById('modalConfirmContent').classList.add('scale-95', 'opacity-0');
            setTimeout(() => { document.getElementById('modalConfirm').classList.add('hidden'); }, 200);
            _confirmCallback = null;
        }
        function _confirmYes() {
            const cb = _confirmCallback; _confirmCallback = null;
            document.getElementById('modalConfirmContent').classList.add('scale-95', 'opacity-0');
            setTimeout(() => { document.getElementById('modalConfirm').classList.add('hidden'); }, 200);
            if (cb) cb();
        }

        // Aksesibilitas: tombol Escape menutup modal yang sedang terbuka (kalau ada). Cek modalConfirm
        // duluan karena biasanya "di atas" modal lain (z-index tertinggi setelah authGate).
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            const modalCloseMap = [
                ['modalConfirm', closeConfirmModal],
                ['modalCalendarDetail', closeCalendarDetail],
                ['modalCategorySelector', closeCategorySelector],
                ['modalRecurringForm', closeRecurringFormModal],
                ['modalRecurringList', closeRecurringListModal],
                ['modalAssetDetail', closeAssetDetailModal],
                ['modalGoalContribute', closeGoalContributeModal],   // slice a11y: sebelumnya TIDAK ada di peta ESC
                ['modalDebtPay', closeDebtPayModal],                // idem
                ['modalProfile', closeProfileModal],
                ['modalManualNav', closeManualNavModal],
                ['modalAccount', closeAccountModal],
                ['modalCategoryStyle', closeCategoryStyleModal],    // idem
                ['modalBudget', closeBudgetModal],
                ['modalAsset', closeAssetModal],
                ['modalGoal', closeGoalModal],                      // idem
                ['modalDebt', closeDebtModal],                      // idem
                ['modalForm', closeModal]
            ];
            for (const [id, closeFn] of modalCloseMap) {
                const el = document.getElementById(id);
                if (el && !el.classList.contains('hidden')) { closeFn(); return; }
            }
        // FOCUS TRAP (slice a11y): saat modal terbuka, TAB/Shift+TAB tidak boleh
        // kabur ke elemen di belakang backdrop. Modal teratas dipilih dari z-index
        // computed style; logika wrap murni di src/ui/modal-a11y.js (teruji unit).
        if (e.key === 'Tab') {
            const top = servicesModule.pickTopModal(_modalA11yEls, (el) => parseInt(getComputedStyle(el).zIndex, 10) || 0);
            if (!top) return;
            const focusables = servicesModule.getFocusable(top);
            const target = servicesModule.nextTabTarget(focusables, document.activeElement, e.shiftKey);
            if (target) { e.preventDefault(); target.focus(); }
        }
        });

        const categoryTypeHeaderConfig = {
            'Pengeluaran': { bg: 'bg-rose-50', text: 'text-rose-600', icon: 'fa-arrow-trend-down', label: 'Kategori Pengeluaran' },
            'Pemasukan':   { bg: 'bg-emerald-50', text: 'text-emerald-600', icon: 'fa-arrow-trend-up', label: 'Sumber Pemasukan' },
            'Transfer':    { bg: 'bg-blue-50', text: 'text-blue-600', icon: 'fa-right-left', label: 'Transfer Antar Akun' }
        };

        function renderCategoryTabs() {
            const cfg = categoryTypeHeaderConfig[activeCategoryTab] || categoryTypeHeaderConfig['Pengeluaran'];
            const header = document.getElementById('categoryTypeHeader');
            const icon = document.getElementById('categoryTypeIcon');
            const label = document.getElementById('categoryTypeLabel');
            header.className = `w-full py-2.5 rounded-xl flex items-center justify-center gap-2 text-xs font-bold transition-all ${cfg.bg} ${cfg.text}`;
            icon.className = `fas ${cfg.icon}`;
            label.innerText = cfg.label;

            const container = document.getElementById('categoryAccordionContainer');

            if (activeCategoryTab === 'Transfer') {
                const rows = appSettings.accounts.filter(acc => document.getElementById('akun').value !== acc).map(acc => `
                        <div onclick="selectCategoryItem('${jsStr(acc)}', 'Transfer', 'Transfer')" class="bg-white border border-slate-100 shadow-sm rounded-xl p-3 md:p-4 flex items-center justify-between cursor-pointer hover:border-slate-300">
                            <div class="flex items-center"><div class="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center mr-3">${getAccountLogo(acc)}</div><span class="font-bold text-sm text-slate-700">${escapeHtml(acc)}</span></div>
                        </div>`).join('');
                // Seksi "ASET (SETOR DANA)": setor dari rekening sumber ke aset (mis. Bibit) --
                // dicatat sbg Transfer dgn kategori = nama aset (lihat src/domain/asset-flows.js).
                const assetRows = (globalAssets || []).map(a => `
                        <div onclick="selectCategoryItem('${jsStr(a.nama)}', 'Aset', 'Aset')" class="bg-white border border-slate-100 shadow-sm rounded-xl p-3 md:p-4 flex items-center justify-between cursor-pointer hover:border-cyan-300">
                            <div class="flex items-center"><div class="w-8 h-8 rounded-full bg-cyan-50 flex items-center justify-center mr-3"><i class="fas fa-chart-line text-cyan-500"></i></div><span class="font-bold text-sm text-slate-700">${escapeHtml(a.nama)}</span></div>
                            <span class="text-[9px] font-black uppercase tracking-wider text-cyan-500 bg-cyan-50 px-2 py-1 rounded">Setor</span>
                        </div>`).join('');
                container.innerHTML = `<div class="text-xs text-slate-400 font-bold uppercase mb-2">Pilih Akun Tujuan</div>` + rows +
                    (assetRows ? `<div class="text-xs text-slate-400 font-bold uppercase mb-2 mt-4">Aset (Setor Dana) -- saldo akun berkurang, nilai & modal aset bertambah</div>` + assetRows : '');
            } else {
                let dict = activeCategoryTab === 'Pengeluaran' ? categoryDict.pengeluaran : categoryDict.pemasukan;

                container.innerHTML = Object.keys(dict).map((parentName, index) => {
                    let parent = dict[parentName];
                    // BUG FIX (sama seperti di Budget): sebelumnya ikon/warna kategori di picker ini
                    // diambil LANGSUNG dari categoryDict mentah (parent.icon/bg/color, sub.icon), dan
                    // dioper sebagai parameter ke selectCategoryItem() lewat atribut onclick -- jadi
                    // kustomisasi ikon/warna dari Pengaturan dan gambar kustom yang diupload user
                    // tidak pernah tampil di sini. Sekarang pakai getCategoryStyle() (sumber yang sama
                    // dengan Riwayat Transaksi/Budget dsb) dan selectCategoryItem() cukup dioper
                    // nama+tipe-nya saja, style-nya dihitung ulang di dalam fungsi itu sendiri.
                    let parentStyle = getCategoryStyle(parentName, activeCategoryTab);

                    let parentSelectButton = `<div onclick="selectCategoryItem('${jsStr(parentName)}', '${jsStr(parentName)}', '${activeCategoryTab}')" class="flex items-center justify-between bg-indigo-50/50 hover:bg-indigo-100/50 text-[#151928] p-2.5 rounded-xl text-xs font-bold cursor-pointer transition mb-2">
                        <span>Pilih Utama: ${escapeHtml(parentName)}</span>
                        <i class="fas fa-check-double text-[10px]"></i>
                    </div>`;

                    let subHtml = parent.subs.map(sub => {
                        let subStyle = getCategoryStyle(sub.name, activeCategoryTab);
                        return `
                        <div onclick="selectCategoryItem('${jsStr(sub.name)}', '${jsStr(parentName)}', '${activeCategoryTab}')" class="flex flex-col items-center justify-center cursor-pointer hover:bg-white p-2 rounded-xl transition border border-transparent hover:border-slate-100">
                            ${categoryIconHtml(subStyle, 'w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center text-sm md:text-base mb-1 shadow-sm border border-white', 'text-sm md:text-base')}
                            <span class="text-[10px] md:text-[10px] font-bold text-slate-600 text-center leading-tight tracking-tight">${escapeHtml(sub.name)}</span>
                        </div>
                    `;
                    }).join('');

                    if(parent.subs.length === 0) { subHtml = `<div class="col-span-4 text-center text-[10px] text-slate-400 py-2">Belum ada sub-kategori kustom.</div>`; }

                    return `
                        <div class="bg-white border border-slate-100 shadow-sm rounded-xl overflow-hidden">
                            <div onclick="toggleAccordion('acc-${index}')" class="p-3 md:p-4 flex items-center justify-between cursor-pointer select-none">
                                <div class="flex items-center">
                                    ${categoryIconHtml(parentStyle, 'w-8 h-8 md:w-10 md:h-10 rounded-xl flex items-center justify-center mr-3 md:mr-4', '')}
                                    <span class="font-bold text-sm text-slate-700 tracking-tight">${escapeHtml(parentName)}</span>
                                </div>
                                <i id="icon-acc-${index}" class="fas fa-chevron-down text-slate-400 text-xs accordion-icon"></i>
                            </div>
                            <div id="acc-${index}" class="accordion-content bg-slate-50/50">
                                <div class="p-3 border-t border-slate-50">
                                    ${parentSelectButton}
                                    <div class="grid grid-cols-4 gap-2">
                                        ${subHtml}
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
                
                setTimeout(() => toggleAccordion('acc-0'), 50);
            }
        }

        let currentlyExpandedAcc = null;
        let lastFilteredTransactions = []; // hasil filter/pencarian terakhir di tabel Transaksi -- SEMUA baris yang cocok filter (TIDAK dipotong pagination), dipakai oleh exportTransactionsCsv()

        // PERFORMANCE: daftar transaksi tidak lagi merender SEMUA hasil filter ke DOM sekaligus --
        // dibatasi TX_LIST_PAGE_SIZE per halaman, dengan tombol "Muat lebih banyak" kalau masih ada
        // sisa. Saat ini (~ratusan transaksi/user) belum terasa dampaknya, tapi mencegah masalah nyata
        // begitu riwayat seorang user sudah menumpuk ribuan baris (app ini didesain utk histori
        // multi-tahun). _txListLastFilterSignature dipakai supaya limit otomatis reset ke halaman
        // pertama setiap kali KRITERIA filter benar2 berubah (pencarian baru, ganti bulan, dst) --
        // tapi TETAP di limit yang sudah di-"muat lebih banyak" kalau filter-nya sama persis (mis.
        // dipanggil ulang cuma krn tambah/edit/hapus transaksi lain, bukan krn user ganti filter).
        const TX_LIST_PAGE_SIZE = 150;
        let _txListVisibleLimit = TX_LIST_PAGE_SIZE;
        let _txListLastFilterSignature = null;
        function loadMoreTransactions() {
            _txListVisibleLimit += TX_LIST_PAGE_SIZE;
            filterTransactions();
        }
        let globalRecurring = []; // daftar template transaksi berulang milik user
        let _recurringProcessed = false; // biar processDueRecurring() cuma benar-benar jalan sekali per sesi login
        function toggleAccordion(id) {
            if (currentlyExpandedAcc && currentlyExpandedAcc !== id) {
                let elOld = document.getElementById(currentlyExpandedAcc);
                let icOld = document.getElementById('icon-' + currentlyExpandedAcc);
                if(elOld) { elOld.classList.remove('expanded'); icOld.classList.remove('expanded'); }
            }
            let el = document.getElementById(id); let ic = document.getElementById('icon-' + id);
            if(el.classList.contains('expanded')) {
                el.classList.remove('expanded'); ic.classList.remove('expanded'); currentlyExpandedAcc = null;
            } else {
                el.classList.add('expanded'); ic.classList.add('expanded'); currentlyExpandedAcc = id;
            }
        }

        function selectCategoryItem(name, parentName, type) {
            document.getElementById('kategori').value = name;
            hideCategorySuggestion(); // user sudah pilih sendiri, saran AI (kalau lagi tampil) tidak relevan lagi
            
            let displayUi = document.getElementById('selected-category-display');
            if (type === 'Aset') {
                // Setor ke aset: tujuan = aset (bukan akun). submitForm memakai flag ini utk
                // jalur setor: transaksi Transfer + update nilai/modal/riwayat aset.
                const assetPicked = servicesModule.findAssetByName(globalAssets, name);
                currentTransferDestIsAsset = true;
                currentTransferDestAssetId = assetPicked ? assetPicked.id : null;
                displayUi.innerHTML = `<div class="w-6 h-6 rounded-full bg-cyan-50 flex items-center justify-center mr-2"><i class="fas fa-chart-line text-cyan-500 text-[10px]"></i></div><span class="font-bold text-slate-800">${escapeHtml(name)}</span> <span class="text-[10px] text-cyan-500 font-bold ml-1">(setor ke aset)</span>`;
                closeCategorySelector();
                return;
            }
            if (type === 'Transfer') {
                currentTransferDestIsAsset = false; currentTransferDestAssetId = null; // tujuan akun biasa
                displayUi.innerHTML = `<div class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center mr-2">${getAccountLogo(name)}</div><span class="font-bold text-slate-800">${escapeHtml(name)}</span>`;
                // User AKTIF memilih akun tujuan (baik transaksi baru maupun ganti akun tujuan selagi
                // edit) -- beda dari setCategoryUIFromValue() yg dipanggil saat form edit PERTAMA kali
                // dibuka (harus pakai kurs historis, bukan fetch ulang).
                handleTransferDestAccountChangeForCurrency(name);
            } else {
                // BUG FIX: sebelumnya icon/bg/color dioper langsung dari HTML (lihat renderCategoryTabs())
                // dan bisa jadi stale/tidak sinkron dengan kustomisasi Pengaturan atau gambar upload.
                // Sekarang dihitung ulang di sini lewat getCategoryStyle(), sama seperti
                // setCategoryUIFromValue() di bawah -- satu sumber kebenaran untuk semua tampilan ikon.
                let style = getCategoryStyle(name, type);
                displayUi.innerHTML = `${categoryIconHtml(style, 'w-6 h-6 rounded-full flex items-center justify-center mr-2', 'text-[10px]')}<span class="font-bold text-slate-800">${escapeHtml(name)}</span> <span class="text-[10px] text-slate-400 ml-2">(${escapeHtml(parentName)})</span>`;
            }
            closeCategorySelector();
        }

        function setCategoryUIFromValue(val, jenis) {
            document.getElementById('kategori').value = val;
            hideCategorySuggestion();
            let displayUi = document.getElementById('selected-category-display');
            
            if(!val) { displayUi.innerHTML = `<div class="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center mr-2"><i class="fas fa-question text-[10px]"></i></div>Pilih Kategori`; return; }

            if(jenis === 'Transfer') {
                const prefillAsset = servicesModule.findAssetByName(globalAssets, val);
                if (prefillAsset) {
                    // Transfer ini adalah "setor ke aset" -- tampilkan ikon aset + set flag
                    // supaya penyimpanan edit memakai jalur setor (delta diterapkan ke aset).
                    currentTransferDestIsAsset = true; currentTransferDestAssetId = prefillAsset.id;
                    displayUi.innerHTML = `<div class="w-6 h-6 rounded-full bg-cyan-50 flex items-center justify-center mr-2"><i class="fas fa-chart-line text-cyan-500 text-[10px]"></i></div><span class="font-bold text-slate-800">${escapeHtml(val)}</span> <span class="text-[10px] text-cyan-500 font-bold ml-1">(setor ke aset)</span>`;
                } else {
                    currentTransferDestIsAsset = false; currentTransferDestAssetId = null;
                    displayUi.innerHTML = `<div class="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center mr-2">${getAccountLogo(val)}</div><span class="font-bold text-slate-800">${escapeHtml(val)}</span>`;
                }
            } else {
                let style = getCategoryStyle(val, jenis);
                displayUi.innerHTML = `${categoryIconHtml(style, 'w-6 h-6 rounded-full flex items-center justify-center mr-2', 'text-[10px]')}<span class="font-bold text-slate-800">${escapeHtml(val)}</span> <span class="text-[10px] text-slate-400 ml-2">(${escapeHtml(style.parentName || style.parent)})</span>`;
            }
        }

        // ========================== SMART CATEGORIZATION (saran kategori dari keterangan) ==========================
        let categorySuggestionTimer = null;
        let categorySuggestionValue = null; // kategori yg lagi disarankan (buat tombol chip)
        let categorySuggestionLastQuery = ''; // hindari nembak ulang Gemini kalau teksnya tidak berubah esensinya

        function handleKeteranganInputForSuggestion() {
            clearTimeout(categorySuggestionTimer);
            const text = document.getElementById('keterangan').value.trim();
            // Kalau kategori SUDAH dipilih manual duluan, jangan ganggu -- saran cuma relevan
            // SEBELUM user menentukan kategorinya sendiri.
            if (document.getElementById('kategori').value) { hideCategorySuggestion(); return; }
            if (text.length < 3) { hideCategorySuggestion(); return; }
            // Nunggu 700ms jeda ketikan (debounce) -- supaya tidak manggil Gemini tiap 1 huruf diketik.
            categorySuggestionTimer = setTimeout(() => requestCategorySuggestion(text), 700);
        }

        function hideCategorySuggestion() {
            categorySuggestionValue = null;
            const chip = document.getElementById('category-suggestion-chip');
            if (chip) chip.classList.add('hidden');
        }

        function requestCategorySuggestion(text) {
            if (text === categorySuggestionLastQuery) return; // sama persis dgn request terakhir, skip
            categorySuggestionLastQuery = text;
            const jenis = activeFormType === 'Transfer' ? null : activeFormType; // Transfer tidak punya kategori kustom
            if (!jenis) return;
            const dict = jenis === 'Pengeluaran' ? categoryDict.pengeluaran : categoryDict.pemasukan;
            const categories = Object.values(dict || {}).flatMap(p => p.subs.map(s => s.name));
            if (categories.length === 0) return;

            // Pensyahan api.run (slice edge): service langsung, callback persis versi lama
            // (termasuk failure handler diam2 -- fitur pemanis, bukan yg kritikal).
            servicesModule.suggestCategory(supabaseClient, text, jenis, categories)
                .then((hasil) => {
                    // Kalau user udah keburu isi kategori sendiri / ganti teks selagi nunggu respons AI, abaikan hasilnya.
                    if (document.getElementById('kategori').value) return;
                    if (document.getElementById('keterangan').value.trim() !== text) return;
                    if (!hasil || !hasil.kategori) { hideCategorySuggestion(); return; }
                    categorySuggestionValue = hasil.kategori;
                    document.getElementById('category-suggestion-text').innerText = `Saran kategori: ${hasil.kategori}`;
                    const chip = document.getElementById('category-suggestion-chip');
                    chip.classList.remove('hidden'); chip.classList.add('flex');
                })
                .catch((err) => { console.error('api.run.suggestCategory gagal:', err); /* diam2 gagal aja, ini fitur pemanis bukan yg kritikal */ });
        }

        function applyCategorySuggestion() {
            if (!categorySuggestionValue) return;
            setCategoryUIFromValue(categorySuggestionValue, activeFormType);
            hideCategorySuggestion();
        }

        // ========================== STRUK SCANNER (foto struk -> auto-isi form) ==========================
        function triggerStrukScan() {
            document.getElementById('strukFileInput').value = ''; // biar bisa pilih file yg sama 2x berturut-turut
            document.getElementById('strukFileInput').click();
        }

        function handleStrukFileSelected(e) {
            const file = e.target.files && e.target.files[0]; if (!file) return;
            if (!file.type.startsWith('image/')) { showErrorToast('File harus berupa foto (JPG/PNG).'); e.target.value = ''; return; }
            if (file.size > 10 * 1024 * 1024) { showErrorToast('Ukuran foto maksimal 10MB ya.'); e.target.value = ''; return; }

            const btn = document.getElementById('btnScanStruk');
            btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

            const reader = new FileReader();
            reader.onload = function (ev) {
                // Dikompres dulu (maks sisi 1600px, JPEG 85%) -- foto kamera HP modern bisa 4-8MB
                // mentah, terlalu besar buat payload sekali kirim & bikin lebih mahal ke Gemini,
                // padahal untuk dibaca teksnya resolusi segitu sudah lebih dari cukup.
                compressImageDataUrl(ev.target.result, 1600, 0.85).then(function (compressed) {
                    const base64Only = compressed.split(',')[1]; // buang prefix "data:image/jpeg;base64,"
                    // Kategori Pengeluaran user ini sendiri (bukan daftar generik) -- supaya AI cuma
                    // boleh milih kategori yang BENAR-BENAR ada di akun user, tidak mengarang nama baru.
                    const categories = Object.values(categoryDict.pengeluaran || {}).flatMap(p => p.subs.map(s => s.name));

                    // Pensyahan api.run (slice edge): service langsung, callback persis versi lama.
                    servicesModule.scanReceipt(supabaseClient, base64Only, 'image/jpeg', categories)
                        .then((hasil) => {
                            applyStrukResultToForm(hasil);
                            btn.disabled = false; btn.innerHTML = '<i class="fas fa-camera"></i>';
                        })
                        .catch((err) => {
                            console.error('api.run.scanReceipt gagal:', err);
                            showErrorToast(err && err.message ? err.message : 'Gagal membaca struk. Coba foto yang lebih jelas.');
                            btn.disabled = false; btn.innerHTML = '<i class="fas fa-camera"></i>';
                        });
                }).catch(function () {
                    showErrorToast('Gagal memproses foto ini. Coba foto lain.');
                    btn.disabled = false; btn.innerHTML = '<i class="fas fa-camera"></i>';
                });
            };
            reader.onerror = function () {
                showErrorToast('Gagal membaca file foto.');
                btn.disabled = false; btn.innerHTML = '<i class="fas fa-camera"></i>';
            };
            reader.readAsDataURL(file);
        }

        // Isi form Catat Transaksi dari hasil ekstraksi AI. SENGAJA TIDAK auto-submit -- user harus
        // cek & konfirmasi dulu (angka/kategori hasil AI bisa saja salah baca), baru tekan Simpan.
        function applyStrukResultToForm(hasil) {
            document.querySelector(`input[name="jenis"][value="Pengeluaran"]`).checked = true;
            handleFormTypeChange();

            if (hasil.tanggal) {
                const d = new Date(hasil.tanggal);
                if (!isNaN(d.getTime())) document.getElementById('tanggal').valueAsDate = d;
            }
            if (hasil.total) {
                document.getElementById('jumlah').value = Math.round(hasil.total);
                document.getElementById('jumlah_display').value = new Intl.NumberFormat('id-ID').format(Math.round(hasil.total));
            }
            if (hasil.merchant) document.getElementById('keterangan').value = hasil.merchant;
            if (hasil.kategori) setCategoryUIFromValue(hasil.kategori, 'Pengeluaran');

            showSuccessToast('Struk berhasil dibaca -- cek dulu datanya sebelum disimpan ya.');
        }

        // ========================== FORM TRANSAKSI ACTIONS ==========================
        function openModal(isEdit = false) {
            const modal = document.getElementById('modalForm'); const content = document.getElementById('modalFormContent');
            modal.classList.remove('hidden'); setTimeout(() => { content.classList.remove('translate-x-full'); }, 10);
            
            if(!isEdit) {
                currentEditId = null; document.getElementById('modalTitle').innerText = "Catat Transaksi";
                document.getElementById('btnSubmitForm').innerText = "Simpan Data"; document.getElementById('formInput').reset();
                document.getElementById('jumlah').value = ''; document.getElementById('jumlah_display').value = '';
                document.getElementById('tanggal').valueAsDate = new Date(); 
                document.querySelector(`input[name="jenis"][value="Pengeluaran"]`).checked = true; handleFormTypeChange();
                document.getElementById('btnScanStruk').classList.remove('hidden');
                categorySuggestionLastQuery = ''; hideCategorySuggestion();
                // Tombol "Simpan & Catat Lagi" cuma relevan untuk entri BARU (edit = 1 baris selesai).
                document.getElementById('btnSubmitFormRepeat').classList.remove('hidden');
                // Fokus ke kolom Jumlah supaya entri berikutnya langsung bisa ketik nominal.
                // Desktop saja: di layar sentuh, keyboard yang muncul sendiri bisa lebih
                // mengganggu daripada membantu (user bisa tap kolom Jumlah sendiri).
                if (window.matchMedia('(min-width: 768px)').matches) {
                    setTimeout(() => {
                        if (document.getElementById('modalForm').classList.contains('hidden') === false) {
                            document.getElementById('jumlah_display').focus();
                            document.getElementById('jumlah_display').select();
                        }
                    }, 350); // selesai animasi slide-in (300 ms)
                }
            } else {
                document.getElementById('modalTitle').innerText = "Edit Transaksi"; document.getElementById('btnSubmitForm').innerText = "Simpan Perubahan"; document.getElementById('btnScanStruk').classList.add('hidden');
                document.getElementById('btnSubmitFormRepeat').classList.add('hidden');
            }
        }
        function closeModal() {
            const content = document.getElementById('modalFormContent'); content.classList.add('translate-x-full');
            setTimeout(() => { document.getElementById('modalForm').classList.add('hidden'); }, 300);
        }

        function editDataForm(id) {
            let item = globalData.find(d => d.id === id); if(!item) return;
            currentEditId = id; 
            document.querySelector(`input[name="jenis"][value="${item.jenis}"]`).checked = true; handleFormTypeChange();
            document.getElementById('tanggal').value = item.tanggal.split('T')[0]; 
            document.getElementById('jumlah').value = item.jumlah;
            document.getElementById('jumlah_display').value = new Intl.NumberFormat('id-ID').format(item.jumlah);
            document.getElementById('akun').value = item.akun; 
            document.getElementById('keterangan').value = item.keterangan || "";
            setCategoryUIFromValue(item.kategori, item.jenis);
            // SENGAJA tidak manggil handleAccountChangeForCurrency() di sini -- pakai kurs HISTORIS
            // yang tersimpan di transaksi ini (item.mata_uang/item.kurs), bukan kurs hari ini, supaya
            // buka-tutup form edit tanpa mengubah apapun tidak diam2 mengubah nilai jumlah_idr lama.
            if (item.mata_uang) { currentTxMataUang = item.mata_uang; currentTxKurs = item.kurs || 1; updateCurrencyHintUI(item.mata_uang, item.kurs, null, false); }
            else { currentTxMataUang = null; currentTxKurs = 1; updateCurrencyHintUI(null, 1); }
            // Sama seperti di atas tapi sisi TUJUAN -- cuma relevan utk Transfer lintas mata uang.
            // Transfer historis dari SEBELUM fitur ini ada punya transfer_mata_uang_tujuan = null,
            // yang berarti "dianggap sama seperti mata uang sumber" (lihat transferTargetAmount()).
            if (item.jenis === 'Transfer' && item.transfer_mata_uang_tujuan) {
                currentTxMataUangTujuan = item.transfer_mata_uang_tujuan;
                currentTxKursTujuan = item.transfer_kurs_tujuan || 1;
                updateTransferDestCurrencyHintUI(item.mata_uang, item.transfer_mata_uang_tujuan, item.transfer_kurs_tujuan, false);
            } else {
                currentTxMataUangTujuan = null; currentTxKursTujuan = 1;
                updateTransferDestCurrencyHintUI(item.mata_uang, null, 1);
            }
            openModal(true);
        }

        // "Simpan & Catat Lagi": set flag repeat lalu jalankan submitForm yang sama persis
        // (validasi & jalur simpan identik) -- bedanya cuma finishSave membuka ulang form
        // kosong alih-alih menutup modal, jadi entri transaksi beruntun tidak perlu
        // buka-tutup modal berkali-kali.
        function submitFormNewAndRepeat() {
            _pendingRepeatSave = true;
            submitForm(new Event('submit'));
        }

        function submitForm(e) {
            if(e) e.preventDefault();
            const form = document.getElementById('formInput'); 
            const catVal = document.getElementById('kategori').value;
            if(!catVal) { alert("Silakan pilih kategori/tujuan transfer!"); return; }
            if(!form.checkValidity()) { form.reportValidity(); return; }
            if (currentTxMataUang && !currentTxKurs) { showErrorToast('Kurs untuk akun ini belum berhasil diambil. Coba pilih ulang akunnya dulu.'); return; }
            const jenisVal = document.querySelector('input[name="jenis"]:checked').value;
            // Transfer lintas mata uang: kurs akun TUJUAN juga wajib sudah berhasil diambil, sama
            // seperti validasi kurs akun sumber di atas.
            if (jenisVal === 'Transfer' && currentTxMataUangTujuan && !currentTxKursTujuan) {
                showErrorToast('Kurs untuk akun tujuan belum berhasil diambil. Coba pilih ulang akun tujuannya.'); return;
            }

            showLoading(true);
            const wasEdit = !!currentEditId; // simpan sebelum async, karena currentEditId bisa berubah setelahnya
            const jumlahNum = Number(document.getElementById('jumlah').value);
            const data = {
                jenis: jenisVal, tanggal: document.getElementById('tanggal').value,
                jumlah: document.getElementById('jumlah').value, akun: document.getElementById('akun').value, kategori: catVal, keterangan: document.getElementById('keterangan').value,
                // mata_uang/kurs null = akun IDR biasa (mayoritas transaksi) -> jumlah_idr = jumlah apa adanya.
                mata_uang: currentTxMataUang, kurs: currentTxMataUang ? currentTxKurs : 1,
                jumlah_idr: currentTxMataUang ? Math.round(jumlahNum * currentTxKurs) : jumlahNum
            };
            const onSaveFail = () => { showErrorToast('Gagal menyimpan transaksi. Periksa koneksi internet kamu lalu coba lagi.'); showLoading(false); };
            // Ambil status budget SEBELUM transaksi ini masuk (cuma relevan utk Pengeluaran) -- dibandingkan
            // lagi SETELAH data ke-refresh, buat deteksi baru saja lewat ambang 80%/100% (lihat penjelasan
            // di notifyIfBudgetThresholdCrossed).
            const budgetBefore = data.jenis === 'Pengeluaran' ? getCategoryBudgetStatus(catVal) : null;
            // repeatSave: tombol "Simpan & Catat Lagi" -> begitu simpan sukses, form dibuka lagi dalam
            // keadaan kosong (tanpa menutup modal), supaya entri transaksi beruntun jauh lebih cepat.
            const repeatSave = _pendingRepeatSave; _pendingRepeatSave = false;
            // finishSave(txRow, assetPatches, pesan): txRow = baris ASLI dari server (bentuk kanonik
            // mapTransactionRow, sama seperti list()) -- dipakai ECHO LOKAL pasca-simpan, TANPA
            // menarik ulang seluruh tabel transaksi (lihat applyLocalTxEcho di bawah).
            const finishSave = (txRow, assetPatches, successMsg) => {
                if (repeatSave) openModal(false); else closeModal();
                applyLocalTxEcho(wasEdit ? 'update' : 'insert', txRow, assetPatches, () => { if (budgetBefore) notifyIfBudgetThresholdCrossed(catVal, budgetBefore); });
                showSuccessToast(successMsg);
            };
            const onSaveOk = (txRow, assetPatches) => finishSave(txRow, assetPatches, wasEdit ? 'Transaksi berhasil diperbarui.' : 'Transaksi berhasil dicatat.');

            if (jenisVal === 'Transfer' && currentTransferDestIsAsset) {
                // SETOR KE ASET (mis. Bibit): transaksi baris biasa (jenis Transfer, kategori =
                // nama aset -> saldo akun sumber berkurang lewat logika transfer yg ada) LALU
                // nilai/modal/value_history aset di-update via applyAssetDeposit. BUKAN lewat
                // RPC create_transfer_transaction -- RPC itu khusus transfer akun-ke-akun.
                if (!(jumlahNum > 0)) { showErrorToast('Jumlah setoran harus lebih dari 0.'); showLoading(false); return; }
                const assetTarget = globalAssets.find(a => a.id === currentTransferDestAssetId);
                if (!assetTarget) { showErrorToast('Aset tujuan tidak ditemukan -- pilih ulang dari daftar tujuan.'); showLoading(false); return; }
                const runDeposit = () => {
                    showLoading(true);
                    // Konsistensi aset saat edit:
                    //  - setor baru / lama bukan setor / aset tujuan SAMA -> selisih (baru-lama).
                    //  - aset tujuan DIGANTI -> aset lama dipulihkan penuh dulu, aset baru dapat penuh.
                    const oldRow = wasEdit ? globalData.find(t => t.id === currentEditId) : null;
                    const oldDepositAsset = oldRow ? servicesModule.resolveAssetDepositTx(oldRow, globalAssets) : null;
                    const sameAsset = !!(oldDepositAsset && oldDepositAsset.id === assetTarget.id);
                    const depositDelta = sameAsset ? (jumlahNum - (Number(oldRow.jumlah) || 0)) : jumlahNum;
                    const txPromise = wasEdit
                        ? transactionService.update(currentEditId, servicesModule.toUpdateRecord(data))
                        : transactionService.create(servicesModule.toCreateRecord(data));
                    // Baris transaksi hasil simpan (dari server, bukan rekaan klien) dipakai utk
                    // echo lokal pasca-simpan -- tidak perlu fetch ulang seluruh tabel.
                    let savedTxRow = null;
                    let chain = txPromise.then((row) => { savedTxRow = row; });
                    // Patch aset yang SAMA PERSIS dengan payload updateAsset (plus terakhir segar)
                    // dipakai juga untuk echo lokal baris aset, supaya tab Aset langsung benar
                    // tanpa refreshAssetsOnly().
                    const assetPatches = [];
                    if (wasEdit && oldDepositAsset && !sameAsset) {
                        const oldAssetPatch = { id: oldDepositAsset.id, terakhir: new Date().toISOString(), ...servicesModule.applyAssetDeposit(oldDepositAsset, -(Number(oldRow.jumlah) || 0), oldRow.tanggal) };
                        assetPatches.push(oldAssetPatch);
                        chain = chain.then(() => servicesModule.updateAsset(supabaseClient, oldDepositAsset.id, oldAssetPatch));
                    }
                    const targetAssetPatch = { id: assetTarget.id, terakhir: new Date().toISOString(), ...servicesModule.applyAssetDeposit(assetTarget, depositDelta, data.tanggal) };
                    assetPatches.push(targetAssetPatch);
                    chain
                        .then(() => servicesModule.updateAsset(supabaseClient, assetTarget.id, targetAssetPatch))
                        .then(() => finishSave(savedTxRow, assetPatches, 'Setoran Rp ' + formatRp(jumlahNum) + ' ke ' + assetTarget.nama + ' berhasil dicatat.'))
                        .catch((err) => { console.error('Setor ke aset gagal:', err); showErrorToast('Gagal menyimpan setoran. Periksa koneksi internet kamu lalu coba lagi.'); showLoading(false); });
                };
                // Cek lunak: peringatkan bila saldo akun sumber tidak cukup -- user boleh lanjut
                // (konsisten dgn pengeluaran yg juga tidak memblokir saldo minus).
                const saldoSumber = servicesModule.computeAccountTotals(globalData, data.akun, { transferTargetAmount }).balance;
                if (!wasEdit && jumlahNum > saldoSumber) {
                    showLoading(false);
                    showConfirm('Saldo akun "' + data.akun + '" (Rp ' + formatRp(saldoSumber) + ') lebih kecil dari jumlah setoran. Tetap catat setorannya?', runDeposit);
                    return;
                }
                runDeposit();
                return;
            }

            if (jenisVal === 'Transfer' && !wasEdit) {
                // TRANSFER BARU -- selalu lewat RPC create_transfer_transaction(), bukan cuma saat
                // lintas mata uang. RPC ini menangani kasus sama-mata-uang dgn benar juga (kurs
                // sumber == kurs tujuan -> jumlah tujuan = jumlah sumber persis), sekalian dapat
                // manfaat "1 operasi atomik" utk SEMUA transfer baru.
                // Pensyahan api.run (slice transactions): RPC transfer dipanggil lewat service
                // langsung; mapping argumen form -> parameter ada di servicesModule.toTransferParams
                // (body createTransferTransactionRemote adapter lama), callback persis.
                servicesModule.createTransfer(supabaseClient, servicesModule.toTransferParams({
                    tanggal: data.tanggal, jumlah: jumlahNum, akun_sumber: data.akun, akun_tujuan: catVal,
                    mata_uang_sumber: currentTxMataUang, mata_uang_tujuan: currentTxMataUangTujuan,
                    kurs_sumber: currentTxMataUang ? currentTxKurs : 1,
                    kurs_tujuan: currentTxMataUangTujuan ? currentTxKursTujuan : 1,
                    keterangan: data.keterangan || null
                }))
                    // RPC create_transfer_transaction RETURNS baris transaksi baru (RETURNS
                    // public.transactions) -- dipakai utk echo lokal seperti jalur insert biasa.
                    .then((result) => {
                        const rpcData = result && result.data;
                        const rpcRow = Array.isArray(rpcData) ? rpcData[0] : rpcData;
                        onSaveOk(rpcRow ? servicesModule.mapTransactionRow(rpcRow) : null, null);
                    })
                    .catch((err) => { console.error('api.run.createTransferTransaction gagal:', err); onSaveFail(err); });
                return;
            }

            if (jenisVal === 'Transfer' && wasEdit) {
                // EDIT transfer yang sudah ada -- tetap lewat UPDATE biasa (RPC di atas khusus utk
                // INSERT baru), tapi field sisi tujuan dihitung dgn RUMUS YANG SAMA PERSIS seperti
                // RPC create_transfer_transaction(), supaya baris hasil edit tetap konsisten dengan
                // baris yang dibuat lewat RPC.
                const kursSumberEfektif = currentTxMataUang ? currentTxKurs : 1;
                const kursTujuanEfektif = currentTxMataUangTujuan ? currentTxKursTujuan : 1;
                const sourceIdr = jumlahNum * kursSumberEfektif;
                data.transfer_jumlah_tujuan = sourceIdr / kursTujuanEfektif;
                data.transfer_mata_uang_tujuan = currentTxMataUangTujuan;
                data.transfer_kurs_tujuan = currentTxMataUangTujuan ? currentTxKursTujuan : null;
                data.transfer_jumlah_tujuan_idr = sourceIdr;
            }

            // Pensyahan api.run (slice transactions): service langsung + normalizer payload
            // (toUpdateRecord/toCreateRecord = body edit/addTransactionRemote adapter lama), callback persis.
            if(currentEditId) {
                // Bila baris lama adalah setor ke aset dan hasil edit BUKAN lagi setor ke aset
                // yang sama (jalur setor-aset sudah return di atas), nominal DITARIK KEMBALI
                // dari aset lama supaya nilai/modal aset tidak menggantung (audit 2026-09).
                const oldRowEdit = globalData.find(t => t.id === currentEditId) || null;
                const oldDepositEdit = oldRowEdit ? servicesModule.resolveAssetDepositTx(oldRowEdit, globalAssets) : null;
                const editPatches = [];
                let editChain = transactionService.update(currentEditId, servicesModule.toUpdateRecord(data));
                if (oldDepositEdit) {
                    const oldEditPatch = { id: oldDepositEdit.id, terakhir: new Date().toISOString(), ...servicesModule.applyAssetDeposit(oldDepositEdit, -(Number(oldRowEdit.jumlah) || 0), oldRowEdit.tanggal) };
                    editPatches.push(oldEditPatch);
                    editChain = editChain.then(() => servicesModule.updateAsset(supabaseClient, oldDepositEdit.id, oldEditPatch));
                }
                editChain.then((row) => onSaveOk(row, editPatches.length ? editPatches : null)).catch((err) => { console.error('api.run.editTransaction gagal:', err); onSaveFail(err); });
            }
            else { transactionService.create(servicesModule.toCreateRecord(data)).then((row) => onSaveOk(row, null)).catch((err) => { console.error('api.run.addTransaction gagal:', err); onSaveFail(err); }); }
        }

        function hapusData(id) { showConfirm('Yakin ingin menghapus transaksi ini?', () => { showLoading(true);
            // Setor ke aset: saat transaksi setor dihapus, nominalnya DITARIK KEMBALI dari
            // nilai/modal aset (src/domain/asset-flows.js) supaya keduanya tetap sinkron.
            const rowToDelete = globalData.find(t => t.id === id) || null;
            const depositAsset = servicesModule.resolveAssetDepositTx(rowToDelete, globalAssets);
            transactionService.remove(id).then(() => {
                if (depositAsset) {
                    servicesModule.updateAsset(supabaseClient, depositAsset.id, { ...depositAsset, ...servicesModule.applyAssetDeposit(depositAsset, -(Number(rowToDelete.jumlah) || 0), rowToDelete.tanggal) })
                        .then(() => { refreshTransactionsOnly(() => refreshAssetsOnly()); showSuccessToast('Transaksi dihapus & nominal ditarik kembali dari aset ' + depositAsset.nama + '.'); })
                        .catch(() => { refreshTransactionsOnly(); showErrorToast('Transaksi dihapus, tapi aset gagal diperbarui -- periksa tab Aset.'); showLoading(false); });
                } else { refreshTransactionsOnly(); showSuccessToast('Transaksi berhasil dihapus.'); }
            }).catch((err) => { console.error('api.run.deleteTransaction gagal:', err); showErrorToast('Gagal menghapus transaksi. Coba lagi.'); showLoading(false); }); }); }

        // ========================== FORM ASET ACTIONS ==========================
        // Section "Simbol/ID" + "Jumlah Unit" cuma relevan buat kategori yang punya sumber harga
        // otomatis. Kripto -> CoinGecko (solid). Saham -> Yahoo Finance (TIDAK RESMI,
        // eksperimental). REKSADANA -> NAB/UP pasar riil dari API publik Bibit (2026-09,
        // terverifikasi; eksekusi di Edge Function refresh-asset-price krn CORS Bibit
        // terpatri ke origin mereka) + jalur "Sync NAB Manual" yang selalu berfungsi.
        // Emas belum didukung -- belum ada sumber data gratis yang cukup diyakini akurat.
        const ASSET_AUTO_UPDATE_CONFIG = {
            'Kripto': {
                sumber_harga: 'coingecko',
                simbolLabel: 'ID CoinGecko',
                simbolPlaceholder: 'Contoh: bitcoin, ethereum, solana',
                simbolHint: 'Lihat ID-nya di URL halaman koin tsb di coingecko.com (bagian paling akhir)',
                unitLabel: 'Jumlah Koin Dimiliki',
                desc: '<i class="fas fa-bolt mr-1"></i>Opsional -- isi dua kolom ini supaya nilai aset ini bisa di-refresh otomatis dari harga pasar terkini (sumber: CoinGecko).'
            },
            'Saham': {
                sumber_harga: 'yahoo_id_stock',
                simbolLabel: 'Kode Saham IDX',
                simbolPlaceholder: 'Contoh: BBCA, TLKM, BBRI',
                simbolHint: 'Kode 4 huruf di Bursa Efek Indonesia, tanpa akhiran .JK',
                unitLabel: 'Jumlah Lembar Saham',
                desc: '<i class="fas fa-triangle-exclamation mr-1"></i>Opsional & EKSPERIMENTAL -- sumber data Yahoo Finance (tidak resmi, bisa berhenti berfungsi sewaktu-waktu tanpa pemberitahuan).'
            },
            'Reksadana': {
                sumber_harga: 'reksadana_bibit',
                simbolLabel: 'Nama Dana di Bibit',
                simbolPlaceholder: 'Contoh: Sucorinvest Stable Fund',
                simbolHint: 'Salin nama reksadana PERSIS seperti tertera di aplikasi Bibit/Bareksa (atau isi ID produk Bibit berupa angka)',
                unitLabel: 'Jumlah Unit Dimiliki',
                desc: '<i class="fas fa-satellite-dish mr-1"></i>Opsional -- isi dua kolom ini supaya nilai aset bisa di-sync otomatis dari NAB/UP pasar riil (sumber: Bibit, via server). Bila sync otomatis belum aktif di proyek Anda, tombol "Sync NAB/UP Pasar" di Detail Aset selalu tersedia.'
            }
        };

        function toggleAssetAutoUpdateSection() {
            const kategori = document.getElementById('aset_kategori').value;
            const cfg = ASSET_AUTO_UPDATE_CONFIG[kategori];
            document.getElementById('aset-auto-update-section').classList.toggle('hidden', !cfg);
            if (!cfg) return;
            document.getElementById('aset-auto-update-desc').innerHTML = cfg.desc;
            document.getElementById('aset-simbol-label').textContent = cfg.simbolLabel;
            document.getElementById('aset_simbol').placeholder = cfg.simbolPlaceholder;
            document.getElementById('aset-simbol-hint').textContent = cfg.simbolHint;
            document.getElementById('aset-jumlah-unit-label').textContent = cfg.unitLabel;
        }

        function openAssetModal(isEdit = false, id = null) {
            const modal = document.getElementById('modalAsset'); const content = document.getElementById('modalAssetContent');
            modal.classList.remove('hidden'); setTimeout(() => { content.classList.remove('translate-x-full'); }, 10);
            
            if(!isEdit) {
                currentAssetEditId = null; document.getElementById('modalAssetTitle').innerText = "Tambah Aset Baru";
                document.getElementById('btnSubmitAssetForm').innerText = "Simpan Aset"; document.getElementById('formAsset').reset();
                document.getElementById('aset_modal').value = ''; document.getElementById('aset_modal_display').value = '';
                document.getElementById('aset_nilai').value = ''; document.getElementById('aset_nilai_display').value = '';
                document.getElementById('aset_simbol').value = ''; document.getElementById('aset_jumlah_unit').value = '';
            } else {
                let item = globalAssets.find(a => a.id === id); if(!item) return;
                currentAssetEditId = id;
                document.getElementById('modalAssetTitle').innerText = "Update Aset";
                document.getElementById('btnSubmitAssetForm').innerText = "Simpan Perubahan";
                document.getElementById('aset_nama').value = item.nama;
                document.getElementById('aset_kategori').value = item.kategori;
                document.getElementById('aset_platform').value = item.platform;
                document.getElementById('aset_modal').value = item.modal;
                document.getElementById('aset_modal_display').value = new Intl.NumberFormat('id-ID').format(item.modal);
                document.getElementById('aset_nilai').value = item.nilai;
                document.getElementById('aset_nilai_display').value = new Intl.NumberFormat('id-ID').format(item.nilai);
                document.getElementById('aset_simbol').value = item.simbol || '';
                document.getElementById('aset_jumlah_unit').value = item.jumlah_unit || '';
            }
            toggleAssetAutoUpdateSection();
        }
        
        function closeAssetModal() {
            const content = document.getElementById('modalAssetContent'); content.classList.add('translate-x-full');
            setTimeout(() => { document.getElementById('modalAsset').classList.add('hidden'); }, 300);
        }

        function submitAsset(e) {
            if(e) e.preventDefault();
            const form = document.getElementById('formAsset');
            if(!form.checkValidity()) { form.reportValidity(); return; }
            
            showLoading(true);
            const newNilai = Number(document.getElementById('aset_nilai').value);
            const kategoriVal = document.getElementById('aset_kategori').value;
            const simbolVal = document.getElementById('aset_simbol').value.trim();
            const jumlahUnitVal = document.getElementById('aset_jumlah_unit').value;
            const autoCfg = ASSET_AUTO_UPDATE_CONFIG[kategoriVal];
            const autoUpdateFilled = !!(autoCfg && simbolVal && jumlahUnitVal);
            const data = {
                nama: document.getElementById('aset_nama').value,
                kategori: kategoriVal,
                platform: document.getElementById('aset_platform').value,
                modal: document.getElementById('aset_modal').value,
                nilai: newNilai,
                // "Refresh Harga Otomatis" baru aktif kalau kategorinya didukung (lihat
                // ASSET_AUTO_UPDATE_CONFIG) DAN kedua kolom terisi -- di luar itu, sumber_harga
                // sengaja null (aset tetap 100% manual seperti biasa).
                simbol: autoUpdateFilled ? simbolVal : null,
                jumlah_unit: autoUpdateFilled ? Number(jumlahUnitVal) : null,
                sumber_harga: autoUpdateFilled ? autoCfg.sumber_harga : null
            };

            const wasEdit = !!currentAssetEditId; // simpan sebelum async
            const todayStr = todayDateStr();

            // Kelola value_history: titik baru cuma ditambah kalau NILAINYA benar-benar berubah,
            // supaya edit nama/kategori/platform doang tidak menghasilkan titik history yang
            // duplikat/tidak informatif. Edit dua kali di hari yang sama menimpa titik hari itu,
            // bukan menumpuk dua titik di tanggal yang sama.
            if (wasEdit) {
                const existing = globalAssets.find(a => a.id === currentAssetEditId);
                const history = (existing && existing.value_history) ? existing.value_history.slice() : [];
                if (!existing || Number(existing.nilai) !== newNilai) {
                    const sameDayIdx = history.findIndex(h => h.tanggal === todayStr);
                    if (sameDayIdx >= 0) history[sameDayIdx] = { tanggal: todayStr, nilai: newNilai };
                    else history.push({ tanggal: todayStr, nilai: newNilai });
                }
                data.value_history = history;
            } else {
                data.value_history = [{ tanggal: todayStr, nilai: newNilai }];
            }

            const onAssetSaveFail = () => { showErrorToast('Gagal menyimpan aset. Periksa koneksi internet kamu lalu coba lagi.'); showLoading(false); };
            const onAssetSaveOk = () => { closeAssetModal(); refreshAssetsOnly(); showSuccessToast(wasEdit ? 'Aset berhasil diperbarui.' : 'Aset berhasil ditambahkan.'); };
            if(currentAssetEditId) {
                // Pensyahan api.run (slice assets): service langsung (adapter memang cuma
                // meneruskan data tanpa mapping), callback persis versi lama.
                servicesModule.updateAsset(supabaseClient, currentAssetEditId, data)
                    .then(onAssetSaveOk)
                    .catch((err) => { console.error('api.run.editAsset gagal:', err); onAssetSaveFail(err); });
            } else {
                servicesModule.createAsset(supabaseClient, data)
                    .then(onAssetSaveOk)
                    .catch((err) => { console.error('api.run.addAsset gagal:', err); onAssetSaveFail(err); });
            }
        }

        function deleteAssetData(id) {
            showConfirm('Yakin ingin menghapus aset ini dari portofolio?', () => {
                showLoading(true); servicesModule.deleteAsset(supabaseClient, id).then(() => { refreshAssetsOnly(); showSuccessToast('Aset berhasil dihapus.'); }).catch((err) => { console.error('api.run.deleteAsset gagal:', err); showErrorToast('Gagal menghapus aset. Coba lagi.'); showLoading(false); });
            });
        }

        // ========================== REFRESH RINGAN (dipakai setelah CRUD transaksi/aset) ==========================
        // loadData() penuh menarik 6 tabel sekaligus (transaksi, budget, aset, ikon, settings, recurring)
        // lewat getSyncData() -- itu masuk akal untuk load awal/refresh manual, tapi BOROS kalau dipanggil
        // ulang setiap kali user cuma menambah/edit/hapus SATU transaksi atau SATU aset, padahal 5 dari
        // 6 tabel itu jelas tidak berubah oleh aksi tersebut. Dua fungsi di bawah ini cuma menarik ulang
        // tabel yang benar-benar terpengaruh, lalu menjalankan render yang sama seperti loadData() untuk
        // bagian yang relevan -- hasil akhir di layar identik, tapi jauh lebih sedikit request ke server.
        function refreshTransactionsOnly(afterCallback) {
            // Pensyahan api.run (slice transactions): service langsung, callback persis versi lama.
            transactionService.list().then((transactions) => {
                globalData = transactions || [];

                // Pendaftaran akun baru + self-heal "nama aset bayangan" -- SATU sumber
                // kebenaran (src/domain/asset-flows.js, syncAccountsFromTransactions), dipakai
                // juga oleh echo lokal pasca-simpan supaya perilakunya identik.
                const accSync = servicesModule.syncAccountsFromTransactions({ accounts: appSettings.accounts, transactions: globalData, assets: globalAssets });
                let needsSettingUpdate = false;
                if (accSync.added.length || accSync.shadowNames.length) {
                    appSettings.accounts = accSync.accounts;
                    accSync.shadowNames.forEach((n) => servicesModule.pruneAccountKeyedMaps(appSettings, n));
                    needsSettingUpdate = true;
                }
                if (needsSettingUpdate) { persistSettings(); renderSettings(); updateFormOptions(); }

                filterTransactions();
                renderRecentList(globalData);
                processDataForUI(globalData);
                renderReportTab();

                if (document.getElementById('view-akun-detail').classList.contains('block')) { openAccountDetail(document.getElementById('detail-account-name').innerText); }
                if (document.getElementById('view-budget').classList.contains('block')) { renderBudgetView(); }

                showLoading(false);
                if (typeof afterCallback === 'function') afterCallback();
            }).catch((err) => {
                console.error('api.run.getTransactionsOnly gagal:', err);
                showErrorToast('Gagal memuat data dari cloud. Periksa koneksi internet kamu, lalu coba muat ulang halaman.');
                showLoading(false);
            });
        }

        // ========================== ECHO LOKAL PASCA-SIMPAN (kecepatan simpan) ==========================
        // Setelah INSERT/UPDATE sukses di server, baris yang DIKEMBALIKAN PostgREST (bentuk kanonik
        // sama persis dengan list()) dipakai untuk memperbarui state lokal secara langsung -- TANPA
        // menarik ulang SELURUH tabel transaksi. Dulu setiap simpan menunggu: getUser() + insert +
        // fetch penuh semua baris (berurutan, 1 request per 1000 baris) + render ulang total.
        // Sekarang: insert (1 request, sekalian mengembalikan barisnya) + update render lokal saja.
        //
        // Hasil di layar identik dengan refresh penuh (baris yang dipakai adalah baris ASLI dari
        // server, bukan hasil reka-reka klien). Kalau ada hal tak terduga (baris hilang, bentuk
        // aneh, dsb), fungsi ini melempar -> fallback ke refreshTransactionsOnly() = perilaku lama
        // persis, jadi tidak ada state yang bisa "nyangkut".
        //
        // assetPatches: array { id, ...patch } optional utk setor-ke-aset -- nilai/modal aset yang
        // BARU SAJA diupdate di server (objek yg sama persis dengan yang dikirim ke updateAsset)
        // dipakai juga untuk meng-cache baris aset lokal, sehingga tidak perlu refreshAssetsOnly().
        function applyLocalTxEcho(mode, txRow, assetPatches, afterCallback) {
            try {
                if (!txRow || txRow.id == null) throw new Error('Baris hasil simpan tidak tersedia.');
                if (mode === 'insert') globalData = servicesModule.insertTransactionRow(globalData, txRow);
                else if (mode === 'update') globalData = servicesModule.replaceTransactionRow(globalData, txRow);
                else throw new Error('Mode echo tidak dikenal: ' + mode);
                if (Array.isArray(assetPatches)) {
                    let assetsMerged = globalAssets.slice();
                    assetPatches.forEach((patch) => {
                        const assetIdx = assetsMerged.findIndex((a) => String(a.id) === String(patch.id));
                        if (assetIdx === -1) throw new Error('Aset target echo tidak ditemukan di state lokal: ' + patch.id);
                        assetsMerged[assetIdx] = { ...assetsMerged[assetIdx], ...patch };
                    });
                    globalAssets = assetsMerged;
                }
                // Pendaftaran akun baru + self-heal -- helper yang SAMA dengan refresh penuh.
                const accSync = servicesModule.syncAccountsFromTransactions({ accounts: appSettings.accounts, transactions: globalData, assets: globalAssets });
                if (accSync.added.length || accSync.shadowNames.length) {
                    appSettings.accounts = accSync.accounts;
                    accSync.shadowNames.forEach((n) => servicesModule.pruneAccountKeyedMaps(appSettings, n));
                    persistSettings(); renderSettings(); updateFormOptions();
                }
                // Pipeline render yang sama persis dengan refreshTransactionsOnly().
                filterTransactions();
                renderRecentList(globalData);
                processDataForUI(globalData);
                renderReportTab();
                if (document.getElementById('view-akun-detail').classList.contains('block')) { openAccountDetail(document.getElementById('detail-account-name').innerText); }
                if (document.getElementById('view-budget').classList.contains('block')) { renderBudgetView(); }
                showLoading(false);
                if (typeof afterCallback === 'function') afterCallback();
            } catch (err) {
                // Fallback: perilaku lama persis (fetch ulang semua tabel yang terpengaruh).
                console.error('Echo lokal pasca-simpan gagal -- fallback refresh penuh:', err);
                if (Array.isArray(assetPatches) && assetPatches.length) refreshTransactionsOnly(() => refreshAssetsOnly());
                else refreshTransactionsOnly(afterCallback);
            }
        }

        // ========================== NOTIFIKASI BUDGET MEPET LIMIT (Quick win) ==========================
        // Dicek tiap kali transaksi Pengeluaran disimpan (baru/edit) -- BUKAN dari cek berkala, tapi
        // bandingkan persentase budget SEBELUM vs SESUDAH transaksi ini, supaya toast cuma muncul
        // TEPAT SAAT baru melewati ambang batas (80%/100%), bukan berulang tiap nyimpen transaksi lain
        // di kategori yang sudah lama over-budget (itu bakal annoying kalau notif terus tiap kali).
        function getCategoryBudgetStatus(kategori) {
            if (!lastInsightsCtx) return null;
            const style = getCategoryStyle(kategori, 'Pengeluaran');
            const parentName = style.parentName || kategori;
            const budget = Number(currentMonthBudgetsCache[parentName]) || 0;
            if (budget <= 0) return null; // kategori ini tidak ada budget-nya bulan ini
            const spent = lastInsightsCtx.monthCatOutMap[parentName] || 0;
            return { parentName, budget, spent, pct: spent / budget };
        }

        function notifyIfBudgetThresholdCrossed(kategori, before) {
            const after = getCategoryBudgetStatus(kategori);
            // detectBudgetThresholdCrossing (src/domain/budgets.js) sudah menangani kasus
            // before/after null -- dipertahankan biar 100% sama seperti kode lama.
            const crossing = servicesModule.detectBudgetThresholdCrossing(before && before.pct, after && after.pct);
            if (crossing === 'exceeded') {
                showToast(`Budget "${after.parentName}" bulan ini sudah TERLAMPAUI -- Rp ${formatRp(after.spent)} dari Rp ${formatRp(after.budget)}.`, 'error');
            } else if (crossing === 'warning') {
                showInfoToast(`Budget "${after.parentName}" sudah ${Math.round(after.pct * 100)}% terpakai bulan ini (Rp ${formatRp(after.spent)} dari Rp ${formatRp(after.budget)}).`);
            }
        }

        function refreshAssetsOnly() {
            // Pensyahan api.run (slice assets): service langsung, callback persis versi lama.
            servicesModule.listAssets(supabaseClient).then((assets) => {
                globalAssets = assets || [];
                processDataForUI(globalData); // dashboard menampilkan total nilai aset, jadi tetap perlu diperbarui
                if (document.getElementById('view-aset').classList.contains('block')) { renderAssetView(); }
                showLoading(false);
            }).catch((err) => {
                console.error('api.run.getAssetsOnly gagal:', err);
                showErrorToast('Gagal memuat data dari cloud. Periksa koneksi internet kamu, lalu coba muat ulang halaman.');
                showLoading(false);
            });
        }

        // ========================== MASTER FETCH ==========================
        async function loadData() {
            setSyncLoading(true); // slice design #3: skeleton Dashboard / overlay utk tab lain
            // Gerbang chart lazy (Tier-2 #5): tunggu chart.js+datalabels siap sebelum
            // rantai render grafik jalan. Semua chart hanya dirender pasca-login, jadi
            // dalam praktik promise ini sudah lama selesai (unduhan dimulai saat halaman
            // dibuka, paralel dgn app script). Gagal dimuat -> lanjut tanpa chart
            // (paritas perilaku versi CDN-off), error sudah dicatat loader.
            if (window.__mfChartLibReady) { try { await window.__mfChartLibReady; } catch (e) {} }
            
            const targetBulan = document.getElementById('budgetFilterMonth').value || todayDateStr().slice(0, 7);

            // Pensyahan api.run (slice penutup): getSyncData() adapter di-inline di sini --
            // Promise.all 6 service, urutan & bentuk hasil { transactions, budgets, assets,
            // settings, customIcons, recurring } sama persis dgn getSyncData lama.
            (async () => {
                const [transactions, budgets, assets, customIcons, settings, recurring] = await Promise.all([
                    transactionService.list(),
                    servicesModule.fetchMonthBudgets(supabaseClient, targetBulan),
                    servicesModule.listAssets(supabaseClient),
                    servicesModule.getCustomIcons(supabaseClient),
                    servicesModule.getSettings(supabaseClient),
                    servicesModule.listRecurring(supabaseClient),
                ]);
                return { transactions, budgets, assets, settings, customIcons, recurring };
            })().then((response) => {
                globalData = response.transactions || [];
                cloudBudgets = response.budgets || {};
                globalAssets = response.assets || [];
                globalRecurring = response.recurring || [];
                
                if (response.settings) { appSettings = response.settings; }
                ensureSettingsShape(); // jaga-jaga: settings lama dari cloud mungkin belum punya field terbaru
                applyThemeColor(); // warna aksen tersimpan di appSettings -> sekali setel, semua device ikut

                // Ikon custom akun (upload gambar / pilih ikon) sumber datanya adalah tabel
                // custom_icons di Supabase, dikirim lewat response.customIcons -- ini yang jadi
                // acuan utama supaya tetap sinkron di semua perangkat. Tabel yang sama juga dipakai
                // buat foto profil (key PROFILE_AVATAR_KEY) dan override gaya kategori (key berawalan
                // CATEGORY_STYLE_KEY_PREFIX), jadi perlu dipilah dulu sebelum ditaruh ke accountIcons.
                if (response.customIcons) {
                    const rawIcons = response.customIcons;
                    appSettings.accountIcons = {};
                    appSettings.categoryStyles = { pengeluaran: {}, pemasukan: {} };
                    Object.keys(rawIcons).forEach(key => {
                        if (key.indexOf(CATEGORY_STYLE_KEY_PREFIX) === 0) {
                            const rest = key.slice(CATEGORY_STYLE_KEY_PREFIX.length);
                            const sepIdx = rest.indexOf('::');
                            if (sepIdx === -1) return;
                            const jenisKey = rest.slice(0, sepIdx), catName = rest.slice(sepIdx + 2);
                            if (jenisKey !== 'pengeluaran' && jenisKey !== 'pemasukan') return;
                            appSettings.categoryStyles[jenisKey][catName] = rawIcons[key];
                        } else {
                            appSettings.accountIcons[key] = rawIcons[key];
                        }
                    });
                }
                if (!appSettings.accountIcons) appSettings.accountIcons = {};

                // Pendaftaran akun baru + self-heal "nama aset bayangan" -- SATU sumber
                // kebenaran (src/domain/asset-flows.js, syncAccountsFromTransactions), sama
                // seperti di refreshTransactionsOnly().
                const accSync = servicesModule.syncAccountsFromTransactions({ accounts: appSettings.accounts, transactions: globalData, assets: globalAssets });
                let needsSettingUpdate = false;
                if (accSync.added.length || accSync.shadowNames.length) {
                    appSettings.accounts = accSync.accounts;
                    accSync.shadowNames.forEach((n) => servicesModule.pruneAccountKeyedMaps(appSettings, n));
                    needsSettingUpdate = true;
                }

                if (needsSettingUpdate || !response.settings) {
                    persistSettings(); 
                }

                renderSettings(); 
                applyDefaultViewOnce(); // tab awal sesuai Preferensi (sekali per pemuatan halaman)
                updateFormOptions();

                // Dipanggil SEDINI MUNGKIN di sini (bukan di akhir handler ini) -- openModal() cuma
                // butuh appSettings.accounts & categoryDict yang sudah siap sejak baris di atas, jadi
                // sengaja TIDAK digantungkan ke suksesnya rendering transaksi/chart/laporan di bawah
                // yang sama sekali tidak berhubungan. Kalau salah satu dari itu error karena sebab
                // apa pun, Quick Add tidak boleh ikut gagal terbuka gara-gara itu. Dibungkus try/catch
                // juga sebagai lapisan aman tambahan.
                try { handlePendingQuickAdd(); } catch (e) { console.error('Gagal membuka modal Quick Add:', e); }

                filterTransactions(); 
                renderRecentList(globalData); 
                renderHudSparklines();
                processDataForUI(globalData); 
                renderReportTab();

                // currentMonthBudgetsCache dipakai wawasan "Peringatan Anggaran" -- di-refresh async di
                // sini (tidak menahan render lain di atas), lalu render ulang wawasan saja begitu datang.
                refreshCurrentMonthBudgetsCache(() => { if (lastInsightsCtx) renderInsights(lastInsightsCtx); });
                
                if(document.getElementById('view-akun-detail').classList.contains('block')) { openAccountDetail(document.getElementById('detail-account-name').innerText); }
                if(document.getElementById('view-budget').classList.contains('block')) { renderBudgetView(); }
                if(document.getElementById('view-aset').classList.contains('block')) { renderAssetView(); }
                renderRecurringSummary();

                setSyncLoading(false);
                updateDashboardEmptyState(); // Tier-3 #8: kartu onboarding saat belum ada transaksi
                processDueRecurring();
            }).catch((err) => {
                console.error('api.run.getSyncData gagal:', err);
                setHudStatus('error');
                showErrorToast('Gagal memuat data dari cloud. Periksa koneksi internet kamu, lalu coba muat ulang halaman.');
                setSyncLoading(false);
            });
        }

        // ========================== TRANSAKSI BERULANG (langganan, gaji, cicilan, tagihan rutin) ==========================
        // Konsep: template disimpan di tabel recurring_transactions (lihat sql/schema.sql). Tiap kali
        // aplikasi selesai memuat data, processDueRecurring() mengecek template yang next_due_date-nya
        // sudah lewat/hari ini, lalu OTOMATIS membuat transaksi nyata di tabel transactions untuk
        // setiap periode yang jatuh tempo (mengejar ketinggalan kalau user lama tidak membuka app),
        // dan memajukan next_due_date ke periode berikutnya. Tidak butuh cron/server terjadwal apa pun
        // karena pengecekannya terjadi di sisi client, setiap kali user login/membuka app.

        // apiCall() (pembungkus api.run jadi Promise) ikut pensiun bersama adapter --
// processDueRecurring() dkk kini meng-await service langsung (slice recurring).

        const RECURRING_FREQ_LABEL = { harian: 'Harian', mingguan: 'Mingguan', bulanan: 'Bulanan', tahunan: 'Tahunan' };

        // advanceDueDate() & planRecurringCatchup() sekarang hidup di src/domain/recurring.js --
        // pure function, tanpa DOM/network, jadi bisa di-unit-test langsung (lihat
        // tests/parity/recurring-domain.test.js). Diakses di sini lewat
        // servicesModule.planRecurringCatchup (lihat window.__myfinanceServices di head).

        // Dipanggil sekali setiap sesi (lihat flag _recurringProcessed) setelah loadData() selesai.
        async function processDueRecurring() {
            if (_recurringProcessed) return;
            _recurringProcessed = true;
            if (!globalRecurring || globalRecurring.length === 0) return;

            const todayStr = todayDateStr();
            const dueItems = globalRecurring.filter(r => r.active && r.next_due_date <= todayStr);
            if (dueItems.length === 0) return;

            const MAX_CATCHUP = 36; // jaga-jaga: batas aman per template supaya tidak "meledak" kalau tanggalnya kacau
            let totalCreated = 0;
            const createdLabels = [];
            let anyFailure = false; // cuma dipakai utk toast ringkasan di akhir, BUKAN utk keputusan per-item

            for (const item of dueItems) {
                // Rencana catch-up dihitung SEKALI di depan oleh domain layer yang sudah diuji
                // (tests/parity/recurring-domain.test.js) -- fungsi ini murni, tidak menyentuh
                // network. Efek sampingnya (panggil RPC per tanggal) tetap di sini.
                const { dueDates, nextDueDateAfter, shouldDeactivate } = servicesModule.planRecurringCatchup({
                    nextDueDate: item.next_due_date,
                    endDate: item.end_date,
                    frequency: item.frequency,
                    todayStr,
                    maxCatchup: MAX_CATCHUP,
                });

                let countThis = 0;
                let itemFailed = false; // BUG FIX: dulu 1 variabel `anyFailure` dipakai bersama semua item,
                // jadi kalau template A gagal, next_due_date template B yang sebenarnya SUKSES ikut
                // tidak dimajukan (karena kondisi di bawah membaca anyFailure global yang sudah true).
                // Sekarang tiap item punya flag sendiri -- kegagalan 1 template tidak lagi menahan
                // kemajuan jadwal template lain yang berhasil.
                for (const dueDate of dueDates) {
                    try {
                        // BUG FIX (reliability hardening): dulu pakai apiCall('addTransaction', ...)
                        // biasa -- kalau proses ini sempat berjalan 2x nyaris bersamaan (2 tab, atau
                        // retry pasca-timeout), transaksi berulang yang sama bisa tercatat DOBEL.
                        // createRecurringTransaction() dijamin idempoten di level database: 1
                        // template + 1 tanggal jatuh tempo = maksimal 1 transaksi, walau baris ini
                        // ke-trigger berkali-kali.
                        // Pensyahan api.run (slice recurring): RPC idempoten dipanggil service
                        // langsung; mapping snake_case -> param ada di servicesModule.toCreateRecurringParams.
                        await servicesModule.createRecurringTransaction(supabaseClient, servicesModule.toCreateRecurringParams({
                            recurring_id: item.id, due_date: dueDate, jenis: item.jenis, jumlah: item.jumlah,
                            akun: item.akun, kategori: item.kategori,
                            keterangan: (item.keterangan ? item.keterangan + ' ' : '') + '(otomatis berulang)'
                        }));
                        totalCreated++; countThis++;
                    } catch (e) {
                        console.error('Gagal membuat transaksi berulang otomatis:', e);
                        itemFailed = true;
                        anyFailure = true;
                        break; // sisa periode yang belum terkejar akan dicoba lagi di sesi berikutnya
                    }
                }
                if (countThis > 0) createdLabels.push(item.keterangan || item.kategori);

                // Majukan jadwal di server -- KECUALI kalau tadi gagal di tengah jalan (biar dicoba lagi,
                // bukan malah melompati periode yang belum berhasil dicatat). nextDueDateAfter/
                // shouldDeactivate cuma valid dipakai kalau SEMUA dueDates di atas berhasil, makanya
                // dijaga oleh !itemFailed.
                if (countThis > 0 && !itemFailed) {
                    try {
                        if (shouldDeactivate) { await servicesModule.setRecurringActive(supabaseClient, item.id, false); }
                        else { await servicesModule.advanceRecurringDueDate(supabaseClient, item.id, nextDueDateAfter); }
                    } catch (e) { console.error('Gagal memperbarui jadwal transaksi berulang:', e); }
                }
            }

            if (totalCreated > 0) {
                const preview = createdLabels.slice(0, 3).join(', ') + (createdLabels.length > 3 ? ', dst.' : '');
                showSuccessToast(`${totalCreated} transaksi berulang otomatis dicatat: ${preview}.`);
                loadData(); // segarkan tabel/grafik supaya transaksi baru langsung kelihatan
            }
            if (anyFailure) {
                showErrorToast('Sebagian transaksi berulang gagal dicatat otomatis (koneksi bermasalah?). Akan dicoba lagi saat berikutnya app dibuka.');
            }
        }

        // ---------- Ringkasan di kartu Pengaturan ----------
        function renderRecurringSummary() {
            // Bangun DOM/HTML-nya sekarang di src/ui/recurring.js (dipakai juga oleh
            // tests/unit/ui-recurring.test.js) -- fungsi ini tinggal wrapper tipis yang
            // menyuplai konteks (data & helper) yang dibutuhkan. Nama fungsi & cara
            // memanggilnya di tempat lain TIDAK berubah sama sekali.
            servicesModule.renderRecurringSummaryUI({
                document, globalRecurring, todayDateStr,
                summarizeRecurringStatus: servicesModule.summarizeRecurringStatus,
            });
        }

        // ---------- Modal Daftar Transaksi Berulang ----------
        function openRecurringListModal() {
            renderRecurringListModal();
            const modal = document.getElementById('modalRecurringList'); const content = document.getElementById('modalRecurringListContent');
            modal.classList.remove('hidden');
            setTimeout(() => { content.classList.remove('translate-y-full', 'md:scale-95', 'opacity-0'); }, 10);
        }
        function closeRecurringListModal() {
            const content = document.getElementById('modalRecurringListContent');
            content.classList.add('translate-y-full', 'md:scale-95', 'opacity-0');
            setTimeout(() => { document.getElementById('modalRecurringList').classList.add('hidden'); }, 300);
        }

        function renderRecurringListModal() {
            // Bangun DOM/HTML-nya sekarang di src/ui/recurring.js (dipakai juga oleh
            // tests/unit/ui-recurring.test.js) -- fungsi ini tinggal wrapper tipis yang
            // menyuplai konteks (data & helper) yang dibutuhkan. Nama fungsi & cara
            // memanggilnya di tempat lain (termasuk atribut onclick="..." di HTML utk
            // tombol jeda/edit/hapus di dalam daftar) TIDAK berubah sama sekali.
            servicesModule.renderRecurringListModalUI({
                document, globalRecurring, todayDateStr, getCategoryStyle, categoryIconHtml,
                classifyRecurringDueBadge: servicesModule.classifyRecurringDueBadge,
                escapeHtml, jsStr, formatRp, RECURRING_FREQ_LABEL,
            });
        }

        function toggleRecurringActive(id, currentActive) {
            showLoading(true);
            servicesModule.setRecurringActive(supabaseClient, id, !currentActive).then(() => {
                const item = globalRecurring.find(r => r.id === id); if (item) item.active = !currentActive;
                renderRecurringListModal(); renderRecurringSummary(); showLoading(false);
                showSuccessToast(currentActive ? 'Transaksi berulang dijeda.' : 'Transaksi berulang diaktifkan kembali.');
            }).catch((err) => { console.error('api.run.setRecurringActive gagal:', err); showErrorToast('Gagal memperbarui status. Coba lagi.'); showLoading(false); });
        }

        function deleteRecurringTemplate(id) {
            showConfirm('Yakin ingin menghapus transaksi berulang ini? Transaksi yang sudah tercatat sebelumnya tidak akan terhapus.', () => {
                showLoading(true);
                servicesModule.deleteRecurring(supabaseClient, id).then(() => {
                    globalRecurring = globalRecurring.filter(r => r.id !== id);
                    renderRecurringListModal(); renderRecurringSummary(); showLoading(false);
                    showSuccessToast('Transaksi berulang berhasil dihapus.');
                }).catch((err) => { console.error('api.run.deleteRecurring gagal:', err); showErrorToast('Gagal menghapus. Coba lagi.'); showLoading(false); });
            });
        }

        // ---------- Modal Tambah/Edit Transaksi Berulang ----------
        let currentRecurringEditId = null;

        function populateRecurringFormOptions(jenis) {
            const akunSelect = document.getElementById('recurring-akun');
            const katSelect = document.getElementById('recurring-kategori');
            const katLabel = document.getElementById('recurring-kategori-label');
            akunSelect.innerHTML = appSettings.accounts.map(acc => `<option value="${escapeHtml(acc)}">${escapeHtml(acc)}</option>`).join('');

            if (jenis === 'Transfer') {
                katLabel.textContent = 'Akun Tujuan';
                katSelect.innerHTML = appSettings.accounts.map(acc => `<option value="${escapeHtml(acc)}">${escapeHtml(acc)}</option>`).join('');
            } else {
                katLabel.textContent = jenis === 'Pemasukan' ? 'Sumber Pemasukan' : 'Kategori Pengeluaran';
                const dictKey = jenis === 'Pemasukan' ? 'pemasukan' : 'pengeluaran';
                let optionsHtml = '';
                Object.keys(categoryDict[dictKey] || {}).forEach(parentName => {
                    const parent = categoryDict[dictKey][parentName];
                    optionsHtml += `<optgroup label="${escapeHtml(parentName)}">`;
                    parent.subs.forEach(sub => { optionsHtml += `<option value="${escapeHtml(sub.name)}">${escapeHtml(sub.name)}</option>`; });
                    optionsHtml += `</optgroup>`;
                });
                katSelect.innerHTML = optionsHtml;
            }
        }

        function openRecurringFormModal(id) {
            currentRecurringEditId = id || null;
            const item = id ? globalRecurring.find(r => r.id === id) : null;
            document.getElementById('recurring-form-title').textContent = item ? 'Edit Transaksi Berulang' : 'Tambah Transaksi Berulang';

            const jenis = (item && item.jenis) || 'Pengeluaran';
            document.querySelector(`input[name="recurring-jenis"][value="${jenis}"]`).checked = true;
            populateRecurringFormOptions(jenis);

            document.getElementById('recurring-jumlah').value = item ? item.jumlah : '';
            document.getElementById('recurring-akun').value = item ? item.akun : appSettings.accounts[0];
            document.getElementById('recurring-kategori').value = item ? item.kategori : '';
            document.getElementById('recurring-keterangan').value = item ? (item.keterangan || '') : '';
            document.getElementById('recurring-frequency').value = item ? item.frequency : 'bulanan';
            document.getElementById('recurring-start-date').value = item ? item.start_date : todayDateStr();
            const noEndDate = !item || !item.end_date;
            document.getElementById('recurring-no-end-date').checked = noEndDate;
            document.getElementById('recurring-end-date').value = (item && item.end_date) ? item.end_date : '';
            document.getElementById('recurring-end-date-wrap').classList.toggle('hidden', noEndDate);

            const modal = document.getElementById('modalRecurringForm'); const content = document.getElementById('modalRecurringFormContent');
            modal.classList.remove('hidden');
            setTimeout(() => { content.classList.remove('translate-y-full', 'md:scale-95', 'opacity-0'); }, 10);
        }
        function closeRecurringFormModal() {
            const content = document.getElementById('modalRecurringFormContent');
            content.classList.add('translate-y-full', 'md:scale-95', 'opacity-0');
            setTimeout(() => { document.getElementById('modalRecurringForm').classList.add('hidden'); }, 300);
        }

        function handleRecurringJenisChange(jenis) { populateRecurringFormOptions(jenis); }
        function toggleRecurringEndDate(noEnd) { document.getElementById('recurring-end-date-wrap').classList.toggle('hidden', noEnd); }

        function submitRecurringForm(e) {
            if (e) e.preventDefault();
            const form = document.getElementById('formRecurring');
            if (!form.checkValidity()) { form.reportValidity(); return; }

            const noEndDate = document.getElementById('recurring-no-end-date').checked;
            const startDate = document.getElementById('recurring-start-date').value;
            const data = {
                jenis: document.querySelector('input[name="recurring-jenis"]:checked').value,
                jumlah: document.getElementById('recurring-jumlah').value,
                akun: document.getElementById('recurring-akun').value,
                kategori: document.getElementById('recurring-kategori').value,
                keterangan: document.getElementById('recurring-keterangan').value,
                frequency: document.getElementById('recurring-frequency').value,
                start_date: startDate,
                end_date: noEndDate ? null : document.getElementById('recurring-end-date').value
            };
            if (data.akun === data.kategori && data.jenis === 'Transfer') { alert('Akun asal dan akun tujuan transfer tidak boleh sama.'); return; }

            const wasEdit = !!currentRecurringEditId;
            if (!wasEdit) {
                // Transaksi baru: next_due_date mulai dari start_date itu sendiri (belum pernah tercatat).
                data.next_due_date = startDate;
            }

            showLoading(true);
            const onFail = () => { showErrorToast('Gagal menyimpan transaksi berulang. Coba lagi.'); showLoading(false); };
            const onOk = () => {
                closeRecurringFormModal(); showLoading(false);
                showSuccessToast(wasEdit ? 'Transaksi berulang berhasil diperbarui.' : 'Transaksi berulang berhasil ditambahkan.');
                servicesModule.listRecurring(supabaseClient).then((list) => { globalRecurring = list || []; renderRecurringListModal(); renderRecurringSummary(); }).catch((err) => { console.error('api.run.getRecurring gagal:', err); });
            };
            if (wasEdit) {
                // next_due_date TIDAK diubah lewat form edit ini (supaya jadwal yang sudah berjalan tidak
                // ter-reset tanpa sengaja) -- edit di sini cuma untuk detail transaksinya (jumlah, kategori, dst).
                const existing = globalRecurring.find(r => r.id === currentRecurringEditId);
                data.next_due_date = existing ? existing.next_due_date : startDate;
                servicesModule.updateRecurring(supabaseClient, currentRecurringEditId, data).then(onOk).catch((err) => { console.error('api.run.editRecurring gagal:', err); onFail(err); });
            } else {
                servicesModule.createRecurring(supabaseClient, data).then(onOk).catch((err) => { console.error('api.run.addRecurring gagal:', err); onFail(err); });
            }
        }


        function toggleTxTimeFilter() {
            const filterType = document.getElementById('txTimeFilterType').value;
            const monthContainer = document.getElementById('txMonthYearContainer');
            const rangeContainer = document.getElementById('txDateRangeContainer');
            monthContainer.classList.toggle('hidden', filterType !== 'custom');
            monthContainer.classList.toggle('block', filterType === 'custom');
            rangeContainer.classList.toggle('hidden', filterType !== 'range');
            rangeContainer.classList.toggle('flex', filterType === 'range');
            filterTransactions();
        }

        // Filter Lanjutan: rentang nominal (Rp dari - sampai) -- berlaku BERBARENGAN dgn filter
        // waktu manapun yg aktif (30 hari terakhir / bulan / rentang tanggal), bukan pengganti.
        function toggleTxAmountFilter() {
            const panel = document.getElementById('txAmountFilterPanel');
            panel.classList.toggle('hidden');
            panel.classList.toggle('flex');
        }
        function clearTxAmountFilter() {
            document.getElementById('txFilterAmountMin').value = '';
            document.getElementById('txFilterAmountMinDisplay').value = '';
            document.getElementById('txFilterAmountMax').value = '';
            document.getElementById('txFilterAmountMaxDisplay').value = '';
            filterTransactions();
        }

        // Bungkus satu nilai jadi field CSV yang aman (RFC 4180): field yang mengandung koma,
        // kutip, atau baris baru dibungkus tanda kutip, dan kutip di dalamnya di-escape jadi "".
        function csvField(value) {
            const str = (value === null || value === undefined) ? '' : String(value);
            if (/[",\n\r]/.test(str)) { return '"' + str.replace(/"/g, '""') + '"'; }
            return str;
        }

        function exportTransactionsCsv() {
            if (!lastFilteredTransactions || lastFilteredTransactions.length === 0) {
                showInfoToast('Tidak ada transaksi untuk diekspor pada filter saat ini.');
                return;
            }
            // BUG FIX: sebelumnya cuma ada 1 kolom "Jumlah" -- untuk Transfer lintas mata uang ini
            // menyesatkan kalau dipakai rekonsiliasi akun TUJUAN (nominal yg tampil adalah sisi
            // SUMBER, mata uangnya bisa beda). Sekarang ditambah kolom "Mata Uang" (sisi sumber,
            // berlaku juga utk Pemasukan/Pengeluaran akun asing) dan "Jumlah Diterima (Tujuan)" +
            // "Mata Uang Tujuan" (KHUSUS Transfer, kosong utk jenis lain).
            const header = ['Tanggal', 'Jenis', 'Kategori', 'Akun', 'Keterangan', 'Jumlah', 'Mata Uang', 'Jumlah Diterima (Tujuan)', 'Mata Uang Tujuan'];
            const rows = lastFilteredTransactions.map(row => [
                row.tanggal ? toDateStr(parseTgl(row.tanggal)) : '',
                row.jenis || '',
                row.kategori || '',
                row.akun || '',
                row.keterangan || '',
                row.jumlah || 0,
                row.mata_uang || 'IDR',
                row.jenis === 'Transfer' ? transferTargetAmount(row) : '',
                row.jenis === 'Transfer' ? (row.transfer_mata_uang_tujuan || 'IDR') : ''
            ]);
            // \uFEFF (BOM UTF-8) di depan supaya Excel/Google Sheets langsung mengenali karakter
            // Indonesia (é, ñ, dsb di keterangan) dengan benar, bukan tampil sebagai karakter aneh.
            const csvContent = '\uFEFF' + [header, ...rows].map(r => r.map(csvField).join(',')).join('\r\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const todayStr = todayDateStr();
            a.href = url;
            a.download = `myfinance-transaksi-${todayStr}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showSuccessToast(`${lastFilteredTransactions.length} transaksi berhasil diekspor ke CSV.`);
        }

        // Debounce KHUSUS untuk input pencarian (txSearchInput) -- sebelumnya oninput langsung
        // memanggil filterTransactions() di SETIAP huruf yang diketik, dan filterTransactions()
        // ikut destroy+rebuild chart Chart.js (charts.txTrend) tiap kali dipanggil. Untuk riwayat
        // transaksi yang sudah banyak (menumpuk tahunan), ini bikin ketikan di kolom pencarian
        // terasa patah-patah/lag, terutama di HP. Pemanggil LAIN (ganti bulan, pindah tab, setelah
        // tambah/edit/hapus data) TIDAK lewat wrapper ini -- tetap langsung/instan seperti semula,
        // supaya hasilnya tetap terasa segera setelah aksi yang bukan ketikan beruntun.
        let _txSearchDebounceTimer = null;
        function debouncedFilterTransactions() {
            if (_txSearchDebounceTimer) clearTimeout(_txSearchDebounceTimer);
            _txSearchDebounceTimer = setTimeout(filterTransactions, 300);
        }

        function filterTransactions() {
            let data = [...globalData];
            
            const searchQuery = document.getElementById('txSearchInput').value.toLowerCase().trim();
            if (searchQuery) {
                // Satu sumber kebenaran sekarang src/domain/transactions.js (dipakai juga oleh
                // tests/unit/transactions-domain.test.js).
                data = data.filter(item => servicesModule.matchesTransactionSearch(item, searchQuery));
            }

            const timeFilterType = document.getElementById('txTimeFilterType').value;
            let chartLabels = []; let chartIn = []; let chartOut = [];

            // Filter waktu + agregasi chart-nya: satu sumber kebenaran sekarang
            // src/domain/transactions.js (dipakai juga oleh tests/unit/transactions-domain.test.js).
            if (timeFilterType === 'last30') {
                ({ filtered: data, chartLabels, chartIn, chartOut } = servicesModule.computeLast30DaysView(data, { now: new Date(), parseTgl, txIdrAmount }));
            } else if (timeFilterType === 'custom') {
                const monthYearVal = document.getElementById('txFilterMonthYear').value;
                ({ filtered: data, chartLabels, chartIn, chartOut } = servicesModule.computeCustomMonthView(data, monthYearVal, { parseTgl, txIdrAmount }));
            } else if (timeFilterType === 'range') {
                const fromVal = document.getElementById('txFilterDateFrom').value;
                const toVal = document.getElementById('txFilterDateTo').value;
                ({ filtered: data, chartLabels, chartIn, chartOut } = servicesModule.computeDateRangeView(data, fromVal, toVal, { parseTgl, txIdrAmount, toDateStr }));
            }

            // Filter Lanjutan: rentang nominal -- berlaku BERBARENGAN dgn filter waktu manapun yg
            // aktif di atas (orthogonal, bukan menggantikan). Dicek longgar (elemennya mungkin belum
            // sempat dirender di beberapa alur pemanggilan awal).
            const amountMinEl = document.getElementById('txFilterAmountMin');
            const amountMaxEl = document.getElementById('txFilterAmountMax');
            const amountMin = amountMinEl && amountMinEl.value ? Number(amountMinEl.value) : null;
            const amountMax = amountMaxEl && amountMaxEl.value ? Number(amountMaxEl.value) : null;
            if (amountMin != null || amountMax != null) {
                data = data.filter(item => servicesModule.isWithinAmountRange(item, amountMin, amountMax, { txIdrAmount }));
            }

            // Reset pagination ("Muat lebih banyak") ke halaman pertama HANYA kalau kriteria filter
            // benar-benar berubah sejak render terakhir -- supaya user yang sudah expand daftarnya
            // tidak balik ke halaman pertama cuma gara2 filterTransactions() terpanggil ulang karena
            // alasan lain (mis. setelah tambah/edit/hapus 1 transaksi).
            const filterSignature = JSON.stringify([
                searchQuery, timeFilterType,
                document.getElementById('txFilterMonthYear')?.value,
                document.getElementById('txFilterDateFrom')?.value,
                document.getElementById('txFilterDateTo')?.value,
                amountMin, amountMax
            ]);
            if (filterSignature !== _txListLastFilterSignature) {
                _txListVisibleLimit = TX_LIST_PAGE_SIZE;
                _txListLastFilterSignature = filterSignature;
            }

            const tbody = document.getElementById('table-body');
            let sortedData = [...data].sort(txServerCompare);
            lastFilteredTransactions = sortedData;
            if(sortedData.length === 0) { 
                tbody.innerHTML = `<div class="p-6 text-center text-slate-400">Tidak ada transaksi yang cocok.</div>`; 
            } else {
                const dayAbbrevID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
                // Dikelompokkan per tanggal (mempermudah pembacaan dibanding tabel datar) -- pakai Map
                // supaya urutan insersi = urutan tanggal terbaru->terlama dari sortedData, bukan diacak
                // seperti object biasa.
                const groups = new Map();
                sortedData.forEach(row => {
                    const key = row.tanggal;
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key).push(row);
                });

                // Batasi grup tanggal yang dirender ke DOM sampai TOTAL barisnya mencapai
                // _txListVisibleLimit -- SELALU menyertakan satu grup tanggal secara UTUH (tidak
                // pernah memotong di tengah hari), supaya "Total bersih hari itu" yang dihitung dari
                // rows per grup (di bawah) tetap akurat, bukan cuma sebagian transaksi hari itu.
                const allGroupEntries = Array.from(groups.entries());
                let visibleGroupEntries = allGroupEntries;
                let sisaTransaksi = 0;
                if (sortedData.length > _txListVisibleLimit) {
                    let running = 0, cutIndex = allGroupEntries.length;
                    for (let i = 0; i < allGroupEntries.length; i++) {
                        running += allGroupEntries[i][1].length;
                        if (running >= _txListVisibleLimit) { cutIndex = i + 1; break; }
                    }
                    if (cutIndex < allGroupEntries.length) {
                        visibleGroupEntries = allGroupEntries.slice(0, cutIndex);
                        sisaTransaksi = sortedData.length - running;
                    }
                }

                tbody.innerHTML = visibleGroupEntries.map(([dateKey, rows]) => {
                    const d = parseTgl(dateKey);
                    const dow = d.getDay(); // 0=Minggu ... 6=Sabtu
                    const badgeClass = dow === 0 ? 'bg-rose-500 text-white' : (dow === 6 ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500');

                    // Total bersih hari itu = Pemasukan - Pengeluaran (Transfer tidak dihitung karena
                    // cuma memindahkan uang antar akun, tidak menambah/mengurangi kekayaan bersih).
                    // Satu sumber kebenaran sekarang src/domain/transactions.js (computeDayNetTotal).
                    const netTotal = servicesModule.computeDayNetTotal(rows, { txIdrAmount });
                    const netColor = netTotal > 0 ? 'text-emerald-500' : (netTotal < 0 ? 'text-rose-500' : 'text-slate-400');
                    const netPrefix = netTotal > 0 ? '+' : (netTotal < 0 ? '-' : '');

                    // HUD: bar nominal proporsional terhadap transaksi terbesar hari itu.
                    const grpMaxAmt = Math.max(...rows.map(r => Math.abs(Number(r.jumlah) || 0)), 1);
                    const rowsHtml = rows.map((row, idx) => {
                        let color = row.jenis === 'Pemasukan' ? 'text-emerald-500' : (row.jenis === 'Pengeluaran' ? 'text-rose-500' : 'text-blue-500');
                        let prefix = row.jenis === 'Pengeluaran' ? '-' : (row.jenis === 'Pemasukan' ? '+' : '');
                        let akuntxt = row.jenis === 'Transfer' ? `<span class="flex items-center"><span class="w-3.5 h-3.5 mr-1 inline-flex">${getAccountLogo(row.akun)}</span> ${escapeHtml(row.akun)} <i class="fas fa-arrow-right text-[10px] mx-1 text-slate-300"></i> <span class="w-3.5 h-3.5 mr-1 inline-flex">${getAccountLogo(row.kategori)}</span> ${escapeHtml(row.kategori)}</span>` : `<span class="flex items-center"><span class="w-3.5 h-3.5 mr-1.5 inline-flex">${getAccountLogo(row.akun)}</span> ${escapeHtml(row.akun)}</span>`;
                        let style = getCategoryStyle(row.kategori, row.jenis);

                        return `
                            <div class="stagger-row flex items-center justify-between px-3 md:px-4 py-2.5 hover:bg-slate-50 transition" style="animation-delay: ${Math.min(idx, 14) * 30}ms">
                                <div class="flex items-center min-w-0">
                                    ${categoryIconHtml(style, 'w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center mr-3 flex-shrink-0 border border-slate-50 shadow-sm', 'text-xs md:text-sm')}
                                    <div class="min-w-0">
                                        <p class="text-xs md:text-sm font-bold text-slate-700 truncate">${row.jenis === 'Transfer' ? 'Transfer' : escapeHtml(row.kategori)}</p>
                                        <p class="text-[10px] md:text-xs text-slate-400 truncate flex items-center mt-0.5">${akuntxt}</p>
                                        ${row.keterangan ? `<p class="text-[10px] md:text-xs text-slate-400 truncate">${escapeHtml(row.keterangan)}</p>` : ''}
                                    </div>
                                </div>
                                <div class="flex items-center gap-0.5 flex-shrink-0 pl-2">
                                    <span class="text-xs md:text-sm font-bold hud-mono ${color} whitespace-nowrap mr-1">${prefix}Rp ${formatRp(row.jumlah)}</span>
                                    <button onclick="editDataForm('${row.id}')" aria-label="Ubah transaksi" class="w-7 h-7 rounded-lg text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition flex items-center justify-center flex-shrink-0"><i class="fas fa-pencil-alt text-[10px]"></i></button>
                                    <button onclick="hapusData('${row.id}')" aria-label="Hapus transaksi" class="w-7 h-7 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition flex items-center justify-center flex-shrink-0"><i class="fas fa-trash-alt text-[10px]"></i></button>
                                </div>
                                <div class="hud-rowbar hud-bar" aria-hidden="true"><div class="hud-bar-fill" style="width:${Math.max(3, Math.round(Math.abs(Number(row.jumlah) || 0) / grpMaxAmt * 100))}%"></div></div>
                            </div>`;
                    }).join('');

                    return `
                        <div>
                            <div class="flex items-center justify-between px-3 md:px-4 py-2 bg-slate-50/70">
                                <div class="flex items-center gap-2">
                                    <span class="text-sm md:text-base font-extrabold text-slate-800">${d.getDate()}</span>
                                    <span class="text-[10px] md:text-[10px] font-bold px-1.5 md:px-2 py-0.5 rounded-md ${badgeClass}">${dayAbbrevID[dow]}</span>
                                    <span class="text-[10px] md:text-xs text-slate-400 font-semibold">${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}</span>
                                </div>
                                <span class="text-xs md:text-sm font-bold ${netColor}">${netPrefix}Rp ${formatRp(Math.abs(netTotal))}</span>
                            </div>
                            <div class="divide-y divide-slate-50">${rowsHtml}</div>
                        </div>`;
                }).join('');

                if (sisaTransaksi > 0) {
                    tbody.innerHTML += `
                        <div class="p-4 text-center">
                            <button onclick="loadMoreTransactions()" class="text-xs md:text-sm font-bold text-indigo-500 hover:text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition px-4 py-2 rounded-xl">
                                Muat ${Math.min(sisaTransaksi, TX_LIST_PAGE_SIZE)} transaksi lainnya (${sisaTransaksi} tersisa)
                            </button>
                        </div>`;
                }
            }

            if(charts.txTrend) charts.txTrend.destroy();
            // Chart "Tren Transaksi" -- 1 batang per hari, ARUS KAS BERSIH (Masuk - Keluar), bukan
            // 2 batang bertumpuk seperti sebelumnya: hijau kalau hari itu net positif, merah kalau
            // net negatif, garis 0 sebagai pembanding. Style ini sengaja disamakan dgn referensi
            // desain yang diminta user (foto: kartu cashflow + chart net per hari, sumbu Y format M).
            let chartNet = chartLabels.map((_, i) => Number(chartIn[i] || 0) - Number(chartOut[i] || 0));

            // Di layar sempit (HP), menampilkan label di SEMUA batang pasti numpuk/tumpang tindih --
            // ruang horizontalnya tidak cukup buat puluhan angka. Jadi kalau chart-nya sempit, cuma
            // batang paling signifikan (nilai absolut terbesar) yang dikasih label, DENGAN jarak
            // minimal antar batang yang dikasih label (supaya tidak 2 batang bersebelahan sama2
            // dikasih label lalu tetap numpuk). Batang lain tetap bisa dilihat detailnya lewat tap
            // (tooltip).
            //
            // BUG FIX: "sempit?" sebelumnya dicek dari window.innerWidth (lebar JENDELA) -- di layar
            // lebar (desktop) dgn banyak sekali hari (mis. filter 1 bulan penuh), tiap batang bisa
            // tetap dapat sangat sedikit px meski window-nya lebar, jadi labelnya numpuk juga.
            // Sekarang dicek dari lebar CONTAINER chart yg sebenarnya dibagi jumlah batang (sama
            // seperti chart "Tren Saldo/Arus Kas" Detail Akun & "Tren Kategori" Detail Kategori --
            // ketiganya sekarang satu sumber kebenaran di src/domain/chart-labels.js).
            const txTrendContainerWidth = document.getElementById('txTrendChart').parentElement.clientWidth || window.innerWidth;
            const chartIsNarrow = servicesModule.isChartNarrow(txTrendContainerWidth, chartNet.length);
            const labelIndicesToShow = chartIsNarrow ? servicesModule.selectSparseLabelIndices(chartNet, 5) : null;

            charts.txTrend = new Chart(document.getElementById('txTrendChart').getContext('2d'), servicesModule.chartsUi.buildTxTrendConfig({ chartLabels, chartNet, labelIndicesToShow, themeAccentColor, formatShortVal, formatRp, chartGridColor }));
        }

        // ========================== DASHBOARD ==========================
        function processDataForUI(data) {
            // Kalkulasi (saldo per akun, total masuk/keluar, breakdown kategori, dll) sekarang
            // satu sumber kebenaran: src/domain/dashboard.js (dipakai juga oleh
            // tests/unit/dashboard-domain.test.js) -- bukan lagi ditulis manual di sini seperti
            // sebelumnya. Lihat komentar "AUTH MODULE BRIDGE" di <head> soal kenapa lewat
            // servicesModule, bukan import langsung (200+ onclick= butuh scope global, lihat
            // docs/architecture-modernization-plan.md Phase 4).
            const now = new Date();
            const {
                accBalances, totalIn, totalOut, monthIn, monthOut,
                prevMonthIn, prevMonthOut, monthTxCount,
                monthCatOutMap, catOut3MoMap, last7Map, last7Order, monthlyMap,
            } = servicesModule.aggregateDashboardData(data, {
                accounts: appSettings.accounts,
                now,
                txIdrAmount,
                transferTargetAmount,
                parseTgl,
                categorizeExpenseParent: (kategori) => getCategoryStyle(kategori, 'Pengeluaran').parentName,
            });

            animateRupiah(document.getElementById('dash-total'), totalIn - totalOut, true);
            animateRupiah(document.getElementById('dash-in'), monthIn, true); animateRupiah(document.getElementById('dash-out'), monthOut, true);

            let assetTotalVal = globalAssets.reduce((sum, item) => sum + Number(item.nilai), 0);
            animateRupiah(document.getElementById('dash-total-aset'), assetTotalVal, true);

            let monthSaldo = monthIn - monthOut;
            const saldoEl = document.getElementById('dash-saldo');
            if (saldoEl) {
                saldoEl.innerHTML = `<i class="fas fa-wallet mr-2 text-xs"></i> ${nominalHidden ? 'Rp ••••••' : (monthSaldo < 0 ? '-Rp ' : 'Rp ') + formatRp(Math.abs(monthSaldo))}`;
                saldoEl.className = 'text-base md:text-lg font-semibold flex items-center ' + (monthSaldo >= 0 ? 'text-sky-300' : 'text-orange-300');
            }
            let prevSaldo = prevMonthIn - prevMonthOut;
            const trendEl = document.getElementById('dash-saldo-trend');
            if (trendEl) {
                if (prevSaldo !== 0) {
                    let pct = ((monthSaldo - prevSaldo) / Math.abs(prevSaldo)) * 100;
                    let up = pct >= 0;
                    trendEl.innerHTML = `<i class="fas fa-arrow-${up ? 'up' : 'down'} mr-1"></i>${Math.abs(pct).toFixed(0)}% vs bulan lalu`;
                    trendEl.className = 'text-[10px] font-bold px-2.5 py-1.5 rounded-full flex-shrink-0 mt-1 md:mt-3 ' + (up ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300');
                } else {
                    trendEl.classList.add('hidden');
                }
            }

            const chipTx = document.getElementById('insight-tx-count'); if(chipTx) chipTx.innerText = monthTxCount;
            const chipAvg = document.getElementById('insight-avg-daily'); if(chipAvg) chipAvg.innerText = 'Rp ' + formatShortVal(monthOut / now.getDate());
            const topCatEntry = Object.entries(monthCatOutMap).sort((a,b) => b[1]-a[1])[0];
            const chipTopWrap = document.getElementById('insight-top-cat-wrap');
            if (chipTopWrap) {
                if (topCatEntry) {
                    let style = getCategoryStyle(topCatEntry[0], 'Pengeluaran');
                    chipTopWrap.innerHTML = `${categoryIconHtml(style, 'w-8 h-8 md:w-9 md:h-9 rounded-xl flex items-center justify-center flex-shrink-0', 'text-xs md:text-sm')}
                        <div class="min-w-0"><p class="text-[10px] md:text-[10px] text-slate-400 font-medium leading-tight font-bold">Terbesar</p><p class="text-xs md:text-sm font-bold text-slate-800 truncate">${topCatEntry[0]}</p></div>`;
                } else {
                    chipTopWrap.innerHTML = `<div class="w-8 h-8 md:w-9 md:h-9 rounded-xl flex items-center justify-center bg-slate-100 text-slate-400 flex-shrink-0"><i class="fas fa-inbox text-xs md:text-sm"></i></div>
                        <div class="min-w-0"><p class="text-[10px] md:text-[10px] text-slate-400 font-medium leading-tight font-bold">Terbesar</p><p class="text-xs md:text-sm font-bold text-slate-400">Belum ada</p></div>`;
                }
            }

            if (charts.cashflow7) charts.cashflow7.destroy();
            if (document.getElementById('cashflow7Chart')) {
                let labels7 = last7Order.map(k => last7Map[k].dateObj.toLocaleDateString('id-ID', { weekday: 'short' }));
                charts.cashflow7 = new Chart(document.getElementById('cashflow7Chart').getContext('2d'), servicesModule.chartsUi.buildCashflow7Config({ labels7, last7Order, last7Map, themeAccentColor, formatShortVal, formatRp, chartLabelColor }));
            }

            const leaderboardEl = document.getElementById('top-category-leaderboard');
            if (leaderboardEl) {
                let entries = Object.entries(monthCatOutMap).sort((a,b) => b[1]-a[1]).slice(0, 5);
                if (entries.length === 0) {
                    leaderboardEl.innerHTML = `<div class="text-center text-xs text-slate-400 py-10">Belum ada pengeluaran bulan ini 🎉</div>`;
                } else {
                    let maxVal = entries[0][1];
                    leaderboardEl.innerHTML = entries.map(([cat, val]) => {
                        let style = getCategoryStyle(cat, 'Pengeluaran');
                        let pct = Math.max(6, Math.round((val / maxVal) * 100));
                        let barColorClass = style.bg.replace(/-\d+$/, '-400');
                        return `<div class="flex items-center gap-3">
                            ${categoryIconHtml(style, 'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', 'text-xs')}
                            <div class="flex-1 min-w-0">
                                <div class="flex justify-between items-baseline mb-1 gap-2">
                                    <p class="text-xs font-bold text-slate-700 truncate">${cat}</p>
                                    <p class="text-[11px] font-bold text-slate-500 flex-shrink-0">Rp ${formatShortVal(val)}</p>
                                </div>
                                <div class="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div class="h-full rounded-full ${barColorClass} transition-all duration-700 ease-out" style="width:${pct}%;"></div>
                                </div>
                            </div>
                        </div>`;
                    }).join('');
                }
            }

            let accHtml = ''; let assetEntries = [];
            let modernPalette = ['#22d3ee', '#34d399', '#a78bfa', '#f472b6', '#fbbf24', '#38bdf8', '#4ade80', '#e879f9'];
            
            appSettings.accounts.forEach(acc => {
                let bal = accBalances[acc] || 0; if(bal > 0) assetEntries.push({label: acc, val: bal});
                accHtml += `<div onclick="openAccountDetail('${jsStr(acc)}')" class="bg-white p-3 md:p-5 rounded-xl md:rounded-2xl flex flex-col items-center justify-center border border-slate-100 shadow-sm account-card">
                    <div class="w-10 h-10 md:w-12 md:h-12 rounded-lg md:rounded-xl bg-slate-50 flex items-center justify-center mb-2 md:mb-3 p-2">${getAccountLogo(acc)}</div>
                    <p class="text-[10px] md:text-xs text-slate-400 font-bold mb-0.5 md:mb-1 truncate w-full text-center">${escapeHtml(acc)}</p>
                    <p class="text-[11px] md:text-sm font-extrabold text-slate-800 text-center whitespace-nowrap">Rp ${nominalHidden ? '••••••' : formatRp(bal)}</p>
                </div>`;
            });
            document.getElementById('dashboard-accounts-container').innerHTML = accHtml;

            assetEntries.sort((a,b) => b.val - a.val);
            let assetLabels = assetEntries.length ? assetEntries.map(e => e.label) : ['Kosong']; 
            let assetData = assetEntries.length ? assetEntries.map(e => e.val) : [1];

            if(charts.asset) charts.asset.destroy();
            if(document.getElementById('assetChart')) {
                charts.asset = new Chart(document.getElementById('assetChart').getContext('2d'), servicesModule.chartsUi.buildAssetDonutConfig({ assetLabels, assetData, modernPalette, chartEmptyColor }));
            }
            renderDonutBreakdown({
                legendEl: document.getElementById('assetChart-legend'),
                listEl: document.getElementById('assetChart-list'),
                totalEl: document.getElementById('assetChart-total'),
                entries: assetEntries.map(e => ({ label: e.label, val: e.val, iconHtml: `<div class="w-8 h-8 md:w-9 md:h-9 rounded-full bg-slate-50 flex items-center justify-center flex-shrink-0 text-xs md:text-sm border border-slate-100">${getAccountLogo(e.label)}</div>` })),
                palette: modernPalette,
                onClickItem: (label) => `openAccountDetail('${jsStr(label)}')`,
                emptyMessage: 'Belum ada saldo di akun manapun.'
            });

                // HUD radar: persen saldo terbesar di tengah cincin donat aset.
                const assetRadarEl = document.getElementById('asset-radar-pct');
                if (assetRadarEl) {
                    const assetTot = assetEntries.reduce((a, e) => a + e.val, 0);
                    const assetTop = assetEntries.reduce((m, e) => (e.val > m.val ? e : m), assetEntries[0] || { val: 0, label: '' });
                    if (assetEntries.length && assetTot > 0) {
                        assetRadarEl.querySelector('b').textContent = Math.round((assetTop.val / assetTot) * 100) + '%';
                        assetRadarEl.querySelector('span').textContent = String(assetTop.label).toUpperCase().slice(0, 10);
                        assetRadarEl.style.display = 'flex';
                    } else { assetRadarEl.style.display = 'none'; }
                }

            let monthKeys = Object.keys(monthlyMap);
            monthKeys.sort((a,b) => { let dateA = new Date("1 " + a); let dateB = new Date("1 " + b); return dateA - dateB; });
            let monthLabels = monthKeys.slice(-6); 

            if(charts.monthly) charts.monthly.destroy();
            if(document.getElementById('monthlyChart')) {
                charts.monthly = new Chart(document.getElementById('monthlyChart').getContext('2d'), servicesModule.chartsUi.buildMonthlyConfig({ monthLabels, monthlyMap, themeAccentColor, formatShortVal, chartGridColor, chartLabelColor }));
            }

            renderBalanceTrendChart();

            // Context wawasan sekarang diperkaya (v64) oleh buildInsightsContext():
            // selain agregat bulanan standar, digali juga transaksi terbesar, pola
            // transaksi kecil, belanja akhir pekan & pengeluaran per kategori bulan
            // lalu -- bahan aturan review/saran baru yang lebih komprehensif.
            // Field hasil aggregateDashboardData dipertahankan apa adanya (context
            // lama yang dipakai renderInsights/renderHealthScore tetap kompatibel).
            const insightsCtx = servicesModule.buildInsightsContext(
                { now, monthIn, monthOut, prevMonthIn, prevMonthOut, monthCatOutMap, catOut3MoMap, monthTxCount, monthlyMap },
                {
                    transactions: data,
                    now,
                    parseTgl,
                    txIdrAmount,
                    categorizeExpenseParent: (kategori) => getCategoryStyle(kategori, 'Pengeluaran').parentName,
                }
            );
            renderInsights(insightsCtx);
            renderHealthScore(insightsCtx);
        }

        // ========================== WAWASAN KEUANGAN (Financial Insights) ==========================
        // Cache anggaran BULAN INI saja (bukan cloudBudgets, yang scope-nya ikut bulan yang lagi dibuka
        // di tab Anggaran -- bisa beda dari bulan kalender sekarang). Diisi ulang di loadData() (load
        // penuh) dan setiap kali user menyimpan anggaran utk bulan ini, supaya wawasan anggaran selalu
        // mengacu ke bulan berjalan tanpa perlu fetch ulang di setiap render dashboard.
        let currentMonthBudgetsCache = {};
        function currentMonthStr() { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; }
        function refreshCurrentMonthBudgetsCache(onDone) {
            // Pensyahan api.run (slice budgets): panggil service langsung (src/services/supabase/budgets.js),
            // callback sukses/gagal persis versi adapter lama (termasuk console.error ala buildRunner).
            servicesModule.fetchMonthBudgets(supabaseClient, currentMonthStr())
                .then((budgets) => {
                    currentMonthBudgetsCache = budgets || {};
                    if (typeof onDone === 'function') onDone();
                })
                .catch((err) => {
                    console.error('api.run.getBudgets gagal:', err);
                    /* biarin cache lama kalau gagal fetch -- bukan hal fatal */
                });
        }

        // Menghasilkan array wawasan {icon,bg,color,title,message}, urutan sesuai prioritas
        // (paling penting/actionable duluan). Semua dihitung dari data yang SUDAH ada di memori
        // (globalData via aggregate yang dilempar processDataForUI + currentMonthBudgetsCache) --
        // tidak ada fetch tambahan di sini supaya ringan dipanggil tiap render dashboard.
        // ========================== SKOR KESEHATAN FINANSIAL ==========================
        // 4 komponen berbobot (total 100 kalau semua ada datanya; kalau user belum punya budget
        // bulan ini, komponen "Kepatuhan Anggaran" di-skip & sisanya di-rescale ke /100 -- supaya
        // orang yang belum pasang budget tidak otomatis dapat skor jelek gara2 "melanggar" budget
        // yang bahkan belum dia buat).
        // computeFinancialHealthScore() lama sudah dipindah ke src/domain/insights.js -- lihat
        // pemanggilannya di renderHealthScore().

        function renderHealthScore(ctx) {
            // Bangun DOM/HTML-nya sekarang di src/ui/insights.js (dipakai juga oleh
            // tests/unit/ui-insights.test.js) -- fungsi ini tinggal wrapper tipis yang
            // menyuplai konteks (data & helper) yang dibutuhkan. Nama fungsi & cara
            // memanggilnya di tempat lain TIDAK berubah sama sekali.
            servicesModule.renderHealthScoreUI({
                document,
                dataCtx: ctx,
                currentMonthBudgets: currentMonthBudgetsCache,
                computeFinancialHealthScore: servicesModule.computeFinancialHealthScore,
                accentColor: themeAccentColor,
            });
        }

        // computeFinancialInsights() lama sudah dipindah ke src/domain/insights.js -- lihat
        // pemanggilannya di renderInsights().

        let lastInsightsCtx = null;
        function renderInsights(ctx) {
            // State lastInsightsCtx SENGAJA tetap dikelola di sini (dipakai juga oleh fitur
            // rekomendasi AI / chat di luar modul UI). Bangun DOM/HTML-nya sekarang di
            // src/ui/insights.js (dipakai juga oleh tests/unit/ui-insights.test.js) --
            // fungsi ini tinggal wrapper tipis yang menyuplai konteks (data & helper) yang
            // dibutuhkan, termasuk requestAiInsight (dipanggil modul HANYA di cabang daftar
            // non-kosong, persis seperti kode lama). Nama fungsi & cara memanggilnya di
            // tempat lain TIDAK berubah sama sekali.
            lastInsightsCtx = ctx;
            servicesModule.renderInsightsUI({
                document,
                dataCtx: ctx,
                currentMonthBudgets: currentMonthBudgetsCache,
                computeFinancialInsights: servicesModule.computeFinancialInsights,
                formatRp, formatShortVal,
                requestAiInsight,
            });
        }

        // ========================== REKOMENDASI AI (Gemini, via Supabase Edge Function) ==========================
        // BEDA dari "Wawasan Keuangan" di atas: itu rule-based (instan, gratis, jalan tanpa panggilan
        // ke Google Gemini). Ini benar-benar memanggil Gemini lewat internet, dengan ringkasan keuangan
        // bulan berjalan sebagai konteks. API key Gemini TIDAK PERNAH ada di kode ini -- request
        // lewat Supabase Edge Function 'analyze-finance' yang menyimpannya dengan aman di server
        // (lihat supabase/functions/analyze-finance/index.ts & panduan setup di README.md).
        //
        // CACHE: hasil AI terakhir disimpan di Supabase (appSettings.ai_insight_cache, kolom `settings`
        // -- ikut sinkron ke SEMUA device akun ini, bukan cuma browser yang barusan generate) dan
        // dipakai lagi setiap kali dashboard dibuka/di-reload. Gemini TIDAK PERNAH dipanggil otomatis
        // -- MURNI kalau tombol refresh (ikon reload di kartu ini) diklik manual, supaya kuota/token
        // API tidak boros kepakai tanpa disadari.
        let aiInsightInFlight = false;

        function loadCachedAiInsight() {
            const cached = appSettings.ai_insight_cache;
            if (!cached || !Array.isArray(cached.insights)) return null;
            return cached;
        }
        function saveCachedAiInsight(insights) {
            appSettings.ai_insight_cache = { insights, timestamp: Date.now() };
            persistSettings(); // simpan ke Supabase -- ikut kebawa ke device lain akun yg sama
        }

        function buildFinanceSummaryForAI(ctx) {
            const topCats = Object.entries(ctx.monthCatOutMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ kategori: k, jumlah: v }));
            const budgetStatus = Object.keys(currentMonthBudgetsCache).map(cat => ({
                kategori: cat, anggaran: currentMonthBudgetsCache[cat], terpakai: ctx.monthCatOutMap[cat] || 0
            }));
            const daysInMonth = new Date(ctx.now.getFullYear(), ctx.now.getMonth() + 1, 0).getDate();
            let saldoGabungan = 0;
            globalData.forEach(t => {
                if (t.jenis === 'Pemasukan') saldoGabungan += txIdrAmount(t);
                else if (t.jenis === 'Pengeluaran') saldoGabungan -= txIdrAmount(t);
            });
            return {
                tanggal_hari_ini_ke: ctx.now.getDate(),
                total_hari_dalam_bulan: daysInMonth,
                pemasukan_bulan_ini: ctx.monthIn,
                pengeluaran_bulan_ini: ctx.monthOut,
                pemasukan_bulan_lalu: ctx.prevMonthIn,
                pengeluaran_bulan_lalu: ctx.prevMonthOut,
                jumlah_transaksi_bulan_ini: ctx.monthTxCount,
                top_kategori_pengeluaran_bulan_ini: topCats,
                status_anggaran_bulan_ini: budgetStatus,
                estimasi_saldo_gabungan_semua_akun: saldoGabungan
            };
        }

        function renderAiInsightLoading() {
            const container = document.getElementById('ai-insights-container'); if (!container) return;
            container.innerHTML = `
                <div class="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex items-center gap-3">
                    <div class="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-400 flex items-center justify-center flex-shrink-0 animate-pulse"><i class="fas fa-brain text-sm"></i></div>
                    <p class="text-xs md:text-sm text-slate-400">Gemini sedang menganalisis keuangan kamu...</p>
                </div>`;
        }

        function renderAiInsightSetupNeeded(detail) {
            const container = document.getElementById('ai-insights-container'); if (!container) return;
            // BUG FIX: sebelumnya SEMUA jenis kegagalan (function belum di-deploy, API key salah,
            // Gemini API error, rate limit, dsb) ditampilkan dengan pesan generik yang sama persis
            // ("belum di-deploy") -- padahal "Tanya AI" di bawah sudah lebih dulu menampilkan pesan
            // error ASLI dari server (lihat requestAiChatQuestion()), jadi user bisa tau persis
            // kenapa gagal. Sekarang detail error aslinya (data.error dari server, atau e.message
            // kalau function-nya sendiri tidak terjangkau) ikut ditampilkan di sini juga, supaya
            // kasus "sudah deploy tapi masih dibilang belum aktif" bisa langsung ketahuan sebabnya.
            const detailHtml = detail ? `<p class="text-[10px] md:text-[11px] text-rose-500 mt-1.5 font-mono break-words">Detail: ${escapeHtml(String(detail))}</p>` : '';
            container.innerHTML = `
                <div class="bg-slate-50 rounded-2xl p-4 border border-dashed border-slate-200 flex items-start gap-3">
                    <div class="w-9 h-9 rounded-xl bg-slate-200 text-slate-500 flex items-center justify-center flex-shrink-0"><i class="fas fa-plug-circle-xmark text-sm"></i></div>
                    <div class="min-w-0">
                        <p class="text-xs md:text-sm font-bold text-slate-600">Rekomendasi AI belum aktif</p>
                        <p class="text-[11px] md:text-xs text-slate-500 mt-0.5 leading-relaxed">Fitur ini butuh Edge Function <code class="bg-slate-200 px-1 rounded">analyze-finance</code> di-deploy dan API key Gemini diset di Supabase. Lihat panduan di README.md bagian "Rekomendasi AI".</p>
                        ${detailHtml}
                    </div>
                </div>`;
        }

        function renderAiInsightEmpty() {
            const container = document.getElementById('ai-insights-container'); if (!container) return;
            container.innerHTML = `
                <div class="bg-slate-50 rounded-2xl p-4 border border-dashed border-slate-200 flex items-start gap-3">
                    <div class="w-9 h-9 rounded-xl bg-slate-200 text-slate-500 flex items-center justify-center flex-shrink-0"><i class="fas fa-wand-magic-sparkles text-sm"></i></div>
                    <div class="min-w-0">
                        <p class="text-xs md:text-sm font-bold text-slate-600">Belum ada rekomendasi</p>
                        <p class="text-[11px] md:text-xs text-slate-500 mt-0.5 leading-relaxed">Klik tombol refresh di pojok kanan atas kartu ini buat minta Gemini menganalisis keuangan kamu.</p>
                    </div>
                </div>`;
        }

        function renderAiInsights(insights) {
            const container = document.getElementById('ai-insights-container'); if (!container) return;
            if (!insights || insights.length === 0) {
                container.innerHTML = `<div class="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex items-center gap-3">
                    <div class="w-9 h-9 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center flex-shrink-0"><i class="fas fa-comment-dots text-sm"></i></div>
                    <p class="text-xs md:text-sm text-slate-500">Gemini belum menemukan rekomendasi khusus untuk saat ini.</p>
                </div>`;
                return;
            }
            const severityStyle = { warning: { bg: 'bg-amber-100', color: 'text-amber-600', icon: 'fa-triangle-exclamation' }, success: { bg: 'bg-emerald-100', color: 'text-emerald-600', icon: 'fa-thumbs-up' }, info: { bg: 'bg-indigo-100', color: 'text-indigo-600', icon: 'fa-lightbulb' } };
            container.innerHTML = insights.map(ins => {
                const s = severityStyle[ins.severity] || severityStyle.info;
                return `<div class="bg-white rounded-2xl p-3.5 md:p-4 border border-slate-100 shadow-sm flex items-start gap-3">
                    <div class="w-9 h-9 rounded-xl ${s.bg} ${s.color} flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fas ${s.icon} text-sm"></i></div>
                    <div class="min-w-0">
                        <p class="text-xs md:text-sm font-bold text-slate-800">${escapeHtml(ins.title || 'Rekomendasi')}</p>
                        <p class="text-[11px] md:text-xs text-slate-500 mt-0.5 leading-relaxed">${escapeHtml(ins.message || '')}</p>
                    </div>
                </div>`;
            }).join('');
        }

        async function requestAiInsight(force) {
            if (aiInsightInFlight) return;
            if (!document.getElementById('ai-insights-container')) return;

            if (!force) {
                // TIDAK PERNAH manggil Gemini di sini -- cuma tampilkan cache Supabase kalau ada,
                // atau state kosong yang minta user klik refresh manual. Ini yang bikin buka/reload
                // dashboard (dari device manapun, karena cache-nya di Supabase) tidak boros token.
                const cached = loadCachedAiInsight();
                if (cached) {
                    renderAiInsights(cached.insights);
                    const tsEl = document.getElementById('ai-insight-timestamp');
                    if (tsEl) tsEl.innerText = 'Diperbarui ' + new Date(cached.timestamp).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                } else {
                    renderAiInsightEmpty();
                }
                return;
            }

            if (!lastInsightsCtx) return;
            aiInsightInFlight = true;
            renderAiInsightLoading();
            const btn = document.getElementById('ai-insight-refresh-btn');
            if (btn) btn.querySelector('i').classList.add('fa-spin');

            try {
                const summary = buildFinanceSummaryForAI(lastInsightsCtx);
                const { data, error } = await supabaseClient.functions.invoke('analyze-finance', { body: summary });
                if (error) throw error;
                if (data && data.error) {
                    renderAiInsightSetupNeeded(data.error);
                } else {
                    const insights = (data && data.insights) || [];
                    saveCachedAiInsight(insights);
                    const tsEl = document.getElementById('ai-insight-timestamp');
                    if (tsEl) tsEl.innerText = 'Diperbarui ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                    renderAiInsights(insights);
                }
            } catch (e) {
                // Edge Function yang belum di-deploy biasanya balas 404, tapi bisa juga gagal
                // karena sebab lain (401/403/500/timeout dsb) -- pesan e.message ikut ditampilkan
                // (lihat renderAiInsightSetupNeeded()) supaya keduanya bisa dibedakan.
                renderAiInsightSetupNeeded(e && e.message ? e.message : null);
            } finally {
                aiInsightInFlight = false;
                if (btn) btn.querySelector('i').classList.remove('fa-spin');
            }
        }

        // ========================== RINGKASAN BULANAN (AI, tab Laporan) ==========================
        // Beda dari "Rekomendasi AI" (kartu insight bulan BERJALAN di dashboard): ini 1 paragraf
        // naratif fokus ke bulan LALU yang sudah selesai (lebih pas buat "laporan retrospektif").
        // Datanya PAKAI ULANG buildFinanceSummaryForAI() yang sama (sudah ada pemasukan_bulan_lalu/
        // pengeluaran_bulan_lalu di situ) -- tidak perlu hitung ulang apa pun di client.
        // CACHE: disimpan di Supabase (appSettings.monthly_summary_cache), sama seperti Rekomendasi
        // AI di atas -- ikut sinkron ke semua device akun ini, dan Gemini TIDAK PERNAH dipanggil
        // otomatis, cuma kalau tombol refresh diklik manual. Konsekuensinya: kalau sudah lewat
        // bulan tapi belum diklik refresh, ringkasannya akan tetap menunjukkan bulan yang lama
        // sampai di-refresh manual -- ini SENGAJA (prioritas hemat kuota API di atas kesegaran data).
        let monthlySummaryInFlight = false;

        function renderMonthlySummaryLoading() {
            const c = document.getElementById('monthly-summary-container'); if (!c) return;
            c.innerHTML = `<p class="text-xs md:text-sm text-slate-400 flex items-center gap-2"><i class="fas fa-spinner fa-spin"></i>Gemini sedang menyusun ringkasan...</p>`;
        }
        function renderMonthlySummarySetupNeeded(detail) {
            const c = document.getElementById('monthly-summary-container'); if (!c) return;
            // BUG FIX: sama seperti renderAiInsightSetupNeeded() -- detail error asli dari server
            // sekarang ikut ditampilkan, bukan cuma teks generik "belum di-deploy" untuk semua kasus.
            const detailHtml = detail ? `<p class="text-[10px] md:text-[11px] text-rose-500 mt-1.5 font-mono break-words">Detail: ${escapeHtml(String(detail))}</p>` : '';
            c.innerHTML = `<p class="text-xs md:text-sm text-slate-500">Fitur ini butuh Edge Function <code class="bg-slate-100 px-1 rounded">analyze-finance</code> ter-deploy & API key Gemini diset. Lihat README.md bagian "Rekomendasi AI".</p>${detailHtml}`;
        }
        function renderMonthlySummaryError() {
            const c = document.getElementById('monthly-summary-container'); if (!c) return;
            c.innerHTML = `<p class="text-xs md:text-sm text-slate-500">Gagal memuat ringkasan. Coba klik tombol refresh di atas.</p>`;
        }
        function renderMonthlySummaryEmpty() {
            const c = document.getElementById('monthly-summary-container'); if (!c) return;
            c.innerHTML = `<p class="text-xs md:text-sm text-slate-500">Klik tombol refresh di pojok kanan atas kartu ini buat minta Gemini membuat ringkasan bulan lalu.</p>`;
        }
        function renderMonthlySummaryText(text, timestamp) {
            const c = document.getElementById('monthly-summary-container'); if (!c) return;
            const tsHtml = timestamp ? `<p class="text-[10px] text-slate-400 mt-2">Diperbarui ${escapeHtml(new Date(timestamp).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</p>` : '';
            c.innerHTML = `<p class="text-xs md:text-sm text-slate-700 leading-relaxed">${escapeHtml(text)}</p>${tsHtml}`;
        }

        async function requestMonthlySummary(force) {
            if (monthlySummaryInFlight) return;
            const container = document.getElementById('monthly-summary-container'); if (!container) return;

            if (!force) {
                const cached = appSettings.monthly_summary_cache;
                if (cached && cached.summary) renderMonthlySummaryText(cached.summary, cached.timestamp);
                else renderMonthlySummaryEmpty();
                return;
            }

            if (!lastInsightsCtx) return;
            monthlySummaryInFlight = true;
            renderMonthlySummaryLoading();
            const btn = document.getElementById('monthly-summary-refresh-btn');
            if (btn) btn.querySelector('i').classList.add('fa-spin');

            try {
                const summary = Object.assign({}, buildFinanceSummaryForAI(lastInsightsCtx), { mode: 'monthly_summary' });
                const { data, error } = await supabaseClient.functions.invoke('analyze-finance', { body: summary });
                if (error) throw error;
                if (data && data.error) {
                    renderMonthlySummarySetupNeeded(data.error);
                } else if (data && data.summary) {
                    const timestamp = Date.now();
                    appSettings.monthly_summary_cache = { summary: data.summary, timestamp };
                    persistSettings(); // simpan ke Supabase -- ikut kebawa ke device lain akun yg sama
                    renderMonthlySummaryText(data.summary, timestamp);
                } else {
                    renderMonthlySummaryError();
                }
            } catch (e) {
                renderMonthlySummarySetupNeeded(e && e.message ? e.message : null);
            } finally {
                monthlySummaryInFlight = false;
                if (btn) btn.querySelector('i').classList.remove('fa-spin');
            }
        }

        // Menghitung saldo gabungan SEMUA akun di AKHIR tiap bulan, N bulan terakhir (termasuk bulan
        // yang tidak ada transaksinya sama sekali -- beda dari monthlyMap di atas yang cuma mencatat
        // bulan-bulan yang benar-benar ada transaksinya). Transfer TIDAK mempengaruhi total gabungan
        // (uang cuma pindah antar akun sendiri, jumlah keseluruhannya tetap), jadi cukup Pemasukan
        // dikurangi Pengeluaran secara kumulatif dari transaksi paling awal sampai akhir tiap bulan.
        function computeBalanceTrend(monthsCount) {
            monthsCount = monthsCount || 6;
            const now = new Date();
            const months = [];
            for (let i = monthsCount - 1; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                months.push({ year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }), net: 0 });
            }
            const earliestCutoff = new Date(months[0].year, months[0].month, 1);
            let balanceBeforePeriod = 0;

            globalData.forEach(t => {
                const d = parseTgl(t.tanggal);
                const amt = txIdrAmount(t);
                const delta = t.jenis === 'Pemasukan' ? amt : (t.jenis === 'Pengeluaran' ? -amt : 0);
                if (delta === 0) return;
                if (d < earliestCutoff) { balanceBeforePeriod += delta; return; }
                const bucket = months.find(m => d.getFullYear() === m.year && d.getMonth() === m.month);
                if (bucket) bucket.net += delta;
            });

            let running = balanceBeforePeriod;
            return months.map(m => { running += m.net; return { label: m.label, balance: running }; });
        }

        function renderBalanceTrendChart() {
            const trend = computeBalanceTrend(6);
            const changeEl = document.getElementById('balance-trend-change');
            if (changeEl) {
                const first = trend[0].balance, last = trend[trend.length - 1].balance;
                if (first !== 0) {
                    const pct = ((last - first) / Math.abs(first)) * 100;
                    const up = pct >= 0;
                    changeEl.classList.remove('hidden');
                    changeEl.innerHTML = `<i class="fas fa-arrow-${up ? 'up' : 'down'} mr-1"></i>${Math.abs(pct).toFixed(0)}% / 6 bulan`;
                    changeEl.className = 'text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ' + (up ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600');
                } else {
                    changeEl.classList.add('hidden');
                }
            }

            if (charts.balanceTrend) charts.balanceTrend.destroy();
            if (document.getElementById('balanceTrendChart')) {
                const isPositiveTrend = trend[trend.length - 1].balance >= trend[0].balance;
                const lineColor = isPositiveTrend ? '#22d3ee' : '#f43f5e';
                const trendLabels = trend.map(t => t.label);
                charts.balanceTrend = new Chart(document.getElementById('balanceTrendChart').getContext('2d'), servicesModule.chartsUi.buildBalanceTrendConfig({ trendLabels, trend, lineColor, formatRp, formatShortVal, chartGridColor }));
            }
        }

        // Urutan tampil transaksi = urutan server list(): tanggal DESC, lalu
        // created_at DESC (jam input pencatatan; baris lama/stub tanpa created_at
        // dianggap PALING LAMA di dalam tanggalnya), lalu id ASC sekadar
        // tie-break deterministik. Sebelumnya sortir cuma per tanggal -> urutan
        // transaksi se-hari mengikuti id (UUID acak) = acak, bukan kapan dicatat.
        function txCreatedAtMs(row) {
            if (row && row.created_at != null) {
                const t = Date.parse(row.created_at);
                if (!Number.isNaN(t)) return t;
            }
            return -Infinity;
        }
        function txServerCompare(a, b) {
            const diffDate = parseTgl(b.tanggal) - parseTgl(a.tanggal);
            if (diffDate !== 0) return diffDate;
            const diffCt = txCreatedAtMs(b) - txCreatedAtMs(a);
            if (diffCt !== 0) return diffCt;
            const ia = String(a.id || '');
            const ib = String(b.id || '');
            return ia < ib ? -1 : ia > ib ? 1 : 0;
        }

        function renderRecentList(data) {
            const container = document.getElementById('recent-transactions-list');
            let sortedData = [...data].sort(txServerCompare);
            let recent = sortedData.slice(0, 5);
            if(recent.length === 0) { container.innerHTML = ''; return; }
            // HUD: bar nominal proporsional terhadap transaksi terbesar di antara 5 teratas.
            const hudMaxAmt = Math.max(...recent.map(r => Math.abs(Number(r.jumlah) || 0)), 1);
            container.innerHTML = recent.map((row, idx) => {
                let color = row.jenis === 'Pemasukan' ? 'text-emerald-500' : (row.jenis === 'Pengeluaran' ? 'text-rose-500' : 'text-blue-500');
                let prefix = row.jenis === 'Pengeluaran' ? '-' : (row.jenis === 'Pemasukan' ? '+' : '');
                let style = getCategoryStyle(row.kategori, row.jenis);
                const hudBarPct = Math.max(4, Math.round(Math.abs(Number(row.jumlah) || 0) / hudMaxAmt * 100));

                return `
                    <div class="stagger-item bg-white p-3 md:p-4 rounded-xl border border-slate-100 flex items-center shadow-sm hover:shadow-md transition cursor-pointer" style="animation-delay: ${idx * 50}ms" onclick="switchView('transaksi')">
                        ${categoryIconHtml(style, 'w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center mr-3 md:mr-4 flex-shrink-0 border border-slate-50 shadow-sm', 'text-sm md:text-base')}
                        <div class="flex-1 min-w-0">
                            <p class="text-xs md:text-sm font-bold text-slate-800 truncate"><span class="hud-mono hud-tx-id" aria-hidden="true">TX-${String(idx + 1).padStart(2, '0')}</span> ${row.jenis === 'Transfer' ? 'Transfer ke ' + escapeHtml(row.kategori) : escapeHtml(row.kategori)}</p>
                            <p class="text-[10px] md:text-xs text-slate-400 truncate flex items-center mt-0.5"><span class="w-3 h-3 mr-1 flex items-center">${getAccountLogo(row.akun)}</span> ${escapeHtml(row.akun)} ${row.keterangan? '• ' + escapeHtml(row.keterangan) : ''}</p>
                            <div class="hud-bar mt-1.5" style="max-width:150px" aria-hidden="true"><div class="hud-bar-fill" style="width:${hudBarPct}%"></div></div>
                        </div>
                        <div class="text-right pl-2">
                            <p class="text-xs md:text-sm font-bold hud-mono ${color} whitespace-nowrap">Rp ${prefix}${formatRp(row.jumlah)}</p>
                            <p class="text-[10px] md:text-[10px] text-slate-400 mt-1">${parseTgl(row.tanggal).toLocaleDateString('id-ID', { day:'2-digit', month:'short' })}</p>
                        </div>
                    </div>`;
            }).join('');
        }

        // ========================== HUD: SPARKLINE & STATUS ==========================
        // Gelombang neon tren 14 hari di kartu hero (domain murni: src/domain/sparkline.js).
        function renderHudSparklines() {
            try {
                const s = window.__myfinanceServices;
                if (!s || typeof s.sparklineSvg !== 'function' || typeof s.buildDailyFlow !== 'function') return;
                const flow = s.buildDailyFlow(globalData || [], { days: 14 });
                const mounts = [
                    ['spark-in', flow.map(d => d.in), '#34d399'],
                    ['spark-out', flow.map(d => d.out), '#fb7185'],
                    ['spark-net', flow.map(d => d.net), '#22d3ee'],
                ];
                mounts.forEach(([id, vals, stroke]) => {
                    const el = document.getElementById(id);
                    if (el) el.innerHTML = s.sparklineSvg(vals, { stroke, id });
                });
            } catch (e) { console.error('Sparkline HUD gagal dirender:', e); }
        }

        // Indikator LED HUD (LIVE / SYNCING / OFFLINE) di header, sidebar & topbar mobile.
        function setHudStatus(state) {
            const text = state === 'sync' ? 'SYNCING' : (state === 'error' ? 'OFFLINE' : 'LIVE');
            document.querySelectorAll('.hud-status').forEach((el) => {
                el.dataset.state = state;
                const t = el.querySelector('.hud-status-text');
                if (t) t.textContent = text;
            });
        }

        // ========================== TAB BUDGET ==========================
        function changeBudgetMonth() {
            showLoading(true);
            const targetBulan = document.getElementById('budgetFilterMonth').value;
            // Pensyahan api.run (slice budgets): panggil service langsung, callback persis versi adapter lama.
            servicesModule.fetchMonthBudgets(supabaseClient, targetBulan)
                .then((cloudBudgetsData) => {
                    cloudBudgets = cloudBudgetsData || {};
                    renderBudgetView();
                    showLoading(false);
                })
                .catch((err) => {
                    console.error('api.run.getBudgets gagal:', err);
                    showErrorToast('Gagal memuat budget bulan ini. Coba lagi.');
                    showLoading(false);
                });
        }

        function openBudgetModal() {
            document.getElementById('modalBudget').classList.remove('hidden');
            setTimeout(() => { document.getElementById('modalBudgetContent').classList.remove('translate-y-full', 'md:scale-95', 'opacity-0'); }, 10);
            renderBudgetModalList();
        }
        
        function closeBudgetModal() {
            document.getElementById('modalBudgetContent').classList.add('translate-y-full', 'md:scale-95', 'opacity-0');
            setTimeout(() => { document.getElementById('modalBudget').classList.add('hidden'); }, 300);
        }

        function formatBudgetInputDisplay(input) {
            let value = input.value.replace(/[^0-9]/g, '');
            input.value = value ? new Intl.NumberFormat('id-ID').format(value) : '';
        }

        function calcBudgetParent(parentSlug) {
            const subInputs = document.querySelectorAll(`input[data-parentslug="${parentSlug}"]`);
            let sum = 0;
            subInputs.forEach(inp => { sum += parseInt(inp.value.replace(/[^0-9]/g, '')) || 0; });
            
            const parentInput = document.getElementById(`budget-parent-${parentSlug}`);
            if(parentInput) {
                parentInput.value = sum > 0 ? new Intl.NumberFormat('id-ID').format(sum) : '';
            }
        }

        function renderBudgetModalList() {
            // Bangun DOM/HTML-nya sekarang di src/ui/budgets.js (dipakai juga oleh
            // tests/unit/ui-budgets.test.js) -- fungsi ini tinggal wrapper tipis yang
            // menyuplai konteks (data & helper) yang dibutuhkan. Atribut oninput di input
            // (formatBudgetInputDisplay / calcBudgetParent) tetap menunjuk fungsi global
            // di sini. Nama fungsi & cara memanggilnya TIDAK berubah sama sekali.
            servicesModule.renderBudgetModalListUI({
                document, categoryDict, cloudBudgets, slugify,
                getCategoryStyle, categoryIconHtml, escapeHtml,
            });
        }

        function saveBudgets() {
            showLoading(true);
            const targetBulan = document.getElementById('budgetFilterMonth').value;
            cloudBudgets = {}; 
            
            const subInputs = document.querySelectorAll('.budget-input');
            subInputs.forEach(inp => {
                const catName = inp.getAttribute('data-category');
                const val = parseInt(inp.value.replace(/[^0-9]/g, '')) || 0;
                if(val > 0) cloudBudgets[catName] = val;
            });

            const parentInputs = document.querySelectorAll('.budget-parent-input:not([readonly])');
            parentInputs.forEach(inp => {
                const catName = inp.getAttribute('data-parent');
                const val = parseInt(inp.value.replace(/[^0-9]/g, '')) || 0;
                if(val > 0) cloudBudgets[catName] = val;
            });

            // Pensyahan api.run (slice budgets): saveBudgetsCloudRemote di adapter cuma membungkus
            // replaceMonthBudgets() + return {status:'success'} yg tidak pernah dipakai handler --
            // panggil RPC-nya langsung (catatan: adapter memakai guard `|| {}`, dipertahankan).
            servicesModule.replaceMonthBudgets(supabaseClient, targetBulan, cloudBudgets || {})
                .then((response) => {
                    closeBudgetModal();
                    renderBudgetView();
                    showLoading(false);
                    showSuccessToast('Budget berhasil disimpan.');
                    // Kalau yang disimpan adalah anggaran BULAN KALENDER SEKARANG, sinkronkan juga ke cache
                    // wawasan keuangan supaya "Peringatan Anggaran" langsung mencerminkan angka terbaru.
                    if (targetBulan === currentMonthStr()) {
                        currentMonthBudgetsCache = Object.assign({}, cloudBudgets);
                        if (lastInsightsCtx) renderInsights(lastInsightsCtx);
                    }
                })
                .catch((err) => {
                    console.error('api.run.saveBudgetsCloud gagal:', err);
                    showErrorToast('Gagal menyimpan budget ke cloud. Perubahan belum tersimpan, coba lagi.');
                    showLoading(false);
                });
        }

        // ========================== SALIN BUDGET/REALISASI BULAN LALU ==========================
        // Prefill input modal "Atur Budget" dari bulan sebelumnya -- TIDAK langsung simpan;
        // user bisa mengoreksi dulu lalu tekan "Simpan Budget Ke Cloud". Dua mode:
        //  - 'budget'    : salin nominal SETTING budget bulan lalu apa adanya (fetch cloud).
        //  - 'realisasi' : jadikan PENGELUARAN RIIL bulan lalu sebagai nominal budget
        //                  (dihitung lokal dari transaksi yg sudah di memori).
        function copyPrevMonthBudget(mode) {
            const targetBulan = document.getElementById('budgetFilterMonth').value || currentMonthStr();
            const prevBulan = servicesModule.shiftMonthStr(targetBulan, -1);
            if (!prevBulan) { showErrorToast('Bulan target tidak valid.'); return; }
            const label = mode === 'realisasi' ? 'realisasi' : 'budget';
            const applyMap = (map) => {
                const usable = Object.entries(map || {}).filter(([, v]) => Number(v) > 0);
                if (!usable.length) { showErrorToast('Belum ada ' + label + ' untuk bulan ' + prevBulan + '.'); return; }
                const doPrefill = () => {
                    let n = 0;
                    document.querySelectorAll('.budget-input').forEach(inp => {
                        const v = Number(map[inp.getAttribute('data-category')]) || 0;
                        inp.value = v > 0 ? new Intl.NumberFormat('id-ID').format(v) : '';
                        if (v > 0) n++;
                    });
                    document.querySelectorAll('.budget-parent-input:not([readonly])').forEach(inp => {
                        const v = Number(map[inp.getAttribute('data-parent')]) || 0;
                        inp.value = v > 0 ? new Intl.NumberFormat('id-ID').format(v) : '';
                        if (v > 0) n++;
                    });
                    // Parent yg punya sub = readonly akumulator -> hitung ulang dari sub yg baru diisi.
                    document.querySelectorAll('.budget-parent-input[readonly]').forEach(inp => {
                        calcBudgetParent(slugify(inp.getAttribute('data-parent')));
                    });
                    showSuccessToast((mode === 'realisasi' ? 'Realisasi' : 'Budget') + ' ' + prevBulan + ' disalin ke ' + n + ' kategori. Periksa dulu, lalu tekan Simpan.');
                };
                // Kalau form sedang ada isinya, minta konfirmasi dulu (prefill = menimpa).
                const anyFilled = Array.from(document.querySelectorAll('.budget-input, .budget-parent-input:not([readonly])')).some(i => String(i.value || '').trim() !== '');
                if (anyFilled) showConfirm('Input budget di form ini akan DITIMPA dengan ' + label + ' bulan ' + prevBulan + '. Lanjutkan?', doPrefill);
                else doPrefill();
            };
            if (mode === 'realisasi') {
                const parts = prevBulan.split('-');
                applyMap(servicesModule.aggregateActualByCategory(globalData, { year: Number(parts[0]), month: Number(parts[1]), txIdrAmount, parseTgl }));
            } else {
                servicesModule.fetchMonthBudgets(supabaseClient, prevBulan)
                    .then((map) => applyMap(map))
                    .catch((err) => { console.error('copyPrevMonthBudget fetch gagal:', err); showErrorToast('Gagal mengambil budget bulan lalu. Periksa koneksi internet kamu.'); });
            }
        }

        // Konstanta presentasi BUDGET_USAGE_RING_COLOR/BAR_COLOR/BADGE pindah ke
        // src/ui/budgets.js (hanya dipakai renderBudgetView di sana). classifyBudgetUsage()
        // (src/domain/budgets.js) cuma mengembalikan level abstrak ('over'/'warning'/'safe')
        // -- pemetaan ke warna/teks tampilan memang milik presentation layer (src/ui/).
        function renderBudgetView() {
            // Bangun DOM/HTML-nya sekarang di src/ui/budgets.js (dipakai juga oleh
            // tests/unit/ui-budgets.test.js) -- fungsi ini tinggal wrapper tipis yang
            // menyuplai konteks (data & helper) yang dibutuhkan. Chart & charts di-inject
            // per pemanggilan (holder bisa di-reassign utuhnya, pola yang sama dgn aset).
            // Nama fungsi & cara memanggilnya di tempat lain TIDAK berubah sama sekali.
            servicesModule.renderBudgetViewUI({
                document, globalData, txIdrAmount, parseTgl, categoryDict, cloudBudgets,
                getCategoryStyle, animateRupiah, escapeHtml, formatRp, formatShortVal,
                categoryIconHtml, chartLabelColor, chartGridColor,
                accentColor: themeAccentColor,
                Chart, charts,
                aggregateActualByCategory: servicesModule.aggregateActualByCategory,
                summarizeBudgets: servicesModule.summarizeBudgets,
                classifyBudgetUsage: servicesModule.classifyBudgetUsage,
            });
        }

        // ========================== TAB ASET PORTOFOLIO ==========================
        function renderAssetView() {
            // Bangun DOM/HTML-nya sekarang di src/ui/assets.js (dipakai juga oleh
            // tests/unit/ui-assets.test.js) -- fungsi ini tinggal wrapper tipis yang
            // menyuplai konteks (data & helper) yang dibutuhkan. Chart & charts
            // SENGAJA di-inject per pemanggilan (bukan ditangkap sekali) karena holder
            // `charts` bisa di-reassign utuhnya (mis. saat ganti tema). Nama fungsi &
            // cara memanggilnya di tempat lain TIDAK berubah sama sekali.
            servicesModule.renderAssetViewUI({
                document, globalAssets, appSettings,
                summarizeAssets: servicesModule.summarizeAssets,
                computeNetWorth: servicesModule.computeNetWorth,
                animateRupiah, escapeHtml, formatRp, jsStr,
                getAccountLogo, detectAssetCategoryIcon, renderDonutBreakdown,
                chartEmptyColor, chartBorderColor,
                Chart, charts,
            });
            // Pemanggilan renderGoalsList()/renderDebtsList() di akhir SENGAJA tetap di
            // wrapper (fungsi global di sini, urutannya persis kode lama: setelah chart
            // & legenda donut selesai dirender).
            renderGoalsList();
            renderDebtsList();
        }

        // ========================== TUJUAN KEUANGAN (Financial Goals) ==========================
        // Disimpan di appSettings.financial_goals (array biasa, ikut kesinkron lewat persistSettings()
        // yang sudah ada) -- SENGAJA tidak bikin tabel Supabase baru, sama seperti pola categoryStyles/
        // accountIcons sebelumnya, supaya tidak perlu migrasi SQL tambahan.
        // (Konstanta palet goalIconPalette/goalColorPalette pindah ke src/ui/goals-debts.js --
        // hanya dipakai fungsi palet di sana.)
        let goalFormState = { icon: 'fa-piggy-bank', bg: 'bg-indigo-100', color: 'text-indigo-500' };
        let currentGoalEditId = null;
        let currentGoalContributeId = null;

        function renderGoalIconColorPalette() {
            // Bangun DOM/HTML-nya sekarang di src/ui/goals-debts.js (dipakai juga oleh
            // tests/unit/ui-goals-debts.test.js) -- fungsi ini tinggal wrapper tipis yang
            // menyuplai konteks yang dibutuhkan. goalFormState tetap dimiliki & di-mutasi di
            // sini (oleh pickGoalIcon/pickGoalColor), modul hanya membacanya. Nama fungsi &
            // cara memanggilnya di tempat lain TIDAK berubah sama sekali.
            servicesModule.renderGoalIconColorPaletteUI({ document, formState: goalFormState });
        }
        function pickGoalIcon(icon) { goalFormState.icon = icon; renderGoalIconColorPalette(); }
        function pickGoalColor(bg, color) { goalFormState.bg = bg; goalFormState.color = color; renderGoalIconColorPalette(); }

        function renderGoalsList() {
            // Bangun DOM/HTML-nya sekarang di src/ui/goals-debts.js (dipakai juga oleh
            // tests/unit/ui-goals-debts.test.js) -- fungsi ini tinggal wrapper tipis yang
            // menyuplai konteks (data & helper) yang dibutuhkan. Nama fungsi & cara
            // memanggilnya di tempat lain (termasuk onclick="..." di kartu tujuan)
            // TIDAK berubah sama sekali.
            servicesModule.renderGoalsListUI({
                document, appSettings,
                computeGoalProgress: servicesModule.computeGoalProgress,
                escapeHtml,
            });
        }

        function openGoalModal(isEdit = false, id = null) {
            const modal = document.getElementById('modalGoal'); const content = document.getElementById('modalGoalContent');
            modal.classList.remove('hidden'); setTimeout(() => { content.classList.remove('translate-x-full'); }, 10);
            document.getElementById('formGoal').reset();
            document.getElementById('goal_target').value = ''; document.getElementById('goal_target_display').value = '';
            document.getElementById('goal_terkumpul').value = ''; document.getElementById('goal_terkumpul_display').value = '';

            if (!isEdit) {
                currentGoalEditId = null;
                document.getElementById('modalGoalTitle').innerText = 'Tujuan Baru';
                document.getElementById('btnSubmitGoalForm').innerText = 'Simpan Tujuan';
                goalFormState = { icon: 'fa-piggy-bank', bg: 'bg-indigo-100', color: 'text-indigo-500' };
            } else {
                const g = (appSettings.financial_goals || []).find(x => x.id === id); if (!g) return;
                currentGoalEditId = id;
                document.getElementById('modalGoalTitle').innerText = 'Ubah Tujuan';
                document.getElementById('btnSubmitGoalForm').innerText = 'Simpan Perubahan';
                document.getElementById('goal_nama').value = g.nama;
                document.getElementById('goal_target').value = g.target;
                document.getElementById('goal_target_display').value = new Intl.NumberFormat('id-ID').format(g.target);
                document.getElementById('goal_terkumpul').value = g.terkumpul;
                document.getElementById('goal_terkumpul_display').value = new Intl.NumberFormat('id-ID').format(g.terkumpul);
                document.getElementById('goal_deadline').value = g.deadline || '';
                goalFormState = { icon: g.icon, bg: g.bg, color: g.color };
            }
            renderGoalIconColorPalette();
        }
        function closeGoalModal() {
            const content = document.getElementById('modalGoalContent'); content.classList.add('translate-x-full');
            setTimeout(() => { document.getElementById('modalGoal').classList.add('hidden'); }, 300);
        }
        function submitGoalForm(e) {
            e.preventDefault();
            const nama = document.getElementById('goal_nama').value.trim();
            const target = Number(document.getElementById('goal_target').value) || 0;
            const terkumpul = Number(document.getElementById('goal_terkumpul').value) || 0;
            const deadline = document.getElementById('goal_deadline').value || null;
            if (!nama || target <= 0) { showErrorToast('Nama dan target dana wajib diisi.'); return; }

            if (!appSettings.financial_goals) appSettings.financial_goals = [];
            if (currentGoalEditId) {
                const g = appSettings.financial_goals.find(x => x.id === currentGoalEditId);
                if (g) Object.assign(g, { nama, target, terkumpul, deadline, icon: goalFormState.icon, bg: goalFormState.bg, color: goalFormState.color });
            } else {
                appSettings.financial_goals.push({ id: 'goal_' + Date.now(), nama, target, terkumpul, deadline, icon: goalFormState.icon, bg: goalFormState.bg, color: goalFormState.color });
            }
            persistSettings();
            renderGoalsList();
            closeGoalModal();
            showSuccessToast('Tujuan keuangan berhasil disimpan.');
        }
        function removeGoal(id) {
            showConfirm('Hapus tujuan keuangan ini? Progres yang sudah tercatat akan ikut hilang.', () => {
                appSettings.financial_goals = (appSettings.financial_goals || []).filter(x => x.id !== id);
                persistSettings();
                renderGoalsList();
                showSuccessToast('Tujuan keuangan dihapus.');
            });
        }

        function openGoalContributeModal(id) {
            const g = (appSettings.financial_goals || []).find(x => x.id === id); if (!g) return;
            currentGoalContributeId = id;
            document.getElementById('goal-contribute-name').innerText = g.nama;
            document.getElementById('formGoalContribute').reset();
            document.getElementById('goal_contribute_amount').value = ''; document.getElementById('goal_contribute_display').value = '';
            const modal = document.getElementById('modalGoalContribute'); const content = document.getElementById('modalGoalContributeContent');
            modal.classList.remove('hidden');
            setTimeout(() => { content.classList.remove('translate-y-full', 'opacity-0'); content.classList.remove('md:scale-95'); }, 10);
        }
        function closeGoalContributeModal() {
            const content = document.getElementById('modalGoalContributeContent');
            content.classList.add('translate-y-full', 'md:scale-95', 'opacity-0');
            setTimeout(() => { document.getElementById('modalGoalContribute').classList.add('hidden'); }, 300);
        }
        function submitGoalContribute(e) {
            e.preventDefault();
            const amount = Number(document.getElementById('goal_contribute_amount').value) || 0;
            if (amount <= 0) { showErrorToast('Isi jumlah setoran dulu.'); return; }
            const g = (appSettings.financial_goals || []).find(x => x.id === currentGoalContributeId); if (!g) return;
            g.terkumpul = (Number(g.terkumpul) || 0) + amount;
            persistSettings();
            renderGoalsList();
            closeGoalContributeModal();
            showSuccessToast(`Setoran Rp ${new Intl.NumberFormat('id-ID').format(amount)} berhasil dicatat.`);
        }

        // ========================== UTANG & CICILAN (Debt Tracker) ==========================
        // Pasangan dari Tujuan Keuangan di atas -- pola PERSIS sama (array di appSettings.debts,
        // sinkron lewat persistSettings() yang sudah ada, tanpa tabel/migrasi Supabase baru), cuma
        // progresnya kebalikan: Tujuan Keuangan menuju ATAS (terkumpul naik ke target), Utang
        // menuju BAWAH (sisa turun ke nol).
        // (Konstanta palet debtIconPalette/debtColorPalette pindah ke src/ui/goals-debts.js --
        // hanya dipakai fungsi palet di sana.)
        let debtFormState = { icon: 'fa-credit-card', bg: 'bg-rose-100', color: 'text-rose-500' };
        let currentDebtEditId = null;
        let currentDebtPayId = null;

        function renderDebtIconColorPalette() {
            // Bangun DOM/HTML-nya sekarang di src/ui/goals-debts.js (dipakai juga oleh
            // tests/unit/ui-goals-debts.test.js) -- fungsi ini tinggal wrapper tipis yang
            // menyuplai konteks yang dibutuhkan. debtFormState tetap dimiliki & di-mutasi di
            // sini (oleh pickDebtIcon/pickDebtColor), modul hanya membacanya. Nama fungsi &
            // cara memanggilnya di tempat lain TIDAK berubah sama sekali.
            servicesModule.renderDebtIconColorPaletteUI({ document, formState: debtFormState });
        }
        function pickDebtIcon(icon) { debtFormState.icon = icon; renderDebtIconColorPalette(); }
        function pickDebtColor(bg, color) { debtFormState.bg = bg; debtFormState.color = color; renderDebtIconColorPalette(); }

        // Kalau lagi bikin utang BARU (bukan edit), begitu "Total Utang" diisi, "Sisa Utang" ikut
        // ke-auto-isi sama (asumsi wajar: pas pertama dicatat, belum ada yang dibayar sama sekali).
        // User tetap bebas mengubahnya manual kalau ternyata sudah sempat bayar sebagian sebelumnya.
        function syncDebtRemainingDefault() {
            if (currentDebtEditId) return;
            const sisaDisplay = document.getElementById('debt_sisa_display');
            if (sisaDisplay.value) return;
            document.getElementById('debt_sisa_display').value = document.getElementById('debt_total_display').value;
            document.getElementById('debt_sisa').value = document.getElementById('debt_total').value;
        }

        function renderDebtsList() {
            // Bangun DOM/HTML-nya sekarang di src/ui/goals-debts.js (dipakai juga oleh
            // tests/unit/ui-goals-debts.test.js) -- fungsi ini tinggal wrapper tipis yang
            // menyuplai konteks (data & helper) yang dibutuhkan. Nama fungsi & cara
            // memanggilnya di tempat lain (termasuk onclick="..." di kartu utang)
            // TIDAK berubah sama sekali.
            servicesModule.renderDebtsListUI({
                document, appSettings,
                computeDebtProgress: servicesModule.computeDebtProgress,
                escapeHtml,
            });
        }

        function openDebtModal(isEdit = false, id = null) {
            const modal = document.getElementById('modalDebt'); const content = document.getElementById('modalDebtContent');
            modal.classList.remove('hidden'); setTimeout(() => { content.classList.remove('translate-x-full'); }, 10);
            document.getElementById('formDebt').reset();
            document.getElementById('debt_total').value = ''; document.getElementById('debt_total_display').value = '';
            document.getElementById('debt_sisa').value = ''; document.getElementById('debt_sisa_display').value = '';
            document.getElementById('debt_cicilan').value = ''; document.getElementById('debt_cicilan_display').value = '';

            if (!isEdit) {
                currentDebtEditId = null;
                document.getElementById('modalDebtTitle').innerText = 'Utang Baru';
                document.getElementById('btnSubmitDebtForm').innerText = 'Simpan Utang';
                debtFormState = { icon: 'fa-credit-card', bg: 'bg-rose-100', color: 'text-rose-500' };
            } else {
                const d = (appSettings.debts || []).find(x => x.id === id); if (!d) return;
                currentDebtEditId = id;
                document.getElementById('modalDebtTitle').innerText = 'Ubah Utang';
                document.getElementById('btnSubmitDebtForm').innerText = 'Simpan Perubahan';
                document.getElementById('debt_nama').value = d.nama;
                document.getElementById('debt_total').value = d.totalUtang;
                document.getElementById('debt_total_display').value = new Intl.NumberFormat('id-ID').format(d.totalUtang);
                document.getElementById('debt_sisa').value = d.sisaUtang;
                document.getElementById('debt_sisa_display').value = new Intl.NumberFormat('id-ID').format(d.sisaUtang);
                if (d.cicilanPerBulan) {
                    document.getElementById('debt_cicilan').value = d.cicilanPerBulan;
                    document.getElementById('debt_cicilan_display').value = new Intl.NumberFormat('id-ID').format(d.cicilanPerBulan);
                }
                debtFormState = { icon: d.icon, bg: d.bg, color: d.color };
            }
            renderDebtIconColorPalette();
        }
        function closeDebtModal() {
            const content = document.getElementById('modalDebtContent'); content.classList.add('translate-x-full');
            setTimeout(() => { document.getElementById('modalDebt').classList.add('hidden'); }, 300);
        }
        function submitDebtForm(e) {
            e.preventDefault();
            const nama = document.getElementById('debt_nama').value.trim();
            const totalUtang = Number(document.getElementById('debt_total').value) || 0;
            const sisaUtang = Number(document.getElementById('debt_sisa').value) || 0;
            const cicilanPerBulan = Number(document.getElementById('debt_cicilan').value) || 0;
            if (!nama || totalUtang <= 0) { showErrorToast('Nama dan total utang wajib diisi.'); return; }

            if (!appSettings.debts) appSettings.debts = [];
            if (currentDebtEditId) {
                const d = appSettings.debts.find(x => x.id === currentDebtEditId);
                if (d) Object.assign(d, { nama, totalUtang, sisaUtang, cicilanPerBulan, icon: debtFormState.icon, bg: debtFormState.bg, color: debtFormState.color });
            } else {
                appSettings.debts.push({ id: 'debt_' + Date.now(), nama, totalUtang, sisaUtang, cicilanPerBulan, icon: debtFormState.icon, bg: debtFormState.bg, color: debtFormState.color });
            }
            persistSettings();
            renderDebtsList();
            closeDebtModal();
            showSuccessToast('Utang berhasil disimpan.');
        }
        function removeDebt(id) {
            showConfirm('Hapus catatan utang ini? Riwayat progres yang sudah tercatat akan ikut hilang.', () => {
                appSettings.debts = (appSettings.debts || []).filter(x => x.id !== id);
                persistSettings();
                renderDebtsList();
                showSuccessToast('Catatan utang dihapus.');
            });
        }

        function openDebtPayModal(id) {
            const d = (appSettings.debts || []).find(x => x.id === id); if (!d) return;
            currentDebtPayId = id;
            document.getElementById('debt-pay-name').innerText = d.nama;
            document.getElementById('formDebtPay').reset();
            document.getElementById('debt_pay_amount').value = ''; document.getElementById('debt_pay_display').value = '';
            const modal = document.getElementById('modalDebtPay'); const content = document.getElementById('modalDebtPayContent');
            modal.classList.remove('hidden');
            setTimeout(() => { content.classList.remove('translate-y-full', 'opacity-0'); content.classList.remove('md:scale-95'); }, 10);
        }
        function closeDebtPayModal() {
            const content = document.getElementById('modalDebtPayContent');
            content.classList.add('translate-y-full', 'md:scale-95', 'opacity-0');
            setTimeout(() => { document.getElementById('modalDebtPay').classList.add('hidden'); }, 300);
        }
        function submitDebtPay(e) {
            e.preventDefault();
            const amount = Number(document.getElementById('debt_pay_amount').value) || 0;
            if (amount <= 0) { showErrorToast('Isi jumlah pembayaran dulu.'); return; }
            const d = (appSettings.debts || []).find(x => x.id === currentDebtPayId); if (!d) return;
            d.sisaUtang = Math.max(0, (Number(d.sisaUtang) || 0) - amount);
            persistSettings();
            renderDebtsList();
            closeDebtPayModal();
            showSuccessToast(`Pembayaran Rp ${new Intl.NumberFormat('id-ID').format(amount)} berhasil dicatat.`);
        }

        // ---------- Detail Aset (riwayat & grafik performa satu aset) ----------
        let currentAssetDetailId = null;

        function openAssetDetailModal(id) {
            const asset = globalAssets.find(a => a.id === id);
            if (!asset) return;
            currentAssetDetailId = id;

            document.getElementById('asset-detail-icon').innerHTML = getAccountLogo(asset.platform);
            document.getElementById('asset-detail-name').textContent = asset.nama;
            document.getElementById('asset-detail-platform').textContent = `${asset.kategori} \u00b7 ${asset.platform || '-'}`;
            document.getElementById('asset-detail-modal').textContent = 'Rp ' + formatRp(asset.modal);
            document.getElementById('asset-detail-nilai').textContent = 'Rp ' + formatRp(asset.nilai);

            const returnRp = Number(asset.nilai) - Number(asset.modal);
            const returnPct = Number(asset.modal) > 0 ? (returnRp / Number(asset.modal)) * 100 : 0;
            const isUp = returnRp >= 0;
            const returnEl = document.getElementById('asset-detail-return');
            returnEl.textContent = (isUp ? '+' : '') + returnPct.toFixed(1) + '%';
            returnEl.className = 'text-xs font-bold mt-0.5 ' + (isUp ? 'text-emerald-500' : 'text-rose-500');

            // Kalau history kosong (aset lama dari sebelum fitur ini ada), pakai nilai saat ini
            // sebagai satu-satunya titik, supaya tetap ada sesuatu yang ditampilkan di grafik.
            const rawHistory = (asset.value_history && asset.value_history.length) ? asset.value_history : [{ tanggal: asset.terakhir ? asset.terakhir.slice(0, 10) : todayDateStr(), nilai: asset.nilai }];
            const history = [...rawHistory].sort((a, b) => a.tanggal.localeCompare(b.tanggal));

            const sinceLabel = 'Sejak ' + new Date(history[0].tanggal + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
            document.getElementById('asset-detail-since').textContent = sinceLabel;
            document.getElementById('asset-detail-single-point-note').classList.toggle('hidden', history.length > 1);

            renderAssetDetailChart(history);

            // Tombol "Refresh Harga Otomatis" cuma muncul kalau aset ini punya simbol + jumlah unit
            // terisi DAN kategorinya termasuk yang didukung (lihat ASSET_AUTO_UPDATE_CONFIG).
            const refreshBtn = document.getElementById('asset-detail-refresh-btn');
            const supportsAutoUpdate = !!(asset.simbol && asset.jumlah_unit && asset.sumber_harga);
            refreshBtn.classList.toggle('hidden', !supportsAutoUpdate);
            refreshBtn.disabled = false; refreshBtn.innerHTML = '<i class="fas fa-rotate mr-2"></i>Refresh Harga Otomatis';
            // Jalur manual (fallback & koreksi) tersedia utk SEMUA kategori yg punya
            // sumber harga otomatis (Kripto/Saham/Reksadana) -- berfungsi bahkan saat
            // Edge Function/sumber sedang tumbang.
            const manualNavBtn = document.getElementById('asset-detail-manualnav-btn');
            if (manualNavBtn) manualNavBtn.classList.toggle('hidden', !ASSET_AUTO_UPDATE_CONFIG[asset.kategori]);
            // Transparansi sumber: harga per unit + waktu pembaruan terakhir.
            const marketLine = document.getElementById('asset-detail-market-line');
            if (marketLine) {
                if (supportsAutoUpdate) {
                    const perUnit = Number(asset.jumlah_unit) ? (Number(asset.nilai) / Number(asset.jumlah_unit)) : null;
                    const srcLabel = ({ coingecko: 'CoinGecko', yahoo_id_stock: 'Yahoo Finance (IDX)', reksadana_bibit: 'Bibit (NAB/UP)' })[asset.sumber_harga] || asset.sumber_harga;
                    const when = asset.terakhir ? new Date(asset.terakhir).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
                    // v57: tanggal DATA PASAR (kolom tanggal_nav -- diisi sync manual & pasca-refresh
                    // harga), berbeda dari "Diperbarui" (jam nilai ditulis). Aset lama yang belum
                    // punya tanggal -> segmen ini disembunyikan, bukan menampilkan "-".
                    const navDateLabel = asset.tanggal_nav ? servicesModule.formatNavDate(asset.tanggal_nav) : null;
                    document.getElementById('asset-detail-market-text').textContent =
                        'Sumber: ' + srcLabel + ' · 1 unit ≈ Rp ' + (perUnit ? formatRp(Math.round(perUnit)) : '-') +
                        (navDateLabel ? ' · Data pasar per ' + navDateLabel : '') + ' · Diperbarui ' + when;
                    marketLine.classList.remove('hidden');
                    marketLine.classList.add('flex');
                } else {
                    marketLine.classList.add('hidden');
                    marketLine.classList.remove('flex');
                }
            }

            const modal = document.getElementById('modalAssetDetail'); const content = document.getElementById('modalAssetDetailContent');
            modal.classList.remove('hidden');
            setTimeout(() => { content.classList.remove('translate-y-full', 'md:scale-95', 'opacity-0'); }, 10);
        }

        function closeAssetDetailModal() {
            const content = document.getElementById('modalAssetDetailContent');
            content.classList.add('translate-y-full', 'md:scale-95', 'opacity-0');
            setTimeout(() => { document.getElementById('modalAssetDetail').classList.add('hidden'); }, 300);
        }

        // Dipanggil dari tombol "Refresh Harga Otomatis" di Detail Aset. Manggil Edge Function
        // 'refresh-asset-price' (lihat js api.run.refreshAssetPrice / supabase/functions/refresh-asset-price),
        // yang mengambil harga terkini dari CoinGecko lalu langsung menyimpan nilai baru ke Supabase.
        function handleRefreshAssetPrice() {
            if (!currentAssetDetailId) return;
            const btn = document.getElementById('asset-detail-refresh-btn');
            btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Mengambil harga terkini...';

            // Pensyahan api.run (slice assets): Edge Function lewat service langsung
            // (src/services/supabase/assets.js), rantai nested & callback persis versi lama.
            servicesModule.refreshAssetPrice(supabaseClient, currentAssetDetailId)
                .then((result) => {
                    const extra = ' (1 unit = Rp ' + formatRp(Math.round(Number(result.harga_per_unit) || 0)) +
                        (result.tanggal_pasar ? ', data pasar ' + String(result.tanggal_pasar).slice(0, 10) : '') + ')';
                    showSuccessToast('Harga diperbarui: Rp ' + formatRp(result.nilai_baru) + extra);
                    servicesModule.listAssets(supabaseClient).then(async (assets) => {
                        globalAssets = assets || [];
                        // v57: simpan tanggal data pasar (kolom tanggal_nav) supaya tanggalnya
                        // bertahan lintas-reload di baris sumber Detail Aset. Ditulis dari baris
                        // SEGAR hasil listAssets (Edge baru saja menulis nilai & value_history --
                        // jangan menimpanya dgn data basi). Non-fatal: gagal tulis tidak boleh
                        // menggagalkan render nilai baru.
                        const tglPasar = result.tanggal_pasar ? String(result.tanggal_pasar).slice(0, 10) : null;
                        const fresh = globalAssets.find(a => a.id === currentAssetDetailId);
                        if (fresh && tglPasar && fresh.tanggal_nav !== tglPasar) {
                            try {
                                await servicesModule.updateAsset(supabaseClient, fresh.id, { ...fresh, tanggal_nav: tglPasar });
                                fresh.tanggal_nav = tglPasar;
                            } catch (eDate) { console.error('simpan tanggal data pasar gagal:', eDate); }
                        }
                        processDataForUI(globalData);
                        if (document.getElementById('view-aset').classList.contains('block')) { renderAssetView(); }
                        openAssetDetailModal(currentAssetDetailId); // re-render detail dgn nilai & grafik terbaru
                    }).catch((err) => { console.error('api.run.getAssetsOnly gagal:', err); btn.disabled = false; btn.innerHTML = '<i class="fas fa-rotate mr-2"></i>Refresh Harga Otomatis'; });
                })
                .catch((err) => {
                    console.error('api.run.refreshAssetPrice gagal:', err);
                    const msg = (err && err.message) ? err.message : 'Gagal mengambil harga terkini. Coba lagi.';
                    showErrorToast(msg);
                    // Edge Function versi lama (sebelum deploy ulang) belum mengenal sumber
                    // reksadana_bibit -> arahkan ke jalur manual yang selalu berfungsi.
                    if (/belum didukung/i.test(msg)) {
                        showInfoToast('Sync otomatis butuh deploy ulang Edge Function (lihat docs). Sementara pakai "Sync NAB/UP Pasar".');
                        openManualNavModal();
                    }
                    btn.disabled = false; btn.innerHTML = '<i class="fas fa-rotate mr-2"></i>Refresh Harga Otomatis';
                });
        }

        // ---------- SYNC NAB/UP MANUAL (reksadana) ----------
        // Jalur yang SELALU berfungsi tanpa ketergantungan server: user menyalin NAB/UP
        // terkini dari aplikasi Bibit/Bareksa (data pasar riil), aplikasi menghitung
        // nilai = NAB x unit via helper murni (src/domain/market-sync.js, teruji unit)
        // dgn aturan value_history yang sama persis dgn submitAsset/Edge Function.
        function openManualNavModal() {
            const asset = globalAssets.find(a => a.id === currentAssetDetailId);
            if (!asset) { showErrorToast('Aset tidak ditemukan.'); return; }
            // Label menyesuaikan kategori (NAB reksadana / harga koin / harga lembar).
            const lbl = ({
                'Reksadana': { t: 'Sync NAB/UP Pasar', sub: 'Masukkan NAB/UP terkini dari aplikasi Bibit/Bareksa', v: 'NAB/UP terkini (Rp per unit)', u: 'Jumlah unit dimiliki', d: 'Tanggal NAB/UP' },
                'Kripto': { t: 'Sync Harga Kripto', sub: 'Masukkan harga per koin terkini dari exchange/aplikasi kamu', v: 'Harga terkini per koin (Rp)', u: 'Jumlah koin dimiliki', d: 'Tanggal harga koin' },
                'Saham': { t: 'Sync Harga Saham', sub: 'Masukkan harga per lembar terkini (mis. harga penutupan) dari aplikasi sekuritas', v: 'Harga terkini per lembar (Rp)', u: 'Jumlah lembar dimiliki', d: 'Tanggal harga saham' },
            })[asset.kategori] || { t: 'Sync Nilai Pasar', sub: 'Masukkan harga per unit terkini', v: 'Harga terkini per unit (Rp)', u: 'Jumlah unit dimiliki', d: 'Tanggal data pasar' };
            document.getElementById('manual-nav-title').textContent = lbl.t;
            document.getElementById('manual-nav-sub').textContent = lbl.sub;
            document.getElementById('manual-nav-value-label').textContent = lbl.v;
            document.getElementById('manual-nav-units-label').textContent = lbl.u;
            const navDateLabel = document.getElementById('manual-nav-date-label');
            if (navDateLabel) navDateLabel.textContent = lbl.d;
            document.getElementById('manual-nav-value').value = '';
            document.getElementById('manual-nav-units').value = (asset.jumlah_unit != null && asset.jumlah_unit !== '') ? asset.jumlah_unit : '';
            // v57: default tanggal data pasar = hari ini (kasus umum: NAB/harga terbit hari ini).
            // User bisa mengubahnya bila angka yang disalin bertanggal lain (mis. NAB kemarin).
            const navDateInput = document.getElementById('manual-nav-date');
            if (navDateInput) navDateInput.value = todayDateStr();
            previewManualNav();
            const modal = document.getElementById('modalManualNav'); const content = document.getElementById('modalManualNavContent');
            modal.classList.remove('hidden');
            setTimeout(() => { content.classList.remove('translate-y-full', 'md:scale-95', 'opacity-0'); }, 10);
        }
        function closeManualNavModal() {
            const content = document.getElementById('modalManualNavContent');
            content.classList.add('translate-y-full', 'md:scale-95', 'opacity-0');
            setTimeout(() => { document.getElementById('modalManualNav').classList.add('hidden'); }, 300);
        }
        function previewManualNav() {
            const v = servicesModule.computeMarketValue(
                document.getElementById('manual-nav-value').value,
                document.getElementById('manual-nav-units').value
            );
            document.getElementById('manual-nav-preview').textContent = 'Rp ' + formatRp(v || 0);
        }
        async function submitManualNav() {
            const asset = globalAssets.find(a => a.id === currentAssetDetailId);
            if (!asset) { showErrorToast('Aset tidak ditemukan.'); return; }
            const nav = Number(document.getElementById('manual-nav-value').value);
            const units = Number(document.getElementById('manual-nav-units').value);
            const nilaiBaru = servicesModule.computeMarketValue(nav, units);
            if (!nilaiBaru) { showErrorToast('NAB/UP dan jumlah unit harus lebih dari 0.'); return; }
            // v57: tanggal data pasar -- divalidasi isBibitNavDate (murni, teruji unit):
            // format YYYY-MM-DD riil, tidak di masa depan, tidak basi (>30 hari). Kosong
            // dianggap hari ini (prefill openManualNavModal).
            const navDateInput = document.getElementById('manual-nav-date');
            const navDate = ((navDateInput && navDateInput.value) || '').trim() || todayDateStr();
            if (!servicesModule.isBibitNavDate(navDate)) {
                showErrorToast('Tanggal data pasar tidak valid. Pakai tanggal riil, maks. 30 hari ke belakang, tidak di masa depan.');
                return;
            }
            try {
                const patch = servicesModule.withSyncedValue(asset, { nilaiBaru, today: todayDateStr() });
                // tanggal_nav ditulis EKSPLISIT (bukan undefined) -- updateAsset hanya
                // menyentuh kolom ini bila disetel, jadi Edit Aset lewat form tidak pernah
                // menghapusnya. Catatan: titik value_history tetap dicap HARI INI (aturan sama
                // dengan Edge Function), tanggal_nav mencatat tanggal DATA PASARNYA.
                await servicesModule.updateAsset(supabaseClient, asset.id, { ...asset, ...patch, jumlah_unit: units, tanggal_nav: navDate });
                closeManualNavModal();
                showSuccessToast('Nilai pasar diterapkan: Rp ' + formatRp(nilaiBaru) + ' (' + servicesModule.describeSyncSource('manual_nav') + ', data per ' + servicesModule.formatNavDate(navDate) + ').');
                servicesModule.listAssets(supabaseClient).then((assets) => {
                    globalAssets = assets || [];
                    processDataForUI(globalData);
                    if (document.getElementById('view-aset').classList.contains('block')) { renderAssetView(); }
                    openAssetDetailModal(currentAssetDetailId);
                }).catch((e2) => { console.error('refresh aset pasca-sync gagal:', e2); });
            } catch (e) {
                console.error('submitManualNav gagal:', e);
                showErrorToast('Gagal menyimpan nilai baru. Periksa koneksi internet kamu.');
            }
        }

        // ---------- REFRESH SEMUA ASET OTOMATIS (kripto/saham/reksadana) ----------
        // Sekali klik: semua aset yg punya simbol+jumlah_unit+sumber_harga di-refresh
        // berurutan (Edge Function menahan rate-limit 30/jam per user). Gagal per aset
        // tidak menghentikan aset lain; ringkasan dilaporkan.
        async function refreshAllAssetPrices() {
            const targets = (globalAssets || []).filter(a => a.simbol && a.jumlah_unit && a.sumber_harga);
            if (!targets.length) {
                showInfoToast('Belum ada aset dengan Simbol + Jumlah Unit terisi. Isi lewat Tambah/Edit Aset dulu.');
                return;
            }
            showLoading(true);
            let okCount = 0;
            const fails = [];
            const dated = []; // v57: [{ id, tanggal }] tanggal_pasar per aset yg sukses di-refresh
            for (const a of targets) {
                try {
                    const r = await servicesModule.refreshAssetPrice(supabaseClient, a.id);
                    okCount++;
                    if (r && r.tanggal_pasar) dated.push({ id: a.id, tanggal: String(r.tanggal_pasar).slice(0, 10) });
                }
                catch (e) { fails.push(a.nama + ': ' + ((e && e.message) || e)); }
            }
            try {
                const assets = await servicesModule.listAssets(supabaseClient);
                globalAssets = assets || [];
                // v57: simpan tanggal data pasar per aset (paralel, non-fatal) supaya tanggalnya
                // tampil di Detail Aset lintas-reload, konsisten dgn jalur refresh tunggal &
                // sync manual. Pakai baris SEGAR hasil listAssets (nilai/history baru ditulis
                // Edge); aset yang tanggalnya sudah sama dilewati (tanpa request).
                await Promise.allSettled(dated.map(({ id, tanggal }) => {
                    const fresh = globalAssets.find(a => a.id === id);
                    if (!fresh || fresh.tanggal_nav === tanggal) return Promise.resolve();
                    return servicesModule.updateAsset(supabaseClient, id, { ...fresh, tanggal_nav: tanggal })
                        .then(() => { fresh.tanggal_nav = tanggal; })
                        .catch((e) => { console.error('simpan tanggal data pasar gagal:', e); });
                }));
                processDataForUI(globalData);
                if (document.getElementById('view-aset').classList.contains('block')) { renderAssetView(); }
            } catch (e) { console.error('muat ulang aset pasca-refresh gagal:', e); }
            showLoading(false);
            if (okCount) showSuccessToast(okCount + ' aset diperbarui dari harga pasar' + (fails.length ? '; ' + fails.length + ' gagal (lihat konsol)' : '') + '.');
            if (fails.length) { fails.forEach((f) => console.error('refresh harga gagal:', f)); showErrorToast('Sebagian gagal: ' + fails[0]); }
        }

        function renderAssetDetailChart(history) {
            if (charts.assetDetail) charts.assetDetail.destroy();
            if (!document.getElementById('assetDetailChart')) return;
            const isUp = history.length > 1 ? history[history.length - 1].nilai >= history[0].nilai : true;
            const lineColor = isUp ? '#22d3ee' : '#f43f5e';
            charts.assetDetail = new Chart(document.getElementById('assetDetailChart').getContext('2d'), servicesModule.chartsUi.buildAssetDetailConfig({ history, lineColor, isUp, formatRp, formatShortVal, chartGridColor }));
        }

        // ---------- Ekspor CSV portofolio aset ----------
        function exportAssetsCsv() {
            if (!globalAssets || globalAssets.length === 0) {
                showInfoToast('Belum ada aset untuk diekspor.');
                return;
            }
            const header = ['Nama', 'Kategori', 'Platform', 'Modal', 'Nilai Sekarang', 'Return (Rp)', 'Return (%)', 'Terakhir Diperbarui'];
            const rows = globalAssets.map(a => {
                const returnRp = Number(a.nilai) - Number(a.modal);
                const returnPct = Number(a.modal) > 0 ? (returnRp / Number(a.modal)) * 100 : 0;
                return [
                    a.nama, a.kategori, a.platform || '',
                    a.modal, a.nilai, returnRp.toFixed(0), returnPct.toFixed(2),
                    a.terakhir ? toDateStr(new Date(a.terakhir)) : ''
                ];
            });
            const csvContent = '\uFEFF' + [header, ...rows].map(r => r.map(csvField).join(',')).join('\r\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const todayStr = todayDateStr();
            a.href = url;
            a.download = `myfinance-aset-${todayStr}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showSuccessToast(`${globalAssets.length} aset berhasil diekspor ke CSV.`);
        }

        // ========================== LAPORAN TAB & CATEGORY DETAIL ==========================
        // ========================== RINGKASAN TAHUNAN ==========================
        // Melengkapi Laporan yang sebelumnya cuma per-bulan -- ini kasih gambaran satu
        // TAHUN PENUH sekaligus, dibanding tahun lalu. Murni dari globalData yang sudah
        // ada (tidak perlu fetch tambahan), jadi aman dipakai bareng filter bulan di atas
        // tanpa saling ganggu.
        let selectedReportYear = new Date().getFullYear();
        function shiftReportYear(delta) {
            selectedReportYear += delta;
            renderYearlyReport();
        }
        function formatYearlyChange(curr, prev) {
            if (prev <= 0) return curr > 0 ? '<span class="text-slate-400">baru tahun ini</span>' : '';
            const pct = Math.round(((curr - prev) / prev) * 100);
            const cls = pct >= 0 ? 'text-emerald-500' : 'text-rose-500';
            const arrow = pct >= 0 ? '&uarr;' : '&darr;';
            return `<span class="${cls}">${arrow} ${Math.abs(pct)}% vs tahun lalu</span>`;
        }
        function renderYearlyReport() {
            const yearEl = document.getElementById('report-year-label'); if (!yearEl) return;
            const year = selectedReportYear;
            yearEl.innerText = year;

            // Net bulanan & total masuk/keluar tahun ini vs tahun lalu: satu sumber kebenaran
            // sekarang src/domain/reports.js (dipakai juga oleh tests/unit/reports-domain.test.js).
            const { monthlyNet, totalIn, totalOut, totalInLast, totalOutLast, totalNet, totalNetLast, hasDataThisYear } =
                servicesModule.computeYearlySummary(globalData, { year, txIdrAmount, parseTgl });

            animateRupiah(document.getElementById('yearly-total-in'), totalIn);
            animateRupiah(document.getElementById('yearly-total-out'), totalOut);
            const netEl = document.getElementById('yearly-total-net');
            netEl.classList.toggle('text-rose-500', totalNet < 0);
            netEl.classList.toggle('text-indigo-600', totalNet >= 0);
            animateRupiah(netEl, totalNet);
            document.getElementById('yearly-change-in').innerHTML = formatYearlyChange(totalIn, totalInLast);
            document.getElementById('yearly-change-out').innerHTML = formatYearlyChange(totalOut, totalOutLast);
            document.getElementById('yearly-change-net').innerHTML = formatYearlyChange(totalNet, totalNetLast);

            const emptyEl = document.getElementById('yearlyNetChart-empty');
            emptyEl.classList.toggle('hidden', hasDataThisYear);

            if (charts.yearlyNet) charts.yearlyNet.destroy();
            const monthLabels = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
            charts.yearlyNet = new Chart(document.getElementById('yearlyNetChart').getContext('2d'), servicesModule.chartsUi.buildYearlyNetConfig({ monthLabels, monthlyNet, themeAccentColor, formatShortVal, chartGridColor }));
        }

        function renderReportTab() {
            renderYearlyReport();
            let filterVal = document.getElementById('reportFilterMonth').value; if(!filterVal) return;
            let [year, month] = filterVal.split('-');

            // Total per kategori (parent) & per hari utk bulan yang dipilih: satu sumber kebenaran
            // sekarang src/domain/reports.js (dipakai juga oleh tests/unit/reports-domain.test.js).
            const { dailyMap, outEntries, inEntries } = servicesModule.computeMonthlyBreakdown(globalData, {
                year, month, txIdrAmount, parseTgl,
                categorizeParent: (kategori, jenis) => getCategoryStyle(kategori, jenis).parentName,
            });

            if(charts.catOut) charts.catOut.destroy(); let hasOutCat = outEntries.length > 0;
            charts.catOut = new Chart(document.getElementById('expenseCategoryChart').getContext('2d'), servicesModule.chartsUi.buildCategoryDonutConfig({ hasData: hasOutCat, entries: outEntries, palette: cutePaletteOut, chartEmptyColor, openCategoryDetail, jenis: 'Pengeluaran' }));
            renderDonutBreakdown({
                legendEl: document.getElementById('expenseCategoryChart-legend'),
                listEl: document.getElementById('expenseCategoryChart-list'),
                totalEl: document.getElementById('expenseCategoryChart-total'),
                entries: outEntries.map(e => { const s = getCategoryStyle(e.label, 'Pengeluaran'); return { label: e.label, val: e.val, iconHtml: categoryIconHtml(s, 'w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center flex-shrink-0', 'text-xs md:text-sm') }; }),
                palette: cutePaletteOut,
                onClickItem: (label) => `openCategoryDetail('${jsStr(label)}','Pengeluaran')`,
                emptyMessage: 'Belum ada pengeluaran bulan ini.'
            });

                // HUD radar: persen kategori pengeluaran terbesar di tengah cincin.
                const expRadarEl = document.getElementById('exp-radar-pct');
                if (expRadarEl) {
                    const expTot = outEntries.reduce((a, e) => a + e.val, 0);
                    const expTop = outEntries.reduce((m, e) => (e.val > m.val ? e : m), outEntries[0] || { val: 0, label: '' });
                    if (hasOutCat && expTot > 0) {
                        expRadarEl.querySelector('b').textContent = Math.round((expTop.val / expTot) * 100) + '%';
                        expRadarEl.querySelector('span').textContent = String(expTop.label).toUpperCase().slice(0, 10);
                        expRadarEl.style.display = 'flex';
                    } else { expRadarEl.style.display = 'none'; }
                }

            if(charts.catIn) charts.catIn.destroy(); let hasInCat = inEntries.length > 0;
            charts.catIn = new Chart(document.getElementById('incomeCategoryChart').getContext('2d'), servicesModule.chartsUi.buildCategoryDonutConfig({ hasData: hasInCat, entries: inEntries, palette: getCutePaletteIn(), chartEmptyColor, openCategoryDetail, jenis: 'Pemasukan' }));
            renderDonutBreakdown({
                legendEl: document.getElementById('incomeCategoryChart-legend'),
                listEl: document.getElementById('incomeCategoryChart-list'),
                totalEl: document.getElementById('incomeCategoryChart-total'),
                entries: inEntries.map(e => { const s = getCategoryStyle(e.label, 'Pemasukan'); return { label: e.label, val: e.val, iconHtml: categoryIconHtml(s, 'w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center flex-shrink-0', 'text-xs md:text-sm') }; }),
                palette: getCutePaletteIn(),
                onClickItem: (label) => `openCategoryDetail('${jsStr(label)}','Pemasukan')`,
                emptyMessage: 'Belum ada pemasukan bulan ini.'
            });

                // HUD radar: persen kategori pemasukan terbesar di tengah cincin.
                const incRadarEl = document.getElementById('inc-radar-pct');
                if (incRadarEl) {
                    const incTot = inEntries.reduce((a, e) => a + e.val, 0);
                    const incTop = inEntries.reduce((m, e) => (e.val > m.val ? e : m), inEntries[0] || { val: 0, label: '' });
                    if (hasInCat && incTot > 0) {
                        incRadarEl.querySelector('b').textContent = Math.round((incTop.val / incTot) * 100) + '%';
                        incRadarEl.querySelector('span').textContent = String(incTop.label).toUpperCase().slice(0, 10);
                        incRadarEl.style.display = 'flex';
                    } else { incRadarEl.style.display = 'none'; }
                }

            let dailyLabels = Object.keys(dailyMap);
            if(charts.daily) charts.daily.destroy();
            charts.daily = new Chart(document.getElementById('dailyChart').getContext('2d'), servicesModule.chartsUi.buildDailyConfig({ dailyLabels, dailyMap, formatShortVal, chartGridColor }));

            // Tren kategori TIDAK ikut filter bulan di atas (selalu 6 bulan terakhir dari HARI INI),
            // jadi dihitung & dirender terpisah dari sisa fungsi ini.
            renderCategoryTrendChart();
            renderAiChatHistory();
        }

        // computeCategoryTrend() lama sudah dipindah ke src/domain/reports.js -- lihat
        // pemanggilannya di renderCategoryTrendChart().

        function renderCategoryTrendChart() {
            const canvas = document.getElementById('categoryTrendChart'); if (!canvas) return;
            const emptyEl = document.getElementById('categoryTrendChart-empty');
            const { labels, series } = servicesModule.computeCategoryTrend(globalData, 6, {
                now: new Date(),
                txIdrAmount,
                categorizeExpenseParent: (kategori) => getCategoryStyle(kategori, 'Pengeluaran').parentName,
            });

            if (charts.catTrend) { charts.catTrend.destroy(); charts.catTrend = null; }
            if (series.length === 0) {
                canvas.classList.add('hidden');
                if (emptyEl) emptyEl.classList.remove('hidden');
                return;
            }
            canvas.classList.remove('hidden');
            if (emptyEl) emptyEl.classList.add('hidden');

            charts.catTrend = new Chart(canvas.getContext('2d'), servicesModule.chartsUi.buildCatTrendConfig({ labels, series, palette: cutePaletteOut, formatRp, formatShortVal, chartGridColor }));
        }

        // ========================== TANYA AI (chat bebas soal keuangan, via Edge Function yang sama) ==========================
        // Beda dari "Rekomendasi AI" di dashboard (yang otomatis, 3 insight tetap): ini user yang
        // bertanya bebas ("berapa pengeluaran transport 3 bulan terakhir?" dsb), dijawab Gemini
        // berdasarkan ringkasan data yang sama (buildFinanceSummaryForAI()) + pertanyaannya sendiri.
        // Edge Function 'analyze-finance' membedakan mode ini lewat ada/tidaknya field "question"
        // di body request (lihat supabase/functions/analyze-finance/index.ts).
        let aiChatHistory = []; // { role: 'user'|'assistant', text }
        let aiChatInFlight = false;

        function renderAiChatHistory() {
            const wrap = document.getElementById('ai-chat-messages'); if (!wrap) return;
            if (aiChatHistory.length === 0) {
                wrap.innerHTML = `<p class="text-[11px] text-slate-400 text-center py-6 px-4">Tanya apa saja soal keuanganmu, mis. "berapa pengeluaran transport 3 bulan terakhir?" atau "kategori apa yang paling boros bulan ini?"</p>`;
                return;
            }
            wrap.innerHTML = aiChatHistory.map(m => `
                <div class="flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}">
                    <div class="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs md:text-sm leading-relaxed ${m.role === 'user' ? 'bg-[#151928] text-white rounded-br-md' : 'bg-slate-100 text-slate-700 rounded-bl-md'}">${escapeHtml(m.text)}</div>
                </div>`).join('');
            wrap.scrollTop = wrap.scrollHeight;
        }

        function appendAiChatLoadingBubble() {
            const wrap = document.getElementById('ai-chat-messages'); if (!wrap) return;
            wrap.innerHTML += `<div class="flex justify-start" id="ai-chat-loading-bubble"><div class="bg-slate-100 rounded-2xl rounded-bl-md px-4 py-3"><i class="fas fa-ellipsis fa-fade text-slate-400"></i></div></div>`;
            wrap.scrollTop = wrap.scrollHeight;
        }

        async function sendAiChatQuestion() {
            if (aiChatInFlight) return;
            const input = document.getElementById('ai-chat-input'); if (!input) return;
            const question = input.value.trim(); if (!question) return;
            if (!lastInsightsCtx) { showErrorToast('Data belum siap dimuat, coba lagi sesaat lagi.'); return; }

            aiChatInFlight = true;
            input.value = '';
            const sendBtn = document.getElementById('ai-chat-send-btn');
            if (sendBtn) sendBtn.disabled = true;

            aiChatHistory.push({ role: 'user', text: question });
            renderAiChatHistory();
            appendAiChatLoadingBubble();

            try {
                const summary = buildFinanceSummaryForAI(lastInsightsCtx);
                const { data, error } = await supabaseClient.functions.invoke('analyze-finance', { body: Object.assign({}, summary, { question: question }) });
                if (error) throw error;
                if (data && data.error) {
                    // Tampilkan pesan aslinya dari server (mis. jeda rate limit, atau "belum di-setup")
                    // -- bukan teks generik yang sama utk semua jenis error, biar user tau persis kenapa.
                    aiChatHistory.push({ role: 'assistant', text: data.error });
                } else {
                    aiChatHistory.push({ role: 'assistant', text: (data && data.answer) || 'Maaf, Gemini tidak memberi jawaban untuk pertanyaan ini.' });
                }
            } catch (e) {
                aiChatHistory.push({ role: 'assistant', text: 'Gagal menghubungi Gemini. Periksa koneksi internet dan coba lagi.' });
            } finally {
                aiChatInFlight = false;
                if (sendBtn) sendBtn.disabled = false;
                renderAiChatHistory();
            }
        }
        
        // ========================== ACCOUNT DETAIL ==========================
        function openAccountDetail(accName) {
            currentAccountDetail = accName;
            document.getElementById('detail-account-name').innerText = accName;
            document.getElementById('detail-account-logo').innerHTML = getAccountLogo(accName);

            // Total masuk/keluar/transfer & saldo akun ini: satu sumber kebenaran sekarang
            // src/domain/accounts.js (dipakai juga oleh tests/unit/accounts-domain.test.js).
            let { relatedTx, totalIn, totalOut, transferIn, transferOut, balance } =
                servicesModule.computeAccountTotals(globalData, accName, { transferTargetAmount });

            const balEl = document.getElementById('detail-account-balance');
            balEl.innerText = nominalHidden ? 'Rp ••••••' : (balance < 0 ? '-Rp ' : 'Rp ') + formatRp(Math.abs(balance));
            balEl.className = 'text-2xl md:text-3xl font-bold ' + (balance < 0 ? 'text-rose-600' : 'text-[#151928]');

            animateRupiah(document.getElementById('detail-account-in'), totalIn, true);
            animateRupiah(document.getElementById('detail-account-out'), totalOut, true);
            animateRupiah(document.getElementById('detail-account-transfer-in'), transferIn, true);
            animateRupiah(document.getElementById('detail-account-transfer-out'), transferOut, true);

            let txCount = relatedTx.length;
            document.getElementById('detail-account-tx-count').innerText = txCount;
            let totalFlow = totalIn + totalOut + transferIn + transferOut;
            document.getElementById('detail-account-avg').innerText = 'Rp ' + formatShortVal(txCount ? totalFlow / txCount : 0);

            // Kategori pengeluaran terbesar (all time) untuk akun ini: satu sumber kebenaran
            // sekarang src/domain/accounts.js (dipakai juga oleh tests/unit/accounts-domain.test.js).
            const { top: topCatEntry } = servicesModule.aggregateAccountExpenseByCategory(relatedTx, accName, { getCategoryStyle, parseTgl });
            const topCatWrap = document.getElementById('detail-account-top-cat-wrap');
            if (topCatEntry) {
                let style = getCategoryStyle(topCatEntry.label, 'Pengeluaran');
                topCatWrap.innerHTML = `${categoryIconHtml(style, 'w-8 h-8 md:w-9 md:h-9 rounded-xl flex items-center justify-center flex-shrink-0', 'text-xs md:text-sm')}
                    <div class="min-w-0"><p class="text-[10px] md:text-[10px] text-slate-400 font-medium leading-tight font-bold">Pengeluaran Terbesar</p><p class="text-xs md:text-sm font-bold text-slate-800 truncate">${topCatEntry.label}</p></div>`;
            } else {
                topCatWrap.innerHTML = `<div class="w-8 h-8 md:w-9 md:h-9 rounded-xl flex items-center justify-center bg-slate-100 text-slate-400 flex-shrink-0"><i class="fas fa-inbox text-xs md:text-sm"></i></div>
                    <div class="min-w-0"><p class="text-[10px] md:text-[10px] text-slate-400 font-medium leading-tight font-bold">Pengeluaran Terbesar</p><p class="text-xs md:text-sm font-bold text-slate-400">Belum ada</p></div>`;
            }

            // Riwayat, dikelompokkan per tanggal (mempermudah pembacaan dibanding tabel datar) --
            // tiap grup tanggal menampilkan badge hari + total bersih hari itu untuk akun ini,
            // lalu daftar transaksinya di bawahnya.
            const tbody = document.getElementById('account-table-body');
            let sortedData = [...relatedTx].sort(txServerCompare);
            const countEl = document.getElementById('detail-account-history-count');
            if (countEl) countEl.innerText = sortedData.length + ' transaksi';

            if (sortedData.length === 0) {
                tbody.innerHTML = `<div class="text-center py-10 text-slate-400 stagger-item"><i class="fas fa-receipt text-3xl mb-3"></i><p class="text-xs font-semibold">Belum ada transaksi di akun ini.</p><p class="text-[11px] mt-1">Transaksi yang memakai akun ini akan muncul di sini.</p></div>`;
            } else {
                const dayAbbrevID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
                // Grup dibangun sambil tetap menjaga urutan tanggal terbaru->terlama dari sortedData
                // (pakai Map supaya urutan insersi = urutan tanggal, bukan diacak seperti object biasa).
                const groups = new Map();
                sortedData.forEach(row => {
                    const key = row.tanggal;
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key).push(row);
                });

                tbody.innerHTML = Array.from(groups.entries()).map(([dateKey, rows]) => {
                    const d = parseTgl(dateKey);
                    const dow = d.getDay(); // 0=Minggu ... 6=Sabtu
                    const badgeClass = dow === 0 ? 'bg-rose-500 text-white' : (dow === 6 ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500');

                    // Total bersih hari itu KHUSUS untuk akun ini (masuk dikurangi keluar), supaya
                    // warnanya mencerminkan efek bersihnya terhadap saldo akun -- bukan sekadar
                    // jumlah pengeluaran seperti tabel biasa. Satu sumber kebenaran sekarang
                    // src/domain/accounts.js (computeAccountGroupNet).
                    const netTotal = servicesModule.computeAccountGroupNet(rows, accName, { transferTargetAmount });
                    const netColor = netTotal > 0 ? 'text-emerald-500' : (netTotal < 0 ? 'text-rose-500' : 'text-slate-400');
                    const netPrefix = netTotal > 0 ? '+' : (netTotal < 0 ? '-' : '');

                    // HUD: bar nominal proporsional terhadap transaksi terbesar hari itu (akun ini).
                    const accGrpMaxAmt = Math.max(...rows.map(r => Math.abs(Number(r.jumlah) || 0)), 1);
                    const rowsHtml = rows.map(row => {
                        let isTransferOut = row.jenis === 'Transfer' && row.akun === accName;
                        let isTransferIn = row.jenis === 'Transfer' && row.kategori === accName;
                        let color = row.jenis === 'Pemasukan' ? 'text-emerald-500' : (row.jenis === 'Pengeluaran' ? 'text-rose-500' : (isTransferIn ? 'text-emerald-500' : 'text-blue-500'));
                        let prefix = row.jenis === 'Pengeluaran' ? '-' : (row.jenis === 'Pemasukan' ? '+' : (isTransferIn ? '+' : '-'));
                        let style = getCategoryStyle(row.kategori, row.jenis);
                        let labelStr = row.kategori;
                        // Untuk transfer, ikon panah arah selalu dipakai (bukan ikon/gambar kategori) --
                        // buat objek gaya baru TANPA .image supaya tidak kebawa gambar kustom yang salah.
                        let iconStyle = style;
                        if (isTransferOut) { iconStyle = { bg: style.bg, color: style.color, icon: 'fa-arrow-right' }; labelStr = 'Transfer ke ' + row.kategori; }
                        else if (isTransferIn) { iconStyle = { bg: style.bg, color: style.color, icon: 'fa-arrow-left' }; labelStr = 'Transfer dari ' + row.akun; }

                        return `
                            <div class="hud-tx-row flex items-center justify-between px-3 md:px-4 py-2.5 hover:bg-slate-50 transition">
                                <div class="flex items-center min-w-0">
                                    ${categoryIconHtml(iconStyle, 'w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center mr-3 flex-shrink-0 border border-slate-50 shadow-sm', 'text-xs md:text-sm')}
                                    <div class="min-w-0">
                                        <p class="text-xs md:text-sm font-bold text-slate-700 truncate">${escapeHtml(labelStr)}</p>
                                        <p class="text-[10px] md:text-xs text-slate-400 truncate">${row.keterangan ? escapeHtml(row.keterangan) : '-'}</p>
                                    </div>
                                </div>
                                <div class="flex items-center gap-0.5 flex-shrink-0 pl-2">
                                    <span class="text-xs md:text-sm font-bold hud-mono ${color} whitespace-nowrap mr-1">${prefix}Rp ${formatRp(isTransferIn ? transferTargetAmount(row) : row.jumlah)}</span>
                                    <button onclick="editDataForm('${row.id}')" aria-label="Ubah transaksi" class="w-7 h-7 rounded-lg text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition flex items-center justify-center flex-shrink-0"><i class="fas fa-pencil-alt text-[10px]"></i></button>
                                    <button onclick="hapusData('${row.id}')" aria-label="Hapus transaksi" class="w-7 h-7 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition flex items-center justify-center flex-shrink-0"><i class="fas fa-trash-alt text-[10px]"></i></button>
                                </div>
                                <div class="hud-rowbar hud-bar" aria-hidden="true"><div class="hud-bar-fill" style="width:${Math.max(3, Math.round(Math.abs(Number(isTransferIn ? transferTargetAmount(row) : row.jumlah) || 0) / accGrpMaxAmt * 100))}%"></div></div>
                            </div>`;
                    }).join('');

                    return `
                        <div>
                            <div class="flex items-center justify-between px-3 md:px-4 py-2 bg-slate-50/70">
                                <div class="flex items-center gap-2">
                                    <span class="text-sm md:text-base font-extrabold text-slate-800">${d.getDate()}</span>
                                    <span class="text-[10px] md:text-[10px] font-bold px-1.5 md:px-2 py-0.5 rounded-md ${badgeClass}">${dayAbbrevID[dow]}</span>
                                    <span class="text-[10px] md:text-xs text-slate-400 font-semibold">${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}</span>
                                </div>
                                <span class="text-xs md:text-sm font-bold ${netColor}">${netPrefix}Rp ${formatRp(Math.abs(netTotal))}</span>
                            </div>
                            <div class="divide-y divide-slate-50">${rowsHtml}</div>
                        </div>`;
                }).join('');
            }

            renderAccountDetailCharts();

            switchView('akun-detail');
        }

        // buildAccountSeries() lama sudah dipindah ke src/domain/accounts.js
        // (buildAccountBalanceSeries) -- lihat pemanggilannya di renderAccountDetailCharts().

        function toggleAccountCatFilter() {
            const filterType = document.getElementById('accountCatFilterType').value;
            const monthInput = document.getElementById('accountCatFilterMonth');
            monthInput.classList.toggle('hidden', filterType !== 'custom');
            // Begitu pindah ke "Pilih Bulan Tertentu" tapi belum pernah pilih apa-apa, langsung isi
            // bulan berjalan sbg default -- supaya tidak sempat nampilin "semua waktu" yg membingungkan
            // sebelum user sempat pilih sendiri.
            if (filterType === 'custom' && !monthInput.value) {
                const n = new Date();
                monthInput.value = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
            }
            renderAccountDetailCharts();
        }

        function renderAccountDetailCharts() {
            // Bangun chart-nya sekarang di src/ui/accounts.js (dipakai juga oleh
            // tests/unit/ui-accounts.test.js) -- fungsi ini tinggal wrapper tipis yang
            // menyuplai konteks (state akun & helper) yang dibutuhkan. State
            // currentAccountDetail tetap dimiliki index.html (ditulis openAccountDetail,
            // dibaca juga alur refresh data). Dipanggil dari: openAccountDetail,
            // toggleAccountCatFilter, onchange #accountDetailPeriod di markup, & handler
            // resize. Nama fungsi & cara memanggilnya TIDAK berubah sama sekali.
            servicesModule.renderAccountDetailChartsUI({
                document, currentAccountDetail, globalData, transferTargetAmount, parseTgl,
                buildAccountBalanceSeries: servicesModule.buildAccountBalanceSeries,
                computeAccountChartSeries: servicesModule.computeAccountChartSeries,
                isChartNarrow: servicesModule.isChartNarrow,
                selectSparseLabelIndices: servicesModule.selectSparseLabelIndices,
                resolveAccountCategoryDateRange: servicesModule.resolveAccountCategoryDateRange,
                aggregateAccountExpenseByCategory: servicesModule.aggregateAccountExpenseByCategory,
                getCategoryStyle, categoryIconHtml, jsStr, formatRp, formatShortVal,
                chartGridColor, chartLabelColor, chartEmptyColor, chartBorderColor,
                cutePaletteOut, renderDonutBreakdown,
                accentColor: themeAccentColor,
                Chart, charts,
            });
        }

        // ========================== CATEGORY DETAIL ==========================
        // State bulan yang lagi ditampilkan di halaman Kategori Detail -- dipisah dari
        // reportFilterMonth (punya tab Laporan) supaya user bisa geser bulan DI HALAMAN INI
        // (pakai panah kiri/kanan) tanpa perlu balik ke Laporan dulu. Awalnya disamakan dgn
        // reportFilterMonth (bulan yg lagi aktif di Laporan saat kategori ini diklik).
        let categoryDetailYear = null, categoryDetailMonth = null, categoryDetailJenis = null, categoryDetailSpecificData = [];

        function openCategoryDetail(categoryName, jenis) {
            const filterVal = document.getElementById('reportFilterMonth').value || todayDateStr().slice(0, 7);
            const [year, month] = filterVal.split('-');
            categoryDetailYear = Number(year); categoryDetailMonth = Number(month); categoryDetailJenis = jenis;
            
            document.getElementById('detail-category-name').innerText = categoryName;
            document.getElementById('detail-category-type').innerText = "Kategori " + jenis;
            
            let style = getCategoryStyle(categoryName, jenis);
            document.getElementById('detail-category-logo').innerHTML = categoryIconHtml(style, 'w-12 h-12 md:w-16 md:h-16 rounded-xl p-2 mr-4 flex items-center justify-center shadow-sm', 'text-2xl');

            // Ambil semua subkategori jika ini parent: satu sumber kebenaran sekarang
            // src/domain/categories.js (dipakai juga oleh tests/unit/categories-domain.test.js).
            let subCategories = servicesModule.resolveCategoryAndSubNames(categoryDict, categoryName, jenis);

            // "Semua Riwayat Transaksi" di bawah SENGAJA tidak ikut difilter per-bulan (namanya
            // "SEMUA") -- cuma total & chart di atas yang bulan-spesifik (lihat renderCategoryDetailMonthData).
            categoryDetailSpecificData = globalData.filter(d => d.jenis === jenis && subCategories.includes(d.kategori));
            
            const tbody = document.getElementById('category-table-body');
            let sortedData = [...categoryDetailSpecificData].sort(txServerCompare);

            if(sortedData.length === 0) {
                tbody.innerHTML = `<div class="text-center py-10 text-slate-400 stagger-item"><i class="fas fa-receipt text-3xl mb-3"></i><p class="text-xs font-semibold">Belum ada transaksi di kategori ini.</p><p class="text-[11px] mt-1">Transaksi yang masuk kategori ini akan muncul di sini.</p></div>`;
            } else {
                const dayAbbrevID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
                const prefix = jenis === 'Pemasukan' ? '+' : '-';
                const color = jenis === 'Pemasukan' ? 'text-emerald-500' : 'text-rose-500';
                // Dikelompokkan per tanggal (konsisten dengan Riwayat Transaksi & Riwayat Akun) -- pakai
                // Map supaya urutan insersi = urutan tanggal terbaru->terlama dari sortedData.
                const groups = new Map();
                sortedData.forEach(row => {
                    const key = row.tanggal;
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key).push(row);
                });

                tbody.innerHTML = Array.from(groups.entries()).map(([dateKey, rows]) => {
                    const d = parseTgl(dateKey);
                    const dow = d.getDay(); // 0=Minggu ... 6=Sabtu
                    const badgeClass = dow === 0 ? 'bg-rose-500 text-white' : (dow === 6 ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500');
                    const dayTotal = rows.reduce((sum, row) => sum + txIdrAmount(row), 0);

                    // HUD: bar nominal proporsional terhadap transaksi terbesar hari itu (kategori ini).
                    const catGrpMaxAmt = Math.max(...rows.map(r => Math.abs(Number(r.jumlah) || 0)), 1);
                    const rowsHtml = rows.map(row => {
                        let style = getCategoryStyle(row.kategori, jenis);
                        return `
                            <div class="hud-tx-row flex items-center justify-between px-3 md:px-4 py-2.5 hover:bg-slate-50 transition">
                                <div class="flex items-center min-w-0">
                                    ${categoryIconHtml(style, 'w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center mr-3 flex-shrink-0 border border-slate-50 shadow-sm', 'text-xs md:text-sm')}
                                    <div class="min-w-0">
                                        <p class="text-xs md:text-sm font-bold text-slate-700 truncate">${escapeHtml(row.kategori)}</p>
                                        <p class="text-[10px] md:text-xs text-slate-400 truncate flex items-center mt-0.5"><span class="w-3 h-3 mr-1 inline-flex">${getAccountLogo(row.akun)}</span> ${escapeHtml(row.akun)} ${row.keterangan ? '• ' + escapeHtml(row.keterangan) : ''}</p>
                                    </div>
                                </div>
                                <div class="flex items-center gap-0.5 flex-shrink-0 pl-2">
                                    <span class="text-xs md:text-sm font-bold hud-mono ${color} whitespace-nowrap">${prefix}${row.mata_uang && row.mata_uang !== 'IDR' ? row.mata_uang + ' ' : 'Rp '}${formatRp(row.jumlah)}</span>
                                </div>
                                <div class="hud-rowbar hud-bar" aria-hidden="true"><div class="hud-bar-fill" style="width:${Math.max(3, Math.round(Math.abs(Number(row.jumlah) || 0) / catGrpMaxAmt * 100))}%"></div></div>
                            </div>`;
                    }).join('');

                    return `
                        <div>
                            <div class="flex items-center justify-between px-3 md:px-4 py-2 bg-slate-50/70">
                                <div class="flex items-center gap-2">
                                    <span class="text-sm md:text-base font-extrabold text-slate-800">${d.getDate()}</span>
                                    <span class="text-[10px] md:text-[10px] font-bold px-1.5 md:px-2 py-0.5 rounded-md ${badgeClass}">${dayAbbrevID[dow]}</span>
                                    <span class="text-[10px] md:text-xs text-slate-400 font-semibold">${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}</span>
                                </div>
                                <span class="text-xs md:text-sm font-bold ${color}">${prefix}Rp ${formatRp(dayTotal)}</span>
                            </div>
                            <div class="divide-y divide-slate-50">${rowsHtml}</div>
                        </div>`;
                }).join('');
            }

            renderCategoryDetailMonthData();
            switchView('kategori-detail');
        }

        // Geser bulan yg ditampilkan di Kategori Detail (panah kiri/kanan di header) tanpa perlu
        // balik ke tab Laporan. delta: -1 = mundur 1 bulan, +1 = maju 1 bulan.
        function categoryDetailShiftMonth(delta) {
            categoryDetailMonth += delta;
            if (categoryDetailMonth < 1) { categoryDetailMonth = 12; categoryDetailYear--; }
            else if (categoryDetailMonth > 12) { categoryDetailMonth = 1; categoryDetailYear++; }
            renderCategoryDetailMonthData();
        }

        // Bagian yang BULAN-SPESIFIK dari halaman Kategori Detail: label bulan, total, & chart harian.
        // Dipisah dari openCategoryDetail() supaya bisa dipanggil ulang sendiri saat geser bulan,
        // tanpa perlu hitung ulang seluruh "Semua Riwayat Transaksi" (yg memang tidak berubah).
        function renderCategoryDetailMonthData() {
            // Bangun DOM/HTML-nya sekarang di src/ui/categories.js (dipakai juga oleh
            // tests/unit/ui-categories.test.js) -- fungsi ini tinggal wrapper tipis yang
            // menyuplai konteks (state bulan/jenis/data & helper) yang dibutuhkan. State
            // categoryDetailYear/Month/Jenis/SpecificData tetap dimiliki index.html
            // (ditulis openCategoryDetail & categoryDetailShiftMonth), modul hanya
            // membacanya. Chart & charts di-inject per pemanggilan (pola assets/budgets).
            // Nama fungsi & cara memanggilnya di tempat lain TIDAK berubah sama sekali.
            servicesModule.renderCategoryDetailMonthDataUI({
                document,
                year: categoryDetailYear, month: categoryDetailMonth, jenis: categoryDetailJenis,
                specificData: categoryDetailSpecificData,
                computeCategoryDetailMonthChart: servicesModule.computeCategoryDetailMonthChart,
                parseTgl, txIdrAmount,
                animateRupiah,
                isChartNarrow: servicesModule.isChartNarrow,
                selectSparseLabelIndices: servicesModule.selectSparseLabelIndices,
                chartGridColor, formatShortVal,
                accentColor: themeAccentColor,
                Chart, charts,
            });

            // Kartu "Proporsi Sub-Kategori" (slice proporsi sub): donat + bar persentase
            // per sub utk bulan aktif. Konteks sama persis + helper tambahan (formatRp,
            // escapeHtml, chartBorderColor utk pemisah segmen donat, rAF utk animasi bar).
            servicesModule.renderCategorySubProportion({
                document,
                year: categoryDetailYear, month: categoryDetailMonth, jenis: categoryDetailJenis,
                categoryName: document.getElementById('detail-category-name').innerText,
                specificData: categoryDetailSpecificData,
                aggregateSubCategoryShares: servicesModule.aggregateSubCategoryShares,
                chartPalette: servicesModule.pickChartPalette(appSettings.chartPalette), // Tier-3 #11: palet pilihan pengguna
                parseTgl, txIdrAmount, formatRp, escapeHtml, chartBorderColor,
                Chart, charts,
                requestAnimationFrame,
            });
        }

        // ========================== KALENDER & POPUP DETAIL TANGGAL ==========================
        function updateCalendarSummary(viewStart, viewEnd) {
            // Kalkulasi di src/domain/calendar.js; bangun DOM-nya sekarang di
            // src/ui/calendar.js (dipakai juga oleh tests/unit/ui-calendar.test.js) --
            // fungsi ini tinggal wrapper tipis yang menyuplai konteks yang dibutuhkan.
            // Nama fungsi & cara memanggilnya (callback datesSet FullCalendar)
            // TIDAK berubah sama sekali.
            servicesModule.updateCalendarSummaryUI({
                document, globalData,
                computeCalendarMonthSummary: servicesModule.computeCalendarMonthSummary,
                parseTgl, txIdrAmount, animateRupiah,
            }, viewStart, viewEnd);
        }

        // Lazy-load FullCalendar (~280KB) lewat penyisipan elemen script secara dinamis, HANYA saat
        // pertama kali dibutuhkan (dipanggil dari renderCalendar() di bawah) -- lihat catatan di
        // <head> soal kenapa TIDAK dimuat via tag script statis lagi. Promise-nya di-cache di
        // _fullCalendarLoadPromise supaya kalau renderCalendar() sempat terpanggil berkali-kali
        // sebelum load pertama selesai (mis. race antara showView('kalender') & resize handler),
        // elemen script-nya cuma disisipkan SEKALI.
        let _fullCalendarLoadPromise = null;
        function loadFullCalendarLib() {
            if (window.FullCalendar) return Promise.resolve();
            if (_fullCalendarLoadPromise) return _fullCalendarLoadPromise;
            _fullCalendarLoadPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                // v59: FullCalendar vendored lokal (vendor/) -- pinned 6.1.10, tanpa origin CDN pihak ketiga.
                script.src = './vendor/fullcalendar-6.1.10.min.js';
                script.onload = () => resolve();
                script.onerror = () => { _fullCalendarLoadPromise = null; reject(new Error('Gagal memuat FullCalendar lokal (vendor/).')); };
                document.head.appendChild(script);
            });
            return _fullCalendarLoadPromise;
        }

        async function renderCalendar(data) {
            // Bangun kalendernya sekarang di src/ui/calendar.js (dipakai juga oleh
            // tests/unit/ui-calendar.test.js) -- fungsi ini tinggal wrapper tipis yang
            // menyuplai konteks yang dibutuhkan. Catatan penting:
            // - loadFullCalendarLib (lazy-loader + cache promise) TETAP di sini &
            //   di-inject; modul memakai window.FullCalendar (bukan referensi polos)
            //   supaya aman dievaluasi kapan pun.
            // - State calendarInstance/_calendarWasMobile tetap milik index.html
            //   (dibaca handler resize & teardown logout) -- instance SAAT INI
            //   dikirim lewat ctx, instance baru dilaporkan balik lewat
            //   onInstanceReady, di titik persis assignment kode lama.
            // Nama fungsi & cara memanggilnya di tempat lain TIDAK berubah sama sekali.
            await servicesModule.renderCalendarUI({
                document, window, data,
                loadFullCalendarLib, showErrorToast,
                buildDailyCashflowMap: servicesModule.buildDailyCashflowMap,
                txIdrAmount, formatShortVal,
                accentColor: themeAccentColor,
                globalRecurring,
                projectRecurringDueDates: servicesModule.projectRecurringDueDates,
                advanceDueDate: servicesModule.advanceDueDate,
                toDateStr, todayDateStr,
                calendarInstance,
                onInstanceReady: (instance, isMobile) => { calendarInstance = instance; _calendarWasMobile = isMobile; },
                updateCalendarSummary, openCalendarDetail,
            });
        }

        function openCalendarDetail(dateStr) {
            // Bangun DOM/HTML modal detail tanggal sekarang di src/ui/calendar.js
            // (dipakai juga oleh tests/unit/ui-calendar.test.js) -- fungsi ini tinggal
            // wrapper tipis yang menyuplai konteks yang dibutuhkan. Callback
            // dateClick/eventClick kalender tetap memanggil nama global ini.
            // Nama fungsi & cara memanggilnya TIDAK berubah sama sekali.
            servicesModule.openCalendarDetailUI({
                document, dateStr, parseTgl, globalData, todayDateStr, globalRecurring,
                projectRecurringDueDates: servicesModule.projectRecurringDueDates,
                advanceDueDate: servicesModule.advanceDueDate,
                getCategoryStyle, categoryIconHtml, escapeHtml, getAccountLogo, formatRp, RECURRING_FREQ_LABEL,
            });
        }
        function closeCalendarDetail() { document.getElementById('modalCalendarDetail').classList.add('hidden'); }

        // Dibungkus typeof-check: kalau CDN Chart.js/ChartDataLabels gagal dimuat (offline, jaringan
        // korporat yang memblokir, ad-blocker, dsb), baris ini dulu langsung throw dan mematikan SISA
        // seluruh script di bawahnya secara diam-diam -- termasuk alur bootstrap login yang harusnya
        // menyembunyikan layar "Memeriksa sesi login...". Sekarang kalau Chart.js tidak tersedia,
        // aplikasi tetap lanjut jalan (cuma tampilan chart yang tidak dapat tema kustom).
        // Tier-1 #2: dijadikan FUNGSI idempoten + dipanggil ulang oleh loader lazy
        // (__mfChartLibReady) setelah Chart.js benar-benar termuat. Sejak #5 memindahkan
        // Chart.js ke loader dinamis, typeof-check di bawah selalu FALSE saat app script
        // diparse -- kustomisasi ini (font, gaya tooltip, radius bar, animasi stagger)
        // diam-diam tidak pernah diterapkan lagi. Tipuan lama: beberapa nilai tampak
        // "sudah benar" karena applyTheme() kebetulan men-set ulang Chart.defaults.color.
        // Plugin glow neon kini SATU sumber kebenaran di src/domain/chart-hud.js
        // (servicesModule.chartHud.hudGlowPlugin) -- dipasang per-chart, bukan global.

        function applyChartStyleDefaults() {
            if (typeof Chart === 'undefined') return;
            if (typeof ChartDataLabels !== 'undefined') { try { Chart.register(ChartDataLabels); } catch (e) { /* idempoten */ } }
            Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
            Chart.defaults.color = document.documentElement.classList.contains('dark') ? '#a6b4d2' : '#64748b';
            Chart.defaults.plugins.tooltip.backgroundColor = '#000000'; // hitam murni -- konsisten dgn kartu tooltip eksternal chart proporsi (kontrak #000)
            Chart.defaults.plugins.tooltip.padding = 12;
            Chart.defaults.plugins.tooltip.cornerRadius = 8;
            Chart.defaults.plugins.tooltip.titleFont = { size: 13, weight: 'bold' };
            Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };
            Chart.defaults.elements.bar.borderRadius = 8; Chart.defaults.elements.bar.borderSkipped = false;

            // Animasi masuk yang lebih halus & "muncul satu-satu" (stagger) utk semua chart —
            // batang/titik/slice tampil berurutan alih-alih serentak, terasa lebih hidup & modern.
            Chart.defaults.animation.duration = 850;
            Chart.defaults.animation.easing = 'easeOutQuart';
            Chart.defaults.animation.delay = (context) => {
                let delay = 0;
                if (context.type === 'data' && context.mode === 'default' && !context.dropped) {
                    delay = context.dataIndex * 35 + (context.datasetIndex || 0) * 80;
                    context.dropped = true;
                }
                return delay;
            };
        }
        applyChartStyleDefaults(); // kompatibilitas kalau Chart suatu saat kembali dimuat sinkron
        
        const cutePaletteOut = ['#f472b6', '#a78bfa', '#22d3ee', '#fbbf24', '#fb7185', '#38bdf8', '#818cf8', '#fb923c', '#e879f9'];

        // Label angka pada chart batang ditaruh DI LUAR batang (di atas, di atas latar kartu),
        // jadi warna batang yang pastel/medium (dioptimalkan utk fill, bukan teks) perlu dipetakan
        // ke warna teks yang kontras terhadap LATAR KARTU -- terang (kartu putih) map ke versi
        // gelap, gelap (kartu midnight neon) map ke versi terang. Ini memastikan angka selalu
        // mudah dibaca di kedua tema (tidak tumpang tindih secara kontras).
        const chartLabelColorMap = {
            light: {
                '#34d399': '#047857', '#10b981': '#047857', '#4ade80': '#065f46', '#2dd4bf': '#0f766e',
                '#fb7185': '#be123c', '#f43f5e': '#be123c', '#f87171': '#b91c1c',
                '#fbbf24': '#b45309', '#f59e0b': '#b45309', '#fb923c': '#c2410c',
                '#c7d2fe': '#4f46e5',
                '#22d3ee': '#0e7490', '#38bdf8': '#0369a1', '#60a5fa': '#1d4ed8',
                '#a78bfa': '#6d28d9', '#8b5cf6': '#6d28d9', '#e879f9': '#a21caf',
                '#f472b6': '#be185d', '#ec4899': '#be185d', '#c084fc': '#7e22ce',
                '#818cf8': '#4338ca'
            },
            dark: {
                '#34d399': '#a7f3d0', '#10b981': '#6ee7b7', '#4ade80': '#a7f3d0', '#2dd4bf': '#99f6e4',
                '#fb7185': '#fecdd3', '#f43f5e': '#fecdd3', '#f87171': '#fecaca',
                '#fbbf24': '#fde68a', '#f59e0b': '#fde68a', '#fb923c': '#fed7aa',
                '#c7d2fe': '#e0e7ff',
                '#22d3ee': '#a5f3fc', '#38bdf8': '#bae6fd', '#60a5fa': '#bfdbfe',
                '#a78bfa': '#ddd6fe', '#8b5cf6': '#ddd6fe', '#e879f9': '#f5d0fe',
                '#f472b6': '#fbcfe8', '#ec4899': '#fbcfe8', '#c084fc': '#e9d5ff',
                '#818cf8': '#c7d2fe'
            }
        };
        function chartLabelColor(bg) {
            const isDark = document.documentElement.classList.contains('dark');
            const inBar = themeAccentColor('incomeBar'), in500 = themeAccentColor('income500');
            if ((inBar && bg === inBar) || (in500 && bg === in500)) return themeAccentColor(isDark ? 'incomeLabelDark' : 'incomeLabel') || (isDark ? '#a7f3d0' : '#047857');
            const map = isDark ? chartLabelColorMap.dark : chartLabelColorMap.light;
            return map[bg] || bg;
        }
        const CUTE_PALETTE_IN_DEFAULT = ['#34D399', '#4ADE80', '#10B981', '#2DD4BF', '#6EE7B7', '#A7F3D0'];
        function getCutePaletteIn() { return themeAccentColor('paletteIn') || CUTE_PALETTE_IN_DEFAULT; }

        // Debounce resize/orientationchange, dan hanya render ulang chart di tab yang SEDANG
        // terlihat — sebelumnya processDataForUI()/renderReportTab() jalan di setiap event resize
        // TANPA PANDANG tab mana yang aktif, sehingga chart bisa ter-render ulang saat kontainernya
        // masih tersembunyi (display:none) dan Chart.js salah mengukur lebar/tingginya. Ini salah
        // satu penyebab chart donat tampil offset/tidak pas kotaknya, terutama setelah rotasi layar.
        let _responsiveListenersAttached = false;
        function setupResponsiveRerender() {
            if (_responsiveListenersAttached) return; // hanya pasang sekali walau initApp() dipanggil ulang (login/logout berkali-kali dalam satu tab)
            _responsiveListenersAttached = true;
            let _resizeDebounceTimer = null;
            function handleResponsiveRerender() {
                if (globalData.length === 0) return;
                if (document.getElementById('view-dashboard').classList.contains('block')) { processDataForUI(globalData); }
                if (document.getElementById('view-laporan').classList.contains('block')) { renderReportTab(); }
                if (document.getElementById('view-kalender').classList.contains('block')) {
                    // Kalender: kalau breakpoint mobile/desktop TIDAK berubah, cukup panggil
                    // updateSize() (menyesuaikan ukuran tanpa reset bulan yang sedang dilihat).
                    // Destroy+recreate penuh (lewat renderCalendar) cuma kalau breakpoint-nya
                    // benar-benar berubah, karena toolbar & aspect ratio-nya beda antara mobile/desktop.
                    const isMobileNow = window.innerWidth < 768;
                    if (calendarInstance && isMobileNow === _calendarWasMobile) {
                        calendarInstance.updateSize();
                    } else {
                        renderCalendar(globalData);
                    }
                }
                if (document.getElementById('view-akun-detail').classList.contains('block')) { renderAccountDetailCharts(); }
            }
            window.addEventListener('resize', () => {
                if (_resizeDebounceTimer) clearTimeout(_resizeDebounceTimer);
                _resizeDebounceTimer = setTimeout(handleResponsiveRerender, 200);
            });
            window.addEventListener('orientationchange', () => {
                // delay lebih panjang: sebagian browser mobile melaporkan dimensi viewport yang belum
                // final tepat saat orientationchange baru terpicu.
                if (_resizeDebounceTimer) clearTimeout(_resizeDebounceTimer);
                _resizeDebounceTimer = setTimeout(handleResponsiveRerender, 350);
            });
        }

        // ========================== PULL-TO-REFRESH & TOMBOL KEMBALI KE ATAS ==========================
        // Dua kebiasaan umum di app mobile: tarik layar ke bawah dari posisi paling atas utk sinkron
        // ulang data, dan tombol muncul buat langsung lompat ke atas kalau sudah scroll jauh ke bawah.

        let _pullToRefreshAttached = false;
        function setupPullToRefresh() {
            if (_pullToRefreshAttached) return; // sekali saja walau initApp() dipanggil ulang (login/logout)
            _pullToRefreshAttached = true;

            const indicator = document.getElementById('pullToRefreshIndicator');
            const icon = document.getElementById('pullToRefreshIcon');
            if (!indicator || !icon) return;

            const PULL_THRESHOLD = 70;  // jarak tarik (px) sebelum dianggap "lepas = refresh"
            const MAX_PULL = 110;       // batas atas indikator boleh turun, biar tidak kelewat jauh
            const DAMPING = 0.5;        // jarak jari dikalikan ini, biar tarikannya terasa "berbobot"
            let startY = 0, pulling = false, refreshing = false, lastPull = 0;

            function getActiveScrollArea() { return document.querySelector('#appShell .content-area.block'); }

            // Modal-modal ini menutupi seluruh layar tapi BUKAN bagian dari .content-area manapun --
            // tanpa pengecekan ini, menggeser jari di dalam modal yang sedang terbuka bisa salah
            // kepicu jadi gestur pull-to-refresh untuk konten DI BALIK modal itu.
            const MODAL_IDS = ['modalConfirm', 'modalCalendarDetail', 'modalCategorySelector', 'modalRecurringForm', 'modalRecurringList', 'modalAssetDetail', 'modalProfile', 'modalAccount', 'modalBudget', 'modalAsset', 'modalManualNav', 'modalForm'];
            function isAnyModalOpen() {
                return MODAL_IDS.some(function (id) { const el = document.getElementById(id); return el && !el.classList.contains('hidden'); });
            }

            function setIndicatorPull(pull) {
                lastPull = pull;
                indicator.style.opacity = String(Math.min(pull / PULL_THRESHOLD, 1));
                indicator.style.transform = 'translateY(' + (pull - 60) + 'px)';
                const pastThreshold = pull >= PULL_THRESHOLD;
                icon.style.transform = pastThreshold ? 'rotate(180deg)' : 'rotate(0deg)';
                icon.classList.toggle('text-indigo-500', pastThreshold);
                icon.classList.toggle('text-slate-400', !pastThreshold);
            }

            function resetIndicator() {
                lastPull = 0;
                indicator.style.opacity = '0';
                indicator.style.transform = 'translateY(-60px)';
                icon.className = 'fas fa-arrow-down text-slate-400 text-sm';
                icon.style.transition = 'transform 0.15s ease, color 0.15s ease';
                icon.style.transform = 'rotate(0deg)';
            }

            document.addEventListener('touchstart', function (e) {
                if (refreshing) return;
                if (document.getElementById('appShell').classList.contains('hidden')) { pulling = false; return; } // masih di layar login
                if (isAnyModalOpen()) { pulling = false; return; }
                const area = getActiveScrollArea();
                if (!area || area.scrollTop > 0) { pulling = false; return; } // cuma aktif kalau BENAR-BENAR di posisi paling atas
                startY = e.touches[0].clientY;
                pulling = true;
            }, { passive: true });

            document.addEventListener('touchmove', function (e) {
                if (!pulling || refreshing) return;
                const area = getActiveScrollArea();
                if (!area || area.scrollTop > 0) { pulling = false; resetIndicator(); return; }
                const delta = (e.touches[0].clientY - startY) * DAMPING;
                if (delta <= 0) { resetIndicator(); return; }
                e.preventDefault(); // cegah pull-to-refresh/overscroll BAWAAN browser ikut kepicu bareng punya kita
                setIndicatorPull(Math.min(delta, MAX_PULL));
            }, { passive: false });

            document.addEventListener('touchend', function () {
                if (!pulling || refreshing) { pulling = false; return; }
                pulling = false;
                if (lastPull < PULL_THRESHOLD) { resetIndicator(); return; }

                refreshing = true;
                indicator.style.opacity = '1';
                indicator.style.transform = 'translateY(16px)';
                icon.className = 'fas fa-circle-notch fa-spin text-indigo-500 text-sm';
                loadData();

                // loadData() sendiri yang mengatur kapan overlay #loading tampil/hilang -- indikator
                // pull-to-refresh ini dipantau ikut mengikuti status itu, bukan diberi durasi tetap
                // sendiri, supaya benar-benar mencerminkan kapan sinkronisasi sungguhan selesai.
                const waitForLoadDone = setInterval(function () {
                    const loadingEl = document.getElementById('loading');
                    // slice design #3: loadData kini bisa sinkron via SKELETON (overlay tak menyala)
                    // -- cek body[data-sync-loading] dulu, fallback ke cek overlay lama.
                    if (!document.body.dataset.syncLoading && (!loadingEl || loadingEl.style.display === 'none' || loadingEl.style.display === '')) {
                        clearInterval(waitForLoadDone);
                        refreshing = false;
                        resetIndicator();
                    }
                }, 150);
                // Jaring pengaman: paling lama 10 detik, supaya indikator tidak nyangkut selamanya
                // kalau status loading karena suatu sebab tidak pernah balik "selesai".
                setTimeout(function () {
                    clearInterval(waitForLoadDone);
                    if (refreshing) { refreshing = false; resetIndicator(); }
                }, 10000);
            });

            resetIndicator();
        }

        let _scrollToTopAttached = false;
        function updateScrollToTopVisibility() {
            const btn = document.getElementById('scrollToTopBtn');
            if (!btn) return;
            const area = document.querySelector('#appShell .content-area.block');
            const show = !!(area && area.scrollTop > 400);
            btn.classList.toggle('hidden', !show);
            btn.classList.toggle('flex', show);
        }
        function setupScrollToTopButton() {
            if (_scrollToTopAttached) return; // sekali saja walau initApp() dipanggil ulang (login/logout)
            _scrollToTopAttached = true;
            // capture:true -- supaya event scroll dari elemen .content-area di dalam #appShell tetap
            // "kedengaran" di sini, walau event scroll sendiri tidak bubbling ke leluhurnya.
            document.addEventListener('scroll', function (e) {
                if (!e.target || !e.target.classList || !e.target.classList.contains('content-area')) return;
                updateScrollToTopVisibility();
            }, true);
        }
        function scrollActiveViewToTop() {
            const area = document.querySelector('#appShell .content-area.block');
            if (area) area.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // ---------- AKSESIBILITAS MODAL (slice design #2) ----------
        // Satu titik pusat, TANPA menyentuh 16 fungsi open/close bespoke: setiap modal
        // [role=dialog] diberi nama aksesibel (aria-label dari heading), lalu
        // MutationObserver class 'hidden' menangkap buka/tutup utk (1) memindahkan
        // fokus ke kontrol pertama saat dibuka, (2) mengembalikan fokus ke elemen
        // pembuka saat ditutup (nested: fokus kembali ke modal induk).
        let _modalA11yReady = false, _modalA11yEls = [], _modalA11yOpen = [];
        function setupModalA11y() {
            if (_modalA11yReady) return; _modalA11yReady = true;
            _modalA11yEls = Array.prototype.slice.call(document.querySelectorAll('[role="dialog"][aria-modal="true"]'));
            _modalA11yEls.forEach((m) => {
                const name = servicesModule.modalAccessibleName(m);
                if (name && !m.getAttribute('aria-label')) m.setAttribute('aria-label', name);
                let wasOpen = !m.classList.contains('hidden');
                let opener = null;
                new MutationObserver(() => {
                    const open = !m.classList.contains('hidden');
                    if (open && !wasOpen) {
                        opener = document.activeElement;
                        _modalA11yOpen.push(m);
                        const f = servicesModule.getFocusable(m);
                        const firstField = f.find((x) => ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(x.tagName) !== -1) || f[0];
                        if (firstField) firstField.focus();
                        else { m.setAttribute('tabindex', '-1'); m.focus(); }
                    } else if (!open && wasOpen) {
                        _modalA11yOpen = _modalA11yOpen.filter((x) => x !== m);
                        if (_modalA11yOpen.length) {
                            const parent = _modalA11yOpen[_modalA11yOpen.length - 1];
                            const pf = servicesModule.getFocusable(parent);
                            const pField = pf.find((x) => ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(x.tagName) !== -1) || pf[0];
                            if (pField) pField.focus();
                        } else if (opener && document.contains(opener)) {
                            try { opener.focus(); } catch (err) { /* opener sudah tidak bisa difokuskan */ }
                        }
                        opener = null;
                    }
                    wasOpen = open;
                }).observe(m, { attributes: true, attributeFilter: ['class'] });
            });
        }

        // Titik masuk utama aplikasi setelah status login terkonfirmasi. Dipanggil langsung oleh
        // alur bootstrap (lihat bagian AUTH & BOOTSTRAP di bawah) -- BUKAN lewat window.onload.
        // Sebelumnya app.js dimuat lewat <script> yang disisipkan secara dinamis SETELAH pengecekan
        // sesi async selesai; assignment "window.onload = ..." di titik itu berisiko tidak pernah
        // terpanggil kalau event 'load' bawaan browser sudah keburu selesai lebih dulu (mis. koneksi
        // cepat / resource CDN sudah ke-cache), membuat aplikasi diam saja di layar loading selamanya.
        // Memanggil fungsi ini secara eksplisit dari alur async login menghindari race condition itu.
        function initApp() {
            buildLookupTable();
            setupModalA11y(); // a11y modal: aria-label + focus trap/restore (sekali, idempoten)
            renderSettings(); setDateHeader(); updateFormOptions(); loadData();
            setupResponsiveRerender();
            updateOfflineBanner();
            updateThemeButtonsUI(getStoredThemePref());
            updateChartPaletteButtonsUI(appSettings.chartPalette || 'default');
            updateNominalToggleUI();
            setupPullToRefresh();
            setupScrollToTopButton();
        }

        // ========================== AUTH & BOOTSTRAP (login <-> dashboard, satu halaman) ==========================
        // Versi gabungan "1 file": layar Login dan Dashboard sekarang adalah dua <div> di halaman
        // yang sama (#loginView dan #appShell), ditukar lewat JS alih-alih navigasi antar file HTML
        // terpisah seperti sebelumnya (login.html <-> index.html).

        // Menyembunyikan authGate lewat fungsi bersama ini, BUKAN classList.add('hidden') --
        // elemen authGate punya atribut inline `style="display:flex;..."` (lihat markup-nya),
        // dan style inline SELALU menang atas class manapun (termasuk class "hidden" bawaan
        // Tailwind) berapa pun spesifisitasnya. Sebelumnya kode ini memakai classList.add('hidden')
        // yang SECARA VISUAL TIDAK PERNAH BEREFEK di elemen ini -- authGate tetap tampil menutupi
        // seluruh layar selamanya walau proses cek sesi di baliknya sudah selesai. Dihapus total
        // dari DOM sekali saja supaya tidak ada lagi risiko konflik specificity seperti ini.
        function hideAuthGate() {
            const gate = document.getElementById('authGate');
            if (gate) gate.remove();
        }

        function showLoginView() {
            resetAppState();
            document.getElementById('appShell').classList.add('hidden');
            hideAuthGate();
            document.getElementById('loginView').classList.remove('hidden');
            const form = document.getElementById('authForm'); if (form) form.reset();
            if (typeof hideAuthMessages === 'function') hideAuthMessages();
            if (typeof setAuthMode === 'function') setAuthMode('login');
        }

        function showAppShell() {
            document.getElementById('loginView').classList.add('hidden');
            hideAuthGate();
            document.getElementById('appShell').classList.remove('hidden');
        }

        // Mengosongkan seluruh state di memori (data transaksi/aset/pengaturan akun sebelumnya)
        // setiap kali kembali ke layar login. PENTING karena aplikasi ini dipakai beberapa akun
        // berbeda di perangkat yang sama (lihat README) -- tanpa reset ini, dan karena sekarang
        // login/logout tidak lagi memuat ulang seluruh halaman, data akun sebelumnya bisa saja
        // sempat "kelihatan sekilas" kalau akun lain login di tab yang sama tanpa refresh browser.
        function resetAppState() {
            globalData = [];
            globalAssets = [];
            cloudBudgets = {};
            globalRecurring = [];
            _recurringProcessed = false;
            appSettings = deepCloneDict(defaultSettings);
            ensureSettingsShape();
            currentSession = null;
            profileAvatarOverride = undefined;
            Object.keys(charts).forEach(k => { if (charts[k]) { try { charts[k].destroy(); } catch (e) {} } });
            charts = {};
            if (calendarInstance) { try { calendarInstance.destroy(); } catch (e) {} calendarInstance = null; }
        }

        // Dipasang SEKALI SAJA (bukan tiap login) supaya tombol keluar tidak terpasang listener
        // berkali-kali kalau user login/logout beberapa kali dalam satu sesi tab yang sama.
        function initStaticUIListeners() {
            document.querySelectorAll('[data-logout-btn]').forEach(el => {
                // Tier-3 #10: saat keluar, minta service worker membuang cache data
                // (GET /rest/v1) supaya sesi berikutnya di perangkat ini tidak bisa
                // membaca sisa data akun lama.
                if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({ type: 'MYFINANCE_CLEAR_DATA_CACHE' });
                }
                el.addEventListener('click', () => auth.signOut());
            });
        }

        // Dipanggil setiap kali sesi login baru aktif (baik saat halaman pertama dibuka dengan
        // sesi yang masih valid, maupun tepat setelah submit form login/daftar berhasil).
        function applySessionToUI(session) {
            currentSession = session;
            document.querySelectorAll('[data-user-email]').forEach(el => { el.textContent = session.user.email; });
            renderUserIdentity();
        }

        // ---------- FORM LOGIN / DAFTAR ----------
        // Deklarasi ini HARUS ada SEBELUM bootstrapAuth() dipanggil di bawah -- initLoginForm()
        // (dipanggil dari dalam bootstrapAuth, sebelum baris await manapun) langsung mengisi kedua
        // variabel ini, jadi kalau "let" ini baru dideklarasikan SETELAH titik itu, JS akan
        // melempar "Cannot access before initialization" (temporal dead zone) -- dan karena itu
        // terjadi di awal alur bootstrap, authGate/"Memeriksa sesi login..." tidak akan pernah
        // hilang sama sekali.
        let hideAuthMessages, setAuthMode;

        (async function bootstrapAuth() {
            // Langkah PERTAMA, sebelum apa pun lain di fungsi ini -- lihat initSupabaseClient()
            // di bagian "KONEKSI SUPABASE" di atas. Dibungkus try/catch secara eksplisit (bukan
            // dibiarkan lempar ke unhandledrejection global) supaya kalau modulnya gagal dimuat,
            // alur berhenti bersih di sini -- tanpa ini, baris2 di bawah akan melempar error yang
            // membingungkan ("Cannot read properties of undefined") karena authModule masih kosong.
            try {
                await initSupabaseClient();
            } catch (error) {
                showFallbackError(error);
                return;
            }

            initStaticUIListeners();
            initLoginForm();

            // Titik terpusat untuk semua jalur logout (tombol manual ATAU sesi kedaluwarsa/dicabut
            // dari perangkat lain) -- supaya perilakunya konsisten di mana pun logout terjadi.
            // SENGAJA tetap cuma bereaksi ke event SIGNED_OUT (persis seperti sebelumnya), BUKAN
            // pakai createAuthLifecycle() dari src/auth/lifecycle.js -- lifecycle itu memanggil
            // onAuthenticated di SETIAP event yang punya session (termasuk TOKEN_REFRESHED yang
            // otomatis terjadi berkala), yang kalau dipakai di sini berarti showAppShell()+initApp()
            // -- dan seluruh loadData() di dalamnya -- akan terulang tiap token refresh. Itu
            // perubahan perilaku nyata yang tidak dilakukan diam-diam di langkah Auth ini.
            authModule.onAuthStateChange(({ event }) => {
                if (event === 'SIGNED_OUT') {
                    showLoginView();
                }
            });

            const session = await auth.getSession();
            if (session) {
                applySessionToUI(session);
                showAppShell();
                initApp();
            } else {
                showLoginView();
            }
        })();

        // Dibungkus dalam fungsi (bukan kode top-level) supaya variabel seperti "mode", "form", dsb
        // tidak mencemari scope global bersama seluruh variabel app.js lainnya di file gabungan ini.
        function initLoginForm() {
            let mode = 'login'; // 'login' | 'signup'

            const tabLogin = document.getElementById('tab-login');
            const tabSignup = document.getElementById('tab-signup');
            const form = document.getElementById('authForm');
            const emailInput = document.getElementById('authEmail');
            const passwordInput = document.getElementById('authPassword');
            const submitLabel = document.getElementById('authSubmitLabel');
            const submitSpinner = document.getElementById('authSubmitSpinner');
            const submitBtn = document.getElementById('authSubmitBtn');
            const errorBox = document.getElementById('authError');
            const errorMsg = document.getElementById('authErrorMsg');
            const successBox = document.getElementById('authSuccess');
            const successMsg = document.getElementById('authSuccessMsg');
            const strengthWrap = document.getElementById('authPasswordStrength');
            const strengthLabel = document.getElementById('authPasswordStrengthLabel');
            const strengthBars = [document.getElementById('pwBar1'), document.getElementById('pwBar2'), document.getElementById('pwBar3'), document.getElementById('pwBar4')];
            if (!form) return; // jaga-jaga kalau markup login belum siap

            // Indikator kekuatan password -- cuma dipakai saat mode Daftar. Ini bantuan visual
            // ringan, BUKAN validasi keamanan sisi server (aturan sesungguhnya tetap dari Supabase Auth).
            const PW_STRENGTH_META = [
                { label: '\u00A0', color: 'bg-slate-200' },
                { label: 'Lemah', color: 'bg-rose-400' },
                { label: 'Cukup', color: 'bg-amber-400' },
                { label: 'Baik', color: 'bg-blue-400' },
                { label: 'Kuat', color: 'bg-emerald-500' }
            ];
            function computePasswordStrength(pw) {
                if (!pw) return 0;
                let score = 0;
                if (pw.length >= 6) score++;
                if (pw.length >= 10) score++;
                if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
                if (/[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
                return Math.min(score, 4);
            }
            function updatePasswordStrength() {
                if (!strengthWrap) return;
                const score = computePasswordStrength(passwordInput.value);
                const meta = PW_STRENGTH_META[score];
                strengthBars.forEach((bar, i) => {
                    if (!bar) return;
                    bar.classList.remove('bg-slate-200', 'bg-rose-400', 'bg-amber-400', 'bg-blue-400', 'bg-emerald-500');
                    bar.classList.add(i < score ? meta.color : 'bg-slate-200');
                });
                if (strengthLabel) strengthLabel.textContent = meta.label;
            }
            passwordInput.addEventListener('input', updatePasswordStrength);

            function setMode(newMode) {
                mode = newMode;
                tabLogin.classList.toggle('active', mode === 'login');
                tabSignup.classList.toggle('active', mode === 'signup');
                submitLabel.textContent = mode === 'login' ? 'Masuk' : 'Daftar';
                passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
                if (strengthWrap) strengthWrap.classList.toggle('hidden', mode !== 'signup');
                if (mode === 'signup') updatePasswordStrength();
                hideMessages();
            }
            function hideMessages() {
                errorBox.classList.add('hidden');
                successBox.classList.add('hidden');
            }
            function showError(msg) {
                errorMsg.textContent = msg;
                errorBox.classList.remove('hidden');
                successBox.classList.add('hidden');
            }
            function showSuccess(msg) {
                successMsg.textContent = msg;
                successBox.classList.remove('hidden');
                errorBox.classList.add('hidden');
            }
            function setLoading(loading) {
                submitBtn.disabled = loading;
                submitSpinner.classList.toggle('hidden', !loading);
            }

            // Diekspos supaya showLoginView() (dipakai dari luar fungsi ini) bisa mereset tampilan form.
            hideAuthMessages = hideMessages;
            setAuthMode = setMode;

            tabLogin.addEventListener('click', () => setMode('login'));
            tabSignup.addEventListener('click', () => setMode('signup'));

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                hideMessages();
                setLoading(true);
                const email = emailInput.value.trim();
                const password = passwordInput.value;
                try {
                    if (mode === 'login') {
                        const result = await auth.signIn(email, password);
                        applySessionToUI(result.session);
                        showAppShell();
                        initApp();
                    } else {
                        const result = await auth.signUp(email, password);
                        if (result.session) {
                            // Konfirmasi email dimatikan di project Supabase -> langsung masuk.
                            applySessionToUI(result.session);
                            showAppShell();
                            initApp();
                        } else {
                            showSuccess('Pendaftaran berhasil! Cek email kamu untuk link konfirmasi sebelum masuk.');
                            setMode('login');
                        }
                    }
                } catch (err) {
                    showError(auth.translateError(err));
                } finally {
                    setLoading(false);
                }
            });
        }

    

/**
 * src/domain/app-lock.js — Kunci aplikasi (App Lock, v92 / Fase 1A).
 *
 * Domain MURNI: tanpa DOM, tanpa network, tanpa localStorage, tanpa Web Crypto.
 * Semua fungsi deterministik & ter-unit-test (tests/unit/app-lock-domain.test.js).
 *
 * MODEL ANCAMAN (jujur & terdokumentasi): kunci ini melindungi dari "mata
 * orang di sekitar" (HP dipinjam sejenak, layar terbuka di meja) — sama seperti
 * app-lock di aplikasi mobile umumnya. Ia BUKAN perlindungan terhadap penyerang
 * yang punya akses penuh ke DevTools/perangkat: PIN hash disimpan di tabel
 * settings milik user sendiri (bisa dibaca user itu sendiri via network tab),
 * dan UI-lock selalu bisa dilewati lewat console di lingkungan yang tidak
 * dipercaya. Untuk ancaman itu, perlindungannya tetap password akun Supabase.
 *
 * PENYIMPANAN (keputusan desain):
 * - SOURCE OF TRUTH konfigurasi = field `app_lock` di JSON appSettings (tabel
 *   settings) -> ikut persistSettings(), ikut roaming antar perangkat, ikut
 *   backup/restore JSON.
 * - GATE SAAT BOOT memakai CACHE LOKAL per-user (localStorage) karena appSettings
 *   baru terisi SETELAH loadData() — sementara kunci harus sudah menghalang
 *   SEBELUM appShell/isi data ditampilkan. Orkestrasi cache ada di app.src.js;
 *   modul ini hanya mendefinisikan bentuk & validasinya.
 * - State lockout (jumlah gagal & cooldown) sengaja HANYA per-perangkat
 *   (localStorage) — brute force terjadi di perangkat fisik.
 *
 * HASH: SHA-256(PIN) murni-JS (bukan crypto.subtle yang async) supaya bisa
 * diverifikasi sinkron saat boot & ter-test identik di Node maupun browser.
 * PIN 6 digit — ruang brute force 10^6; hash+salt cukup, kecepatan bukan tujuan.
 */

/** Kebijakan default konfigurasi kunci (di-merge dengan data user). */
export const APP_LOCK_DEFAULTS = {
    enabled: false,
    salt: '',
    hash: '',
    auto_lock_minutes: 5, // 0 = hanya kunci saat aplikasi DIBUKA (page load), >0 = + timer idle
    biometric_enabled: false,
    credential_id: null, // LEGACY (v92-v98): cermin dari credentials[0].id, lihat catatan di bawah
    credentials: [], // v99: daftar kredensial WebAuthn PER PERANGKAT
};

/**
 * BUG v92-v98 YANG DIPERBAIKI DI v99 — kenapa `credentials` harus berupa DAFTAR:
 *
 * Konfigurasi ini SATU objek yang ikut roaming lewat tabel settings, tapi
 * kredensial WebAuthn platform authenticator TERIKAT PERANGKAT: sidik jari yang
 * didaftarkan di laptop secara fisik tidak ada di HP. Dengan satu slot
 * `credential_id`, mendaftar di laptop berarti:
 *   1. HP menarik setelan yang sama, melihat biometrik "sudah aktif", sehingga
 *      Pengaturan di HP hanya menawarkan "Matikan" -- Face ID TIDAK PERNAH bisa
 *      didaftarkan di HP sama sekali;
 *   2. tombol buka-dengan-biometrik di HP memanggil allowCredentials berisi
 *      kredensial laptop -> NotAllowedError -> terlihat seperti "Face ID rusak";
 *   3. menekan "Matikan" di HP ikut menghapus biometrik laptop.
 * Karena itu kredensial disimpan sebagai daftar, dan setiap perangkat mendaftar
 * sendiri. `credential_id` tetap ditulis sebagai cermin entri pertama supaya
 * versi app lama yang masih ter-cache di perangkat lain tidak langsung rusak.
 */
export const MAX_BIOMETRIC_CREDENTIALS = 10;

/** Satu kredensial = { id (base64 rawId), label (nama perangkat), added_at (ISO) }. */
function normalizeCredential(raw) {
    const c = raw && typeof raw === 'object' ? raw : {};
    const id = typeof c.id === 'string' && c.id ? c.id : null;
    if (!id) return null;
    return {
        id,
        label: typeof c.label === 'string' && c.label ? c.label.slice(0, 60) : 'Perangkat',
        added_at: typeof c.added_at === 'string' ? c.added_at : '',
    };
}

/**
 * Normalisasi daftar kredensial + MIGRASI dari bentuk lama satu-slot.
 * Duplikat id dibuang (id pertama menang), dipotong di MAX_BIOMETRIC_CREDENTIALS.
 */
export function normalizeCredentialList(rawList, legacyCredentialId) {
    const list = Array.isArray(rawList) ? rawList : [];
    const out = [];
    const seen = new Set();
    for (const item of list) {
        const c = normalizeCredential(item);
        if (!c || seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c);
        if (out.length >= MAX_BIOMETRIC_CREDENTIALS) break;
    }
    // Migrasi: konfigurasi lama hanya punya credential_id tunggal.
    const legacy = typeof legacyCredentialId === 'string' && legacyCredentialId ? legacyCredentialId : null;
    if (legacy && !seen.has(legacy) && out.length < MAX_BIOMETRIC_CREDENTIALS) {
        out.push({ id: legacy, label: 'Perangkat pertama', added_at: '' });
    }
    return out;
}

/** Kebijakan lockout: setelah 5x salah berturut-turut, cooldown 30 detik. */
export const LOCKOUT_MAX_FAILS = 5;
export const LOCKOUT_COOLDOWN_MS = 30000;

/**
 * Normalisasi konfigurasi dari penyimpanan apa pun (cloud/local/backup lama):
 * selalu kembalikan bentuk lengkap dengan tipe aman — jangan pernah percaya
 * JSON mentah. Unknown key diabaikan (bukan error) supaya restore backup lama
 * tidak pernah melempar.
 */
export function normalizeLockConfig(raw) {
    const cfg = raw && typeof raw === 'object' ? raw : {};
    const minutes = Number(cfg.auto_lock_minutes);
    const credentials = normalizeCredentialList(cfg.credentials, cfg.credential_id);
    return {
        enabled: cfg.enabled === true,
        salt: typeof cfg.salt === 'string' ? cfg.salt : '',
        hash: typeof cfg.hash === 'string' ? cfg.hash : '',
        auto_lock_minutes: Number.isFinite(minutes) && minutes >= 0 ? Math.floor(minutes) : APP_LOCK_DEFAULTS.auto_lock_minutes,
        // DITURUNKAN dari daftar, bukan dipercaya apa adanya: flag true tanpa satu
        // pun kredensial adalah state mustahil yang dulu bikin UI menawarkan
        // "Matikan" di perangkat yang belum pernah mendaftar.
        biometric_enabled: credentials.length > 0,
        credential_id: credentials.length > 0 ? credentials[0].id : null, // cermin utk versi app lama
        credentials,
    };
}

/** Semua rawId (base64) yang boleh dipakai membuka -- untuk allowCredentials WebAuthn. */
export function biometricCredentialIds(cfg) {
    return normalizeLockConfig(cfg).credentials.map((c) => c.id);
}

/** Apakah kredensial milik PERANGKAT INI (id dari penanda lokal) terdaftar di cloud? */
export function hasBiometricCredential(cfg, id) {
    if (typeof id !== 'string' || !id) return false;
    return biometricCredentialIds(cfg).includes(id);
}

/** Tambah kredensial perangkat baru (idempoten per id). Mengembalikan cfg BARU. */
export function addBiometricCredential(cfg, entry) {
    const base = normalizeLockConfig(cfg);
    const c = normalizeCredential(entry);
    if (!c) return base;
    if (base.credentials.some((x) => x.id === c.id)) return base;
    // Perangkat terbaru di depan supaya cermin credential_id (untuk app versi
    // lama) menunjuk perangkat yang paling mungkin sedang dipakai.
    const credentials = [c, ...base.credentials].slice(0, MAX_BIOMETRIC_CREDENTIALS);
    return { ...base, credentials, biometric_enabled: true, credential_id: credentials[0].id };
}

/** Cabut SATU perangkat (dipakai tombol "Matikan di perangkat ini"). */
export function removeBiometricCredential(cfg, id) {
    const base = normalizeLockConfig(cfg);
    const credentials = base.credentials.filter((c) => c.id !== id);
    return {
        ...base,
        credentials,
        biometric_enabled: credentials.length > 0,
        credential_id: credentials.length > 0 ? credentials[0].id : null,
    };
}

/** Cabut SEMUA perangkat sekaligus. */
export function clearBiometricCredentials(cfg) {
    return { ...normalizeLockConfig(cfg), credentials: [], biometric_enabled: false, credential_id: null };
}

/**
 * Nama biometrik yang benar menurut perangkat. Menyebut "sidik jari" di iPhone
 * itu salah sekaligus membingungkan -- pengguna mencari Face ID.
 */
export function biometricLabel(userAgent) {
    const ua = String(userAgent || '');
    if (/iPhone|iPad|iPod/i.test(ua)) return 'Face ID / Touch ID';
    if (/Macintosh/i.test(ua)) return 'Touch ID';
    if (/Android/i.test(ua)) return 'sidik jari / face unlock';
    if (/Windows/i.test(ua)) return 'Windows Hello';
    return 'biometrik';
}

/** Label perangkat yang manusiawi untuk daftar kredensial. */
export function deviceLabelFromUserAgent(userAgent) {
    const ua = String(userAgent || '');
    if (/iPad/i.test(ua)) return 'iPad';
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/Android/i.test(ua)) return 'Android';
    if (/Macintosh/i.test(ua)) return 'Mac';
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Perangkat';
}

/**
 * Ringkasan status untuk UI Pengaturan. Dipisah jadi fungsi murni supaya
 * kombinasi "aktif di sini / aktif di tempat lain / belum sama sekali" bisa
 * diuji tanpa DOM -- inilah kombinasi yang salah dibaca sampai v98.
 */
export function describeBiometricState(cfg, thisDeviceCredentialId) {
    const c = normalizeLockConfig(cfg);
    const enrolledHere = hasBiometricCredential(c, thisDeviceCredentialId);
    const otherDevices = c.credentials.filter((x) => x.id !== thisDeviceCredentialId).length;
    return {
        enrolledHere,
        otherDevices,
        total: c.credentials.length,
        // Tombol "Aktifkan" WAJIB tetap muncul selama perangkat ini belum
        // terdaftar, walau perangkat lain sudah -- ini inti bug v92-v98.
        canEnrollHere: !enrolledHere && c.credentials.length < MAX_BIOMETRIC_CREDENTIALS,
    };
}

/** Kunci aktif = enabled + salt + hash terisi (hash tanpa salt = data rusak -> jangan kunci user keluar). */
export function isLockEnabled(cfg) {
    const c = normalizeLockConfig(cfg);
    return c.enabled && !!c.salt && !!c.hash;
}

/** PIN valid = tepat 6 digit angka. */
export function isValidPinFormat(pin) {
    return typeof pin === 'string' && /^\d{6}$/.test(pin);
}

// ---------------------------------------------------------------------------
// SHA-256 murni-JS (implementasi standar FIPS 180-4). Dipertahankan sinkron &
// deterministik lintas lingkungan; diverifikasi unit test terhadap vektor
// resmi NIST ("" / "abc" / string panjang) di tests/unit/app-lock-domain.test.js.
// ---------------------------------------------------------------------------
const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** SHA-256 dari string UTF-8 -> hex kecil. Murni, sinkron, tanpa dependensi. */
export function sha256Hex(message) {
    const msg = String(message);
    // UTF-8 encode manual (hindari dependensi TextEncoder supaya behavior
    // identik di semua lingkungan test).
    const bytes = [];
    for (let i = 0; i < msg.length; i++) {
        let code = msg.charCodeAt(i);
        if (code < 0x80) bytes.push(code);
        else if (code < 0x800) {
            bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < msg.length) {
            // surrogate pair
            const lo = msg.charCodeAt(++i);
            code = 0x10000 + ((code - 0xd800) << 10) + (lo - 0xdc00);
            bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        } else {
            bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        }
    }
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    // panjang 64-bit big-endian (cukup 32-bit tinggi nol untuk input wajar)
    bytes.push(0, 0, 0, 0, (bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));

    for (let off = 0; off < bytes.length; off += 64) {
        for (let t = 0; t < 16; t++) {
            const i4 = off + t * 4;
            w[t] = ((bytes[i4] << 24) | (bytes[i4 + 1] << 16) | (bytes[i4 + 2] << 8) | bytes[i4 + 3]) >>> 0;
        }
        for (let t = 16; t < 64; t++) {
            const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
            const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
            w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, h] = H;
        for (let t = 0; t < 64; t++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) >>> 0;
            h = g; g = f; f = e; e = (d + temp1) >>> 0;
            d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
        }
        H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
        H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** Hash PIN dengan salt: sha256(salt + '|' + pin). Pin diasumsikan sudah tervalidasi formatnya. */
export function pinHashHex(pin, salt) {
    return sha256Hex(String(salt) + '|' + String(pin));
}

/**
 * Verifikasi PIN terhadap konfigurasi. Perbandingan panjang-tetap (constant-time
 * sederhana) supaya tidak bocor lewat timing di layer aplikasi — nilai praktis
 * kecil, tapi gratis dan ter-test.
 */
export function verifyPin(pin, cfg) {
    const c = normalizeLockConfig(cfg);
    if (!isValidPinFormat(pin) || !c.salt || !c.hash) return false;
    const candidate = pinHashHex(pin, c.salt);
    const expected = c.hash;
    if (candidate.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
}

/**
 * Transisi state lockout. `state` = {fail_count, locked_until} (ms epoch,
 * 0 = tidak terkunci). `ok` = hasil verifikasi barusan.
 * Kebalikan implementasi naif: fail_count TIDAK direset saat cooldown berakhir —
 * gagal sekali lagi setelah cooldown langsung masuk cooldown baru. Reset penuh
 * hanya setelah verifikasi BERHASIL.
 */
export function nextLockoutState(state, ok, nowMs, opts) {
    const maxFails = (opts && opts.maxFails) || LOCKOUT_MAX_FAILS;
    const cooldownMs = (opts && opts.cooldownMs) != null ? opts.cooldownMs : LOCKOUT_COOLDOWN_MS;
    const s = state && typeof state === 'object' ? state : { fail_count: 0, locked_until: 0 };
    const failCount = Number(s.fail_count) || 0;
    if (ok) return { fail_count: 0, locked_until: 0 };
    const next = failCount + 1;
    if (next >= maxFails) return { fail_count: next, locked_until: nowMs + cooldownMs };
    return { fail_count: next, locked_until: Number(s.locked_until) || 0 };
}

/** Sedang terkunci cooldown? (locked_until di masa depan). */
export function isLockedOut(state, nowMs) {
    const until = state && Number(state.locked_until) || 0;
    return until > nowMs;
}

/** Sisa detik cooldown (pembulatan ke atas, minimal 1 selama masih terkunci). */
export function lockoutRemainingSec(state, nowMs) {
    const until = state && Number(state.locked_until) || 0;
    if (until <= nowMs) return 0;
    return Math.max(1, Math.ceil((until - nowMs) / 1000));
}

/**
 * Apakah kunci WAJIB dipasang SEKARANG, dilihat dari konfigurasi + jejak
 * aktivitas terakhir (epoch ms; sumbernya localStorage per-user sehingga jam
 * idle BERLAKU LINTAS RELOAD dan lintas tab). Aturan:
 * - lock nonaktif                    -> false (tidak pernah mengunci);
 * - mode "setiap dibuka" (menit <= 0) -> SELALU true;
 * - mode idle (menit > 0)            -> true hanya kalau waktu sejak aktivitas
 *   terakhir sudah >= ambang menit. Reload di tengah periode aktif = false
 *   (bug fix v93: dulu boot selalu mengunci apa pun modenya).
 * - jejak tidak ada / tidak valid / melenceng jauh ke MASA DEPAN (jam sistem
 *   berubah) -> true (fail-closed: kunci sekali; setelah dibuka, jejak tertulis
 *   ulang dengan jam yang benar -> sembuh sendiri).
 *
 * Dipakai di: gerbang boot (enterApp), reconcile pasca-loadData, dan re-check
 * saat timer idle menyala (tab lain bisa memperbarui jejak yang sama).
 */
export function shouldLockNow(cfg, lastActivityMs, nowMs) {
    if (!isLockEnabled(cfg)) return false;
    const minutes = Number(cfg.auto_lock_minutes) || 0;
    if (minutes <= 0) return true; // mode "setiap kali aplikasi dibuka"
    const last = Number(lastActivityMs);
    const now = Number(nowMs);
    if (!Number.isFinite(last) || last <= 0 || last > now + 60000) return true; // jejak tak valid / jam skew
    return (now - last) >= minutes * 60000;
}


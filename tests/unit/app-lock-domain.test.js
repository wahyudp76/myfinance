/**
 * Unit test src/domain/app-lock.js (v92 / Fase 1A — App Lock).
 * Fokus: SHA-256 vs vektor resmi NIST, normalisasi konfigurasi terhadap data
 * rusak/backup lama, verifikasi PIN, dan kebijakan lockout pada batas-batasnya.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_LOCK_DEFAULTS, LOCKOUT_MAX_FAILS, LOCKOUT_COOLDOWN_MS, MAX_BIOMETRIC_CREDENTIALS, normalizeLockConfig, isLockEnabled, isValidPinFormat, sha256Hex, pinHashHex, verifyPin, nextLockoutState, isLockedOut, lockoutRemainingSec, shouldLockNow,
    normalizeCredentialList, biometricCredentialIds, hasBiometricCredential, addBiometricCredential, removeBiometricCredential, clearBiometricCredentials, biometricLabel, deviceLabelFromUserAgent, describeBiometricState } from '../../src/domain/app-lock.js';

// ---------------------------------------------------------------------------
// SHA-256 — vektor resmi (FIPS 180-4 / NIST):
//   SHA256("")    = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
//   SHA256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
//   SHA256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")
//                 = 248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1
//   SHA256("a".repeat(1000000)) = cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0
// ---------------------------------------------------------------------------
test('sha256Hex: vektor resmi NIST', () => {
    assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(
        sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
        '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    );
    assert.equal(sha256Hex('a'.repeat(1000000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('sha256Hex: input multi-blok tepat (64 byte) & non-ASCII (UTF-8)', () => {
    // 64 karakter ASCII = tepat 1 blok + padding blok kedua
    assert.equal(sha256Hex('x'.repeat(64)).length, 64);
    // ü = 2 byte UTF-8; é€ (surrogate-range check) — pastikan tidak melempar
    assert.equal(sha256Hex('hüsla € 42').length, 64);
    // emoji (surrogate pair) — encoder manual harus menangani
    assert.equal(sha256Hex('🎯🔥').length, 64);
    // Angka kecil deterministik
    assert.equal(sha256Hex('0'), '5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9');
});

test('pinHashHex: salt memisahkan hash PIN sama', () => {
    const h1 = pinHashHex('123456', 'saltA');
    const h2 = pinHashHex('123456', 'saltB');
    assert.notEqual(h1, h2);
    assert.equal(h1, sha256Hex('saltA|123456'));
});

// ---------------------------------------------------------------------------
// Normalisasi konfigurasi
// ---------------------------------------------------------------------------
test('normalizeLockConfig: null/undefined/tipe salah -> default aman', () => {
    assert.deepEqual(normalizeLockConfig(null), APP_LOCK_DEFAULTS);
    assert.deepEqual(normalizeLockConfig(undefined), APP_LOCK_DEFAULTS);
    assert.deepEqual(normalizeLockConfig('string ngawur'), APP_LOCK_DEFAULTS);
    assert.deepEqual(normalizeLockConfig(42), APP_LOCK_DEFAULTS);
});

test('normalizeLockConfig: field salah tipe tidak pernah melempar, dijaga aman', () => {
    const c = normalizeLockConfig({ enabled: 'yes', salt: 99, hash: null, auto_lock_minutes: -3, credential_id: 123 });
    assert.equal(c.enabled, false); // hanya === true yang lolos
    assert.equal(c.salt, '');
    assert.equal(c.hash, '');
    assert.equal(c.auto_lock_minutes, 5); // negatif -> default
    assert.equal(c.credential_id, null);
    assert.equal(c.biometric_enabled, false);
});

test('normalizeLockConfig: nilai valid dipertahankan', () => {
    const c = normalizeLockConfig({ enabled: true, salt: 's', hash: 'h', auto_lock_minutes: 0, biometric_enabled: true, credential_id: 'abc' });
    assert.deepEqual(c, {
        enabled: true, salt: 's', hash: 'h', auto_lock_minutes: 0,
        biometric_enabled: true, credential_id: 'abc',
        // v99: credential_id lama dimigrasikan jadi satu entri daftar
        credentials: [{ id: 'abc', label: 'Perangkat pertama', added_at: '', rp_id: '' }],
    });
});

test('isLockEnabled: butuh enabled + salt + hash lengkap', () => {
    assert.equal(isLockEnabled(null), false);
    assert.equal(isLockEnabled({ enabled: true, salt: '', hash: 'h' }), false);
    assert.equal(isLockEnabled({ enabled: true, salt: 's', hash: '' }), false);
    assert.equal(isLockEnabled({ enabled: false, salt: 's', hash: 'h' }), false);
    assert.equal(isLockEnabled({ enabled: true, salt: 's', hash: 'h' }), true);
});

// ---------------------------------------------------------------------------
// Format & verifikasi PIN
// ---------------------------------------------------------------------------
test('isValidPinFormat: tepat 6 digit', () => {
    assert.equal(isValidPinFormat('123456'), true);
    assert.equal(isValidPinFormat('000000'), true);
    assert.equal(isValidPinFormat('12345'), false);
    assert.equal(isValidPinFormat('1234567'), false);
    assert.equal(isValidPinFormat('12a456'), false);
    assert.equal(isValidPinFormat(' 123456'), false);
    assert.equal(isValidPinFormat(123456), false); // angka, bukan string
    assert.equal(isValidPinFormat(''), false);
    assert.equal(isValidPinFormat(null), false);
});

test('verifyPin: benar/salah/konfigurasi rusak', () => {
    const cfg = { enabled: true, salt: 'nacl', hash: pinHashHex('135790', 'nacl') };
    assert.equal(verifyPin('135790', cfg), true);
    assert.equal(verifyPin('135791', cfg), false);
    assert.equal(verifyPin('1357', cfg), false); // format salah -> false, bukan throw
    assert.equal(verifyPin('135790', null), false);
    assert.equal(verifyPin('135790', { enabled: true, salt: 'nacl', hash: '' }), false);
});

// ---------------------------------------------------------------------------
// Kebijakan lockout
// ---------------------------------------------------------------------------
test('nextLockoutState: sukses selalu reset penuh', () => {
    const st = nextLockoutState({ fail_count: 4, locked_until: 9999999999999 }, true, 1000);
    assert.deepEqual(st, { fail_count: 0, locked_until: 0 });
});

test('nextLockoutState: kunci tepat pada kegagalan ke-LOCKOUT_MAX_FAILS', () => {
    let st = { fail_count: 0, locked_until: 0 };
    for (let i = 1; i < LOCKOUT_MAX_FAILS; i++) {
        st = nextLockoutState(st, false, 1000);
        assert.equal(st.fail_count, i);
        assert.equal(st.locked_until, 0); // belum terkunci
    }
    st = nextLockoutState(st, false, 2000); // kegagalan ke-5
    assert.equal(st.fail_count, LOCKOUT_MAX_FAILS);
    assert.equal(st.locked_until, 2000 + LOCKOUT_COOLDOWN_MS);
});

test('nextLockoutState: setelah cooldown lewat, 1 gagal lagi langsung cooldown baru', () => {
    let st = { fail_count: LOCKOUT_MAX_FAILS, locked_until: 5000 };
    st = nextLockoutState(st, false, 5000 + LOCKOUT_COOLDOWN_MS + 100); // cooldown sudah lewat
    assert.equal(st.locked_until, 5000 + LOCKOUT_COOLDOWN_MS + 100 + LOCKOUT_COOLDOWN_MS);
});

test('nextLockoutState: state rusak tidak melempar', () => {
    assert.deepEqual(nextLockoutState(null, false, 10), { fail_count: 1, locked_until: 0 });
    assert.deepEqual(nextLockoutState('x', true, 10), { fail_count: 0, locked_until: 0 });
});

test('isLockedOut & lockoutRemainingSec', () => {
    assert.equal(isLockedOut({ locked_until: 5000 }, 4999), true);
    assert.equal(isLockedOut({ locked_until: 5000 }, 5000), false); // tepat habis = tidak terkunci
    assert.equal(isLockedOut({ locked_until: 5000 }, 5001), false);
    assert.equal(isLockedOut(null, 9999), false);
    assert.equal(lockoutRemainingSec({ locked_until: 5300 }, 5000), 1); // 300ms -> ceil 1
    assert.equal(lockoutRemainingSec({ locked_until: 6800 }, 5000), 2); // 1.8s -> 2
    assert.equal(lockoutRemainingSec({ locked_until: 5000 }, 6000), 0);
});

// ---------- shouldLockNow (v93: idle lintas reload) ----------
const NOW = 1_700_000_000_000;
const MIN = 60_000;
const cfgIdle = { enabled: true, salt: 'ab', hash: 'cd', auto_lock_minutes: 5, biometric_enabled: false, credential_id: null };
const cfgEveryOpen = { enabled: true, salt: 'ab', hash: 'cd', auto_lock_minutes: 0, biometric_enabled: false, credential_id: null };

test('shouldLockNow: lock nonaktif tidak pernah mengunci', () => {
    assert.equal(shouldLockNow({ enabled: false }, NOW - 99 * MIN, NOW), false);
    assert.equal(shouldLockNow(null, 0, NOW), false);
});

test('shouldLockNow: mode "setiap dibuka" selalu mengunci (apa pun jejak)', () => {
    assert.equal(shouldLockNow(cfgEveryOpen, NOW, NOW), true); // baru saja aktif pun tetap
    assert.equal(shouldLockNow(cfgEveryOpen, 0, NOW), true);
});

test('shouldLockNow: mode idle + aktivitas BARU SAJA -> TIDAK mengunci (bug fix v93)', () => {
    assert.equal(shouldLockNow(cfgIdle, NOW - 10 * 1000, NOW), false); // 10 detik lalu
    assert.equal(shouldLockNow(cfgIdle, NOW - 4 * MIN - 59 * 1000, NOW), false); // sebelum ambang
    assert.equal(shouldLockNow(cfgIdle, NOW - 5 * MIN + 1000, NOW), false); // kurang 1 detik
});

test('shouldLockNow: mode idle + sudah lewat ambang -> mengunci', () => {
    assert.equal(shouldLockNow(cfgIdle, NOW - 5 * MIN, NOW), true); // tepat ambang
    assert.equal(shouldLockNow(cfgIdle, NOW - 6 * MIN, NOW), true);
});

test('shouldLockNow: jejak tidak valid / jam skew masa depan -> fail-closed mengunci', () => {
    assert.equal(shouldLockNow(cfgIdle, 0, NOW), true); // belum pernah ada jejak
    assert.equal(shouldLockNow(cfgIdle, null, NOW), true);
    assert.equal(shouldLockNow(cfgIdle, NaN, NOW), true);
    assert.equal(shouldLockNow(cfgIdle, NOW + 10 * MIN, NOW), true); // jam mundur -> kunci, sembuh sendiri
    // toleransi kecil (<= 60 dtk) tidak dianggap skew
    assert.equal(shouldLockNow(cfgIdle, NOW + 30 * 1000, NOW), false);
});

// ---------------------------------------------------------------------------
// v99 — Biometrik PER PERANGKAT.
//
// REGRESI YANG DIJAGA (laporan pengguna nyata, 2026-09-07): "di desktop bisa
// pakai fingerprint, tapi di mobile tidak bisa pakai Face ID". Penyebabnya
// bukan Face ID: konfigurasi app_lock ikut roaming lewat tabel settings, tapi
// kredensial WebAuthn terikat perangkat. Dengan satu slot credential_id, HP
// melihat biometrik "sudah aktif" milik laptop sehingga tidak pernah menawarkan
// pendaftaran, dan tombol bukanya memanggil kredensial yang tidak ada di HP.
// ---------------------------------------------------------------------------

const CRED_LAPTOP = { id: 'kredensial-laptop', label: 'Windows', added_at: '2026-09-01T00:00:00.000Z' };
const CRED_HP = { id: 'kredensial-hp', label: 'iPhone', added_at: '2026-09-07T00:00:00.000Z' };

test('REGRESI v99: HP tetap ditawari mendaftar walau laptop sudah aktif', () => {
    // Persis kondisi yang dilaporkan: cfg lama satu-slot hasil pendaftaran laptop.
    const cfgDariCloud = { enabled: true, salt: 's', hash: 'h', biometric_enabled: true, credential_id: CRED_LAPTOP.id };

    // Di HP: penanda lokal belum ada (HP belum pernah mendaftar).
    const diHp = describeBiometricState(cfgDariCloud, null);
    assert.equal(diHp.enrolledHere, false);
    assert.equal(diHp.otherDevices, 1);
    assert.equal(diHp.canEnrollHere, true, 'HP WAJIB masih bisa mendaftar -- ini inti bugnya');

    // Di laptop: penanda lokal cocok -> tidak perlu daftar lagi.
    const diLaptop = describeBiometricState(cfgDariCloud, CRED_LAPTOP.id);
    assert.equal(diLaptop.enrolledHere, true);
    assert.equal(diLaptop.canEnrollHere, false);
    assert.equal(diLaptop.otherDevices, 0);
});

test('REGRESI v99: mendaftar di HP TIDAK menghapus kredensial laptop', () => {
    const awal = normalizeLockConfig({ enabled: true, salt: 's', hash: 'h', credential_id: CRED_LAPTOP.id });
    const sesudah = addBiometricCredential(awal, CRED_HP);
    assert.deepEqual(biometricCredentialIds(sesudah).sort(), [CRED_HP.id, CRED_LAPTOP.id].sort());
    assert.equal(sesudah.biometric_enabled, true);
});

test('REGRESI v99: allowCredentials memuat SEMUA perangkat, bukan satu', () => {
    let cfg = normalizeLockConfig({ enabled: true, salt: 's', hash: 'h' });
    cfg = addBiometricCredential(cfg, CRED_LAPTOP);
    cfg = addBiometricCredential(cfg, CRED_HP);
    const ids = biometricCredentialIds(cfg);
    assert.equal(ids.length, 2);
    assert.ok(ids.includes(CRED_LAPTOP.id) && ids.includes(CRED_HP.id));
});

test('v99: mematikan di satu perangkat hanya mencabut perangkat itu', () => {
    let cfg = addBiometricCredential(normalizeLockConfig({}), CRED_LAPTOP);
    cfg = addBiometricCredential(cfg, CRED_HP);
    const sisa = removeBiometricCredential(cfg, CRED_HP.id);
    assert.deepEqual(biometricCredentialIds(sisa), [CRED_LAPTOP.id]);
    assert.equal(sisa.biometric_enabled, true, 'laptop masih aktif -> flag tetap true');

    const kosong = removeBiometricCredential(sisa, CRED_LAPTOP.id);
    assert.deepEqual(kosong.credentials, []);
    assert.equal(kosong.biometric_enabled, false);
    assert.equal(kosong.credential_id, null);
});

test('v99: clearBiometricCredentials mencabut semua perangkat', () => {
    let cfg = addBiometricCredential(normalizeLockConfig({}), CRED_LAPTOP);
    cfg = addBiometricCredential(cfg, CRED_HP);
    const kosong = clearBiometricCredentials(cfg);
    assert.deepEqual(kosong.credentials, []);
    assert.equal(kosong.biometric_enabled, false);
    assert.equal(kosong.credential_id, null);
    assert.equal(kosong.enabled, cfg.enabled, 'PIN tidak ikut dimatikan');
});

test('v99: biometric_enabled DITURUNKAN dari daftar (state mustahil ditolak)', () => {
    // Flag true tapi tidak ada kredensial: inilah yang dulu membuat UI HP
    // hanya menawarkan "Matikan".
    const c = normalizeLockConfig({ biometric_enabled: true, credential_id: null, credentials: [] });
    assert.equal(c.biometric_enabled, false);
    assert.equal(c.credential_id, null);
});

test('v99: addBiometricCredential idempoten & mempertahankan cfg lain', () => {
    const awal = normalizeLockConfig({ enabled: true, salt: 'aa', hash: 'bb', auto_lock_minutes: 3 });
    const sekali = addBiometricCredential(awal, CRED_HP);
    const dua = addBiometricCredential(sekali, CRED_HP);
    assert.equal(dua.credentials.length, 1, 'id sama tidak boleh dobel');
    assert.equal(dua.auto_lock_minutes, 3);
    assert.equal(dua.salt, 'aa');
    assert.equal(dua.enabled, true);
});

test('v99: daftar kredensial dibatasi & tahan data rusak', () => {
    const rusak = normalizeCredentialList([null, 'bukan objek', { id: '' }, { id: 'ok' }, { id: 'ok' }], null);
    assert.deepEqual(rusak.map((c) => c.id), ['ok'], 'duplikat & sampah dibuang, tidak melempar');

    const banyak = Array.from({ length: MAX_BIOMETRIC_CREDENTIALS + 5 }, (_, i) => ({ id: 'c' + i }));
    assert.equal(normalizeCredentialList(banyak, null).length, MAX_BIOMETRIC_CREDENTIALS);

    // label kepanjangan dipotong, bukan ditolak
    assert.equal(normalizeCredentialList([{ id: 'x', label: 'a'.repeat(200) }], null)[0].label.length, 60);
});

test('v99: migrasi legacy tidak menggandakan kalau id-nya sudah ada di daftar', () => {
    const c = normalizeLockConfig({ credential_id: CRED_HP.id, credentials: [CRED_HP] });
    assert.equal(c.credentials.length, 1);
});

test('v99: hasBiometricCredential aman terhadap id kosong/null', () => {
    const cfg = addBiometricCredential(normalizeLockConfig({}), CRED_HP);
    assert.equal(hasBiometricCredential(cfg, CRED_HP.id), true);
    assert.equal(hasBiometricCredential(cfg, null), false);
    assert.equal(hasBiometricCredential(cfg, ''), false);
    assert.equal(hasBiometricCredential(cfg, 'entah'), false);
});

test('v99: label biometrik mengikuti perangkat (iPhone bukan "sidik jari")', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1';
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
    const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
    assert.equal(biometricLabel(iphone), 'Face ID / Touch ID');
    assert.equal(biometricLabel(android), 'sidik jari / face unlock');
    assert.equal(biometricLabel(win), 'Windows Hello');
    assert.equal(biometricLabel(undefined), 'biometrik');

    assert.equal(deviceLabelFromUserAgent(iphone), 'iPhone');
    assert.equal(deviceLabelFromUserAgent(android), 'Android');
    assert.equal(deviceLabelFromUserAgent(win), 'Windows');
    assert.equal(deviceLabelFromUserAgent(''), 'Perangkat');
});

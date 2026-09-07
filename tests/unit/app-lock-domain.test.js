/**
 * Unit test src/domain/app-lock.js (v92 / Fase 1A — App Lock).
 * Fokus: SHA-256 vs vektor resmi NIST, normalisasi konfigurasi terhadap data
 * rusak/backup lama, verifikasi PIN, dan kebijakan lockout pada batas-batasnya.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_LOCK_DEFAULTS, LOCKOUT_MAX_FAILS, LOCKOUT_COOLDOWN_MS, normalizeLockConfig, isLockEnabled, isValidPinFormat, sha256Hex, pinHashHex, verifyPin, nextLockoutState, isLockedOut, lockoutRemainingSec, shouldLockNow } from '../../src/domain/app-lock.js';

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
    assert.deepEqual(c, { enabled: true, salt: 's', hash: 'h', auto_lock_minutes: 0, biometric_enabled: true, credential_id: 'abc' });
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

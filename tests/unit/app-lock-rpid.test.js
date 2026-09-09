/**
 * v107: RP ID biometrik mengikuti hostname persis, tidak pernah domain induk.
 * Metadata hanya untuk seleksi/UI; BUKAN sumber rpId untuk API WebAuthn.
 * Kredensial lama tanpa metadata tetap dicoba (browser memeriksa RP asli).
 * Dibuktikan MERAH terhadap v106 sebelum implementasi.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeLockConfig, normalizeCredentialList, biometricCredentialIds,
    hasBiometricCredential, describeBiometricState, addBiometricCredential,
    removeBiometricCredential, clearBiometricCredentials, verifyPin, pinHashHex,
} from '../../src/domain/app-lock.js';

const PAGES = 'wahyudp76.github.io';
const CUSTOM = 'uang.example.test';
const legacy = { id: 'lama', label: 'Perangkat lama', added_at: '' };
const pages = { id: 'pages', label: 'Laptop', added_at: '2026-09-09T00:00:00Z', rp_id: PAGES };
const custom = { id: 'custom', label: 'HP', added_at: '2026-09-09T00:01:00Z', rp_id: CUSTOM };
const cfg = { enabled: true, salt: 'salt', hash: pinHashHex('246813', 'salt'), credentials: [pages, custom, legacy] };

test('RP: metadata domain bertahan saat normalisasi / round-trip JSON', () => {
    const first = normalizeLockConfig(cfg);
    assert.equal(first.credentials[0].rp_id, PAGES);
    assert.equal(first.credentials[1].rp_id, CUSTOM);
    assert.deepEqual(normalizeLockConfig(JSON.parse(JSON.stringify(first))), first);
});

test('RP: legacy satu-slot & daftar lama tetap ada, domain TIDAK ditebak', () => {
    const old = normalizeLockConfig({ credential_id: 'old-slot', biometric_enabled: true });
    assert.equal(old.credentials[0].id, 'old-slot');
    assert.equal(old.credentials[0].rp_id, '');
    const list = normalizeCredentialList([legacy], null);
    assert.equal(list[0].rp_id, '');
    assert.deepEqual(biometricCredentialIds(old, PAGES), ['old-slot']);
    assert.deepEqual(biometricCredentialIds(old, CUSTOM), ['old-slot']);
});

test('RP: domain salah tipe dinormalkan tanpa melempar atau menghapus kredensial', () => {
    for (const rp_id of [null, undefined, 123, {}, ['example.test']]) {
        const list = normalizeCredentialList([{ id: 'x', rp_id }], null);
        assert.equal(list.length, 1);
        assert.equal(list[0].rp_id, '');
    }
    assert.equal(normalizeCredentialList([{ id: 'x', rp_id: 'WAHYUDP76.GITHUB.IO' }], null)[0].rp_id, PAGES);
});

test('RP: allow/exclude mencakup domain ini & legacy, bukan domain lain', () => {
    assert.deepEqual(biometricCredentialIds(cfg, PAGES), ['pages', 'lama']);
    assert.deepEqual(biometricCredentialIds(cfg, CUSTOM), ['custom', 'lama']);
    assert.deepEqual(biometricCredentialIds({ credentials: [pages] }, CUSTOM), []);
});

test('RP: kecocokan persis, bukan suffix / induk / host:port / URL lengkap', () => {
    for (const rp of ['github.io', 'sub.wahyudp76.github.io', `${PAGES}.evil.test`, `${PAGES}:443`, `https://${PAGES}/myfinance/`]) {
        assert.deepEqual(biometricCredentialIds({ credentials: [pages] }, rp), [], rp);
    }
});

test('RP: pemanggil lama tanpa filter masih mendapat semua id', () => {
    assert.deepEqual(biometricCredentialIds(cfg), ['pages', 'custom', 'lama']);
    assert.equal(hasBiometricCredential(cfg, 'custom'), true);
});

test('RP: penanda lokal yang tersalin tidak membuat kredensial domain lain aktif', () => {
    assert.equal(hasBiometricCredential(cfg, 'pages', PAGES), true);
    assert.equal(hasBiometricCredential(cfg, 'pages', CUSTOM), false);
    assert.equal(hasBiometricCredential(cfg, 'lama', PAGES), true);
    assert.equal(hasBiometricCredential(cfg, null, PAGES), false);
});

test('RP: UI memisahkan perangkat domain ini dari pendaftaran domain lain', () => {
    const st = describeBiometricState(cfg, 'pages', PAGES);
    assert.equal(st.enrolledHere, true);
    assert.equal(st.otherDevices, 1); // legacy tidak diketahui domainnya
    assert.equal(st.otherDomains, 1);
    assert.equal(st.total, 3); // tidak membuang data asal
    assert.equal(st.canEnrollHere, false);

    const moved = describeBiometricState({ credentials: [pages] }, 'pages', CUSTOM);
    assert.equal(moved.enrolledHere, false);
    assert.equal(moved.otherDevices, 0);
    assert.equal(moved.otherDomains, 1);
    assert.equal(moved.canEnrollHere, true);
});

test('RP: daftar ulang domain baru tidak menghapus kredensial domain lama atau mengubah PIN', () => {
    const base = normalizeLockConfig({ ...cfg, credentials: [pages] });
    const before = JSON.stringify(base);
    const next = addBiometricCredential(base, custom);
    assert.equal(JSON.stringify(base), before, 'input tidak boleh dimutasi');
    assert.equal(next.credentials.find((c) => c.id === 'custom').rp_id, CUSTOM);
    assert.equal(next.credentials.find((c) => c.id === 'pages').rp_id, PAGES);
    assert.equal(next.credential_id, 'custom', 'cermin legacy tetap dipertahankan');
    assert.equal(verifyPin('246813', next), true);
});

test('RP: mencabut satu kredensial tidak mencabut metadata/PIN milik yang lain', () => {
    const next = removeBiometricCredential(cfg, 'custom');
    assert.equal(next.credentials.find((c) => c.id === 'pages').rp_id, PAGES);
    assert.equal(verifyPin('246813', next), true);
    const cleared = clearBiometricCredentials(next);
    assert.deepEqual(cleared.credentials, []);
    assert.equal(verifyPin('246813', cleared), true);
});

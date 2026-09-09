// v107 — RP ID WebAuthn: domain eksplisit, kompatibilitas kredensial lama,
// migrasi domain -> PIN + daftar ulang, tanpa mencabut domain asal.
//
// HERMETIK: SEMUA aset dibaca dari checkout lokal lewat route.fulfill(path).
// Origin HTTPS produksi & domain kustom hanya disimulasikan di browser;
// TIDAK ada request ke produksi/Supabase, TIDAK ada perubahan DNS/sertifikat.
// Virtual authenticator CDP menjalankan create/get WebAuthn SUNGGUHAN.
// Spy hanya merekam parameter; mode gagal dipakai khusus uji fail-closed.
//
// Jalankan: node scripts/verify-applock-rpid.mjs
//   APPLOCK_RPID_URL opsional, default http://localhost:8123/ (tanpa server pun jalan).
//   APPLOCK_RPID_ROOT opsional: checkout historis/mutan untuk pembuktian MERAH.
import { chromium } from 'playwright';
import { resolve, extname, sep } from 'node:path';

const ROOT = resolve(process.env.APPLOCK_RPID_ROOT || resolve(import.meta.dirname, '..'));
const LOCAL = new URL((process.env.APPLOCK_RPID_URL || 'http://localhost:8123/').replace('127.0.0.1', 'localhost'));
const PAGES = new URL('https://wahyudp76.github.io/myfinance/');
const CUSTOM = new URL('https://uang.example.test/finance/');
const REF = 'uxfngmxghupdlwoeoxgh';
const USER_ID = '11111111-2222-3333-4444-555555555555';
const PIN = '246813';
const CFG_KEY = 'myfinance_applock_cfg';
const CRED_KEY = 'myfinance_applock_cred';
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};
const session = {
  access_token: 'stub-token', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub-refresh',
  user: { id: USER_ID, aud: 'authenticated', email: 'rpid.verify@local.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
};
const checks = [];
const errors = [];
const ok = (name, pass, extra = '') => checks.push({ name, pass: !!pass, extra });
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const browser = await chromium.launch({ headless: true });

async function fixture() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  let store = { user_id: USER_ID, data: {} };
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === `https://${REF}.supabase.co`) {
      if (u.pathname.startsWith('/auth/v1/token')) return route.fulfill(json(session));
      if (u.pathname.startsWith('/auth/v1/user')) return route.fulfill(json(session.user));
      if (u.pathname.startsWith('/rest/v1/settings')) {
        if (route.request().method() !== 'GET') {
          const body = route.request().postDataJSON();
          const row = Array.isArray(body) ? body[0] : body;
          if (row?.data) store = { user_id: USER_ID, data: row.data };
        }
        return route.fulfill(json(store, route.request().method() === 'GET' ? 200 : 201));
      }
      if (u.pathname.startsWith('/rest/v1/')) return route.fulfill(json([]));
      if (u.pathname.startsWith('/functions/v1/')) return route.fulfill(json({ ok: true }));
    }
    const base = [LOCAL, PAGES, CUSTOM].find((b) => b.origin === u.origin && u.pathname.startsWith(b.pathname));
    if (base) {
      const path = resolve(ROOT, decodeURIComponent(u.pathname.slice(base.pathname.length)) || 'index.html');
      if (path.startsWith(ROOT + sep)) {
        return route.fulfill({ path, contentType: types[extname(path)] || 'application/octet-stream' });
      }
    }
    errors.push(`Request tanpa stub: ${u.origin}${u.pathname}`);
    return route.abort();
  });
  await context.addInitScript(([ref, s]) => {
    const key = `sb-${ref}-auth-token`;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(s));
    window.__rpCalls = [];
    window.__rpGetMode = '';
    const b64 = (id) => btoa(String.fromCharCode(...new Uint8Array(id)));
    for (const method of ['create', 'get']) {
      const native = navigator.credentials[method].bind(navigator.credentials);
      navigator.credentials[method] = async (options) => {
        const pk = options.publicKey;
        window.__rpCalls.push({ method, rp: pk.rp?.id ?? null, rpId: pk.rpId ?? null,
          ids: (pk.allowCredentials || pk.excludeCredentials || []).map((c) => b64(c.id)) });
        if (method === 'get') {
          if (window.__rpGetMode === 'cancel') throw new DOMException('Dibatalkan oleh uji', 'NotAllowedError');
          if (window.__rpGetMode === 'null') return null;
          if (window.__rpGetMode === 'foreign') return { rawId: new Uint8Array([1, 2, 3]).buffer };
          if (window.__rpGetMode === 'invalid-rp') options = { ...options, publicKey: { ...pk, rpId: 'https://wrong.example.test/path' } };
        }
        try { return await native(options); }
        catch (err) { window.__rpLastError = err.name; throw err; }
      };
    }
  }, [REF, session]);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 240)}`); });
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  const nativeCredentials = async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
  const boot = async (url) => {
    await page.goto(String(url), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof openAppLockModal === 'function' &&
      !document.getElementById('authGate') && !document.body.dataset.syncLoading &&
      (!document.getElementById('appShell').classList.contains('hidden') ||
       !document.getElementById('appLockOverlay').classList.contains('hidden')));
  };
  const seedPin = async () => page.evaluate(async ([pin, cfgKey, uid]) => {
    const svc = window.__myfinanceServices;
    appSettings.app_lock = svc.normalizeLockConfig({ enabled: true, salt: 'rpid-test-salt',
      hash: svc.pinHashHex(pin, 'rpid-test-salt'), auto_lock_minutes: 0 });
    await persistSettings();
    localStorage.setItem(cfgKey, JSON.stringify({ userId: uid, cfg: appSettings.app_lock }));
  }, [PIN, CFG_KEY, USER_ID]);
  const config = () => page.evaluate(() => window.__myfinanceServices.normalizeLockConfig(appSettings.app_lock));
  const marker = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), CRED_KEY);
  const calls = () => page.evaluate(() => window.__rpCalls);
  const locked = () => page.evaluate(() => !document.getElementById('appLockOverlay').classList.contains('hidden'));
  const lock = async () => {
    // closeAppLockModal menjadwalkan hidden setelah animasi 300ms. Jangan
    // menyisakan timer penutupan yang akan menyembunyikan modal saat R9
    // membukanya kembali (dan jangan menjadwalkannya bila modal sudah tertutup).
    if (await page.locator('#modalAppLock').isVisible()) {
      await page.evaluate(() => closeAppLockModal());
      await page.waitForSelector('#modalAppLock.hidden', { state: 'attached' });
    }
    await page.evaluate(() => showAppLockOverlay(null));
  };
  const bioVisible = () => page.evaluate(() => !document.getElementById('appLockBioBtn').classList.contains('hidden'));
  const bioRow = async () => {
    await page.evaluate(() => openAppLockModal());
    await page.waitForFunction(() => document.getElementById('applock-bio-row')?.innerText.trim());
    return page.locator('#applock-bio-row').innerText();
  };
  const enroll = async () => {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/v1/settings') && r.request().method() === 'POST'),
      page.evaluate(async () => { await appLockEnrollBiometric(); }),
    ]);
    return marker();
  };
  const unlock = () => page.evaluate(async () => { await appLockBiometricUnlock(); });
  const pinUnlock = async () => {
    await page.fill('#appLockPinInput', PIN);
    await page.click('#appLockUnlockBtn');
    await page.waitForFunction(() => !document.body.dataset.syncLoading &&
      document.getElementById('appLockOverlay').classList.contains('hidden'));
  };
  return { context, page, boot, seedPin, config, marker, calls, nativeCredentials, locked, lock, bioVisible, bioRow, enroll, unlock, pinUnlock,
    cloud: () => store.data.app_lock };
}

try {
  // R1-R2: localhost BER-PORT harus tetap RP "localhost", bukan host:port.
  const local = await fixture();
  await local.boot(LOCAL);
  await local.seedPin();
  const localMarker = await local.enroll();
  const localCreds = await local.nativeCredentials();
  ok('R1: create mengirim rp.id localhost eksplisit (tanpa port)',
    (await local.calls()).at(-1)?.rp === 'localhost', JSON.stringify((await local.calls()).at(-1)));
  ok('R1: authenticator benar-benar menyimpan RP localhost',
    localCreds.length === 1 && localCreds[0].rpId === 'localhost');
  ok('R1: cloud dan penanda lokal menyimpan domain pendaftaran',
    local.cloud()?.credentials?.[0]?.rp_id === 'localhost' && localMarker?.rpId === 'localhost');
  await local.lock();
  await local.unlock();
  const localGet = (await local.calls()).at(-1);
  ok('R2: get mengirim rpId localhost eksplisit, bukan hanya create', localGet?.method === 'get' && localGet.rpId === 'localhost');
  ok('R2: allowCredentials menunjuk kredensial yang didaftarkan',
    localGet?.ids.length === 1 && localGet.ids[0] === localMarker.credentialId);
  ok('R2: biometrik localhost benar-benar membuka kunci (counter naik)',
    !await local.locked() && (await local.nativeCredentials())[0]?.signCount > localCreds[0]?.signCount);
  await local.context.close();

  // R3: buat kredensial dengan cara LAMA (rp.id OMITTED) di origin produksi,
  // simpan bentuk lama tanpa rp_id/rpId, lalu boot ulang app versi baru.
  const old = await fixture();
  await old.boot(PAGES);
  await old.seedPin();
  const oldId = await old.page.evaluate(async ([uid, cfgKey, credKey]) => {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'MyFinance' },
      user: { id: new TextEncoder().encode(uid), name: 'legacy@local.test', displayName: 'Legacy' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    } });
    const id = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
    delete appSettings.app_lock.credentials;
    appSettings.app_lock.credential_id = id;
    appSettings.app_lock.biometric_enabled = true;
    await persistSettings();
    localStorage.setItem(cfgKey, JSON.stringify({ userId: uid, cfg: appSettings.app_lock }));
    localStorage.setItem(credKey, JSON.stringify({ userId: uid, credentialId: id }));
    return id;
  }, [USER_ID, CFG_KEY, CRED_KEY]);
  ok('R3: fixture legacy benar-benar dibuat TANPA rp.id, terikat wahyudp76.github.io',
    (await old.calls()).at(-1)?.rp === null && (await old.nativeCredentials())[0]?.rpId === PAGES.hostname);
  await old.boot(PAGES);
  const oldButton = await old.bioVisible();
  await old.unlock();
  ok('R3: kredensial legacy + penanda lama tetap bisa membuka tanpa daftar ulang',
    oldButton && !await old.locked() && (await old.nativeCredentials()).length === 1 &&
    (await old.nativeCredentials())[0].credentialId === oldId && (await old.nativeCredentials())[0].signCount > 0);
  ok('R3: get legacy kini eksplisit domain lama & penanda lokal diperbarui',
    (await old.calls()).at(-1)?.rpId === PAGES.hostname && (await old.marker())?.rpId === PAGES.hostname);
  await old.context.close();

  // R4-R7: satu perangkat/sensor, satu cloud, dua origin terpisah.
  const moved = await fixture();
  await moved.boot(PAGES);
  await moved.seedPin();
  const pagesMarker = await moved.enroll();
  const pagesId = pagesMarker.credentialId;
  ok('R4: produksi memakai hostname utuh, bukan github.io atau /myfinance',
    (await moved.calls()).at(-1)?.rp === PAGES.hostname && (await moved.nativeCredentials())[0]?.rpId === PAGES.hostname);
  ok('R4: metadata domain produksi bertahan di cloud', moved.cloud()?.credentials?.[0]?.rp_id === PAGES.hostname);
  const pagesRow = await moved.bioRow();
  ok('R4: Pengaturan menjelaskan domain aktif, PIN, dan daftar ulang bila pindah domain',
    pagesRow.includes(PAGES.hostname) && /PIN/.test(pagesRow) && /domain baru/i.test(pagesRow), pagesRow.replace(/\s+/g, ' '));

  await moved.boot(CUSTOM);
  await moved.lock();
  ok('R5: origin baru tidak menganggap biometrik produksi sudah aktif di sini',
    !await moved.bioVisible() && await moved.marker() === null);
  const customRow = await moved.bioRow();
  ok('R5: domain baru menawarkan Aktifkan, menyebut domain lain dan jalur PIN',
    /Aktifkan/.test(customRow) && customRow.includes(CUSTOM.hostname) && /domain lain/.test(customRow) && /PIN/.test(customRow),
    customRow.replace(/\s+/g, ' '));
  await moved.lock();
  const beforeGet = (await moved.calls()).length;
  // Jika kode lama mengirim kredensial domain lain, jangan menunggu timeout OS.
  // Spy harus TIDAK TERPANGGIL pada kode sehat (daftar eligible kosong).
  await moved.page.evaluate(() => { window.__rpGetMode = 'cancel'; });
  await moved.unlock();
  ok('R5: tanpa kredensial domain ini, get TIDAK dipanggil & kunci tetap terpasang',
    (await moved.calls()).length === beforeGet && await moved.locked());
  await moved.page.evaluate(() => { window.__rpGetMode = ''; });
  await moved.page.evaluate(([key, marker]) => localStorage.setItem(key, JSON.stringify(marker)), [CRED_KEY, { ...pagesMarker, rpId: PAGES.hostname }]);
  await moved.lock();
  ok('R5: penanda lokal domain lama yang tersalin tidak mengaktifkan tombol biometrik', !await moved.bioVisible());
  // Klien versi lama bisa menghilangkan metadata cloud saat menulis settings.
  // Penanda lokal BARU tetap harus menjaga domain, independen dari filter cloud.
  await moved.page.evaluate(() => {
    window.__rpSavedConfig = appSettings.app_lock;
    const cfg = window.__myfinanceServices.normalizeLockConfig(appSettings.app_lock);
    appSettings.app_lock = { ...cfg, credentials: cfg.credentials.map(({ rp_id, ...c }) => c) };
  });
  await moved.lock();
  ok('R5: domain penanda lokal tetap dijaga ketika metadata cloud hilang', !await moved.bioVisible());
  await moved.page.evaluate(() => { appSettings.app_lock = window.__rpSavedConfig; });
  await moved.page.evaluate(([key, uid, id]) => localStorage.setItem(key, JSON.stringify({ userId: uid, credentialId: id })), [CRED_KEY, USER_ID, pagesId]);
  await moved.lock();
  ok('R5: penanda tanpa rpId juga tidak menimpa metadata domain yang sudah diketahui', !await moved.bioVisible());
  await moved.page.evaluate((key) => localStorage.removeItem(key), CRED_KEY);

  await moved.pinUnlock();
  ok('R6: PIN lama tetap membuka di domain baru tanpa reset konfigurasi',
    !await moved.locked() && (await moved.config()).enabled && (await moved.config()).credentials.some((c) => c.id === pagesId));
  const customMarker = await moved.enroll();
  const customId = customMarker.credentialId;
  const customCreate = (await moved.calls()).at(-1);
  ok('R6: daftar ulang di domain kustom memakai RP kustom, bukan hardcode produksi',
    customCreate?.rp === CUSTOM.hostname && (await moved.nativeCredentials()).some((c) => c.credentialId === customId && c.rpId === CUSTOM.hostname));
  ok('R6: excludeCredentials tidak membawa id domain produksi', customCreate?.ids.length === 0);
  const both = moved.cloud()?.credentials || [];
  ok('R6: dua domain tersimpan berdampingan, kredensial asal tidak terhapus',
    both.length === 2 && both.some((c) => c.id === pagesId && c.rp_id === PAGES.hostname) &&
    both.some((c) => c.id === customId && c.rp_id === CUSTOM.hostname));
  await moved.lock();
  await moved.unlock();
  const customGet = (await moved.calls()).at(-1);
  ok('R6: get domain kustom hanya memakai id domain kustom & berhasil',
    !await moved.locked() && customGet?.rpId === CUSTOM.hostname && customGet.ids.length === 1 && customGet.ids[0] === customId &&
    (await moved.nativeCredentials()).find((c) => c.credentialId === customId)?.signCount > 0);

  await moved.boot(PAGES);
  await moved.unlock();
  const backGet = (await moved.calls()).at(-1);
  ok('R7: kembali ke domain asal tetap bisa memakai kredensial asal (tanpa daftar ulang)',
    !await moved.locked() && backGet?.rpId === PAGES.hostname && backGet.ids.length === 1 && backGet.ids[0] === pagesId &&
    (await moved.nativeCredentials()).find((c) => c.credentialId === pagesId)?.signCount > 0);

  // R8: respons kosong/id di luar allow-list bukan keberhasilan autentikasi.
  // Domain salah dipaksakan hanya pada API native untuk membuktikan PIN fallback.
  const stableMarker = JSON.stringify(await moved.marker());
  await moved.lock();
  await moved.page.evaluate(() => { window.__rpGetMode = 'null'; });
  await moved.unlock();
  ok('R8: get null tidak membuka kunci atau menulis ulang penanda',
    await moved.locked() && JSON.stringify(await moved.marker()) === stableMarker);
  await moved.lock();
  await moved.page.evaluate(() => { window.__rpGetMode = 'foreign'; });
  await moved.unlock();
  ok('R8: assertion di luar allow-list tidak membuka kunci atau merusak penanda',
    await moved.locked() && JSON.stringify(await moved.marker()) === stableMarker);
  await moved.lock();
  await moved.page.evaluate(() => { window.__rpGetMode = 'invalid-rp'; });
  await moved.unlock();
  ok('R8: RP invalid ditolak browser dengan SecurityError & overlay tetap terkunci',
    await moved.locked() && await moved.page.evaluate(() => window.__rpLastError === 'SecurityError'));
  await moved.pinUnlock();
  ok('R8: PIN tetap bisa membuka setelah kegagalan WebAuthn', !await moved.locked());

  // R9: filter hitungan "perangkat lain" tidak boleh menghilangkan kontrol
  // global ketika seluruh pendaftaran lainnya berasal dari domain berbeda.
  const clearRow = await moved.bioRow();
  const clearButton = moved.page.locator('[data-action="appLockDisableBiometricAll"]');
  const canClearAll = await clearButton.isVisible();
  ok('R9: Matikan di semua perangkat tetap ditawarkan untuk pendaftaran domain lain',
    canClearAll && /Matikan di semua perangkat/.test(clearRow));
  if (canClearAll) {
    await Promise.all([
      moved.page.waitForResponse((r) => r.url().includes('/rest/v1/settings') && r.request().method() === 'POST'),
      clearButton.click(),
    ]);
  }
  const afterAll = await moved.config();
  const pinValid = await moved.page.evaluate((pin) => window.__myfinanceServices.verifyPin(pin, appSettings.app_lock), PIN);
  await moved.lock();
  if (afterAll.enabled && pinValid) await moved.pinUnlock();
  ok('R9: Matikan semua mencabut kedua domain, tetapi PIN lama tetap membuka',
    afterAll.credentials.length === 0 && afterAll.credential_id === null && !afterAll.biometric_enabled &&
    afterAll.enabled && pinValid && !await moved.locked() && moved.cloud()?.credentials?.length === 0);
  await moved.context.close();
} catch (err) {
  errors.push(`Harness berhenti: ${err.stack || err}`);
} finally {
  await browser.close();
}

ok('R10: tidak ada exception halaman, console.error, atau request tanpa stub', errors.length === 0);
console.log(`\n== HASIL VERIFY APPLOCK RPID (${checks.length} cek) ==`);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.extra ? ' — ' + c.extra : ''}`);
console.log(`\nError (${errors.length}):`);
errors.slice(0, 12).forEach((e) => console.log(e));
process.exit(checks.some((c) => !c.pass) || errors.length ? 1 : 0);

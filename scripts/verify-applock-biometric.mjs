// VERIFY APPLOCK BIOMETRIC — reproduksi laporan pengguna nyata (2026-09-07):
// "di desktop bisa pakai fingerprint, tapi di mobile tidak bisa pakai Face ID".
//
// Bug v92-v98: konfigurasi app_lock ikut roaming lewat tabel settings, tapi
// kredensial WebAuthn platform authenticator TERIKAT PERANGKAT. Dengan satu slot
// `credential_id`, perangkat kedua melihat biometrik "sudah aktif" milik
// perangkat pertama, sehingga (a) Pengaturan hanya menawarkan "Matikan" -- tidak
// pernah bisa mendaftar, dan (b) tombol bukanya memanggil kredensial yang tidak
// ada di perangkat ini -> NotAllowedError.
//
// Harness ini memakai VIRTUAL AUTHENTICATOR Chrome DevTools Protocol, jadi alur
// WebAuthn benar-benar dijalankan browser (bukan mock JS): sensor virtual
// "perangkat ini" tidak memiliki kredensial milik perangkat lain, persis seperti
// HP sungguhan.
//
// Jalankan: node scripts/verify-applock-biometric.mjs
//   env: APPLOCK_URL (default http://localhost:8123/)
//
// Alur uji:
//  B1 setelan cloud sudah berisi kredensial "laptop" (perangkat lain)
//     -> Pengaturan di perangkat ini WAJIB tetap menawarkan "Aktifkan"
//     -> tombol biometrik di layar kunci TIDAK ditampilkan (pasti gagal kalau ada)
//  B2 daftarkan biometrik di perangkat ini -> kredensial laptop TETAP ada (2 entri)
//  B3 kunci lagi -> tombol biometrik muncul -> sensor virtual membuka app
//  B4 "Matikan" di perangkat ini -> hanya entri perangkat ini yang hilang
import { chromium } from "playwright";

// PENTING: harus lewat http://localhost, BUKAN http://127.0.0.1. WebAuthn
// menolak origin ber-IP dengan "SecurityError: This is an invalid domain"
// karena RP ID wajib berupa domain terdaftar; hanya localhost yang
// dikecualikan sebagai secure context. URL ber-IP dinormalkan di bawah.
const URL_RAW = process.env.APPLOCK_URL || process.env.HUD_URL || "http://localhost:8123/";
const URL_ = URL_RAW.replace("127.0.0.1", "localhost");
const REF = "uxfngmxghupdlwoeoxgh";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const EMAIL = "biometric.verify@local.test";
const PIN = "246813";
const CRED_LAPTOP = "a3JlZGVuc2lhbC1sYXB0b3AtbGFtYQ=="; // base64 dummy: kredensial perangkat LAIN

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: false });

const session = {
  access_token: "stub-token", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "stub-refresh",
  user: { id: USER_ID, aud: "authenticated", email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};
await context.addInitScript(([ref, s]) => {
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s));
}, [REF, session]);

const errors = [];
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
await context.route("**/functions/v1/**", (r) => r.fulfill(json({ ok: true })));
await context.route("**/rest/v1/**", (r) => r.fulfill(json([])));
await context.route("**/auth/v1/token**", (r) => r.fulfill(json(session)));
await context.route("**/auth/v1/user**", (r) => r.fulfill(json(session.user)));

// Settings STATEFUL, dan sengaja SUDAH berisi hasil pendaftaran "laptop".
let settingsStore = { user_id: USER_ID, data: {} };
await context.route("**/rest/v1/settings**", (r) => {
  if (r.request().method() === "GET") return r.fulfill(settingsStore ? json(settingsStore) : json([]));
  try {
    const body = JSON.parse(r.request().postData() || "{}");
    const row = Array.isArray(body) ? body[0] : body;
    if (row && row.data) settingsStore = { user_id: USER_ID, data: row.data, updated_at: new Date().toISOString() };
  } catch { /* ignore */ }
  return r.fulfill(json(settingsStore || {}, 201));
});

const page = await context.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });

const checks = [];
const ok = (name, cond, extra = "") => { checks.push({ name, pass: !!cond, extra }); };

// ---------- Virtual authenticator: "sensor biometrik" perangkat INI ----------
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: {
    protocol: "ctap2",
    transport: "internal",       // platform authenticator (Face ID / Touch ID / Hello)
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,        // sensor selalu "berhasil mengenali" -- kita menguji logika app
    automaticPresenceSimulation: true,
  },
});

async function credentialCount() {
  const res = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  return res.credentials.length;
}
async function cloudCredentials() {
  return await page.evaluate(() => {
    const raw = (typeof appSettings !== "undefined" && appSettings.app_lock) || {};
    // Bentuk mentah dari cloud bisa masih format lama satu-slot -> normalkan dulu,
    // persis seperti yang dilakukan app saat membacanya.
    const cfg = window.__myfinanceServices.normalizeLockConfig(raw);
    // Defensif: versi app SEBELUM v99 tidak punya cfg.credentials sama sekali.
    // Jangan crash -- harness ini justru harus bisa MELAPORKAN kondisi itu
    // sebagai kegagalan yang terbaca (dipakai sbg uji negatif terhadap v98).
    const list = Array.isArray(cfg.credentials) ? cfg.credentials.map((c) => c.id)
        : (cfg.credential_id ? [cfg.credential_id] : []);
    return { list, enabled: cfg.biometric_enabled === true };
  });
}

// ================= Siapkan: PIN aktif + kredensial "laptop" di cloud =================
await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("#appShell:not(.hidden)", { timeout: 45000 });
await page.waitForTimeout(1200);

// Tulis konfigurasi persis seperti korban bug: bentuk LAMA satu-slot dari laptop.
await page.evaluate(async ([pin, credLaptop]) => {
  const svc = window.__myfinanceServices;
  const salt = "abcdef0123456789abcdef0123456789";
  appSettings.app_lock = {
    enabled: true, salt, hash: svc.pinHashHex(pin, salt), auto_lock_minutes: 0,
    biometric_enabled: true, credential_id: credLaptop, // <- bentuk v92-v98
  };
  await persistSettings();
}, [PIN, CRED_LAPTOP]);
await page.waitForTimeout(600);

// ================= B1: perangkat ini BELUM terdaftar =================
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// Buka Pengaturan -> baris biometrik
await page.evaluate(() => { typeof openAppLockModal === 'function' && openAppLockModal(); });
// appLockRenderBioRow() async (menunggu isUserVerifyingPlatformAuthenticatorAvailable)
await page.waitForFunction(() => {
  const el = document.getElementById("applock-bio-row");
  return el && el.innerText.trim().length > 0;
}, null, { timeout: 15000 }).catch(() => {});
const bioRowText = await page.evaluate(() => (document.getElementById("applock-bio-row") || {}).innerText || "");
ok("B1: Pengaturan di perangkat ini MENAWARKAN 'Aktifkan' walau laptop sudah aktif",
  /Aktifkan/i.test(bioRowText), bioRowText.replace(/\s+/g, " ").slice(0, 90));
ok("B1: baris itu memberi tahu ada perangkat lain yang aktif",
  /perangkat lain/i.test(bioRowText), bioRowText.replace(/\s+/g, " ").slice(0, 90));
ok("B1: migrasi kredensial lama -> daftar (1 entri = laptop)",
  (await cloudCredentials()).list.length === 1);
ok("B1: sensor perangkat ini memang belum punya kredensial", (await credentialCount()) === 0);

// ================= B2: daftarkan di perangkat ini =================
await page.evaluate(() => { typeof appLockEnrollBiometric === 'function' && appLockEnrollBiometric(); });
await page.waitForTimeout(2500);
const setelahDaftar = await cloudCredentials();
ok("B2: pendaftaran perangkat ini BERHASIL lewat sensor virtual", (await credentialCount()) === 1);
ok("B2: kredensial laptop TIDAK terhapus (2 entri di cloud)",
  setelahDaftar.list.length === 2, `entri=${setelahDaftar.list.length}`);
ok("B2: kredensial laptop masih ada di daftar", setelahDaftar.list.includes(CRED_LAPTOP));
ok("B2: biometric_enabled tetap true", setelahDaftar.enabled === true);

// ================= B3: buka kunci pakai biometrik perangkat ini =================
await page.evaluate(() => { typeof closeAppLockModal === 'function' && closeAppLockModal(); });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const overlayTampil = await page.evaluate(() => !document.getElementById("appLockOverlay").classList.contains("hidden"));
ok("B3: auto_lock 0 -> app terkunci saat dibuka lagi", overlayTampil);
const btnTampil = await page.evaluate(() => !document.getElementById("appLockBioBtn").classList.contains("hidden"));
ok("B3: tombol biometrik MUNCUL setelah perangkat ini terdaftar", btnTampil);
const labelTombol = await page.evaluate(() => (document.getElementById("appLockBioBtn") || {}).innerText || "");
ok("B3: label tombol menyebut jenis biometrik perangkat, bukan 'sidik jari' generik",
  /Buka dengan/i.test(labelTombol), labelTombol.replace(/\s+/g, " ").slice(0, 60));

await page.click("#appLockBioBtn");
await page.waitForTimeout(3000);
const terbuka = await page.evaluate(() =>
  document.getElementById("appLockOverlay").classList.contains("hidden") &&
  !document.getElementById("appShell").classList.contains("hidden"));
ok("B3: sensor biometrik membuka kunci (overlay hilang, appShell tampil)", terbuka);

// ================= B4: matikan HANYA di perangkat ini =================
await page.evaluate(() => { typeof openAppLockModal === 'function' && openAppLockModal(); });
await page.waitForTimeout(1000);
await page.evaluate(() => { typeof appLockDisableBiometric === 'function' && appLockDisableBiometric(); });
await page.waitForTimeout(1500);
const setelahMatikan = await cloudCredentials();
ok("B4: mematikan di perangkat ini TIDAK mencabut laptop",
  setelahMatikan.list.length === 1 && setelahMatikan.list.includes(CRED_LAPTOP),
  `sisa=${setelahMatikan.list.length}`);
ok("B4: biometric_enabled tetap true karena laptop masih terdaftar", setelahMatikan.enabled === true);

// ---------- ringkasan ----------
console.log(`\n== HASIL VERIFY APPLOCK BIOMETRIC (${checks.length} cek) ==`);
let failed = 0;
for (const c of checks) {
  if (!c.pass) failed++;
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.extra ? " — " + c.extra : ""}`);
}
console.log(`\nError halaman (${errors.length}):`);
errors.slice(0, 12).forEach((e) => console.log("  " + e));
await browser.close();
process.exit(failed > 0 || errors.length > 0 ? 1 : 0);

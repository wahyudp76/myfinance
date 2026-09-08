// VERIFY APPLOCK — ritual "verify browser nyata" untuk fitur Kunci Aplikasi +
// Notifikasi & Pengingat (v92 / Fase 1A-1B roadmap). Boot app lokal lewat stub
// Supabase (auth + REST di-intercept Playwright; TANPA service key, TANPA
// menyentuh cloud). Perbedaan kunci vs verify-hud: stub tabel SETTINGS disini
// STATEFUL — PUT/upsert ditulis ke store di memori sehingga konfigurasi kunci
// (app_lock) bertahan lintas reload, persis perilaku cloud asli. Itu yang
// membuat gerbang kunci saat boot benar-benar teruji end-to-end.
// Jalankan: node scripts/verify-applock.mjs   (butuh `npx playwright install chromium`)
//   env: APPLOCK_URL (default http://localhost:8123/), APPLOCK_SHOTS (default /tmp/applock-shots)
//
// Alur uji (satu konteks browser, localStorage & stub settings persist antar reload):
//  F0  boot tanpa kunci      -> appShell langsung; 3 pengingat (budget jebol / goal H-7 /
//                               recurring H-1) tercatat di log per-perangkat (dedup contract)
//  F1  aktifkan kunci        -> PUT settings membawa app_lock (hash+salt, PIN TIDAK plaintext)
//  F2a reload di periode aktif -> TIDAK terkunci (v93 bug fix: mode idle 5 menit
//                               menghormati jejak aktivitas lintas reload)
//  F2b idle >= ambang -> GERBANG -> overlay SEBELUM appShell; PIN salah 1x -> hitungan;
//                               PIN benar -> app terbuka; pengingat TIDAK dobel (dedup)
//  F3  lockout               -> 5x PIN salah -> cooldown aktif (input disabled + hitungan detik)
//  F4  lupa PIN              -> password salah ditolak; password benar -> kunci ter-reset di
//                               cloud + app terbuka; reload berikutnya TANPA gerbang
import { chromium } from "playwright";

const URL_ = process.env.APPLOCK_URL || process.env.HUD_URL || "http://localhost:8123/";
const SHOTS = process.env.APPLOCK_SHOTS || "/tmp/applock-shots";
const REF = "uxfngmxghupdlwoeoxgh";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const EMAIL = "applock.verify@local.test";
const PASSWORD_BENAR = "rahasia-akun-benar";
const PIN = "135790";

// ---------- tanggal deterministik (zona waktu lokal browser == lokal Node) ----------
function dayStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const TODAY = dayStr(0);
const TOMORROW = dayStr(1);
const MONTH = TODAY.slice(0, 7);
const GOAL_DEADLINE_H7 = dayStr(7); // tepat 7 hari lagi -> pengingat H-7

// ---------- seed data ----------
// 1 tx Makanan 100000 bulan ini vs budget Makanan 100000 -> 100% (budget-over).
const demoTx = [{
  id: "demo-al-1", created_at: `${TODAY}T09:00:00Z`, tanggal: TODAY,
  jenis: "Pengeluaran", kategori: "Makanan", akun: "BCA", jumlah: "100000",
  keterangan: "[Demo] Makan keluarga", mata_uang: "IDR", user_id: USER_ID,
}];
const budgetRows = [{ kategori: "Makanan", jumlah: 100000, bulan: MONTH }];
// Template berulang aktif jatuh tempo BESOK -> pengingat H-1 (bukan overdue:
// yang overdue sudah ditangani processDueRecurring, jadi jangan dobel seed).
const recurringRows = [{
  id: "rec-al-1", jenis: "Pengeluaran", jumlah: 50000, akun: "BCA", kategori: "Hiburan",
  keterangan: "[Demo] Langganan musik", frequency: "bulanan", start_date: dayStr(-30),
  next_due_date: TOMORROW, end_date: null, active: true,
}];
// Settings STATEFUL: mulai dengan 1 goal (deadline H-7, belum tercapai).
let settingsStore = {
  user_id: USER_ID,
  data: { financial_goals: [{ id: "goal-al-1", nama: "Dana Darurat", target: 10000000, terkumpul: 2500000, deadline: GOAL_DEADLINE_H7 }] },
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// Sesi auth di-seed ke localStorage SEBELUM app boot (format supabase-js v2).
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
// Route dipasang di CONTEXT; catch-all DIDAFTARKAN DULU (Playwright: route
// terakhir terdaftar menang) supaya route spesifik di bawahnya yang meng-handle.
await context.route("**/functions/v1/**", (r) => r.fulfill(json({ ok: true })));
await context.route("**/rest/v1/**", (r) => r.fulfill(json([])));
// Stub auth: /token (signInWithPassword) HANYA menerima password yang benar —
// password salah -> 400 invalid_grant (negatif-test F4 mengandalkan ini).
await context.route("**/auth/v1/token**", (r) => {
  let body = {};
  try { body = JSON.parse(r.request().postData() || "{}"); } catch { /* ignore */ }
  if (body.password === PASSWORD_BENAR) return r.fulfill(json(session));
  return r.fulfill(json({ error: "invalid_grant", error_description: "Invalid login credentials" }, 400));
});
await context.route("**/auth/v1/user**", (r) => r.fulfill(json(session.user)));
// Stub SETTINGS STATEFUL: GET = store saat ini (bentuk maybeSingle: objek, bukan
// array); upsert POST = tulis payload penuh ke store -> bertahan lintas reload.
const settingsPuts = [];
await context.route("**/rest/v1/settings**", (r) => {
  const m = r.request().method();
  if (m === "GET") {
    return r.fulfill(settingsStore ? json(settingsStore) : json([]));
  }
  try {
    const body = JSON.parse(r.request().postData() || "{}");
    const row = Array.isArray(body) ? body[0] : body;
    if (row && row.data) {
      settingsStore = { user_id: row.user_id || USER_ID, data: row.data, updated_at: row.updated_at || new Date().toISOString() };
      settingsPuts.push(row.data);
    }
  } catch { /* ignore */ }
  return r.fulfill(json(settingsStore || {}, 201));
});
await context.route("**/rest/v1/transactions**", (r) => (r.request().method() === "GET" ? r.fulfill(json(demoTx)) : r.fulfill(json({}, 201))));
await context.route("**/rest/v1/budgets**", (r) => (r.request().method() === "GET" ? r.fulfill(json(budgetRows)) : r.fulfill(json({}, 201))));
await context.route("**/rest/v1/recurring_transactions**", (r) => (r.request().method() === "GET" ? r.fulfill(json(recurringRows)) : r.fulfill(json({}, 201))));

const page = await context.newPage();
// Negatif-test F4 (password salah) sengaja memicu 400 dari stub auth. Browser
// MENULIS sendiri baris console "Failed to load resource ... 400" untuk 4xx
// apa pun -- hitung yang diharapkan supaya baris itu tidak dihitung sbg error.
let expectedToken400 = 0;
let seenConsole400 = 0;
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") {
    if (/Failed to load resource.*400/.test(m.text()) && seenConsole400 < expectedToken400) {
      seenConsole400 += 1; // 400 yang memang diharapkan (password salah di F4)
      return;
    }
    errors.push(`console: ${m.text().slice(0, 200)}`);
  }
});
page.on("response", (r) => {
  if (r.status() >= 400) {
    // Negatif-test sadar: stub auth memang menolak password salah dengan 400.
    if (/\/auth\/v1\/token/.test(r.url()) && r.status() === 400) { expectedToken400 += 1; return; }
    errors.push(`HTTP ${r.status()}: ${r.url().slice(0, 140)}`);
  }
});

const checks = [];
const ok = (name, cond, extra = "") => { checks.push({ name, pass: !!cond, extra }); };
async function waitUntil(fn, timeout = 10000, label = "kondisi") {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fn()) return true;
    await page.waitForTimeout(150);
  }
  console.error(`waitUntil TIMEOUT: ${label}`);
  return false;
}

// ================= F0: boot tanpa kunci =================
await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("#appShell:not(.hidden)", { timeout: 45000 });
await page.waitForFunction(() => document.querySelectorAll("#recent-transactions-list > div").length > 0, null, { timeout: 45000 });
await page.waitForTimeout(1500);
ok("F0: tanpa kunci, appShell langsung tampil (overlay tersembunyi)", await page.evaluate(() =>
  document.getElementById("appLockOverlay").classList.contains("hidden")));
ok("F0: cache kunci lokal per-user ikut tertulis (nonaktif)", await page.evaluate((uid) => {
  const raw = JSON.parse(localStorage.getItem("myfinance_applock_cfg") || "null");
  return raw && raw.userId === uid && raw.cfg && raw.cfg.enabled === false;
}, USER_ID));
ok("F0: 3 pengingat tercatat di log per-perangkat (budget-over, goal H-7, recurring H-1)", await page.evaluate(([uid, month, tomorrow, dl]) => {
  const raw = JSON.parse(localStorage.getItem("myfinance_reminders_sent") || "null");
  if (!raw || raw.userId !== uid || !raw.log) return false;
  return raw.log[`budget:${month}:100:Makanan`] === 1 &&
    raw.log[`goal:goal-al-1:${dl}:H7`] === 1 &&
    raw.log[`recurring:rec-al-1:${tomorrow}`] === 1;
}, [USER_ID, MONTH, TOMORROW, GOAL_DEADLINE_H7]));
const sentLogAfterF0 = await page.evaluate(() => localStorage.getItem("myfinance_reminders_sent"));
await page.screenshot({ path: `${SHOTS}/01-f0-tanpa-kunci.png` });

// ================= F1: aktifkan kunci dari Pengaturan =================
await page.evaluate(() => switchView("pengaturan"));
await page.waitForTimeout(700);
ok("F1: kartu Kunci Aplikasi & Notifikasi tampil di Pengaturan", await page.evaluate(() => {
  return !!document.getElementById("applock-summary-text") && !!document.getElementById("notif-pref-budget") && !!document.getElementById("notif-pref-recurring") && !!document.getElementById("notif-pref-goals");
}));
ok("F1: toggle notifikasi default ON semua (prefs ikut settings)", await page.evaluate(() =>
  document.getElementById("notif-pref-budget").checked && document.getElementById("notif-pref-recurring").checked && document.getElementById("notif-pref-goals").checked));
await page.click('button[data-action="openAppLockModal"]');
await page.waitForSelector("#modalAppLock:not(.hidden)", { timeout: 10000 });
await page.waitForTimeout(400);
await page.fill("#applock-set-pin", PIN);
await page.fill("#applock-set-pin2", PIN);
const putsBaseline = settingsPuts.length;
// v102: HTML dinamis App Lock ikut dikonversi di Fase 4 tahap B, jadi selector
// ini sekarang data-action (dulu onclick=).
await page.click('button[data-action="appLockEnableFromModal"]');
await waitUntil(() => settingsPuts.length > putsBaseline, 10000, "PUT settings setelah aktifkan kunci");
{
  const delta = settingsPuts[settingsPuts.length - 1];
  const al = delta && delta.app_lock;
  ok("F1: PUT settings membawa app_lock aktif (enabled, auto_lock 5 menit)", !!(al && al.enabled === true && al.auto_lock_minutes === 5));
  ok("F1: PIN disimpan sbg hash SHA-256 + salt (32-hex), BUKAN plaintext", () => {
    const put = JSON.stringify(delta);
    return /^[0-9a-f]{64}$/.test(al.hash) && /^[0-9a-f]{32}$/.test(al.salt) && !put.includes(PIN);
  });
}
ok("F1: kartu Pengaturan menampilkan status Aktif", await waitUntil(async () =>
  (await page.textContent("#applock-summary-text")).includes("Aktif"), 5000, "kartu status Aktif"));
ok("F1: mengatur PIN mencatat jejak kehadiran (dasar jam idle lintas reload)", await page.evaluate((uid) => {
  const raw = JSON.parse(localStorage.getItem("myfinance_applock_activity") || "null");
  return raw && raw.userId === uid && typeof raw.ts === "number" && raw.ts > 0;
}, USER_ID));
await page.screenshot({ path: `${SHOTS}/02-f1-kunci-aktif.png` });

// ================= F2a (v93 BUG FIX): mode idle + reload di tengah periode aktif -> TIDAK terkunci =================
// User memilih "5 menit tidak dipakai" lalu reload < 5 menit setelah aktivitas:
// dulunya boot TETAP mengunci (bug), sekarang gerbang menghormati jejak aktivitas.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#appShell:not(.hidden)", { timeout: 30000 });
await page.waitForTimeout(700);
ok("F2a: idle-mode + aktivitas baru saja -> reload TIDAK langsung terkunci (bug fix)", await page.evaluate(() =>
  document.getElementById("appLockOverlay").classList.contains("hidden") &&
  !document.getElementById("appShell").classList.contains("hidden")));
await page.screenshot({ path: `${SHOTS}/03-f2a-reload-tanpa-kunci.png` });

// ================= F2b: sudah idle >= ambang -> reload TERKUNCI =================
await page.evaluate((uid) => {
  localStorage.setItem("myfinance_applock_activity", JSON.stringify({ userId: uid, ts: Date.now() - 6 * 60 * 1000 }));
}, USER_ID);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#appLockOverlay:not(.hidden)", { timeout: 30000 });
await page.waitForTimeout(600);
ok("F2b: idle > 5 menit -> overlay kunci tampil SEBELUM appShell (data tak termuat)", await page.evaluate(() =>
  document.getElementById("appShell").classList.contains("hidden") && !document.getElementById("appLockOverlay").classList.contains("hidden")));
ok("F2b: input PIN ter-focus otomatis", await page.evaluate(() => document.activeElement === document.getElementById("appLockPinInput")));
await page.fill("#appLockPinInput", "111111");
await page.press("#appLockPinInput", "Enter");
await page.waitForTimeout(400);
ok("F2b: PIN salah -> hitungan percobaan (1/5), overlay tetap", await page.evaluate(() =>
  /PIN salah \(1\/5\)/.test(document.getElementById("appLockStatus").textContent) &&
  !document.getElementById("appLockOverlay").classList.contains("hidden")));
await page.fill("#appLockPinInput", PIN);
await page.press("#appLockPinInput", "Enter");
await page.waitForSelector("#appShell:not(.hidden)", { timeout: 30000 });
await page.waitForFunction(() => document.querySelectorAll("#recent-transactions-list > div").length > 0, null, { timeout: 45000 });
ok("F2b: PIN benar -> overlay hilang, appShell + dashboard termuat", await page.evaluate(() =>
  document.getElementById("appLockOverlay").classList.contains("hidden") && !document.getElementById("appShell").classList.contains("hidden")));
ok("F2b: pengingat TIDAK dobel setelah unlock (dedup lintas reload)", await page.evaluate((before) =>
  localStorage.getItem("myfinance_reminders_sent") === before, sentLogAfterF0));
await page.screenshot({ path: `${SHOTS}/04-f2b-terbuka.png` });

// ================= F3: lockout 5x gagal -> cooldown =================
// (stale-kan lagi jejak aktivitas: unlock F2b barus saja men-touch-nya)
await page.evaluate((uid) => {
  localStorage.setItem("myfinance_applock_activity", JSON.stringify({ userId: uid, ts: Date.now() - 6 * 60 * 1000 }));
}, USER_ID);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#appLockOverlay:not(.hidden)", { timeout: 30000 });
await page.waitForTimeout(500);
for (let i = 1; i <= 5; i++) {
  await page.fill("#appLockPinInput", "000000");
  await page.press("#appLockPinInput", "Enter");
  await page.waitForTimeout(350);
}
ok("F3: 5x salah -> cooldown aktif (pesan tunggu + hitungan detik)", await page.evaluate(() =>
  /Tunggu \d+ detik/.test(document.getElementById("appLockStatus").textContent)));
ok("F3: input & tombol terkunci selama cooldown", await page.evaluate(() =>
  document.getElementById("appLockPinInput").disabled === true && document.getElementById("appLockUnlockBtn").disabled === true));
await page.screenshot({ path: `${SHOTS}/04-f3-lockout.png` });

// ================= F4: lupa PIN -> verifikasi password -> reset =================
await page.click("text=Lupa PIN?");
await page.waitForSelector("#appLockForgotBox:not(.hidden)", { timeout: 5000 });
await page.fill("#appLockForgotPassword", "password-salah-total");
await page.click('button[data-action="appLockRecover"]');
await page.waitForTimeout(800);
ok("F4: password salah -> ditolak, kunci TETAP aktif", await page.evaluate(() =>
  /Password salah/.test(document.getElementById("appLockStatus").textContent) &&
  !document.getElementById("appLockOverlay").classList.contains("hidden")));
const putsBaselineF4 = settingsPuts.length;
await page.fill("#appLockForgotPassword", PASSWORD_BENAR);
await page.click('button[data-action="appLockRecover"]');
await page.waitForSelector("#appShell:not(.hidden)", { timeout: 30000 });
await page.waitForFunction(() => document.querySelectorAll("#recent-transactions-list > div").length > 0, null, { timeout: 45000 });
{
  const found = await waitUntil(() => settingsPuts.length > putsBaselineF4, 10000, "PUT reset app_lock");
  const delta = settingsPuts[settingsPuts.length - 1];
  ok("F4: password benar -> kunci direset di cloud (enabled=false) + app terbuka", found && delta && delta.app_lock && delta.app_lock.enabled === false);
}
ok("F4: overlay hilang pasca recovery", await page.evaluate(() => document.getElementById("appLockOverlay").classList.contains("hidden")));
await page.screenshot({ path: `${SHOTS}/05-f4-pasca-recovery.png` });

// ================= F5: reload terakhir -> TANPA gerbang =================
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#appShell:not(.hidden)", { timeout: 30000 });
await page.waitForTimeout(800);
ok("F5: setelah reset, reload berikutnya LANGSUNG masuk (tanpa kunci)", await page.evaluate(() =>
  document.getElementById("appLockOverlay").classList.contains("hidden") && !document.getElementById("appShell").classList.contains("hidden")));

// ---------- ringkasan ----------
console.log(`\n== HASIL VERIFY APPLOCK (${checks.length} cek) ==`);
let failed = 0;
for (const c of checks) {
  if (!c.pass) failed++;
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.extra ? " — " + c.extra : ""}`);
}
console.log(`\nError halaman (${errors.length}):`);
errors.slice(0, 12).forEach((e) => console.log("  " + e));
console.log(`Screenshot: ${SHOTS}/01..05`);
await browser.close();
process.exit(failed > 0 || errors.length > 0 ? 1 : 0);

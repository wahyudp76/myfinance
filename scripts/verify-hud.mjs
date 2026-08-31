// VERIFY HUD — ritual "verify browser nyata" untuk transformasi Cyberpunk HUD.
// Boot app lokal lewat stub Supabase (auth + REST di-intercept Playwright; TANPA
// service key, TANPA menyentuh cloud), seed transaksi [Demo] deterministik, lalu
// assert elemen HUD + screenshot. Jaringan TIDAK diblokir (esm.sh/jsdelivr perlu
// nyata). Jalankan: node scripts/verify-hud.mjs   (butuh `npx playwright install chromium`)
//   env: HUD_URL (default http://localhost:8123/), HUD_SHOTS (default /tmp/hud-shots)
import { chromium } from "playwright";

const URL_ = process.env.HUD_URL || "http://localhost:8123/";
const SHOTS = process.env.HUD_SHOTS || "/tmp/hud-shots";
const REF = "uxfngmxghupdlwoeoxgh";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const EMAIL = "hud.verify@local.test";

// ---------- seed transaksi demo (14 hari ke belakang, tak pernah masa depan) ----------
function localKey(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const demoTx = [];
const plan = [
  [0, "Pengeluaran", "Makanan", "BCA", "18000", "[Demo] Makan siang"],
  [0, "Pengeluaran", "Transportasi", "DANA", "25000", "[Demo] Ojek"],
  [1, "Pemasukan", "Freelance", "BCA", "750000", "[Demo] Proyek desain"],
  [1, "Pengeluaran", "Belanja", "BCA", "240000", "[Demo] Kebutuhan dapur"],
  [2, "Pengeluaran", "Makanan", "DANA", "42000", "[Demo] Kopi & roti"],
  [3, "Pengeluaran", "Hiburan", "BCA", "95000", "[Demo] Streaming"],
  [4, "Pengeluaran", "Tagihan", "BCA", "385000", "[Demo] Listrik"],
  [5, "Pemasukan", "Gaji", "BCA", "4500000", "[Demo] Gaji bulanan"],
  [6, "Pengeluaran", "Transportasi", "BCA", "150000", "[Demo] Bensin"],
  [7, "Pengeluaran", "Makanan", "DANA", "56000", "[Demo] Makan malam"],
  [8, "Pengeluaran", "Belanja", "BCA", "310000", "[Demo] Baju"],
  [9, "Transfer", "DANA", "BCA", "200000", "[Demo] Top up e-wallet"],
  [10, "Pengeluaran", "Makanan", "DANA", "33000", "[Demo] Sarapan"],
  [12, "Pemasukan", "Freelance", "DANA", "450000", "[Demo] Komisi"],
  [13, "Pengeluaran", "Hiburan", "BCA", "120000", "[Demo] Nonton"],
];
plan.forEach(([off, jenis, kategori, akun, jumlah, ket], i) => {
  demoTx.push({
    id: `demo-${i}`, created_at: `${localKey(off)}T09:0${i % 10}:00Z`, tanggal: localKey(off),
    jenis, kategori, akun, jumlah, keterangan: ket, mata_uang: "IDR", user_id: USER_ID,
  });
});

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
// Route dipasang di CONTEXT (bukan page) supaya berlaku untuk semua halaman,
// termasuk halaman mobile. Catch-all DIDAFTARKAN DULU (Playwright: route
// terakhir terdaftar menang).
await context.route("**/functions/v1/**", (r) => r.fulfill(json({ ok: true })));
await context.route("**/rest/v1/**", (r) => r.fulfill(json([])));
await context.route("**/auth/v1/token**", (r) => r.fulfill(json(session)));
await context.route("**/auth/v1/user**", (r) => r.fulfill(json(session.user)));
await context.route("**/rest/v1/settings**", (r) => (r.request().method() === "GET" ? r.fulfill(json([])) : r.fulfill(json({}), 201)));
await context.route("**/rest/v1/transactions**", (r) => r.fulfill(json(demoTx)));

const page = await context.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });
page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url().slice(0, 140)}`); });

const checks = [];
const ok = (name, cond, extra = "") => { checks.push({ name, pass: !!cond, extra }); };

await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("#appShell:not(.hidden)", { timeout: 45000 });
await page.waitForFunction(() => document.querySelectorAll("#recent-transactions-list > div").length > 0, null, { timeout: 45000 });
await page.waitForTimeout(2500); // biarkan animasi chart selesai

// ---------- assertions HUD ----------
ok("html.dark aktif (HUD default)", await page.evaluate(() => document.documentElement.classList.contains("dark")));
ok("LED status ada & LIVE", (await page.locator(".hud-status").count()) >= 3 &&
  ((await page.locator(".hud-status .hud-status-text").first().textContent()) === "LIVE"));
ok("sparkline hero (in/out/net) ter-render", await page.evaluate(() =>
  ["spark-in", "spark-out", "spark-net"].every((id) => document.querySelector(`#${id} svg path`))));
ok("5 baris log transaksi + bar nominal", (await page.locator("#recent-transactions-list > div").count()) === 5 &&
  (await page.locator("#recent-transactions-list .hud-bar-fill").count()) === 5);
ok("saldo hero monospace + terisi", await page.evaluate(() => {
  const el = document.getElementById("dash-total");
  return /mono/i.test(getComputedStyle(el).fontFamily) && /^Rp\s?\d/.test(el.textContent.trim());
}));
ok("canvas balanceTrend tidak kosong", await page.evaluate(() => {
  const cv = document.getElementById("balanceTrendChart");
  return cv.width > 0 && cv.toDataURL().length > 5000;
}));
ok("radar donat aset tampil + persen di tengah", await page.evaluate(() => {
  const p = document.getElementById("asset-radar-pct");
  return p && p.style.display !== "none" && /^\d+%$/.test(p.querySelector("b").textContent) &&
    !!document.querySelector(".hud-radar-sweep");
}));
ok("kontrak tooltip #000 utuh", await page.evaluate(() =>
  typeof Chart !== "undefined" && Chart.defaults.plugins.tooltip.backgroundColor === "#000000"));

// ---------- view transaksi: terminal log ----------
await page.click("#nav-dashboard");
await page.evaluate(() => switchView("transaksi"));
await page.waitForSelector("#table-body .stagger-row", { timeout: 10000 });
ok("tabel transaksi: bar + nominal mono", (await page.locator("#table-body .hud-bar-fill").count()) > 0 &&
  (await page.locator("#table-body .hud-mono").count()) > 0);
await page.screenshot({ path: `${SHOTS}/02-transaksi.png`, fullPage: false });

// ---------- view laporan: radar kategori ----------
await page.evaluate(() => switchView("laporan"));
await page.waitForTimeout(1500);
ok("radar laporan (expense) tampil", await page.evaluate(() => {
  const p = document.getElementById("exp-radar-pct");
  return p && p.style.display !== "none" && /^\d+%$/.test(p.querySelector("b").textContent);
}));
ok("grafik garis laporan ber-DNA balanceTrend (crosshair+glow+glowPlugin)", await page.evaluate(() => {
  const d = typeof charts !== "undefined" && charts.daily && charts.daily.config;
  const t = typeof charts !== "undefined" && charts.catTrend && charts.catTrend.config;
  return d && d.data.datasets.every((ds) => ds.pointStyle === "crossRot" && ds.tension === 0.45 && ds.fill === true) &&
    (d.plugins || []).some((p) => p.id === "hudGlow") &&
    t && t.data.datasets[0].tension === 0.45 && (t.plugins || []).some((p) => p.id === "hudGlow");
}));
await page.screenshot({ path: `${SHOTS}/03-laporan.png`, fullPage: false });
await page.locator("#dailyChart").scrollIntoViewIfNeeded();
await page.waitForTimeout(900);
await page.screenshot({ path: `${SHOTS}/08-laporan-daily.png` });

// ---------- kontrak: command palette Ctrl+K ----------
await page.evaluate(() => switchView("dashboard"));
await page.waitForTimeout(400);
await page.keyboard.press("Control+k");
await page.waitForTimeout(600);
ok("command palette Ctrl+K terbuka", await page.evaluate(() => {
  const el = document.getElementById("modalPalette");
  return !!el && !el.classList.contains("hidden");
}));
await page.keyboard.press("Escape");

// ---------- screenshot desktop + mobile ----------
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/01-dashboard-desktop.png`, fullPage: true });
const mobile = await context.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.goto(URL_, { waitUntil: "domcontentloaded" });
await mobile.waitForSelector("#appShell:not(.hidden)", { timeout: 45000 });
await mobile.waitForFunction(() => document.querySelectorAll("#recent-transactions-list > div").length > 0, null, { timeout: 45000 });
await mobile.waitForTimeout(2000);

// ---------- paritas HUD mobile (Android) ----------
ok("mobile: FAB chamfered neon (bukan border putih)", await mobile.evaluate(() => {
  const f = document.getElementById("fabMobileCatat");
  const cs = getComputedStyle(f);
  return cs.clipPath !== "none" && cs.borderTopWidth === "1px";
}));
ok("mobile: nav bawah item aktif neon cyan", await mobile.evaluate(() => {
  const el = document.querySelector(".liquid-glass-nav-active");
  return el && getComputedStyle(el).color === "rgb(103, 232, 249)";
}));
ok("mobile: kontrol native ikut skema gelap", await mobile.evaluate(() =>
  getComputedStyle(document.documentElement).colorScheme.includes("dark")));
await mobile.click("#fabMobileCatat");
await mobile.waitForTimeout(900);
ok("mobile: drawer Catat Transaksi kaca neon", await mobile.evaluate(() => {
  const c = document.getElementById("modalFormContent");
  return c && getComputedStyle(c).backgroundImage.includes("linear-gradient");
}));
await mobile.screenshot({ path: `${SHOTS}/05-mobile-drawer.png` });
await mobile.evaluate(() => closeModal());
await mobile.waitForTimeout(600);
await mobile.screenshot({ path: `${SHOTS}/04-dashboard-mobile.png`, fullPage: true });

// ---------- ringkasan ----------
console.log(`\n== HASIL VERIFY HUD (${checks.length} cek) ==`);
let failed = 0;
for (const c of checks) {
  if (!c.pass) failed++;
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.extra ? " — " + c.extra : ""}`);
}
console.log(`\nError halaman (${errors.length}):`);
errors.slice(0, 12).forEach((e) => console.log("  " + e));
console.log(`Screenshot: ${SHOTS}/01..04`);
await browser.close();
process.exit(failed > 0 || errors.length > 0 ? 1 : 0);

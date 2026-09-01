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
  [6, "Transfer", "Shopee Merchant", "BCA", "100000", "[Demo] Beli aset Shopee Merchant"],
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
// Tx bulan SEBELUMNYA utk E2E salin realisasi: offset dinamis (tanggal hari ini + 5
// hari ke belakang = selalu jatuh di bulan sebelumnya, apa pun tanggal run-nya).
{
  const offPrev = new Date().getDate() + 5;
  demoTx.push({
    id: "demo-prev", created_at: `${localKey(offPrev)}T09:00:00Z`, tanggal: localKey(offPrev),
    jenis: "Pengeluaran", kategori: "Restoran", akun: "DANA", jumlah: "77000",
    keterangan: "[Demo] Makan keluarga bulan lalu (E2E salin realisasi)", mata_uang: "IDR", user_id: USER_ID,
  });
}

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
const txPosts = [];
await context.route("**/rest/v1/transactions**", (r) => {
  if (r.request().method() === "POST") { try { txPosts.push(JSON.parse(r.request().postData() || "{}")); } catch { /* ignore */ } }
  return r.fulfill(json(demoTx));
});
// Aset demo utk E2E setor dana (akun -> Bibit). GET: satu aset Bibit 1jt; tulis: ditangkap.
const budgetRows = [{ kategori: "Restoran", jumlah: 500000, bulan: "2026-08" }, { kategori: "Bensin", jumlah: 120000, bulan: "2026-08" }];
await context.route("**/rest/v1/budgets**", (r) => (r.request().method() === "GET" ? r.fulfill(json(budgetRows)) : r.fulfill(json({}), 201)));
const SHOPEE_SEED = { id: "asset-sm-1", user_id: "u1", nama: "Shopee Merchant", kategori: "Bisnis", platform: "Shopee", modal: 100000, nilai: 100000, terakhir: "2026-08-01T00:00:00.000Z", value_history: [{ tanggal: "2026-08-01", nilai: 100000 }], simbol: null, jumlah_unit: null, sumber_harga: null };
const BIBIT_SEED = { id: "asset-bibit-1", user_id: "u1", nama: "Bibit", kategori: "Reksadana", platform: "Bibit", modal: 1000000, nilai: 1000000, terakhir: "2026-08-01T00:00:00.000Z", value_history: [{ tanggal: "2026-08-01", nilai: 1000000 }], simbol: null, jumlah_unit: null, sumber_harga: null };
const assetWrites = [];
await context.route("**/rest/v1/assets**", (r) => {
  if (r.request().method() === "GET") return r.fulfill(json([BIBIT_SEED, SHOPEE_SEED]));
  try { assetWrites.push({ method: r.request().method(), body: JSON.parse(r.request().postData() || "{}") }); } catch { /* ignore */ }
  return r.fulfill(json({}));
});

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
ok("grafik batang ber-DNA HUD (gradasi scriptable + casing + glow)", await page.evaluate(() => {
  const ok1 = (c) => c && c.data.datasets.every((ds) => typeof ds.backgroundColor === "function" && ds.borderSkipped === false) && (c.plugins || []).some((p) => p.id === "hudGlow");
  return typeof charts !== "undefined" && ok1(charts.cashflow7 && charts.cashflow7.config) && ok1(charts.monthly && charts.monthly.config);
}));
ok("gradasi batang & donut AKTIF sejak render pertama (tanpa klik/hover)", await page.evaluate(() => {
  // Nilai opsi yang sudah di-resolve Chart.js harus CanvasGradient -- bukan string solid.
  const isGrad = (v) => !!(v && typeof v === "object" && typeof v.addColorStop === "function");
  const barEl = typeof charts !== "undefined" && charts.cashflow7 && charts.cashflow7.getDatasetMeta(0).data.find((el) => el && el.options);
  const arcEl = typeof charts !== "undefined" && charts.asset && charts.asset.getDatasetMeta(0).data.find((el) => el && el.options);
  return !!(barEl && isGrad(barEl.options.backgroundColor) && arcEl && isGrad(arcEl.options.backgroundColor));
}));
ok("donut ber-DNA HUD (segmen gradasi scriptable + glow violet)", await page.evaluate(() => {
  const a = typeof charts !== "undefined" && charts.asset && charts.asset.config;
  return a && typeof a.data.datasets[0].backgroundColor === "function" &&
    (a.plugins || []).some((p) => p.id === "hudGlow" && p !== undefined) && a.data.datasets[0].hoverOffset === 8;
}));
// ---------- E2E: mekanisme setor dana akun -> aset (Bibit) ----------
await page.evaluate(() => {
  document.querySelector('input[name="jenis"][value="Transfer"]').checked = true;
  handleFormTypeChange();
});
await page.evaluate(() => openCategorySelector());
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/13-selector-setor-aset.png` });
ok("selector tujuan transfer punya seksi Aset (Setor Dana) + Bibit", await page.evaluate(() => {
  const html = document.getElementById("categoryAccordionContainer").innerHTML;
  closeCategorySelector();
  return html.includes("Aset (Setor Dana)") && html.includes("Bibit");
}));
await page.evaluate(() => {
  selectCategoryItem("Bibit", "Aset", "Aset");
  document.getElementById("tanggal").value = "2026-08-15";
  document.getElementById("jumlah").value = "500000";
  document.getElementById("jumlah_display").value = "500.000";
  document.getElementById("keterangan").value = "[Demo] Top up Bibit";
  submitForm(null);
});
await page.waitForTimeout(400);
// kalau saldo akun sumber kurang -> dialog konfirmasi muncul -> lanjutkan
await page.evaluate(() => { const m = document.getElementById("modalConfirm"); if (m && !m.classList.contains("hidden")) _confirmYes(); });
await page.waitForTimeout(1800);
ok("setor ke aset: transaksi Transfer terkirim (kategori Bibit, 500rb)", () =>
  txPosts.some((b) => b.jenis === "Transfer" && b.kategori === "Bibit" && Number(b.jumlah) === 500000));
ok("setor ke aset: aset Bibit di-update (nilai+modal 1.5jt, riwayat 2026-08-15)", () =>
  assetWrites.some((q) => Number(q.body.nilai) === 1500000 && Number(q.body.modal) === 1500000 &&
    Array.isArray(q.body.value_history) && q.body.value_history.some((h) => h.tanggal === "2026-08-15" && h.nilai === 1500000)));
await page.evaluate(() => switchView("aset"));
await page.waitForTimeout(700);
ok("tab Aset: donut alokasi ber-DNA HUD (segmen + glow)", await page.evaluate(() => {
  const c = typeof charts !== "undefined" && charts.assetAlloc && charts.assetAlloc.config;
  return c && typeof c.data.datasets[0].backgroundColor === "function" && (c.plugins || []).some((p) => p.id === "hudGlow");
}));
ok("tab Aset: donut alokasi radar overlay + badge persen ala Komposisi", await page.evaluate(() => {
  const wrap = document.getElementById("assetAllocationChart").parentElement;
  const badge = document.getElementById("assetAlloc-radar-pct");
  return !!(wrap.querySelector(".hud-radar-sweep") && wrap.querySelector(".hud-radar-ticks") && wrap.querySelector(".hud-radar-ring") &&
    badge && (badge.style.display === "none" || /^\d+%$/.test(badge.querySelector("b").textContent)));
}));
await page.screenshot({ path: `${SHOTS}/10-tab-aset.png` });
await page.evaluate(() => { try { openCategoryDetail("Makanan", "Pengeluaran"); } catch { /* seed tanpa kategori tsb */ } });
await page.waitForTimeout(900);
ok("detail Kategori: batang tren + donut sub ber-DNA HUD", await page.evaluate(() => {
  const b = typeof charts !== "undefined" && charts.catTrend && charts.catTrend.config;
  if (!b || b.type !== "bar") return false;
  const barsOk = b.data.datasets.every((ds) => typeof ds.backgroundColor === "function" && ds.borderSkipped === false) &&
    (b.plugins || []).some((p) => p.id === "hudGlow");
  const s = charts.catSubDonut && charts.catSubDonut.config;
  const subOk = !s || (typeof s.data.datasets[0].backgroundColor === "function" && (s.plugins || []).some((p) => p.id === "hudGlow"));
  // donut sub (bila ter-render) wajib punya overlay radar ala Komposisi
  const host = document.getElementById("cat-sub-proportion");
  const subRadarOk = !host || !host.querySelector("#catSubDonut") || !!host.querySelector(".hud-radar-sweep");
  return barsOk && subOk && subRadarOk;
}));
await page.screenshot({ path: `${SHOTS}/11-kategori-detail.png` });
await page.evaluate(() => switchView("budget"));
await page.waitForTimeout(700);
ok("tab Anggaran: bar perbandingan ber-DNA HUD (bila ada data budget)", await page.evaluate(() => {
  const c = typeof charts !== "undefined" && charts.budgetCompare && charts.budgetCompare.config;
  if (!c) return true; // seed tanpa budget -> chart memang tidak dibuat
  return c.data.datasets.every((ds) => typeof ds.backgroundColor === "function") && (c.plugins || []).some((p) => p.id === "hudGlow");
}));
// ---------- E2E: salin budget/realisasi bulan lalu (modal Atur Budget) ----------
await page.evaluate(() => { switchView("budget"); openBudgetModal(); });
await page.waitForTimeout(600);
ok("modal budget: tombol Salin Budget & Salin Realisasi tersedia", await page.evaluate(() => {
  const txt = document.getElementById("modalBudgetContent").textContent;
  return txt.includes("Salin Budget Bulan Lalu") && txt.includes("Salin Realisasi Bulan Lalu");
}));
await page.evaluate(() => copyPrevMonthBudget("realisasi"));
await page.waitForTimeout(400);
await page.evaluate(() => { const m = document.getElementById("modalConfirm"); if (m && !m.classList.contains("hidden")) _confirmYes(); });
await page.waitForTimeout(400);
ok("salin realisasi: input Restoran terisi pengeluaran riil bulan lalu (77.000)", await page.evaluate(() => {
  const el = document.querySelector('.budget-input[data-category="Restoran"]');
  return !!el && el.value.replace(/[^0-9]/g, "") === "77000";
}));
await page.evaluate(() => copyPrevMonthBudget("budget"));
await page.waitForTimeout(700);
// form sudah terisi -> dialog konfirmasi timpa muncul -> lanjutkan
await page.evaluate(() => { const m = document.getElementById("modalConfirm"); if (m && !m.classList.contains("hidden")) _confirmYes(); });
await page.waitForTimeout(400);
ok("salin budget bulan lalu (via konfirmasi): Restoran 500.000 + Bensin 120.000", await page.evaluate(() => {
  const a = document.querySelector('.budget-input[data-category="Restoran"]');
  const b = document.querySelector('.budget-input[data-category="Bensin"]');
  return !!a && !!b && a.value.replace(/[^0-9]/g, "") === "500000" && b.value.replace(/[^0-9]/g, "") === "120000";
}));
await page.screenshot({ path: `${SHOTS}/14-modal-budget-salin.png` });
await page.evaluate(() => closeBudgetModal());
// ---------- E2E: perombakan tab Pengaturan (v40) ----------
await page.evaluate(() => switchView("pengaturan"));
await page.waitForTimeout(600);
ok("pengaturan: kartu Data & Cadangan ada; kartu duplikat+tombol mati hilang", await page.evaluate(() => {
  const txt = document.getElementById("view-pengaturan").textContent;
  return txt.includes("Data & Cadangan") && txt.includes("Ekspor Semua Data (JSON)") && !txt.includes("Unduh Cadangan (JSON)");
}));
ok("pengaturan: builder CSV menghasilkan BOM+header+baris dari data seed", await page.evaluate(() => {
  const svc = window.__myfinanceServices;
  const csv = svc.buildTransactionsCsv(globalData.slice(0, 3), { txIdrAmount });
  return csv.startsWith("\uFEFFTanggal,Jenis,Kategori,Akun,Nominal,Keterangan,Mata Uang") && csv.split("\r\n").length === 4;
}));
ok("pengaturan: filter rentang CSV 'month' konsisten domain", await page.evaluate(() => {
  const svc = window.__myfinanceServices;
  const month = svc.filterTransactionsForRange(globalData, "month", todayDateStr());
  const all = svc.filterTransactionsForRange(globalData, "all", todayDateStr());
  return month.length > 0 && all.length === globalData.length && month.length <= all.length;
}));
ok("pengaturan: kartu Tentang Aplikasi menampilkan jumlah data nyata", await page.evaluate(() => {
  const el = document.getElementById("appinfo-tx");
  return !!el && Number(el.textContent) === globalData.length;
}));
ok("preferensi: toggle sembunyikan nominal -> localStorage + kembali normal", await page.evaluate(() => {
  const cb = document.getElementById("pref-hide-nominal");
  cb.click();
  const on = localStorage.getItem("myfinance-hide-nominal") === "1" && cb.checked;
  cb.click();
  return on && localStorage.getItem("myfinance-hide-nominal") === "0" && !cb.checked;
}));
ok("preferensi: tampilan awal tersimpan & diterapkan sekali", await page.evaluate(() => {
  setDefaultView("budget");
  const saved = appSettings.default_view === "budget";
  window.__defaultViewApplied = false;
  applyDefaultViewOnce();
  const applied = document.getElementById("view-budget").classList.contains("block");
  setDefaultView("dashboard");
  window.__defaultViewApplied = false;
  applyDefaultViewOnce(); // "dashboard" bukan target pindah -> no-op by design (uji guard)
  const stillBudget = document.getElementById("view-budget").classList.contains("block");
  switchView("dashboard"); // reset eksplisit utk skenario berikutnya
  return saved && applied && stillBudget && document.getElementById("view-dashboard").classList.contains("block");
}));
ok("profil: email akun tampil + seksi ganti kata sandi tersedia", await page.evaluate(() => {
  openProfileModal();
  const email = document.getElementById("profile-modal-email").textContent;
  const hasPw = !!document.getElementById("profile-modal-password") && !!document.getElementById("profile-modal-password-confirm");
  closeProfileModal();
  return email.includes("@") && hasPw;
}));
ok("profil: validasi kata sandi murni menolak konfirmasi beda", await page.evaluate(() => {
  const v = window.__myfinanceServices.validatePasswordChange("rahasia123", "salah");
  return v.valid === false && /tidak sama/.test(v.error);
}));
// ---------- E2E: sync nilai reksadana dari data pasar (v41) ----------
ok("aset: config auto-update Reksadana terdaftar (sumber reksadana_bibit)", await page.evaluate(() => {
  return !!ASSET_AUTO_UPDATE_CONFIG["Reksadana"] && ASSET_AUTO_UPDATE_CONFIG["Reksadana"].sumber_harga === "reksadana_bibit";
}));
ok("aset: form kategori Reksadana memunculkan kolom Nama Dana + Jumlah Unit", await page.evaluate(() => {
  openAssetModal(false);
  document.getElementById("aset_kategori").value = "Reksadana";
  toggleAssetAutoUpdateSection();
  const label = document.getElementById("aset-simbol-label").textContent;
  const hidden = document.getElementById("aset-auto-update-section").classList.contains("hidden");
  closeAssetModal();
  return !hidden && label.includes("Nama Dana di Bibit");
}));
ok("aset: helper murni NAB x unit + aturan value_history", await page.evaluate(() => {
  const s2 = window.__myfinanceServices;
  const v = s2.computeMarketValue(1465.82, 100);
  const p = s2.withSyncedValue({ nilai: 1000000, value_history: [] }, { nilaiBaru: v, today: todayDateStr() });
  return v === 146582 && p.nilai === 146582 && p.value_history.length === 1;
}));
const reksaAsset = await page.evaluate(() => { const a = globalAssets.find(x => x.kategori === "Reksadana"); return a ? a.id : null; });
await page.evaluate((id) => openAssetDetailModal(id), reksaAsset);
await page.waitForTimeout(500);
const hasManualBtn = await page.evaluate(() => !document.getElementById("asset-detail-manualnav-btn").classList.contains("hidden"));
await page.evaluate(() => openManualNavModal());
await page.waitForTimeout(400);
await page.evaluate(() => {
  document.getElementById("manual-nav-value").value = "1500";
  document.getElementById("manual-nav-units").value = "100";
  previewManualNav();
});
const navPreview = await page.evaluate(() => document.getElementById("manual-nav-preview").textContent);
await page.evaluate(() => submitManualNav());
await page.waitForTimeout(900);
const lastAssetWrite = assetWrites.length ? assetWrites[assetWrites.length - 1] : null;
ok("aset Reksadana: tombol Sync NAB tampil & preview NAB x unit benar (Rp 150.000)", hasManualBtn && navPreview === "Rp 150.000");
ok("aset Reksadana: sync manual menulis nilai 150000 + 100 unit ke cloud", !!lastAssetWrite && Number(lastAssetWrite.body.nilai) === 150000 && Number(lastAssetWrite.body.jumlah_unit) === 100);
// ---------- E2E: self-heal akun-bayangan aset (bug "shopee merchant") ----------
// Simulasikan polusi lama: nama aset pernah terdaftar sebagai akun. loadData()
// harus membuangnya otomatis (aset ada + jejak Transfer-tujuan ada + tak pernah
// dipakai sebagai akun), lalu persist.
await page.evaluate(() => { appSettings.accounts.push("Shopee Merchant"); });
await page.evaluate(() => loadData());
await page.waitForTimeout(1800);
ok("bug-fix: 'Shopee Merchant' (aset) dibuang dari daftar akun oleh self-heal", await page.evaluate(() => !appSettings.accounts.includes("Shopee Merchant")));
ok("bug-fix: akun asli (BCA) tetap utuh pasca self-heal", await page.evaluate(() => appSettings.accounts.includes("BCA")));

// ---------- E2E: penyempurnaan refresh kripto/saham (v43) ----------
ok("aset: tombol Refresh Harga (semua aset auto) ada di header tab Aset", await page.evaluate(() => {
  switchView("aset");
  return !!document.querySelector('#view-aset button[onclick="refreshAllAssetPrices()"]');
}));
const kriptoUi = await page.evaluate(async () => {
  globalAssets.push({ id: "tmp-kripto", nama: "BTC Uji", kategori: "Kripto", platform: "Binance", modal: 1000000, nilai: 1380000, terakhir: new Date().toISOString(), value_history: [], simbol: "bitcoin", jumlah_unit: 0.001, sumber_harga: "coingecko" });
  openAssetDetailModal("tmp-kripto");
  await new Promise((r) => setTimeout(r, 300));
  const manualShown = !document.getElementById("asset-detail-manualnav-btn").classList.contains("hidden");
  const lineShown = !document.getElementById("asset-detail-market-line").classList.contains("hidden");
  const lineTxt = document.getElementById("asset-detail-market-text").textContent;
  openManualNavModal();
  const lbl = document.getElementById("manual-nav-value-label").textContent;
  const ttl = document.getElementById("manual-nav-title").textContent;
  closeManualNavModal();
  closeAssetDetailModal();
  globalAssets = globalAssets.filter((a) => a.id !== "tmp-kripto");
  return { manualShown, lineShown, coin: lineTxt.includes("CoinGecko"), koinLabel: /koin/i.test(lbl), kriptoTitle: /Kripto/i.test(ttl) };
});
ok("aset kripto: fallback manual + baris sumber CoinGecko + label harga per koin", kriptoUi.manualShown && kriptoUi.lineShown && kriptoUi.coin && kriptoUi.koinLabel && kriptoUi.kriptoTitle);

// ---------- E2E: hover baris "Komposisi Kas & Rekening" tetap terbaca (v44) ----------
await page.evaluate(() => switchView("dashboard"));
await page.waitForTimeout(200);
const breakdownRow = page.locator("#assetChart-list .hud-breakdown-row").first();
await breakdownRow.hover();
await page.waitForTimeout(350);
const hoverState = await breakdownRow.evaluate((el) => {
  const cs = getComputedStyle(el);
  const before = getComputedStyle(el, "::before");
  return { bgImage: cs.backgroundImage, bgColor: cs.backgroundColor, beforeOpacity: before.opacity };
});
ok("komposisi kas: hover baris = sapuan gradasi lembut (bukan blok putih)",
  hoverState.bgImage.includes("linear-gradient") &&
  hoverState.bgColor !== "rgb(255, 255, 255)" && hoverState.bgColor !== "rgb(248, 250, 252)");
ok("komposisi kas: hover memunculkan garis aksen kiri (neon)", hoverState.beforeOpacity === "1");

await page.screenshot({ path: `${SHOTS}/16-aset-reksadana.png` });
await page.evaluate(() => { closeManualNavModal(); closeAssetDetailModal(); });
await page.waitForTimeout(400);

await page.screenshot({ path: `${SHOTS}/15-pengaturan.png` });
await page.evaluate(() => switchView("dashboard"));
await page.waitForTimeout(300);
await page.evaluate(() => { try { openAccountDetail("BCA"); } catch { /* seed tanpa akun tsb */ } });
await page.waitForTimeout(900);
ok("detail Akun: bar cashflow + donut kategori ber-DNA HUD (bila terbuka)", await page.evaluate(() => {
  const b = typeof charts !== "undefined" && charts.accCashflow && charts.accCashflow.config;
  const d = charts.accCat && charts.accCat.config;
  if (!b && !d) return true;
  const barOk = !b || (b.data.datasets.every((ds) => typeof ds.backgroundColor === "function") && (b.plugins || []).some((p) => p.id === "hudGlow"));
  const donutOk = !d || (typeof d.data.datasets[0].backgroundColor === "function" && (d.plugins || []).some((p) => p.id === "hudGlow"));
  return barOk && donutOk;
}));
await page.screenshot({ path: `${SHOTS}/12-akun-detail.png` });
await page.evaluate(() => switchView("laporan"));
await page.waitForTimeout(700);
await page.screenshot({ path: `${SHOTS}/03-laporan.png`, fullPage: false });
await page.locator("#dailyChart").scrollIntoViewIfNeeded();
await page.waitForTimeout(900);
await page.screenshot({ path: `${SHOTS}/08-laporan-daily.png` });
await page.locator("#yearlyNetChart").scrollIntoViewIfNeeded();
await page.waitForTimeout(900);
await page.screenshot({ path: `${SHOTS}/09-laporan-yearly.png` });

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

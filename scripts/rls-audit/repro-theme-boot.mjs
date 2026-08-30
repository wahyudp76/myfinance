// REPRO lokal utk bug CI "transaction read not observed" pada 624aeec.
// Browser nyata (playwright chromium) -> site live, user uji sendiri (dibuat
// via Admin API). Mendengarkan console/pageerror/response/requestfailed utk
// menemukan LETUHAN tepatnya saat boot.
// Smoke test boot produksi/lokal: login dgn user uji sementara (Admin API),
// verifikasi boot penuh (GET transactions teramati), lalu uji interaktif fitur
// Warna Aksen (buka Pengaturan, klik swatch, cek CSS var + meta theme-color,
// reset). Kredensial dari environment (pola scripts/rls-audit lainnya).
//   REPRO_URL bisa diarahkan ke http://localhost:8000/ utk uji repo lokal.
import { chromium } from "playwright";
const env = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
};
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
  console.error("Butuh SUPABASE_URL & SUPABASE_SERVICE_KEY di environment.");
  process.exit(1);
}
const URL_ = env.SUPABASE_URL.replace(/\/$/, "");
const EMAIL = `repro-theme-${Date.now().toString(36)}@audit.local`;
const PASS = `A${crypto.randomUUID().replace(/-/g, "")}!`;

// buat user uji
const cu = await (await fetch(`${URL_}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true }),
})).json();
console.log("user uji:", cu.id);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

page.on("console", (m) => {
  console.log(`[console.${m.type()}]`, m.text().slice(0, 400));
});
await context.addInitScript(() => {
  window.addEventListener("unhandledrejection", (e) => {
    console.error("UNHANDLED-REJECTION:", e.reason && (e.reason.stack || e.reason.message || String(e.reason)));
  });
  window.addEventListener("error", (e) => {
    if (e.error) console.error("WINDOW-ERROR:", e.error.stack || e.error.message);
  });
});
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 300)));
page.on("requestfailed", (r) => console.log("[requestfailed]", r.url().slice(0, 120), r.failure()?.errorText));
page.on("response", async (r) => {
  const u = new URL(r.url());
  if (r.status() >= 400) console.log(`[HTTP ${r.status()}]`, r.url().slice(0, 140));
  if (u.pathname.includes("/rest/v1/") || u.pathname.includes("/myfinance/src/") || u.pathname.endsWith("sw.js")) {
    console.log(`[response ${r.status()}]`, u.pathname.slice(0, 90));
  }
});

try {
  await page.goto(process.env.REPRO_URL || "https://wahyudp76.github.io/myfinance/", { waitUntil: "domcontentloaded", timeout: 60000 });
  const emailInput = page.locator('input[type="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  await emailInput.waitFor({ state: "visible", timeout: 30000 });
  await emailInput.fill(EMAIL);
  await passwordInput.fill(PASS);
  const submit = page.locator('button[type="submit"], input[type="submit"]').first();
  if (await submit.count()) await submit.click(); else await passwordInput.press("Enter");
  await page.waitForTimeout(15000);
  console.log("\n== transaksi SETELAH 15s (kalau boot lanjut) ==");
  await page.waitForTimeout(10000);
  console.log("\n== buka tab Pengaturan, lalu klik swatch ke-4 (ungu) ==");
  await page.click("#nav-pengaturan");
  await page.waitForTimeout(600);
  await page.click("#theme-accent-swatches button:nth-child(4)");
  await page.waitForTimeout(1200);
  console.log("setelah klik -> data-theme-accent:", await page.evaluate(() => document.body.dataset.themeAccent ?? "(tidak ada)"));
  console.log("--accent-500:", await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent-500").trim() || "(kosong)"));
  console.log("meta theme-color:", await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.content));
  console.log("swatch aktif (aria-pressed):", await page.evaluate(() => document.querySelectorAll('#theme-accent-swatches button[aria-pressed="true"]').length));
  console.log("\n== reset (klik tombol Reset) ==");
  await page.click("#view-pengaturan div button:has-text(\"Reset\")");
  await page.waitForTimeout(800);
  console.log("setelah reset -> data-theme-accent:", await page.evaluate(() => document.body.dataset.themeAccent ?? "(tidak ada)"));

  // ===== verifikasi menyeluruh: logo, chart, ring budget, guard rose =====
  console.log("\n== Klik ulang ungu utk uji chart/maskot/ring ==");
  await page.click("#theme-accent-swatches button:nth-child(4)");
  await page.waitForTimeout(1500);
  await page.click("#nav-dashboard");
  await page.waitForTimeout(1500);
  const deep = await page.evaluate(() => {
    const out = {};
    out.accentVar = getComputedStyle(document.documentElement).getPropertyValue("--accent-500").trim();
    // maskot login: stop gradient pertama
    const stop = document.querySelector("#mascotBody stop");
    out.mascotStop = stop ? getComputedStyle(stop).stop_color || getComputedStyle(stop).stopColor || "?" : "tidak ada";
    // SEMUA chart yg ter-register: kumpulkan warna dataset
    out.chartColors = [];
    if (window.Chart && Chart.getChart) {
      for (const canvas of document.querySelectorAll("canvas")) {
        const c = Chart.getChart(canvas);
        if (!c) continue;
        for (const ds of c.data.datasets) {
          const bg = Array.isArray(ds.backgroundColor) ? ds.backgroundColor.slice(0, 2) : ds.backgroundColor;
          out.chartColors.push({ id: canvas.id, label: ds.label || "-", bg });
        }
      }
    }
    return out;
  });
  console.log("accent var:", deep.accentVar, "| maskot stop:", deep.mascotStop);
  console.log("chart terlihat:", JSON.stringify(deep.chartColors.slice(0, 6)));
  const expected400 = await page.evaluate(() => window.__myfinanceServices.buildAccentShades("#8b5cf6")["400"]);
  console.log("expected accent-400 (ungu):", expected400);
  const themed = deep.chartColors.filter((c) => JSON.stringify(c.bg).includes(expected400));
  console.log(themed.length ? `PASS chart pakai aksen (${themed.length} dataset)` : "CEK: tidak ada dataset beraksen (mungkin tab chart tidak terlihat)");

  console.log("\n== Tab Budget: ring pakai aksen? ==");
  await page.click("#nav-budget");
  await page.waitForTimeout(1500);
  const ring = await page.evaluate(() => document.getElementById("budget-ring-progress")?.style.stroke || "(belum dirender)");
  console.log("ring stroke:", ring, ring === expected400 ? "-> PASS" : "(cek manual bila beda)");

  console.log("\n== Tab Laporan: txTrend/yearlyNet ikut aksen? ==");
  await page.click("#nav-laporan");
  await page.waitForTimeout(1800);
  const laporan = await page.evaluate(() => {
    const out = {};
    for (const id of ["txTrendChart", "yearlyNetChart", "monthlyChart", "expenseCategoryChart"]) {
      const c = window.Chart && Chart.getChart(document.getElementById(id));
      if (!c) { out[id] = "(tidak ter-render)"; continue; }
      out[id] = c.data.datasets.map((d) => Array.isArray(d.backgroundColor) ? d.backgroundColor[0] : d.backgroundColor).join(",");
    }
    return out;
  });
  console.log("laporan:", JSON.stringify(laporan));

  console.log("\n== Tab Transaksi: txTrend ikut aksen? ==");
  await page.evaluate(() => switchView("transaksi"));
  await page.waitForTimeout(1500);
  const txTrend = await page.evaluate(() => {
    const c = window.Chart && Chart.getChart(document.getElementById("txTrendChart"));
    return c ? (Array.isArray(c.data.datasets[0].backgroundColor) ? c.data.datasets[0].backgroundColor[0] : c.data.datasets[0].backgroundColor) : "(tidak ter-render)";
  });
  console.log("txTrend warna:", txTrend, txTrend === "#8b5cf6" ? "-> PASS (income500 ungu)" : "(cek)");

  console.log("\n== GUARD: pilih rose -> chart 'Masuk' TETAP zamrud ==");
  await page.click("#nav-pengaturan");
  await page.waitForTimeout(400);
  await page.click("#theme-accent-swatches button:nth-child(7)"); // rose
  await page.waitForTimeout(1200);
  const guard = await page.evaluate(() => {
    const attr = document.body.dataset.themeAccent;
    const incomeBar = document.querySelectorAll("#theme-accent-swatches button").length; // sanity
    return { attr, income: window.__myfinanceServices && null };
  });
  console.log("atribut tema:", guard.attr);
  await page.click("#nav-dashboard");
  await page.waitForTimeout(1200);
  const roseChart = await page.evaluate(() => {
    const seen = [];
    for (const canvas of document.querySelectorAll("canvas")) {
      const c = window.Chart && Chart.getChart(canvas);
      if (!c) continue;
      for (const ds of c.data.datasets) {
        const bg = Array.isArray(ds.backgroundColor) ? ds.backgroundColor : [ds.backgroundColor];
        bg.forEach((b) => { if (b) seen.push(b); });
      }
    }
    return { masihZamrud: seen.includes("#34d399"), roseDiChart: seen.includes("#f43f5e") || seen.includes("#fb7185") };
  });
  console.log("guard rose ->", JSON.stringify(roseChart), roseChart.masihZamrud ? "(PASS: seri Masuk tetap zamrud)" : "(cek)");

  console.log("\n== ringkasan ==");
  console.log("body data-theme-accent:", await page.evaluate(() => document.body.dataset.themeAccent ?? "(tidak ada)"));
  console.log("loading overlay hidden:", await page.evaluate(() => { const el = document.getElementById("loading-overlay") || document.getElementById("loading"); if (!el) return "(elemen loading tak ditemukan)"; return el.classList.contains("hidden") || el.classList.contains("opacity-0") || getComputedStyle(el).display === "none"; }));
  console.log("swatch ter-render:", await page.evaluate(() => document.getElementById("theme-accent-swatches")?.children.length ?? -1));
} finally {
  await browser.close();
  await fetch(`${URL_}/auth/v1/admin/users/${cu.id}`, { method: "DELETE", headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } });
  console.log("user uji dihapus");
}

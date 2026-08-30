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
  console.log("\n== ringkasan ==");
  console.log("body data-theme-accent:", await page.evaluate(() => document.body.dataset.themeAccent ?? "(tidak ada)"));
  console.log("loading overlay hidden:", await page.evaluate(() => { const el = document.getElementById("loading-overlay") || document.getElementById("loading"); if (!el) return "(elemen loading tak ditemukan)"; return el.classList.contains("hidden") || el.classList.contains("opacity-0") || getComputedStyle(el).display === "none"; }));
  console.log("swatch ter-render:", await page.evaluate(() => document.getElementById("theme-accent-swatches")?.children.length ?? -1));
} finally {
  await browser.close();
  await fetch(`${URL_}/auth/v1/admin/users/${cu.id}`, { method: "DELETE", headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } });
  console.log("user uji dihapus");
}

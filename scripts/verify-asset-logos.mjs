// VERIFY ASSET LOGOS — E2E "logo aset benar-benar tampil" (v86).
// ==============================================================================
// Ritual verifikasi browser nyata khusus LOGO PLATFORM pada tab Aset:
// boot app lokal lewat stub Supabase (auth + REST di-intercept Playwright;
// TANPA service key, TANPA menyentuh cloud), seed aset dgn beragam platform
// (lokal, katalog DB, platform custom DB, fallback netral), lalu assert:
//   1. <img> logo TER-RENDER dengan src yang benar di kartu aset,
//   2. gambarnya BENAR-BENAR DIMUAT browser (img.naturalWidth > 0) --
//      ini yang membedakan "tag img ada" vs "logo kelihatan",
//   3. detail aset & saran platform di form Tambah Aset ikut memakai logo,
//   4. guard anti-collision: platform "Dana" TIDAK kebagian logo Danamas.
// Jalankan: node scripts/verify-asset-logos.mjs
//   (butuh `npx playwright install chromium`; server: npx http-server . -p 8123 -c-1)
//   env: HUD_URL (default http://localhost:8123/), HUD_SHOTS (default /tmp/asset-logo-shots)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL_ = process.env.HUD_URL || "http://localhost:8123/";
const SHOTS = process.env.HUD_SHOTS || "/tmp/asset-logo-shots";
mkdirSync(SHOTS, { recursive: true });

const REF = "uxfngmxghupdlwoeoxgh";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const EMAIL = "logo.verify@local.test";

// Logo data-URL sederhana (svg pasif) utk platform CUSTOM dari katalog DB --
// meniru baris platform_logos yang ditambahkan admin (bukan katalog bawaan).
const CUSTOM_LOGO_DATA_URL =
  "data:image/svg+xml;base64," +
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="12" fill="#7c3aed"/><text x="32" y="42" font-size="28" text-anchor="middle" fill="#fff" font-family="sans-serif">K</text></svg>').toString("base64");

function localKey(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- seed aset: campuran platform lokal / DB / custom / tak dikenal ----------
const seedAssets = [
  { id: "a-1", nama: "Reksadana Pasar Uang", kategori: "Reksadana", platform: "Bibit", modal: "1000000", nilai: "1150000", terakhir: localKey(0), value_history: [] },
  { id: "a-2", nama: "Saham BBRI", kategori: "Saham", platform: "Stockbit", modal: "2000000", nilai: "2400000", terakhir: localKey(1), value_history: [] },
  { id: "a-3", nama: "GoTo Holdings", kategori: "Saham", platform: "GoTo", modal: "500000", nilai: "420000", terakhir: localKey(2), value_history: [] },
  { id: "a-4", nama: "Danamas Stabil", kategori: "Reksadana", platform: "Danamas Stabil", modal: "3000000", nilai: "3180000", terakhir: localKey(3), value_history: [] },
  { id: "a-5", nama: "BTC Long Term", kategori: "Kripto", platform: "Indodax", modal: "8000000", nilai: "12500000", terakhir: localKey(4), value_history: [] },
  { id: "a-6", nama: "Portofolio IPOT", kategori: "Saham", platform: "IPOT", modal: "1500000", nilai: "1600000", terakhir: localKey(5), value_history: [] },
  { id: "a-7", nama: "Saldo DANA", kategori: "Kripto", platform: "Dana", modal: "200000", nilai: "200000", terakhir: localKey(6), value_history: [] },
  { id: "a-8", nama: "Deposito Mini", kategori: "Deposito", platform: "Kripto Ku", modal: "1000000", nilai: "1030000", terakhir: localKey(7), value_history: [] },
  { id: "a-9", nama: "Emas Antam", kategori: "Emas", platform: "Toko Emas ABC", modal: "5000000", nilai: "5600000", terakhir: localKey(8), value_history: [] },
].map((a) => ({ ...a, simbol: null, jumlah_unit: null, sumber_harga: null, tanggal_nav: null }));

// Katalog DB (meniru hasil migrasi 20260906_platform_logos.sql + 1 baris custom admin).
const dbLogos = [
  { platform_key: "goto", display_name: "GoTo", logo_url: "icons/platforms/goto.svg", source_url: "https://gotocompany.com/", is_active: true },
  { platform_key: "danamas-stabil", display_name: "Danamas Stabil", logo_url: "icons/platforms/danamas-stabil.png", source_url: "https://www.banksinarmas.com/", is_active: true },
  { platform_key: "crypto-ku", display_name: "Kripto Ku", logo_url: CUSTOM_LOGO_DATA_URL, source_url: null, is_active: true },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

const session = {
  access_token: "stub-token", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "stub-refresh",
  user: { id: USER_ID, aud: "authenticated", email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};
await context.addInitScript(([ref, s]) => {
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s));
}, [REF, session]);

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
// Catch-all DIDAFTARKAN DULU (route terakhir terdaftar menang).
await context.route("**/functions/v1/**", (r) => r.fulfill(json({ ok: true })));
await context.route("**/rest/v1/**", (r) => r.fulfill(json([])));
await context.route("**/auth/v1/token**", (r) => r.fulfill(json(session)));
await context.route("**/auth/v1/user**", (r) => r.fulfill(json(session.user)));
await context.route("**/rest/v1/settings**", (r) => (r.request().method() === "GET" ? r.fulfill(json([])) : r.fulfill(json({}), 201)));
await context.route("**/rest/v1/transactions**", (r) => r.fulfill(json([])));
await context.route("**/rest/v1/platform_logos**", (r) => r.fulfill(json(dbLogos)));
await context.route("**/rest/v1/assets**", (r) => {
  const m = r.request().method();
  if (m === "GET") return r.fulfill(json(seedAssets));
  return r.fulfill(json({}, 201));
});

const errors = [];
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("#appShell:not(.hidden)", { timeout: 45000 });
// Tunggu loadData selesai: kartu aset ter-render (globalAssets adalah global
// lexical monolit -- diakses TANPA prefix window.).
await page.waitForFunction(
  () => typeof globalAssets !== "undefined" && Array.isArray(globalAssets) && globalAssets.length > 0,
  null,
  { timeout: 45000 },
);

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}`); }
};

await page.evaluate(() => switchView("aset"));
await page.waitForTimeout(800); // beri waktu render kartu + chart donut

// ---------- 1. setiap kartu aset: logo <img> benar & BENAR-BENAR DIMUAT ----------
const cardLogos = await page.evaluate(() => {
  const cards = [...document.querySelectorAll("#asset-list-container > div")];
  return cards.map((card) => {
    const nama = card.querySelector("p.font-bold")?.textContent?.trim() || "";
    const logoBox = card.querySelector("div.w-10, div.w-12");
    const img = logoBox?.querySelector("img") || null;
    const badge = logoBox?.querySelector("span");
    const icon = logoBox?.querySelector("i");
    // v126: radius logo HARUS mengikuti radius box-nya (rounded-[inherit]).
    const boxRadius = logoBox ? getComputedStyle(logoBox).borderRadius : null;
    const imgRadius = img ? getComputedStyle(img).borderRadius : null;
    return {
      nama,
      imgSrc: img ? img.getAttribute("src") : null,
      imgLoaded: img ? (img.complete && img.naturalWidth > 0) : false,
      radiusOk: img ? boxRadius === imgRadius && parseFloat(boxRadius) > 0 : null,
      badgeText: badge && !badge.querySelector("i") ? badge.textContent.trim() : null,
      iconClass: icon ? icon.className : null,
    };
  });
});
ok("tab aset: 9 kartu aset ter-render", cardLogos.length === 9);

const byName = Object.fromEntries(cardLogos.map((c) => [c.nama, c]));
ok("Bibit -> img icons/platforms/bibit.svg & TERMUAT", byName["Reksadana Pasar Uang"]?.imgSrc === "icons/platforms/bibit.svg" && byName["Reksadana Pasar Uang"]?.imgLoaded === true);
ok("Stockbit -> img icons/platforms/stockbit.svg & TERMUAT", byName["Saham BBRI"]?.imgSrc === "icons/platforms/stockbit.svg" && byName["Saham BBRI"]?.imgLoaded === true);
ok("GoTo (katalog DB) -> img goto.svg & TERMUAT", byName["GoTo Holdings"]?.imgSrc === "icons/platforms/goto.svg" && byName["GoTo Holdings"]?.imgLoaded === true);
ok("Danamas Stabil (katalog DB) -> img danamas-stabil.png & TERMUAT", byName["Danamas Stabil"]?.imgSrc === "icons/platforms/danamas-stabil.png" && byName["Danamas Stabil"]?.imgLoaded === true);
ok("Indodax -> img indodax.png & TERMUAT", byName["BTC Long Term"]?.imgSrc === "icons/platforms/indodax.png" && byName["BTC Long Term"]?.imgLoaded === true);
ok("IPOT -> badge 'IP' (tanpa file lokal -- by design)", byName["Portofolio IPOT"]?.badgeText === "IP");
ok("Dana -> logo e-wallet DANA (icons/banks/dana.svg), BUKAN Danamas", byName["Saldo DANA"]?.imgSrc === "icons/banks/dana.svg" && byName["Saldo DANA"]?.imgLoaded === true);
ok("Platform custom DB 'Kripto Ku' -> img data-URL & TERMUAT", String(byName["Deposito Mini"]?.imgSrc || "").startsWith("data:image/svg+xml") === true && byName["Deposito Mini"]?.imgLoaded === true);
ok("Platform tak dikenal -> fallback ikon dompet netral (bukan img rusak)", byName["Emas Antam"]?.imgSrc === null && /fa-wallet/.test(String(byName["Emas Antam"]?.iconClass || "")));
// v126: SEMUA logo img di kartu aset wajib mengikuti radius box-nya (rounded-[inherit]).
{
  const withImg = cardLogos.filter((c) => c.imgSrc);
  const allRounded = withImg.length > 0 && withImg.every((c) => c.radiusOk === true);
  ok(`v126 pembulatan: semua ${withImg.length} logo img membulat mengikuti box-nya (rounded-[inherit])`, allRounded);
}

await page.screenshot({ path: `${SHOTS}/01-aset-logos.png`, fullPage: false });

// ---------- 2. detail aset ikut memakai logo ----------
await page.evaluate(() => openAssetDetailModal("a-1"));
await page.waitForTimeout(400);
const detailLogo = await page.evaluate(() => {
  const box = document.getElementById("asset-detail-icon");
  const img = box?.querySelector("img");
  return img
    ? {
        src: img.getAttribute("src"),
        loaded: img.complete && img.naturalWidth > 0,
        radiusOk: getComputedStyle(img).borderRadius === getComputedStyle(box).borderRadius && parseFloat(getComputedStyle(box).borderRadius) > 0,
      }
    : null;
});
ok("detail aset: logo Bibit tampil & TERMUAT", detailLogo?.src === "icons/platforms/bibit.svg" && detailLogo?.loaded === true);
ok("detail aset: logo ikut membulat mengikuti box-nya (v126)", detailLogo?.radiusOk === true);
await page.evaluate(() => closeAssetDetailModal());
await page.waitForTimeout(400);

// ---------- 3. form Tambah Aset: saran platform memakai logo ----------
const suggestionLogos = await page.evaluate(async () => {
  const waitImgs = (ms) => new Promise((resolve) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      const imgs = [...document.querySelectorAll("#asset-platform-suggestions img")];
      const allDone = imgs.length > 0 && imgs.every((i) => i.complete);
      if (allDone || Date.now() > deadline) resolve(); else setTimeout(tick, 50);
    };
    tick();
  });
  openAssetModal(false);
  const box = document.getElementById("asset-platform-suggestions");
  if (!box) return null;
  searchAssetBankSuggestions("");
  await waitImgs(3000); // tunggu logo saran benar2 termuat (network live bisa lebih lambat)
  const items = [...box.querySelectorAll("div.flex.items-center.gap-2")];
  const out = items.map((it) => ({
    name: it.querySelector("span")?.textContent?.trim() || "",
    hasImg: !!it.querySelector("img"),
    imgLoaded: it.querySelector("img") ? (it.querySelector("img").complete && it.querySelector("img").naturalWidth > 0) : false,
  }));
  // Query spesifik utk item di luar 5 besar (IPOT = badge, di urutan ke-9 katalog).
  searchAssetBankSuggestions("ipot");
  const ipotItem = [...box.querySelectorAll("div.flex.items-center.gap-2")].map((it) => ({
    name: it.querySelector("span")?.textContent?.trim() || "",
    hasImg: !!it.querySelector("img"),
  }))[0] || null;
  closeAssetModal();
  return { list: out, ipot: ipotItem };
});
const suggByName = Object.fromEntries((suggestionLogos?.list || []).map((s) => [s.name, s]));
ok("form aset: saran platform tampil (>= 5 item)", (suggestionLogos?.list || []).length >= 5);
ok("form aset: saran 'Bibit' pakai <img> logo & TERMUAT", suggByName["Bibit"]?.hasImg === true && suggByName["Bibit"]?.imgLoaded === true);
ok("form aset: cari 'ipot' -> tetap badge (tanpa file lokal)", suggestionLogos?.ipot?.name === "IPOT" && suggestionLogos?.ipot?.hasImg === false);

// ---------- 4. mobile viewport: logo tetap muncul ----------
const mPage = await context.newPage();
mPage.on("pageerror", (e) => errors.push(String(e)));
await mPage.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
await mPage.waitForSelector("#appShell:not(.hidden)", { timeout: 45000 });
await mPage.waitForFunction(
  () => typeof globalAssets !== "undefined" && Array.isArray(globalAssets) && globalAssets.length > 0,
  null,
  { timeout: 45000 },
);
await mPage.setViewportSize({ width: 390, height: 844 });
await mPage.evaluate(() => switchView("aset"));
await mPage.waitForTimeout(800);
const mobileLoaded = await mPage.evaluate(() =>
  [...document.querySelectorAll("#asset-list-container img")].filter((i) => i.complete && i.naturalWidth > 0).length,
);
ok(`mobile (390px): ${mobileLoaded} logo termuat (>= 7 diharapkan)`, mobileLoaded >= 7);
await mPage.screenshot({ path: `${SHOTS}/02-aset-logos-mobile.png`, fullPage: false });

console.log(`\nError halaman (${errors.length}):`);
errors.slice(0, 5).forEach((e) => console.log("  -", e));
console.log(`Screenshot: ${SHOTS}/01-aset-logos.png, ${SHOTS}/02-aset-logos-mobile.png`);
await browser.close();
if (fail > 0 || errors.length > 0) {
  console.log(`\nHASIL: ${pass} PASS / ${fail} FAIL / ${errors.length} error halaman`);
  process.exit(1);
}
console.log(`\nHASIL: ${pass} PASS / ${fail} FAIL`);

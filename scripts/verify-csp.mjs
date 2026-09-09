// VERIFY CSP — harness untuk pengetatan Content-Security-Policy (v109).
//
// Setelah `'unsafe-inline'` dilepas dari script-src dan diganti 4 hash sha256,
// dan dari style-src setelah seluruh atribut style dipindah ke CSS/CSSOM,
// ada dua cara gagal yang sama-sama buruk dan sama-sama SENYAP di unit test:
//   (a) TERLALU KETAT -- satu blok inline yang hash-nya meleset (mis. karena
//       satu spasi berubah) tidak akan dieksekusi browser. Aplikasi bisa tetap
//       "terlihat" boot, tapi tema tidak diterapkan / grafik tak pernah dimuat /
//       service worker tak terdaftar. Tidak ada exception, cuma diam.
//   (b) TERLALU LONGGAR -- CSP tertulis rapi tapi ternyata tidak menegakkan
//       apa pun, sehingga rasa aman yang palsu.
//
// Karena itu harness ini menguji KEDUA arah: setiap blok inline terbukti
// BENAR-BENAR JALAN, dan skrip inline yang disuntikkan terbukti DIBLOKIR.
//
// Jalankan: node scripts/verify-csp.mjs
//   env: CSP_URL (default http://localhost:8123/)
import { chromium } from "playwright";

const URL_ = process.env.CSP_URL || "http://localhost:8123/";
const REF = "uxfngmxghupdlwoeoxgh";
const USER_ID = "11111111-2222-3333-4444-555555555555";

let gagal = 0;
const ok = (kondisi, label, extra = "") => {
  if (!kondisi) gagal += 1;
  console.log(`${kondisi ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
};

const session = {
  access_token: "stub", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r",
  user: { id: USER_ID, aud: "authenticated", email: "csp@local.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const hariIni = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const tx = [{
  id: "t1", created_at: `${hariIni()}T09:00:00Z`, tanggal: hariIni(), jenis: "Pengeluaran",
  kategori: "Makanan", akun: "BCA", jumlah: "25000", keterangan: "[Demo] makan", mata_uang: "IDR", user_id: USER_ID,
}];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Pelanggaran CSP dicatat SEBELUM apa pun berjalan, supaya yang terjadi saat
// boot paling awal (blok tema) ikut tertangkap.
await context.addInitScript(([r, s]) => {
  const k = `sb-${r}-auth-token`;
  if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s));
  window.__cspViolations = [];
  document.addEventListener("securitypolicyviolation", (e) => {
    window.__cspViolations.push({
      directive: e.violatedDirective,
      blocked: String(e.blockedURI || "").slice(0, 80),
      sample: String(e.sample || "").slice(0, 60),
    });
  });
}, [REF, session]);
await context.route("**/functions/v1/**", (r) => r.fulfill(json({ ok: true })));
await context.route("**/rest/v1/**", (r) => r.fulfill(json([])));
await context.route("**/auth/v1/**", (r) => r.fulfill(json(session)));
await context.route("**/rest/v1/transactions**", (r) => r.fulfill(json(tx)));

const page = await context.newPage();
const errorHalaman = [];
const konsolError = [];
page.on("pageerror", (e) => errorHalaman.push(String(e).slice(0, 180)));
page.on("console", (m) => { if (m.type() === "error") konsolError.push(m.text().slice(0, 200)); });

await page.goto(URL_, { waitUntil: "networkidle" });
await page.waitForSelector("#appShell:not(.hidden)", { timeout: 30000 });
await page.waitForTimeout(3000);

// ===================== C1: kebijakan memang sudah diperketat =====================
console.log("\n-- C1: bentuk kebijakan --");
const c1 = await page.evaluate(() => {
  const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  const isi = meta ? meta.getAttribute("content") : "";
  const scriptSrc = (isi.match(/script-src ([^;]*)/) || [])[1] || "";
  const styleSrc = (isi.match(/style-src ([^;]*)/) || [])[1] || "";
  const styleSrcAttr = (isi.match(/style-src-attr ([^;]*)/) || [])[1] || "";
  return {
    ada: !!meta,
    scriptSrc,
    styleSrc,
    styleSrcAttr,
    unsafeInline: scriptSrc.includes("'unsafe-inline'"),
    unsafeEval: scriptSrc.includes("'unsafe-eval'"),
    styleUnsafeInline: styleSrc.includes("'unsafe-inline'"),
    styleAttrNone: styleSrcAttr.split(/\s+/).includes("'none'"),
    jumlahHash: (scriptSrc.match(/'sha256-/g) || []).length,
    inlineDiDom: [...document.querySelectorAll("script")].filter((s) => !s.src).length,
  };
});
ok(c1.ada, "C1: meta CSP hadir");
ok(!c1.unsafeInline, "C1: script-src TIDAK lagi memuat 'unsafe-inline'", c1.scriptSrc.slice(0, 60) + "…");
ok(!c1.unsafeEval, "C1: script-src tidak memuat 'unsafe-eval'");
ok(!c1.styleUnsafeInline, "C1: style-src TIDAK lagi memuat 'unsafe-inline'", c1.styleSrc);
ok(c1.styleAttrNone, "C1: style-src-attr memblokir atribut style", c1.styleSrcAttr);
ok(c1.jumlahHash === c1.inlineDiDom,
  "C1: jumlah hash == jumlah blok skrip inline di dokumen", `${c1.jumlahHash} hash / ${c1.inlineDiDom} blok`);

// ===================== C2: tidak ada pelanggaran saat boot normal =====================
console.log("\n-- C2: boot normal tidak melanggar kebijakan sendiri --");
const pelanggaranBoot = await page.evaluate(() => window.__cspViolations.slice());
ok(pelanggaranBoot.length === 0, "C2: nol pelanggaran CSP selama boot",
  pelanggaranBoot.map((v) => `${v.directive}:${v.blocked}`).join(" | ") || "bersih");
ok(errorHalaman.length === 0, "C2: nol error halaman", errorHalaman.slice(0, 2).join(" | "));

// ===================== C3: SETIAP blok inline benar-benar DIJALANKAN =====================
// Inilah kegagalan senyap yang paling ditakuti: hash meleset -> blok tidak jalan,
// tanpa exception apa pun. Tiap blok diperiksa lewat efek nyatanya.
console.log("\n-- C3: keempat blok inline benar-benar tereksekusi --");
const c3 = await page.evaluate(async () => ({
  // #1 blok tema: menempelkan kelas/atribut tema sebelum render
  tema: document.documentElement.className + "|" + (document.documentElement.getAttribute("data-theme") || ""),
  // #2 blok jembatan auth
  authReady: typeof window.__myfinanceAuthReady !== "undefined",
  // #4 blok pemuat pustaka grafik
  loadChartLibs: typeof window.__loadChartLibs === "function",
  // #6 blok registrasi service worker
  swTerdaftar: !!(await navigator.serviceWorker.getRegistration()),
}));
ok(c3.tema.length > 1, "C3: blok #1 (tema) jalan — kelas tema terpasang di <html>", c3.tema);
ok(c3.authReady, "C3: blok #2 (jembatan auth) jalan — window.__myfinanceAuthReady ada");
ok(c3.loadChartLibs, "C3: blok #4 (pemuat grafik) jalan — window.__loadChartLibs ada");
ok(c3.swTerdaftar, "C3: blok #6 (registrasi SW) jalan — service worker terdaftar");

// ===================== C4: skrip yang DIBUAT runtime tetap boleh (jangan kelewat ketat) =====================
console.log("\n-- C4: skrip lokal ber-src yang dibuat runtime tetap jalan --");
const c4 = await page.evaluate(async () => {
  await window.__loadChartLibs();
  return { chart: typeof window.Chart === "function" };
});
ok(c4.chart, "C4: Chart.js termuat lewat <script src> yang dibuat runtime ('self' cukup)");

// ===================== C5: BUKTI NEGATIF — skrip inline sungguhan DIBLOKIR =====================
// Tanpa cek ini, C1 cuma membuktikan teksnya rapi, bukan bahwa browser menolak.
console.log("\n-- C5: penegakan nyata terhadap penyisipan skrip inline --");
const c5 = await page.evaluate(async () => {
  const sebelum = window.__cspViolations.length;
  window.__XSS_INLINE = false;
  const s = document.createElement("script");
  s.textContent = "window.__XSS_INLINE = true;";
  document.head.appendChild(s);
  await new Promise((r) => setTimeout(r, 250));
  const pelanggaranBaru = window.__cspViolations.slice(sebelum);
  s.remove();
  return { jalan: window.__XSS_INLINE, pelanggaranBaru };
});
ok(c5.jalan === false, "C5: skrip inline yang disuntikkan TIDAK dieksekusi");
ok(c5.pelanggaranBaru.length > 0, "C5: penolakannya dilaporkan sebagai pelanggaran CSP",
  c5.pelanggaranBaru.map((v) => v.directive).join(",") || "tidak ada laporan");

// CATATAN soal eval(): TIDAK bisa diuji dari sini, dan itu batasan alat, bukan
// celah. Kode yang dijalankan lewat page.evaluate() masuk melalui protokol
// DevTools, dan konteks itu DIKECUALIKAN dari CSP oleh Chrome -- eval di situ
// akan selalu berhasil sekalipun 'unsafe-eval' tidak ada. Percobaan pertama
// harness ini sempat melaporkannya sebagai KEGAGALAN, padahal kebijakannya
// benar. Yang bisa dijamin (dan dijamin di C1) adalah 'unsafe-eval' memang
// tidak pernah ada di dalam kebijakan; penegakannya untuk kode yang berasal
// dari halaman itu sendiri adalah tanggung jawab browser.

// ===================== C6: aplikasi tetap berfungsi =====================
// Garis dasar diambil di sini: C5 SENGAJA memicu satu pelanggaran, dan kolom
// `sample` tidak bisa dipakai memfilternya (Chrome hanya mengisi `sample` kalau
// direktif report-sample dipasang -- di sini kosong). Jadi yang dihitung adalah
// pelanggaran yang MUNCUL SETELAH titik ini.
const garisDasarPelanggaran = await page.evaluate(() => window.__cspViolations.length);
console.log("\n-- C6: aplikasi tetap berfungsi di bawah kebijakan ketat --");
for (const v of ["transaksi", "laporan", "aset", "kalender", "pengaturan", "dashboard"]) {
  await page.evaluate((vv) => switchView(vv), v);
  await page.waitForTimeout(700);
}
const c6 = await page.evaluate((dasar) => ({
  tampil: document.getElementById("view-dashboard").classList.contains("block"),
  baru: window.__cspViolations.slice(dasar),
}), garisDasarPelanggaran);
ok(c6.tampil, "C6: pindah view tetap normal");
ok(c6.baru.length === 0, "C6: tidak ada pelanggaran CSP baru saat memakai aplikasi",
  c6.baru.map((v) => `${v.directive}:${v.blocked}`).join(" | ") || "bersih");

const errorTakTerduga = konsolError.filter((t) => !/Content Security Policy|Refused to execute/i.test(t));
console.log("\n== HASIL VERIFY CSP (17 cek) ==");
console.log(`Error halaman (${errorHalaman.length})`);
[...new Set(errorHalaman)].slice(0, 5).forEach((e) => console.log(`   ${e}`));
console.log(`console.error di luar laporan CSP (${errorTakTerduga.length})`);
[...new Set(errorTakTerduga)].slice(0, 5).forEach((e) => console.log(`   ${e}`));
console.log(gagal === 0 ? "SEMUA CEK LOLOS" : `${gagal} CEK GAGAL`);

await browser.close();
process.exit(gagal === 0 && errorHalaman.length === 0 && errorTakTerduga.length === 0 ? 0 : 1);

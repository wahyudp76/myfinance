// VERIFY OFFLINE CACHE — harness E2E untuk cerita "aplikasi tetap berguna tanpa
// internet". Sebelum v100 bagian ini NOL cakupan otomatis: unit test hanya bisa
// membaca teks sw.js, sedangkan yang penting justru perilaku Cache Storage nyata.
//
// Yang dikunci di sini:
//   O1. Service worker mengendalikan halaman dan DATA_CACHE benar-benar terisi.
//   O2. REGRESI v100: refresh token pada akun yang SAMA TIDAK melahirkan namespace
//       cache baru. Bug lama (scope = 24 char terakhir header Authorization =
//       ekor tanda tangan JWT) membuat entri berlipat tiap jam dan tak pernah
//       dibuang -> 8 jadi 16 jadi 24 ... Dibuktikan MERAH pada kode v99.
//   O3. Akun BERBEDA tetap terpisah -- perbaikan tidak boleh membocorkan data
//       antar akun di perangkat yang sama.
//   O4. Offline sungguhan: aplikasi tetap memuat DAN menyajikan data dari cache.
//   O5. Logout membuang cache data.
//
// CATATAN METODOLOGI (mahal ditemukan, jangan diulang):
//   - Service worker baru meng-cache setelah ia MENGENDALIKAN halaman. Kunjungan
//     pertama biasanya belum terkendali, jadi harus reload sekali sebelum menilai
//     isi DATA_CACHE. Menilai di kunjungan pertama = kesimpulan palsu "cache kosong".
//   - context.addInitScript() jalan di SETIAP navigasi. Kalau dipakai menyemai
//     sesi tanpa penjaga "kalau belum ada", ia menimpa token baru tiap reload dan
//     simulasi refresh token tidak pernah benar-benar terjadi.
//   - Playwright setOffline() tidak selalu mengubah navigator.onLine setelah
//     navigasi; jangan menilai banner offline dari situ. Untuk menguji jalur
//     offline, yang dipercaya adalah kegagalan request nyata.
//
// Jalankan: node scripts/verify-offline-cache.mjs
//   env: OFFLINE_URL (default http://localhost:8123/)
import { chromium } from "playwright";

const URL_ = process.env.OFFLINE_URL || "http://localhost:8123/";
const REF = "uxfngmxghupdlwoeoxgh";
const SUB_A = "11111111-2222-3333-4444-555555555555";
const SUB_B = "99999999-8888-7777-6666-444444444444";
const DATA_CACHE_PREFIX = "myfinance-data";

let gagal = 0;
const ok = (kondisi, label, extra = "") => {
  if (!kondisi) gagal += 1;
  console.log(`${kondisi ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
};

// ---------- JWT palsu tapi berbentuk benar (payload base64url yang bisa dibaca) ----------
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const jwt = (sub, sig) => `eyJhbGciOiJIUzI1NiJ9.${b64url({ sub, aud: "authenticated", exp: 9999999999 })}.${sig}`;
const sesi = (sub, sig) => ({
  access_token: jwt(sub, sig), token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `refresh-${sig}`,
  user: { id: sub, aud: "authenticated", email: `${sub.slice(0, 8)}@local.test`, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
});

const hariIni = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const txUntuk = (sub, ket) => [{
  id: `tx-${sub.slice(0, 4)}`, created_at: `${hariIni()}T09:00:00Z`, tanggal: hariIni(),
  jenis: "Pengeluaran", kategori: "Makanan", akun: "BCA", jumlah: "123456",
  keterangan: ket, mata_uang: "IDR", user_id: sub,
}];

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

// Sesi aktif bisa diganti di tengah jalan (simulasi refresh token / ganti akun).
let sesiAktif = sesi(SUB_A, "TANDATANGAN-PERTAMA-AAAAAAAAAAAA");
let txAktif = txUntuk(SUB_A, "[Demo] transaksi akun A");

// Penjaga "kalau belum ada": lihat CATATAN METODOLOGI di atas.
await context.addInitScript(([ref]) => {
  window.__seedSesi = (s) => localStorage.setItem(`sb-${ref}-auth-token`, s);
}, [REF]);
await context.addInitScript(([ref, s]) => {
  const k = `sb-${ref}-auth-token`;
  if (!localStorage.getItem(k)) localStorage.setItem(k, s);
}, [REF, JSON.stringify(sesiAktif)]);

await context.route("**/functions/v1/**", (r) => r.fulfill(json({ ok: true })));
await context.route("**/rest/v1/**", (r) => r.fulfill(json([])));
await context.route("**/auth/v1/**", (r) => r.fulfill(json(sesiAktif)));
await context.route("**/rest/v1/transactions**", (r) => r.fulfill(json(txAktif)));

const page = await context.newPage();
const errorHalaman = [];
page.on("pageerror", (e) => errorHalaman.push(String(e).slice(0, 160)));

const bootPenuh = async () => {
  await page.waitForSelector("#appShell:not(.hidden)", { timeout: 30000 });
  await page.waitForTimeout(3500);
};
// Nama cache dicari DINAMIS ("myfinance-data-*"), bukan dipatok ke satu versi:
// dengan begitu harness ini tetap bermakna saat dijalankan terhadap kode LAMA
// (yang memakai myfinance-data-v1) sebagai uji negatif.
const kunciCache = async () => page.evaluate(async (awalan) => {
  const nama = (await caches.keys()).filter((n) => n.startsWith(awalan));
  const out = [];
  for (const n of nama) {
    const c = await caches.open(n);
    for (const r of await c.keys()) out.push(decodeURIComponent(new URL(r.url).pathname + new URL(r.url).search));
  }
  return out;
}, DATA_CACHE_PREFIX);
const scopeDari = (kunci) => [...new Set(kunci.map((k) => (k.split(/[?&]u=/)[1] || "").split("&")[0]))];

// ======================= O1: SW mengendalikan & cache terisi =======================
console.log("\n-- O1: service worker mengendalikan halaman & mengisi cache data --");
await page.goto(URL_, { waitUntil: "networkidle" });
await bootPenuh();
ok(await page.evaluate(() => navigator.serviceWorker.controller !== null), "O1: halaman dikendalikan service worker");

// Reload: barulah request data melewati handler fetch service worker.
await page.reload({ waitUntil: "networkidle" });
await bootPenuh();
const kunciA1 = await kunciCache();
ok(kunciA1.length > 0, "O1: DATA_CACHE terisi setelah muat dalam kendali SW", `${kunciA1.length} entri`);
const scopeA1 = scopeDari(kunciA1);
ok(scopeA1.length === 1 && scopeA1[0] === SUB_A,
  "O1: scope cache = user id (klaim sub), bukan potongan tanda tangan token", scopeA1.join(","));

// ======================= O2: REFRESH TOKEN TIDAK MENAMBAH NAMESPACE =======================
console.log("\n-- O2: refresh token akun yang SAMA (inti bug v100) --");
sesiAktif = sesi(SUB_A, "TANDATANGAN-KEDUA-BBBBBBBBBBBBBB"); // sub sama, tanda tangan baru
await page.evaluate((s) => window.__seedSesi(s), JSON.stringify(sesiAktif));
await page.reload({ waitUntil: "networkidle" });
await bootPenuh();
const kunciA2 = await kunciCache();
const scopeA2 = scopeDari(kunciA2);
ok(scopeA2.length === 1, "O2: hanya ADA SATU namespace cache setelah refresh token", `scope=${scopeA2.join(" | ")}`);
ok(scopeA2[0] === SUB_A, "O2: namespace itu tetap user id yang sama", scopeA2.join(","));
ok(kunciA2.length === kunciA1.length,
  "O2: jumlah entri TIDAK bertambah setelah refresh token", `${kunciA1.length} -> ${kunciA2.length}`);

// ======================= O3: akun berbeda tetap terpisah =======================
console.log("\n-- O3: akun kedua di perangkat yang sama --");
sesiAktif = sesi(SUB_B, "TANDATANGAN-AKUN-B-CCCCCCCCCCCC");
txAktif = txUntuk(SUB_B, "[Demo] transaksi akun B");
await page.evaluate((s) => window.__seedSesi(s), JSON.stringify(sesiAktif));
await page.reload({ waitUntil: "networkidle" });
await bootPenuh();
const kunciB = await kunciCache();
const scopeB = scopeDari(kunciB);
ok(scopeB.includes(SUB_A) && scopeB.includes(SUB_B),
  "O3: dua akun punya namespace TERPISAH di cache yang sama", scopeB.join(" | "));
const bocor = kunciB.filter((k) => k.includes(SUB_A) && k.includes(SUB_B));
ok(bocor.length === 0, "O3: tidak ada entri yang tercampur antar akun");

// ======================= O4: offline sungguhan menyajikan data cache =======================
console.log("\n-- O4: offline sungguhan (semua stub dicabut, jaringan mati) --");
sesiAktif = sesi(SUB_A, "TANDATANGAN-KEDUA-BBBBBBBBBBBBBB");
txAktif = txUntuk(SUB_A, "[Demo] transaksi akun A");
await page.evaluate((s) => window.__seedSesi(s), JSON.stringify(sesiAktif));
await page.reload({ waitUntil: "networkidle" });
await bootPenuh();
const txOnline = await page.evaluate(() => (typeof globalData !== "undefined" ? globalData.length : -1));
ok(txOnline > 0, "O4: transaksi termuat saat online (dasar pembanding)", `${txOnline} baris`);

await context.unrouteAll();
await context.setOffline(true);
await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
await context.setOffline(true);
await page.waitForTimeout(11000);
const hasilOffline = await page.evaluate(() => ({
  shell: !document.getElementById("appShell")?.classList.contains("hidden"),
  tx: typeof globalData !== "undefined" ? globalData.length : -1,
}));
ok(hasilOffline.shell, "O4: aplikasi TETAP MEMUAT tanpa jaringan (shell dari precache)");
ok(hasilOffline.tx === txOnline,
  "O4: transaksi DISAJIKAN DARI CACHE saat offline", `online=${txOnline} offline=${hasilOffline.tx}`);
await context.setOffline(false);

// ======================= O5: logout membuang cache data =======================
console.log("\n-- O5: logout membersihkan cache data --");
await context.route("**/functions/v1/**", (r) => r.fulfill(json({ ok: true })));
await context.route("**/rest/v1/**", (r) => r.fulfill(json([])));
await context.route("**/auth/v1/**", (r) => r.fulfill(json(sesiAktif)));
await context.route("**/rest/v1/transactions**", (r) => r.fulfill(json(txAktif)));
await page.reload({ waitUntil: "networkidle" });
await bootPenuh();
ok((await kunciCache()).length > 0, "O5: ada isi cache sebelum logout (dasar pembanding)");
await page.evaluate(() => clearOfflineDataCache());
await page.waitForTimeout(2500);
ok((await kunciCache()).length === 0, "O5: DATA_CACHE kosong setelah logout", `${(await kunciCache()).length} entri`);

console.log(`\n== HASIL VERIFY OFFLINE CACHE (13 cek) ==`);
console.log(`Error halaman (${errorHalaman.length})`);
[...new Set(errorHalaman)].slice(0, 5).forEach((e) => console.log(`   ${e}`));
console.log(gagal === 0 ? "SEMUA CEK LOLOS" : `${gagal} CEK GAGAL`);

await browser.close();
process.exit(gagal === 0 && errorHalaman.length === 0 ? 0 : 1);

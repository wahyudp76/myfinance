// VERIFY BUDGET NOTIFY — harness runtime notifikasi ambang anggaran.
//
// KENAPA ADA (v139): bug "notifikasi anggaran tidak pernah muncul" bertahan lama
// karena tidak ada satu pun tes yang menutup jalur ini. Unit test hanya menutup
// `detectBudgetThresholdCrossing` (fungsi murni pembanding ambang) — sedangkan
// cacatnya ada di `getCategoryBudgetStatus()` (app.src.js) yang hanya mencari
// anggaran pada KATEGORI UTAMA, padahal tab Anggaran juga menyimpan anggaran
// per SUB-kategori. Akibatnya status sebelum/sesudah sama-sama null dan toast
// tidak pernah muncul. Hanya browser sungguhan yang bisa membuktikan toast-nya
// benar-benar tampil.
//
// Yang dibuktikan harness ini:
//   A. anggaran di kategori utama + transaksi sub-kategori -> toast 80% muncul
//   B. anggaran di SUB-kategori -> toast 80% muncul (ini yang dulu mati total)
//   C. kategori tanpa anggaran -> TIDAK ada toast (kontrol negatif)
//   D. ambang belum terseberangi (75% -> 78%) -> TIDAK ada toast (kontrol negatif)
//   E. angka di toast = realisasi/anggaran yang benar
//
// Jalankan: node scripts/verify-budget-notify.mjs
//   env: BUDNOTIF_URL (default http://localhost:8123/)
import { chromium } from "playwright";

const URL_ = process.env.BUDNOTIF_URL || "http://localhost:8123/";
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
  user: { id: USER_ID, aud: "authenticated", email: "budnotif@local.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const hariIni = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Jalankan satu skenario di context terpisah.
 * @param {object} browser
 * @param {{kategoriTx: string, budgets: Array, jumlahBaru: string}} cfg
 */
async function skenario(browser, { kategoriTx, budgets, jumlahBaru }) {
  const tx = [0, 1, 2].map((i) => ({
    id: `t${i}`, created_at: `${hariIni()}T09:0${i}:00Z`, tanggal: hariIni(), jenis: "Pengeluaran",
    kategori: kategoriTx, akun: "BCA", jumlah: "250000", keterangan: "harness", mata_uang: "IDR", user_id: USER_ID,
  }));
  tx.push({ id: "tg", created_at: `${hariIni()}T08:00:00Z`, tanggal: hariIni(), jenis: "Pemasukan",
    kategori: "Gaji", akun: "BCA", jumlah: "5000000", keterangan: "harness", mata_uang: "IDR", user_id: USER_ID });
  const settingsRow = [{ data: { accounts: ["BCA"], accountIcons: {}, account_currencies: {}, themeColor: null,
    custom_categories: { pengeluaran: { parents: [], subs: {} }, pemasukan: { parents: [], subs: {} } },
    hidden_categories: { pengeluaran: [], pemasukan: [] } } }];

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(([r, s]) => {
    const k = `sb-${r}-auth-token`;
    if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s));
  }, [REF, session]);
  await context.route("**/functions/v1/**", (r) => r.fulfill(json({ ok: true })));
  await context.route("**/rest/v1/**", (r) => r.fulfill(json([])));
  await context.route("**/auth/v1/**", (r) => r.fulfill(json(session)));
  await context.route("**/rest/v1/transactions**", (r) => r.fulfill(json(tx)));
  await context.route("**/rest/v1/assets**", (r) => r.fulfill(json([])));
  await context.route("**/rest/v1/budgets**", (r) => r.fulfill(json(budgets)));
  await context.route("**/rest/v1/settings**", (r) => (r.request().method() === "GET" ? r.fulfill(json(settingsRow)) : r.fulfill(json({}), 201)));

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
  await page.goto(URL_, { waitUntil: "networkidle" });
  await page.waitForSelector("#appShell:not(.hidden)", { timeout: 30000 });
  await page.waitForTimeout(2500);

  const hasil = await page.evaluate(({ kat, jumlah }) => {
    const before = getCategoryBudgetStatus(kat);
    const baris = {
      id: "harness-1", created_at: new Date().toISOString(), tanggal: new Date().toISOString().slice(0, 10),
      jenis: "Pengeluaran", kategori: kat, akun: "BCA", jumlah,
      keterangan: "harness crossing", mata_uang: "IDR", user_id: "11111111-2222-3333-4444-555555555555",
    };
    // Persis jalur pasca-simpan: echo lokal lalu notifikasi (lihat finishSave).
    applyLocalTxEcho("insert", baris, [], () => notifyIfBudgetThresholdCrossed(kat, before));
    const after = getCategoryBudgetStatus(kat);
    const wrap = document.getElementById("errorToast");
    return {
      before, after,
      toastTerlihat: wrap ? !wrap.classList.contains("hidden") : false,
      toastTeks: (document.getElementById("errorToastMsg") || {}).innerText || "",
    };
  }, { kat: kategoriTx, jumlah: jumlahBaru });

  await context.close();
  return { ...hasil, pageErrors };
}

const browser = await chromium.launch({ headless: true });

// A: anggaran di kategori utama, transaksi pada sub-kategori, 75% -> 85%.
const A = await skenario(browser, { kategoriTx: "Restoran", budgets: [{ kategori: "Makanan & Minuman", jumlah: 1000000 }], jumlahBaru: "100000" });
ok(A.before && Math.abs(A.before.pct - 0.75) < 1e-9, "A: status sebelum = 75%", A.before ? `pct=${A.before.pct}` : "null");
ok(A.after && Math.abs(A.after.pct - 0.85) < 1e-9, "A: status sesudah = 85%", A.after ? `pct=${A.after.pct}` : "null");
ok(A.toastTerlihat === true, "A: toast ambang 80% TAMPIL (anggaran kategori utama)");
ok(/85%/.test(A.toastTeks) && /Makanan & Minuman/.test(A.toastTeks), "A: isi toast menyebut persen & kategori", A.toastTeks);

// B: anggaran di SUB-kategori — inilah yang dulu mati total.
const B = await skenario(browser, { kategoriTx: "Restoran", budgets: [{ kategori: "Restoran", jumlah: 1000000 }], jumlahBaru: "100000" });
ok(B.before && Math.abs(B.before.pct - 0.75) < 1e-9, "B: status sebelum = 75% (anggaran sub terbaca)", B.before ? `pct=${B.before.pct}` : "null");
ok(B.after && Math.abs(B.after.pct - 0.85) < 1e-9, "B: status sesudah = 85%", B.after ? `pct=${B.after.pct}` : "null");
ok(B.toastTerlihat === true, "B: toast ambang 80% TAMPIL (anggaran sub-kategori)");
ok(/Restoran/.test(B.toastTeks) && /850\.000/.test(B.toastTeks), "B: isi toast menyebut sub-kategori & nominal", B.toastTeks);

// C: tanpa anggaran sama sekali -> tidak boleh ada toast.
const C = await skenario(browser, { kategoriTx: "Restoran", budgets: [], jumlahBaru: "100000" });
ok(C.before === null && C.after === null, "C: tanpa anggaran, status null sebelum & sesudah");
ok(C.toastTerlihat === false, "C: TIDAK ada toast bila kategori tidak beranggaran");

// D: ambang belum terseberangi (75% -> 78%) -> tidak boleh ada toast.
const D = await skenario(browser, { kategoriTx: "Restoran", budgets: [{ kategori: "Restoran", jumlah: 1000000 }], jumlahBaru: "30000" });
ok(D.after && Math.abs(D.after.pct - 0.78) < 1e-9, "D: sesudah = 78% (belum lewat ambang)", D.after ? `pct=${D.after.pct}` : "null");
ok(D.toastTerlihat === false, "D: TIDAK ada toast bila ambang belum terseberangi");

const semuaError = [A, B, C, D].flatMap((x) => x.pageErrors);
ok(semuaError.length === 0, "tidak ada pageerror selama harness", semuaError.join(" | ") || "bersih");

await browser.close();
console.log(gagal === 0 ? "\nSEMUA CEK LOLOS" : `\n${gagal} CEK GAGAL`);
process.exit(gagal === 0 ? 0 : 1);

// VERIFY UI SWEEP — sapu menyeluruh seluruh permukaan aksi UI.
//
// KENAPA HARNESS INI ADA (v106):
// Bug v105 -- "kartu saldo per akun tidak bisa diklik" -- lolos ke pengguna
// bukan karena kodenya rumit, tapi karena TIDAK ADA satu pun harness yang
// pernah MEMBUKA halaman detail akun. Harness lain menguji alur yang dipilih
// satu per satu oleh penulisnya; yang ini menguji SEMUANYA: setiap view, setiap
// halaman/modal detail, setiap aksi klik, dan setiap handler non-klik, lalu
// menangkap exception & console.error apa pun yang muncul.
//
// PRINSIP: harness lain menjawab "apakah fitur X benar?". Harness ini menjawab
// pertanyaan yang berbeda dan lebih murah dijawab mesin: "apakah ADA yang
// meledak kalau seluruh aplikasi disentuh?".
//
// SOAL AKSI YANG DILEWATI:
// Sebagian aksi tidak bisa disapu buta karena akan merusak keadaan uji itu
// sendiri (logout mengeluarkan sesi, hapus menghilangkan data yang dipakai cek
// berikutnya). Daftarnya DITULIS EKSPLISIT di DILEWATI beserta alasannya, dan
// dijaga cek S7: aksi apa pun yang muncul di DOM tapi tidak ada di daftar itu
// WAJIB ikut dijalankan. Dengan begitu tidak ada aksi baru yang diam-diam luput
// dari sapuan hanya karena namanya kebetulan mirip sesuatu yang berbahaya.
//
// Jalankan: node scripts/verify-ui-sweep.mjs
//   env: SWEEP_URL (default http://localhost:8123/)
import { chromium } from "playwright";

const URL_ = process.env.SWEEP_URL || "http://localhost:8123/";
const REF = "uxfngmxghupdlwoeoxgh";
const UID = "11111111-2222-3333-4444-555555555555";

let gagal = 0;
const ok = (kondisi, label, extra = "") => {
  if (!kondisi) gagal += 1;
  console.log(`${kondisi ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
};

// ---------------------------------------------------------------------------
// Aksi yang SENGAJA tidak dijalankan otomatis, beserta alasannya.
// Menambah entri di sini adalah keputusan sadar, bukan efek samping regex.
// ---------------------------------------------------------------------------
const DILEWATI = {
  // CATATAN: daftar ini pernah memuat 6 nama KARANGAN (logout, confirmLogout,
  // clearOfflineDataCache, muatUlangHalaman, exportCSV, downloadBackup) yang
  // ternyata tidak ada sebagai aksi. Cek S7-lah yang menangkapnya. Tombol
  // logout tidak memakai data-action (ia dipasang lewat addEventListener), dan
  // nama ekspor yang benar adalah exportTransactionsCsv dkk.
  //
  // Menghapus/mereset data yang justru dipakai cek berikutnya.
  hapusData: "menghapus transaksi yang dipakai cek lain",
  deleteAssetData: "menghapus aset yang dipakai cek lain",
  removeGoal: "menghapus tujuan yang dipakai cek lain",
  removeDebt: "menghapus utang yang dipakai cek lain",
  removeSub: "menghapus sub-kategori yang dipakai cek lain",
  removeParentCategory: "menghapus kategori induk yang dipakai cek lain",
  removeSetting: "menghapus akun dari setelan",
  deleteRecurringTemplate: "menghapus template berulang",
  removeDemoData: "menghapus seluruh data demo",
  seedDemoData: "menulis banyak data & mengubah keadaan uji",
  resetCategoryStyleToDefault: "mereset gaya kategori",
  resetAccountIconToAuto: "mereset ikon akun",
  unlinkWhatsapp: "memutus tautan WhatsApp",
  appLockDisableBiometric: "mengubah kredensial biometrik",
  appLockDisableBiometricAll: "mengubah kredensial biometrik",
  appLockDisableConfirm: "mematikan kunci aplikasi",
  appLockEnableFromModal: "menyalakan kunci aplikasi -> layar terkunci menutupi sisa sapuan",
  appLockEnrollBiometric: "butuh authenticator virtual (sudah diuji verify-applock-biometric)",
  // Membuka dialog file OS yang tidak bisa ditutup dari halaman.
  pilihBerkasBackup: "membuka dialog berkas OS",
  triggerStrukScan: "membuka dialog berkas OS",
  // Menulis ke backend & memunculkan toast beruntun; alurnya sudah diuji
  // harness khusus (verify-hud) dengan asersi yang bermakna.
  kirimFormTransaksi: "alur simpan sudah diuji verify-hud",
  kirimFormAset: "alur simpan sudah diuji verify-hud",
  kirimFormTujuan: "alur simpan sudah diuji verify-hud",
  kirimFormUtang: "alur simpan sudah diuji verify-hud",
  submitFormNewAndRepeat: "alur simpan sudah diuji verify-hud",
  submitForm: "alur simpan sudah diuji verify-hud",
  submitAsset: "alur simpan sudah diuji verify-hud",
  submitGoalForm: "alur simpan sudah diuji verify-hud",
  submitGoalContribute: "alur simpan sudah diuji verify-hud",
  submitDebtForm: "alur simpan sudah diuji verify-hud",
  submitDebtPay: "alur simpan sudah diuji verify-hud",
  submitRecurringForm: "alur simpan sudah diuji verify-hud",
  submitAccountModal: "menulis setelan akun",
  submitCategoryStyleModal: "menulis gaya kategori",
  submitProfileModal: "menulis profil",
  submitPasswordChange: "mengubah kata sandi",
  submitManualNav: "menulis NAV manual",
  saveBudgets: "menulis anggaran",
  saveNotifPrefs: "menulis preferensi notifikasi",
  appLockChangePin: "mengubah PIN kunci aplikasi",
  appLockRecover: "alur pemulihan sudah diuji verify-applock",
  // Memanggil jaringan luar / izin browser.
  refreshAllAssetPrices: "memanggil Edge Function harga",
  requestAiInsight: "memanggil Edge Function AI",
  requestMonthlySummary: "memanggil Edge Function AI",
  sendAiChatQuestion: "memanggil Edge Function AI",
  requestNotificationPermission: "meminta izin notifikasi browser",
  generateWhatsappLinkCode: "menulis kode tautan",
  exportTransactionsCsv: "memicu unduhan berkas",
  exportTransactionsCsvByRange: "memicu unduhan berkas",
  exportAssetsCsv: "memicu unduhan berkas",
  exportFullBackup: "memicu unduhan berkas",
};

const session = {
  access_token: "stub", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r",
  user: { id: UID, aud: "authenticated", email: "sweep@local.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};
const json = (b, s = 200) => ({ status: s, contentType: "application/json", body: JSON.stringify(b) });
const hari = (o) => {
  const d = new Date();
  d.setDate(d.getDate() - o);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Data seed sengaja "lengkap": tiap view harus punya sesuatu untuk dirender,
// karena cabang kosong dan cabang berisi adalah jalur kode yang berbeda.
const tx = [
  ["Makanan", "BCA", "Pengeluaran", "25000"], ["Gaji", "BCA", "Pemasukan", "5000000"],
  ["Transportasi", "GoPay", "Pengeluaran", "15000"], ["Belanja", "OVO", "Pengeluaran", "90000"],
  ["Tagihan", "BCA", "Pengeluaran", "250000"], ["Hiburan", "GoPay", "Pengeluaran", "60000"],
].map(([k, a, j, n], i) => ({
  id: `t${i}`, created_at: `${hari(i)}T09:0${i}:00Z`, tanggal: hari(i), jenis: j, kategori: k,
  akun: a, jumlah: n, keterangan: `[Demo] ${k}`, mata_uang: "IDR", user_id: UID,
}));
const aset = [{
  id: "a1", nama: "Saham ABCD", kategori: "Saham", platform: "Stockbit", modal: 1000000,
  nilai: 1250000, jumlah_unit: 100, terakhir: hari(0), user_id: UID,
  // Bentuk PERSIS seperti yang ditulis aplikasi: {tanggal, nilai}. Bentuk yang
  // salah pernah bikin sapuan melaporkan "bug" yang sebenarnya cacat data uji.
  value_history: [{ tanggal: hari(5), nilai: 1100000 }, { tanggal: hari(0), nilai: 1250000 }],
}];
const budgets = [{ kategori: "Makanan", jumlah: 1000000 }, { kategori: "Transportasi", jumlah: 500000 }];
const recurring = [{
  id: "r1", jenis: "Pengeluaran", jumlah: "50000", akun: "BCA", kategori: "Tagihan",
  keterangan: "[Demo] Langganan", frequency: "monthly", start_date: hari(30),
  next_due_date: hari(-2), end_date: null, active: true,
}];
const settings = [{ data: {
  accounts: ["BCA", "GoPay", "OVO"], accountIcons: {}, account_currencies: {}, themeColor: null,
  custom_categories: {
    pengeluaran: { parents: ["Rumah Tangga"], subs: { "Rumah Tangga": ["Listrik", "Air"] } },
    pemasukan: { parents: [], subs: {} },
  },
  hidden_categories: { pengeluaran: [], pemasukan: [] },
  financial_goals: [{ id: "g1", nama: "Dana Darurat", target: 10000000, terkumpul: 2500000, tenggat: hari(-90), icon: "fa-piggy-bank", bg: "bg-indigo-100", color: "text-indigo-500" }],
  debts: [{ id: "d1", nama: "Cicilan Laptop", total: 6000000, dibayar: 1500000, jatuh_tempo: hari(-30), icon: "fa-credit-card", bg: "bg-rose-100", color: "text-rose-500" }],
} }];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(([r, s]) => {
  const k = `sb-${r}-auth-token`;
  if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s));
}, [REF, session]);
await context.route("**/functions/v1/**", (r) => r.fulfill(json({ ok: true })));
await context.route("**/rest/v1/**", (r) => r.fulfill(json([])));
await context.route("**/auth/v1/**", (r) => r.fulfill(json(session)));
await context.route("**/rest/v1/transactions**", (r) => r.fulfill(json(tx)));
await context.route("**/rest/v1/assets**", (r) => r.fulfill(json(aset)));
await context.route("**/rest/v1/budgets**", (r) => r.fulfill(json(budgets)));
await context.route("**/rest/v1/recurring_transactions**", (r) => r.fulfill(json(recurring)));
await context.route("**/rest/v1/settings**", (r) => (r.request().method() === "GET" ? r.fulfill(json(settings)) : r.fulfill(json({}), 201)));

const page = await context.newPage();
const errorHalaman = [];
const konsolError = [];
page.on("pageerror", (e) => errorHalaman.push(String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") konsolError.push(m.text().slice(0, 200)); });

await page.goto(URL_, { waitUntil: "networkidle" });
await page.waitForSelector("#appShell:not(.hidden)", { timeout: 30000 });
await page.waitForTimeout(3000);

const masalah = [];
/** Catat exception/console.error yang muncul sejak penanda terakhir. */
const catat = async (label) => {
  await page.waitForTimeout(260);
  if (errorHalaman.length > tanda.err) {
    masalah.push({ label, jenis: "EXCEPTION", pesan: errorHalaman[tanda.err] });
  } else if (konsolError.length > tanda.konsol) {
    masalah.push({ label, jenis: "console.error", pesan: konsolError[tanda.konsol] });
  }
  tanda.err = errorHalaman.length;
  tanda.konsol = konsolError.length;
};
const tanda = { err: 0, konsol: 0 };

// ===================== S1: prasyarat — data seed benar-benar ter-render =====================
console.log("\n-- S1: prasyarat sapuan --");
const s1 = await page.evaluate(() => ({
  tx: typeof globalData !== "undefined" ? globalData.length : -1,
  aksi: document.querySelectorAll("[data-action]").length,
}));
ok(s1.tx > 0, "S1: transaksi seed termuat (cabang 'berisi' yang diuji, bukan cabang kosong)", `${s1.tx} baris`);
ok(s1.aksi > 100, "S1: permukaan aksi ter-render", `${s1.aksi} elemen ber-data-action`);
await catat("prasyarat");

// ===================== S2: seluruh view =====================
console.log("\n-- S2: seluruh view --");
const VIEWS = ["dashboard", "transaksi", "budget", "laporan", "aset", "kalender", "pengaturan"];
for (const v of VIEWS) {
  await page.evaluate((x) => switchView(x), v);
  await catat(`view ${v}`);
}
ok(masalah.length === 0, "S2: semua view dirender tanpa exception",
  masalah.map((m) => m.label).join(", ") || `${VIEWS.length} view bersih`);

// ===================== S3: halaman & modal DETAIL =====================
// Justru di sinilah bug v105 bersembunyi: view utamanya baik-baik saja,
// halaman detailnya yang meledak.
console.log("\n-- S3: halaman & modal detail --");
const sebelumS3 = masalah.length;
const DETAIL = [
  ["detail akun BCA", () => { switchView("dashboard"); openAccountDetail("BCA"); }],
  ["detail akun GoPay", () => { switchView("dashboard"); openAccountDetail("GoPay"); }],
  ["detail kategori pengeluaran", () => openCategoryDetail("Makanan", "Pengeluaran")],
  ["detail kategori pemasukan", () => openCategoryDetail("Gaji", "Pemasukan")],
  ["detail aset", () => { switchView("aset"); openAssetDetailModal("a1"); }],
  ["daftar transaksi berulang", () => openRecurringListModal()],
];
for (const [label, fn] of DETAIL) {
  try { await page.evaluate(fn); } catch (e) { masalah.push({ label, jenis: "LEMPAR", pesan: String(e).slice(0, 200) }); }
  await catat(label);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);
}
ok(masalah.length === sebelumS3, "S3: semua halaman/modal detail terbuka tanpa exception",
  masalah.slice(sebelumS3).map((m) => `${m.label}: ${m.pesan.slice(0, 70)}`).join(" | ") || `${DETAIL.length} detail bersih`);

// ===================== S4: setiap aksi klik yang tidak dikecualikan =====================
console.log("\n-- S4: seluruh aksi klik --");
const sebelumS4 = masalah.length;
const rencana = await page.evaluate((dilewati) => {
  const unik = new Map();
  for (const el of document.querySelectorAll("[data-action]")) {
    const aksi = el.getAttribute("data-action");
    if (Object.prototype.hasOwnProperty.call(dilewati, aksi)) continue;
    const args = el.getAttribute("data-args");
    if (!unik.has(aksi + args)) unik.set(aksi + args, { aksi, args });
  }
  return [...unik.values()];
}, DILEWATI);
for (const r of rencana) {
  try {
    await page.evaluate(({ aksi, args }) => {
      const fn = uiActionRegistry()[aksi];
      if (typeof fn !== "function") throw new Error("aksi tidak terdaftar di registry: " + aksi);
      fn.apply(null, args ? JSON.parse(args) : []);
    }, r);
  } catch (e) {
    masalah.push({ label: `aksi ${r.aksi}(${r.args || ""})`, jenis: "LEMPAR", pesan: String(e).slice(0, 200) });
  }
  await catat(`aksi ${r.aksi}(${r.args || ""})`);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(90);
}
ok(masalah.length === sebelumS4, `S4: ${rencana.length} aksi klik dijalankan tanpa exception`,
  masalah.slice(sebelumS4).map((m) => `${m.label}: ${m.pesan.slice(0, 70)}`).join(" | ") || "bersih");

// ===================== S5: setiap handler non-klik =====================
console.log("\n-- S5: seluruh handler non-klik --");
const sebelumS5 = masalah.length;
await page.evaluate(() => switchView("transaksi"));
await page.waitForTimeout(600);
const jumlahNonKlik = await page.evaluate(async () => {
  // data-on-submit SENGAJA tidak ikut: men-dispatch submit natif pada form yang
  // wajib-isinya kosong memicu validasi bawaan browser ("An invalid form control
  // ... is not focusable"), yaitu pesan BROWSER, bukan kegagalan aplikasi.
  // Wiring submit sudah dibuktikan verify-ui-actions U11 memakai mata-mata
  // registry, yang menguji jalur yang sama tanpa memancing validasi natif.
  const PETA = {
    "data-on-change": "change", "data-on-input": "input",
    "data-on-keydown": "keydown", "data-on-focus": "focusin", "data-on-blur": "focusout",
  };
  let n = 0;
  for (const [atr, namaEvent] of Object.entries(PETA)) {
    for (const el of document.querySelectorAll(`[${atr}]`)) {
      const ev = namaEvent === "keydown"
        ? new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
        : new Event(namaEvent, { bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      n += 1;
    }
  }
  await new Promise((r) => setTimeout(r, 400));
  return n;
});
await catat("handler non-klik");
ok(masalah.length === sebelumS5, `S5: ${jumlahNonKlik} handler non-klik dipicu tanpa exception`,
  masalah.slice(sebelumS5).map((m) => `${m.label}: ${m.pesan.slice(0, 70)}`).join(" | ") || "bersih");

// ===================== S6: aplikasi masih hidup setelah disapu =====================
console.log("\n-- S6: keadaan akhir --");
await page.keyboard.press("Escape").catch(() => {});
await page.evaluate(() => switchView("dashboard"));
await page.waitForTimeout(900);
const s6 = await page.evaluate(() => ({
  shell: !document.getElementById("appShell").classList.contains("hidden"),
  dashboard: document.getElementById("view-dashboard").classList.contains("block"),
}));
ok(s6.shell && s6.dashboard, "S6: aplikasi masih hidup & responsif setelah seluruh sapuan");

// ===================== S7: gerbang klasifikasi aksi =====================
// Tanpa cek ini, aksi baru yang kebetulan masuk daftar DILEWATI (atau hilang
// dari DOM) akan mengecilkan cakupan sapuan tanpa ada yang sadar.
console.log("\n-- S7: gerbang klasifikasi --");
const s7 = await page.evaluate((dilewati) => {
  const diDom = new Set([...document.querySelectorAll("[data-action]")].map((e) => e.getAttribute("data-action")));
  const registry = Object.keys(uiActionRegistry());
  return {
    totalDom: diDom.size,
    dilewatiTerpakai: Object.keys(dilewati).filter((a) => diDom.has(a)),
    dilewatiTakDipakai: Object.keys(dilewati).filter((a) => !registry.includes(a)),
  };
}, DILEWATI);
ok(s7.dilewatiTakDipakai.length === 0,
  "S7: setiap entri daftar-dilewati masih menunjuk aksi yang benar-benar ada",
  s7.dilewatiTakDipakai.join(", ") || "semua valid");
const cakupan = Math.round(((s7.totalDom - s7.dilewatiTerpakai.length) / s7.totalDom) * 100);
ok(cakupan >= 60, "S7: cakupan sapuan aksi klik memadai",
  `${s7.totalDom - s7.dilewatiTerpakai.length}/${s7.totalDom} aksi unik disapu (${cakupan}%)`);

// ===================== ringkasan =====================
console.log("\n== HASIL VERIFY UI SWEEP (9 cek) ==");
console.log(`Masalah terkumpul: ${masalah.length}`);
for (const m of masalah.slice(0, 12)) console.log(`   [${m.jenis}] ${m.label}\n       ${m.pesan}`);
console.log(`Total pageerror=${errorHalaman.length} console.error=${konsolError.length}`);
console.log(gagal === 0 ? "SEMUA CEK LOLOS" : `${gagal} CEK GAGAL`);

await browser.close();
process.exit(gagal === 0 && masalah.length === 0 ? 0 : 1);

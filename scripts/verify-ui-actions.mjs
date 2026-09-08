// VERIFY UI ACTIONS — harness runtime untuk konversi Fase 4
// (119 atribut onclick= di index.html -> data-action= + satu dispatcher delegasi).
//
// Kenapa perlu harness terpisah, padahal sudah ada tests/unit/ui-actions.test.js:
// tes statis hanya bisa membuktikan NAMA aksi cocok dengan registry. Yang tidak
// bisa dibuktikan tanpa browser sungguhan adalah hal-hal yang justru paling
// mungkin bikin tombol mati setelah refactor semacam ini:
//   U1. registry di RUNTIME benar-benar berisi setiap aksi yang dipakai markup
//       (tes statis membaca teks; ini memanggil uiActionRegistry() sungguhan);
//   U2. klik pada IKON DI DALAM tombol tetap jalan -- inline onclick dulu ikut
//       menangkap klik anak lewat bubbling, sekarang bergantung pada closest();
//   U3. tipe argumen dari data-args tetap ANGKA, bukan string "1"/"-1";
//       (shiftReportYear("1") akan menghasilkan tahun "20261", bukan 2027);
//   U4. elemen ber-data-action yang BERSARANG tidak menjalankan aksi dua kali;
//   U5. aksi tak dikenal & data-args rusak hanya berisik di console, TIDAK
//       melempar exception yang mematikan handler klik untuk seluruh halaman.
//
// Jalankan: node scripts/verify-ui-actions.mjs
//   env: UIACT_URL (default http://localhost:8123/)
import { chromium } from "playwright";

const URL_ = process.env.UIACT_URL || "http://localhost:8123/";
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
  user: { id: USER_ID, aud: "authenticated", email: "uiact@local.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const hariIni = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const tx = [
  ["Makanan","BCA","Pengeluaran","25000"],["Transportasi","GoPay","Pengeluaran","15000"],
  ["Gaji","BCA","Pemasukan","5000000"],["Belanja","BCA","Pengeluaran","300000"],
].map(([k,a,j,n],i)=>({ id:`t${i}`, created_at:`${hariIni()}T09:0${i}:00Z`, tanggal:hariIni(), jenis:j,
  kategori:k, akun:a, jumlah:n, keterangan:`[Demo] ${k}`, mata_uang:"IDR", user_id:USER_ID }));
// Nama yang sengaja "nakal": kalau data pengguna bocor jadi kode, di sinilah pecah.
const NAMA_NAKAL = `Aset " onmouseover="alert(1)" x="`;
const aset = [{ id:"a1", nama:NAMA_NAKAL, kategori:"Saham", platform:"Stockbit", modal:1000000,
  nilai:1250000, jumlah_unit:100, terakhir:hariIni(), user_id:USER_ID, value_history:[] }];
const budgets = [{ kategori:"Makanan", jumlah:1000000 }];
const settingsRow = [{ data: { accounts:["BCA","GoPay"], accountIcons:{}, account_currencies:{}, themeColor:null,
  custom_categories:{ pengeluaran:{ parents:["Rumah Tangga"], subs:{ "Rumah Tangga":["Listrik"] } },
                      pemasukan:{ parents:[], subs:{} } },
  hidden_categories:{ pengeluaran:[], pemasukan:[] } } }];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
await context.route("**/rest/v1/settings**", (r) => (r.request().method() === "GET" ? r.fulfill(json(settingsRow)) : r.fulfill(json({}), 201)));

const page = await context.newPage();
const errorHalaman = [];
const konsolError = [];
page.on("pageerror", (e) => errorHalaman.push(String(e).slice(0, 180)));
page.on("console", (m) => { if (m.type() === "error") konsolError.push(m.text().slice(0, 200)); });

await page.goto(URL_, { waitUntil: "networkidle" });
await page.waitForSelector("#appShell:not(.hidden)", { timeout: 30000 });
await page.waitForTimeout(2500);

// ===================== U1: setiap aksi di DOM ada di registry runtime =====================
console.log("\n-- U1: registry runtime menutupi seluruh data-action di DOM --");
const u1 = await page.evaluate(() => {
  const reg = uiActionRegistry();
  const el = [...document.querySelectorAll("[data-action]")];
  const dipakai = [...new Set(el.map((e) => e.getAttribute("data-action")))];
  return {
    jumlahElemen: el.length,
    aksiUnik: dipakai.length,
    entriRegistry: Object.keys(reg).length,
    takTerpetakan: dipakai.filter((n) => typeof reg[n] !== "function"),
  };
});
ok(u1.jumlahElemen >= 119, "U1: elemen ber-data-action hadir di DOM", `${u1.jumlahElemen} elemen / ${u1.aksiUnik} aksi unik`);
ok(u1.entriRegistry >= u1.aksiUnik, "U1: registry runtime terisi", `${u1.entriRegistry} entri`);
ok(u1.takTerpetakan.length === 0, "U1: TIDAK ADA aksi di DOM yang gagal dipetakan ke fungsi", u1.takTerpetakan.join(", ") || "semua terpetakan");

// ===================== U2: klik ikon DI DALAM tombol tetap memicu aksi =====================
console.log("\n-- U2: klik pada ikon di dalam tombol (bergantung closest) --");
await page.evaluate(() => switchView("dashboard"));
await page.waitForTimeout(600);
const adaIkon = await page.locator("#nav-laporan i").count();
ok(adaIkon > 0, "U2: tombol nav punya elemen ikon di dalamnya (prasyarat uji)", `${adaIkon} ikon`);
await page.click("#nav-laporan i", { force: true });
await page.waitForTimeout(1200);
ok(await page.evaluate(() => document.getElementById("view-laporan").classList.contains("block")),
  "U2: klik IKON di dalam tombol tetap menjalankan aksi tombolnya");

// klik tombolnya langsung juga harus jalan
await page.click("#nav-dashboard");
await page.waitForTimeout(1000);
ok(await page.evaluate(() => document.getElementById("view-dashboard").classList.contains("block")),
  "U2: klik tombol itu sendiri tetap jalan");

// ===================== U3: tipe argumen dari data-args tetap ANGKA =====================
console.log("\n-- U3: data-args mempertahankan tipe (angka tetap angka) --");
await page.evaluate(() => switchView("laporan"));
await page.waitForTimeout(1200);
const tombolTahun = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[data-action="shiftReportYear"]')];
  return el.map((e, i) => {
    e.setAttribute("data-uji-tahun", String(i));
    return { args: e.getAttribute("data-args"), id: e.id || null };
  });
});
ok(tombolTahun.length >= 2, "U3: tombol geser tahun ditemukan", JSON.stringify(tombolTahun.map((t) => t.args)));
const tahunSebelum = await page.evaluate(() => (typeof selectedReportYear !== "undefined" ? selectedReportYear : null));
const idxNaik = tombolTahun.findIndex((t) => t.args === "[1]");
await page.click(`[data-uji-tahun="${idxNaik}"]`, { force: true });
await page.waitForTimeout(1200);
const tahunSesudah = await page.evaluate(() => (typeof selectedReportYear !== "undefined" ? selectedReportYear : null));
ok(typeof tahunSesudah === "number", "U3: nilai tahun tetap bertipe number", `${typeof tahunSesudah}`);
ok(tahunSesudah === tahunSebelum + 1,
  "U3: argumen [1] diperlakukan sebagai ANGKA, bukan string", `${tahunSebelum} -> ${tahunSesudah}`);

// ===================== U4: elemen bersarang tidak menjalankan aksi dua kali =====================
console.log("\n-- U4: data-action bersarang hanya sekali jalan --");
const u4 = await page.evaluate(async () => {
  // Bangun sarang buatan yang meniru satu-satunya sarang nyata di index.html.
  let hitung = 0;
  window.__ujiSarang = () => { hitung += 1; };
  uiActionRegistry().__ujiSarang = window.__ujiSarang;
  const luar = document.createElement("div");
  luar.setAttribute("data-action", "__ujiSarang");
  const dalam = document.createElement("button");
  dalam.setAttribute("data-action", "__ujiSarang");
  dalam.id = "uji-sarang-dalam";
  luar.appendChild(dalam);
  document.body.appendChild(luar);
  dalam.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  luar.remove();
  return hitung;
});
ok(u4 === 1, "U4: aksi bersarang dijalankan TEPAT SEKALI (closest ambil yang terdekat)", `terpanggil ${u4}x`);

// ===================== U5: input rusak tidak mematikan halaman =====================
console.log("\n-- U5: ketahanan terhadap aksi tak dikenal & data-args rusak --");
const errSebelum = konsolError.length;
const errHalamanSebelum = errorHalaman.length;
await page.evaluate(async () => {
  const b1 = document.createElement("button");
  b1.setAttribute("data-action", "aksiYangTidakPernahAda");
  b1.id = "uji-aksi-hantu";
  document.body.appendChild(b1);
  b1.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  const b2 = document.createElement("button");
  b2.setAttribute("data-action", "switchView");
  b2.setAttribute("data-args", "{ini bukan json}");
  b2.id = "uji-args-rusak";
  document.body.appendChild(b2);
  b2.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  b1.remove();
  b2.remove();
});
await page.waitForTimeout(500);
ok(konsolError.length >= errSebelum + 2, "U5: keduanya DILAPORKAN ke console.error (tidak senyap)",
  `${konsolError.length - errSebelum} pesan baru`);
ok(errorHalaman.length === errHalamanSebelum, "U5: tidak ada exception yang lolos ke halaman");

// dispatcher harus MASIH hidup setelah dua input rusak tadi
await page.click("#nav-aset");
await page.waitForTimeout(1000);
ok(await page.evaluate(() => document.getElementById("view-aset").classList.contains("block")),
  "U5: dispatcher tetap berfungsi setelah menemui input rusak");

// ===================== U6: modal buka/tutup lewat data-action =====================
console.log("\n-- U6: alur modal (buka & tutup) lewat aksi --");
await page.evaluate(() => switchView("dashboard"));
await page.waitForTimeout(700);
await page.click("#fabDesktopCatat", { force: true });
await page.waitForTimeout(1000);
ok(await page.evaluate(() => !document.getElementById("modalForm").classList.contains("hidden")),
  "U6: aksi openModal membuka modal catat transaksi");
await page.evaluate(() => {
  const t = [...document.querySelectorAll('#modalForm [data-action="closeModal"]')][0];
  if (t) t.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await page.waitForTimeout(900);
ok(await page.evaluate(() => document.getElementById("modalForm").classList.contains("hidden")),
  "U6: aksi closeModal menutup modal itu kembali");

// ===================== U7: SELURUH 119 elemen benar-benar men-dispatch =====================
// Cek sebelumnya membuktikan nama aksi TERPETAKAN, dan beberapa klik nyata
// membuktikan dispatcher hidup. Yang belum: apakah SETIAP elemen di markup
// benar-benar memicu aksinya saat diklik. Mengklik semuanya beneran jelas tidak
// bisa (ada logout, hapus data, dsb), jadi seluruh isi registry disulih dulu
// dengan mata-mata: dispatch tetap berjalan penuh lewat jalur yang sama, tapi
// nol efek samping. Setelah selesai, registry dikembalikan seperti semula.
console.log("\n-- U7: setiap elemen ber-data-action memicu aksinya saat diklik --");
const u7 = await page.evaluate(async () => {
  const reg = uiActionRegistry();
  const asli = { ...reg };
  const tercatat = [];
  for (const k of Object.keys(reg)) reg[k] = (...args) => { tercatat.push({ k, args }); };

  const el = [...document.querySelectorAll("[data-action]")];
  const diharapkan = el.map((e) => ({
    k: e.getAttribute("data-action"),
    args: e.getAttribute("data-args") ? JSON.parse(e.getAttribute("data-args")) : [],
  }));
  for (const e of el) e.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));

  Object.keys(reg).forEach((k) => { reg[k] = asli[k]; });   // pulihkan

  const bisu = [];
  for (let i = 0; i < diharapkan.length; i += 1) {
    const d = diharapkan[i];
    const c = tercatat[i];
    if (!c || c.k !== d.k || JSON.stringify(c.args) !== JSON.stringify(d.args)) {
      bisu.push(`#${i} harap=${d.k}(${JSON.stringify(d.args)}) dapat=${c ? c.k + "(" + JSON.stringify(c.args) + ")" : "TIDAK TERPANGGIL"}`);
    }
  }
  return { jumlahElemen: el.length, terpanggil: tercatat.length, bisu: bisu.slice(0, 5), totalBisu: bisu.length };
});
ok(u7.terpanggil === u7.jumlahElemen,
  "U7: SEMUA elemen ber-data-action memicu aksi saat diklik",
  `${u7.terpanggil}/${u7.jumlahElemen} terpanggil`);
ok(u7.totalBisu === 0,
  "U7: setiap panggilan membawa nama aksi & argumen yang tepat",
  u7.bisu.join(" | ") || "semua cocok");

// dispatcher & registry harus utuh lagi setelah pemulihan
await page.evaluate(() => switchView("dashboard"));
await page.waitForTimeout(500);
await page.click("#nav-budget");
await page.waitForTimeout(1000);
ok(await page.evaluate(() => document.getElementById("view-budget").classList.contains("block")),
  "U7: registry pulih utuh setelah disulih (aksi asli jalan lagi)");

// ===================== U8: HTML DINAMIS (Fase 4 tahap B) =====================
// Elemen di bawah ini TIDAK ada di index.html -- semuanya dirender runtime dari
// template JS. Dulu mereka memakai onclick= dengan data pengguna disisipkan ke
// dalam string kode lewat jsStr().
console.log("\n-- U8: aksi pada HTML yang dirender runtime --");
await page.evaluate(() => switchView("transaksi"));
await page.waitForTimeout(1800);
const u8 = await page.evaluate(() => {
  const reg = uiActionRegistry();
  const el = [...document.querySelectorAll("[data-action]")].filter((e) => !e.closest("#appShell > nav"));
  const dinamis = [...document.querySelectorAll('[data-action="hapusData"], [data-action="editDataForm"]')];
  return {
    totalDom: el.length,
    dinamis: dinamis.length,
    argsContoh: dinamis[0] ? dinamis[0].getAttribute("data-args") : null,
    takTerpetakan: [...new Set([...document.querySelectorAll("[data-action]")]
      .map((e) => e.getAttribute("data-action")))].filter((n) => typeof reg[n] !== "function"),
  };
});
ok(u8.dinamis > 0, "U8: tombol dari HTML dinamis hadir (edit/hapus transaksi)", `${u8.dinamis} tombol`);
ok(u8.takTerpetakan.length === 0, "U8: seluruh aksi di DOM (statis + dinamis) terpetakan ke fungsi",
  u8.takTerpetakan.join(", ") || "semua terpetakan");

// argumen dari data dinamis sampai utuh ke fungsi
const u8b = await page.evaluate(async () => {
  const reg = uiActionRegistry();
  const asli = reg.hapusData;
  let diterima = null;
  reg.hapusData = (...args) => { diterima = args; };
  const btn = document.querySelector('[data-action="hapusData"]');
  const diharapkan = JSON.parse(btn.getAttribute("data-args"));
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  reg.hapusData = asli;
  return { diterima, diharapkan };
});
ok(JSON.stringify(u8b.diterima) === JSON.stringify(u8b.diharapkan),
  "U8: argumen dari data dinamis sampai utuh ke fungsi",
  `${JSON.stringify(u8b.diterima)} vs ${JSON.stringify(u8b.diharapkan)}`);

// ---- U9: data pengguna "nakal" tidak bisa memutus atribut / jadi kode ----
console.log("\n-- U9: data pengguna nakal pada HTML dinamis --");
await page.evaluate(() => switchView("aset"));
await page.waitForTimeout(1800);
const u9 = await page.evaluate(() => {
  const kartu = document.querySelector('[data-action="openAssetDetailModal"]');
  if (!kartu) return { ada: false };
  return {
    ada: true,
    punyaOnmouseover: kartu.hasAttribute("onmouseover"),
    args: JSON.parse(kartu.getAttribute("data-args")),
    adaAtributLiar: [...document.querySelectorAll("[onmouseover]")].length,
  };
});
ok(u9.ada, "U9: kartu aset (HTML dinamis) ter-render");
ok(u9.ada && !u9.punyaOnmouseover && u9.adaAtributLiar === 0,
  "U9: nama aset berisi kutip+onmouseover TIDAK menjadi atribut baru",
  `atribut liar=${u9.adaAtributLiar}`);

// ---- U10: yang dulu dijaga stopPropagation ----
// Tombol ubah/hapus di dalam baris yang juga bisa diklik. Dulu memakai
// event.stopPropagation() agar aksi induk tidak ikut jalan; sekarang closest()
// yang menjaminnya. Ini cek langsung bahwa induknya BENAR-BENAR tidak terpanggil.
console.log("\n-- U10: aksi anak tidak ikut memicu aksi induk --");
const u10 = await page.evaluate(async () => {
  // Cari pasangan bersarang APA PUN di DOM saat ini: elemen ber-data-action yang
  // punya leluhur ber-data-action. Jangan mematok nama tertentu -- querySelector
  // bisa menangkap tombol STATIS berNAMA sama yang tidak bersarang.
  // WAJIB pasangan dengan nama aksi BERBEDA. Kalau anak & induk kebetulan
  // memanggil aksi yang sama (ada satu pasangan begitu di nav), cek "induk tidak
  // ikut jalan" jadi hampa -- tidak ada yang bisa dibedakan. Ini pernah terjadi
  // saat harness ini pertama ditulis dan menghasilkan PASS palsu.
  let anak = null, induk = null;
  for (const kandidat of document.querySelectorAll("[data-action]")) {
    const atas = kandidat.parentElement && kandidat.parentElement.closest("[data-action]");
    if (atas && atas.getAttribute("data-action") !== kandidat.getAttribute("data-action")) {
      anak = kandidat; induk = atas; break;
    }
  }
  if (!anak) return { ada: false, alasan: "tidak ada pasangan bersarang bernama beda di DOM ini" };
  const reg = uiActionRegistry();
  const namaAnak = anak.getAttribute("data-action");
  const namaInduk = induk.getAttribute("data-action");
  const asliAnak = reg[namaAnak], asliInduk = reg[namaInduk];
  let anakJalan = 0, indukJalan = 0;
  reg[namaAnak] = () => { anakJalan += 1; };
  reg[namaInduk] = () => { indukJalan += 1; };
  anak.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  reg[namaAnak] = asliAnak; reg[namaInduk] = asliInduk;
  return { ada: true, namaAnak, namaInduk, anakJalan, indukJalan };
});
ok(u10.ada, "U10: menemukan tombol anak yang bersarang di baris yang bisa diklik",
  u10.ada ? `${u10.namaAnak} di dalam ${u10.namaInduk}` : (u10.alasan || ""));
ok(u10.ada && u10.anakJalan === 1, "U10: aksi ANAK jalan tepat sekali", `${u10.anakJalan}x`);
ok(u10.ada && u10.indukJalan === 0,
  "U10: aksi INDUK TIDAK ikut jalan (pengganti event.stopPropagation)", `${u10.indukJalan}x`);

// ============ U11: handler NON-KLIK (v104) ============
// change/input/submit/keydown/focus/blur dulu ditulis sebagai atribut inline.
// Semuanya MATI di bawah CSP tanpa 'unsafe-inline' (terbukti di browser:
// el.oninput jadi null + pelanggaran script-src-attr), jadi konversinya
// prasyarat mutlak untuk pengetatan CSP. Pola pembuktiannya sama dengan U7:
// registry disulih jadi mata-mata, SETIAP elemen dipicu, nol efek samping.
console.log("\n-- U11: handler non-klik benar-benar terpicu --");
const u11 = await page.evaluate(async () => {
  const PETA = {
    "data-on-change": "change",
    "data-on-input": "input",
    "data-on-submit": "submit",
    "data-on-keydown": "keydown",
    "data-on-focus": "focusin",
    "data-on-blur": "focusout",
  };
  const reg = uiActionRegistry();
  const asli = { ...reg };
  const tercatat = [];
  for (const k of Object.keys(reg)) reg[k] = (...args) => { tercatat.push({ k, args }); };

  const rencana = [];
  for (const [atr, namaEvent] of Object.entries(PETA)) {
    for (const el of document.querySelectorAll(`[${atr}]`)) {
      rencana.push({ el, atr, namaEvent, aksi: el.getAttribute(atr) });
    }
  }
  const takTerpetakan = [...new Set(rencana.map((r) => r.aksi))].filter((n) => typeof asli[n] !== "function");

  for (const r of rencana) {
    const ev = r.namaEvent === "keydown"
      ? new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
      : new Event(r.namaEvent, { bubbles: true, cancelable: true });
    r.el.dispatchEvent(ev);
  }
  await new Promise((r) => setTimeout(r, 300));
  Object.keys(reg).forEach((k) => { reg[k] = asli[k]; });

  const bisu = rencana.filter((r, i) => !tercatat[i] || tercatat[i].k !== r.aksi)
    .slice(0, 5).map((r) => `${r.atr}=${r.aksi}`);
  const perAtribut = {};
  for (const r of rencana) perAtribut[r.atr] = (perAtribut[r.atr] || 0) + 1;
  return { total: rencana.length, terpanggil: tercatat.length, takTerpetakan, bisu, perAtribut };
});
ok(u11.total >= 60, "U11: elemen handler non-klik hadir di DOM",
  `${u11.total} elemen — ${JSON.stringify(u11.perAtribut)}`);
ok(u11.takTerpetakan.length === 0, "U11: semua aksi non-klik terpetakan ke fungsi",
  u11.takTerpetakan.join(", ") || "semua terpetakan");
ok(u11.terpanggil === u11.total, "U11: SETIAP elemen memicu aksinya saat event-nya terjadi",
  `${u11.terpanggil}/${u11.total}`);
ok(u11.bisu.length === 0, "U11: aksi yang terpanggil sesuai atributnya", u11.bisu.join(" | ") || "cocok");

// Placeholder $event/$el/$value harus benar-benar diselesaikan, bukan lewat apa adanya
const u11b = await page.evaluate(async () => {
  const reg = uiActionRegistry();
  const el = document.querySelector('[data-on-submit="submitForm"]');
  if (!el) return { ada: false };
  const asli = reg.submitForm;
  let diterima = null;
  reg.submitForm = (...args) => { diterima = args; };
  el.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 150));
  reg.submitForm = asli;
  return { ada: true, jenis: diterima ? typeof diterima[0] : null,
           adalahEvent: !!(diterima && diterima[0] && typeof diterima[0].preventDefault === "function") };
});
ok(u11b.ada && u11b.adalahEvent,
  "U11: placeholder $event diselesaikan jadi objek Event sungguhan (bukan string)",
  `tipe=${u11b.jenis}`);

// ===================== ringkasan =====================
const errorTakTerduga = konsolError.filter((t) => !t.includes("[ui-action]"));
console.log("\n== HASIL VERIFY UI ACTIONS (31 cek) ==");
console.log(`Error halaman (${errorHalaman.length})`);
[...new Set(errorHalaman)].slice(0, 5).forEach((e) => console.log(`   ${e}`));
console.log(`console.error di luar [ui-action] (${errorTakTerduga.length})`);
[...new Set(errorTakTerduga)].slice(0, 5).forEach((e) => console.log(`   ${e}`));
console.log(gagal === 0 ? "SEMUA CEK LOLOS" : `${gagal} CEK GAGAL`);

await browser.close();
process.exit(gagal === 0 && errorHalaman.length === 0 && errorTakTerduga.length === 0 ? 0 : 1);

// KONTRAK AKSI UI DEKLARATIF (Fase 4, v101).
//
// Setelah 119 atribut onclick= di index.html diganti data-action=, muncul
// kontrak baru yang GAMPANG PUTUS DIAM-DIAM: markup menyebut nama aksi sebagai
// STRING, dan tidak ada yang memaksa string itu benar-benar punya fungsi. Salah
// ketik satu huruf = tombol mati tanpa error saat build, tanpa error saat boot,
// dan baru ketahuan kalau ada yang kebetulan mengkliknya.
//
// Berkas ini menutup celah itu di tingkat statis (cepat, jalan di tiap commit),
// sementara scripts/verify-ui-actions.mjs menutupnya di tingkat runtime
// (registry sungguhan di browser + klik nyata).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const src = readFileSync(resolve(ROOT, "app.src.js"), "utf8");

// ---- isi registry diambil dari app.src.js apa adanya (satu sumber kebenaran) ----
function registryEntries() {
  const mulai = src.indexOf("__uiActionsCache = {");
  assert.notEqual(mulai, -1, "blok __uiActionsCache = { ... } harus ada di app.src.js");
  const buka = src.indexOf("{", mulai);
  let dalam = 0;
  let selesai = -1;
  for (let i = buka; i < src.length; i += 1) {
    if (src[i] === "{") dalam += 1;
    else if (src[i] === "}") {
      dalam -= 1;
      if (dalam === 0) { selesai = i; break; }
    }
  }
  assert.notEqual(selesai, -1, "kurung registry tidak seimbang");
  const isi = src.slice(buka + 1, selesai);
  const tanpaKomentar = isi.replace(/\/\/[^\n]*/g, "");
  return tanpaKomentar
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.includes(":") ? s.split(":")[0].trim() : s));
}

function markupActions() {
  return [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);
}

function terdeklarasi(nama) {
  const n = nama.replace(/\$/g, "\\$");
  return new RegExp(`function\\s+${n}\\s*\\(|\\b(?:const|let|var)\\s+${n}\\s*=`).test(src);
}

test("index.html sudah BEBAS dari atribut onclick=", () => {
  const sisa = [...html.matchAll(/onclick="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(sisa, [], `masih ada onclick= di index.html: ${sisa.slice(0, 5).join(" | ")}`);
});

test("jumlah data-action masuk akal (konversi tidak diam-diam hilang)", () => {
  const aksi = markupActions();
  assert.ok(aksi.length >= 119, `data-action di index.html cuma ${aksi.length}, harusnya >= 119`);
});

test("SETIAP data-action di markup punya entri di registry", () => {
  const daftar = new Set(registryEntries());
  const hilang = [...new Set(markupActions())].filter((a) => !daftar.has(a));
  assert.deepEqual(hilang, [], `aksi dipakai di index.html tapi TIDAK ada di uiActionRegistry(): ${hilang.join(", ")}`);
});

test("SETIAP entri registry benar-benar terdeklarasi sebagai fungsi", () => {
  const hilang = registryEntries().filter((n) => !terdeklarasi(n));
  assert.deepEqual(hilang, [], `terdaftar di registry tapi tidak ada deklarasinya: ${hilang.join(", ")}`);
});

test("SETIAP data-args adalah JSON array yang valid", () => {
  const rusak = [];
  for (const m of html.matchAll(/data-args='([^']*)'/g)) {
    try {
      const v = JSON.parse(m[1]);
      if (!Array.isArray(v)) rusak.push(`${m[1]} (bukan array)`);
    } catch {
      rusak.push(`${m[1]} (JSON tidak valid)`);
    }
  }
  assert.deepEqual(rusak, [], `data-args bermasalah: ${rusak.join(" | ")}`);
});

test("data-args selalu menempel pada elemen yang juga punya data-action", () => {
  // data-args tanpa data-action = argumen yatim: tidak akan pernah terpakai.
  const yatim = [...html.matchAll(/<[^>]*data-args='[^']*'[^>]*>/g)]
    .filter((m) => !m[0].includes("data-action="))
    .map((m) => m[0].slice(0, 80));
  assert.deepEqual(yatim, [], `data-args tanpa data-action: ${yatim.join(" | ")}`);
});

test("dispatcher klik terpasang di level document", () => {
  assert.ok(
    /document\.addEventListener\('click', function \(ev\) \{/.test(src),
    "listener delegasi klik harus ada di app.src.js"
  );
  assert.ok(/closest\('\[data-action\]'\)/.test(src), "dispatcher harus memakai closest('[data-action]')");
});

test("aksi yang tidak dikenal DILAPORKAN, bukan gagal diam-diam", () => {
  const i = src.indexOf("function runUiAction(");
  assert.notEqual(i, -1);
  const fn = src.slice(i, i + 700);
  assert.ok(/console\.error\('\[ui-action\] aksi tidak dikenal:'/.test(fn),
    "runUiAction harus berisik saat aksi tidak ada -- tombol mati diam-diam itu yang mau dihindari");
});

test("data-args yang rusak tidak menjatuhkan handler (ada try/catch)", () => {
  const i = src.indexOf("function parseUiActionArgs(");
  assert.notEqual(i, -1);
  const fn = src.slice(i, i + 700);
  assert.ok(/try \{/.test(fn) && /catch/.test(fn), "parseUiActionArgs wajib menangkap JSON rusak");
});

test("KONTRAK BUILD: setiap nama aksi tetap ada sebagai fungsi di app.js hasil minify", () => {
  // mangle.toplevel=false membuat nama global aman, tapi kalau suatu saat opsi
  // itu berubah, kontrak inilah yang jebol duluan -- jadi diuji eksplisit.
  const out = readFileSync(resolve(ROOT, "app.js"), "utf8");
  const hilang = registryEntries().filter((n) => {
    const e = n.replace(/\$/g, "\\$");
    return !new RegExp(`function\\s+${e}\\s*\\(|\\b(?:const|let|var)\\s+${e}\\s*=`).test(out);
  });
  assert.deepEqual(hilang, [], `nama aksi hilang dari app.js: ${hilang.join(", ")}`);
});

test("harness E2E tidak memilih elemen ber-data-action lewat selector [onclick=]", () => {
  // Pelajaran dari konversi ini: dua harness memilih tombol dengan
  // `button[onclick="fn()"]`. Begitu atribut itu hilang, harness-nya TIMEOUT
  // 30 detik lalu melempar -- bukan gagal cek yang terbaca. Selector semacam
  // itu hanya boleh menunjuk HTML DINAMIS app.src.js (yang memang masih
  // onclick= sampai Fase 4 tahap B), tidak boleh menunjuk markup index.html.
  const { readdirSync } = require("node:fs");
  const dir = resolve(ROOT, "scripts");
  const semuaAksi = new Set([...markupActions(), ...aksiDinamis(), ...registryEntries()]);
  const salah = [];
  for (const f of readdirSync(dir).filter((n) => n.startsWith("verify-") && n.endsWith(".mjs"))) {
    const teks = readFileSync(resolve(dir, f), "utf8");
    for (const m of teks.matchAll(/\[onclick="([A-Za-z_$][\w$]*)\(/g)) {
      const nama = m[1];
      // v102: dibandingkan ke SELURUH nama aksi (markup statis + HTML dinamis),
      // bukan cuma index.html. Versi sebelumnya hanya memeriksa index.html dan
      // karena itu MELEWATKAN selector App Lock & paginasi yang baru dikonversi
      // di tahap B -- dua harness sempat timeout 30 detik karenanya.
      if (semuaAksi.has(nama)) {
        salah.push(`${f}: [onclick="${nama}(...)"] padahal ${nama} kini sebuah data-action`);
      }
    }
  }
  assert.deepEqual(salah, [], salah.join("\n"));
});

// ===========================================================================
// FASE 4 TAHAP B (v102): HTML yang DIHASILKAN runtime
// ===========================================================================
// Celah baru yang muncul di tahap B: nama aksi ditulis sebagai string di dalam
// template JS (`uiActionAttrs('hapusData', row.id)`). Salah ketik di situ tidak
// menghasilkan error apa pun -- tombolnya cuma diam saat diklik, dan itu baru
// ketahuan kalau ada yang mengkliknya. Guard di bawah menutupnya secara statis.

const BERKAS_RENDER = [
  "app.src.js",
  "src/ui/accounts.js", "src/ui/assets.js", "src/ui/budgets.js",
  "src/ui/goals-debts.js", "src/ui/recurring.js",
];

function aksiDinamis() {
  const nama = new Set();
  for (const f of BERKAS_RENDER) {
    const teks = readFileSync(resolve(ROOT, f), "utf8");
    for (const m of teks.matchAll(/uiActionAttrs\(\s*'([A-Za-z_$][\w$]*)'/g)) nama.add(m[1]);
    for (const m of teks.matchAll(/uiActionAttrs\(\s*"([A-Za-z_$][\w$]*)"/g)) nama.add(m[1]);
  }
  return [...nama];
}

test("tahap B: SETIAP aksi di HTML dinamis terdaftar di registry", () => {
  const daftar = new Set(registryEntries());
  const hilang = aksiDinamis().filter((n) => !daftar.has(n));
  assert.deepEqual(hilang, [], `dipakai uiActionAttrs() tapi tidak ada di registry: ${hilang.join(", ")}`);
});

test("tahap B: aksi dinamis jumlahnya masuk akal (konversi tidak hilang diam-diam)", () => {
  assert.ok(aksiDinamis().length >= 40, `aksi dinamis cuma ${aksiDinamis().length}, harusnya >= 40`);
});

test("tahap B: aksi yang namanya VARIABEL punya nilai yang terdaftar", () => {
  // Dua tempat memakai nama aksi dinamis: historyPaginationHtml(handler) dan
  // kontrak onClickItem -> {action, args}. Nilainya tidak bisa dicek regex biasa,
  // jadi dicek dari SISI PEMANGGIL.
  const teks = readFileSync(resolve(ROOT, "app.src.js"), "utf8");
  const daftar = new Set(registryEntries());
  const nilai = [
    ...[...teks.matchAll(/historyPaginationHtml\([^,]+,\s*[^,]+,\s*'([^']+)'\)/g)].map((m) => m[1]),
    ...[...teks.matchAll(/onClickItem:\s*\(label\)\s*=>\s*\(\{\s*action:\s*'([^']+)'/g)].map((m) => m[1]),
  ];
  assert.ok(nilai.length >= 5, `pemanggil aksi-variabel terdeteksi cuma ${nilai.length} (regex rusak?)`);
  const hilang = nilai.filter((n) => !daftar.has(n));
  assert.deepEqual(hilang, [], `nama aksi variabel tidak terdaftar: ${hilang.join(", ")}`);
});

test("tahap B: TIDAK ADA lagi onclick= di berkas render mana pun", () => {
  const sisa = [];
  for (const f of BERKAS_RENDER) {
    const teks = readFileSync(resolve(ROOT, f), "utf8");
    teks.split("\n").forEach((baris, i) => {
      const polos = baris.trim();
      if (polos.startsWith("*") || polos.startsWith("//")) return; // komentar boleh menyebut
      if (/onclick="/.test(baris)) sisa.push(`${f}:${i + 1} ${polos.slice(0, 70)}`);
    });
  }
  assert.deepEqual(sisa, [], `masih ada onclick= di HTML yang dihasilkan:\n${sisa.join("\n")}`);
});

test("tahap B: fallback __sanitize.uiActionAttrs identik dengan modul sumber", async () => {
  // Monolit punya salinan cadangan yang dipakai SEBELUM modul ter-adopsi.
  // Kalau keduanya menyimpang, hasil escape bisa beda di detik-detik awal boot.
  const modul = await import(resolve(ROOT, "src/domain/sanitize.js"));
  const i = src.indexOf("uiActionAttrs: function (action, ...args) {");
  assert.notEqual(i, -1, "fallback uiActionAttrs harus ada di app.src.js");
  const akhir = src.indexOf("},", i);
  const badan = src.slice(i, akhir);
  const fallback = new Function(
    "escapeHtml",
    `const o = { escapeHtml, ${badan}} }; return o.uiActionAttrs.bind(o);`
  )(modul.escapeHtml);
  const kasus = [
    ["hapusData"],
    ["hapusData", "tx-1"],
    // Nama aksi yang butuh escape. Tanpa kasus ini, melepas escapeHtml() dari
    // NAMA aksi di fallback lolos tanpa ketahuan -- terbukti saat guard ini
    // diuji-negatif, jadi kasusnya sengaja dipertahankan di sini.
    ['<x&"aneh', "arg"],
    ['" data-action="lain', "arg"],
    ["f", 'a" onmouseover=alert(1) x="', "<img>", 3, true, null],
    ["g", "kutip ' tunggal & ampersand"],
  ];
  for (const k of kasus) {
    assert.equal(fallback(...k), modul.uiActionAttrs(...k), `fallback menyimpang untuk ${JSON.stringify(k)}`);
  }
});

test("tahap B: data pengguna di-escape sehingga tidak bisa memutus atribut", async () => {
  const { uiActionAttrs } = await import(resolve(ROOT, "src/domain/sanitize.js"));
  const jahat = '" onmouseover="alert(1)';
  const hasil = uiActionAttrs("hapusData", jahat);
  assert.ok(!hasil.includes('" onmouseover="alert(1)'), "kutip ganda mentah bocor ke atribut");
  assert.ok(hasil.includes("&quot;"), "kutip ganda harus jadi &quot;");
  // dan tetap bisa dibaca balik utuh setelah browser meng-unescape entitas
  const isi = hasil.match(/data-args="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  assert.deepEqual(JSON.parse(isi), [jahat], "argumen harus utuh setelah di-unescape");
});

// ===========================================================================
// HANDLER NON-KLIK (v104) — prasyarat pengetatan CSP
// ===========================================================================
// CSP tanpa 'unsafe-inline' memblokir SEMUA atribut handler inline, bukan cuma
// onclick. Selama onchange/oninput/onsubmit/onkeydown/onfocus/onblur masih ada,
// kebijakan ketat itu mematikan filter transaksi, toggle setelan, submit form,
// dan tombol Enter -- tanpa error, cuma diam.
const ATRIBUT_EVENT = ["data-on-change", "data-on-input", "data-on-submit",
  "data-on-keydown", "data-on-focus", "data-on-blur"];

function aksiNonKlik() {
  const nama = new Set();
  for (const atr of ATRIBUT_EVENT) {
    for (const m of html.matchAll(new RegExp(`${atr}="([^"]+)"`, "g"))) nama.add(m[1]);
  }
  return [...nama];
}

test("index.html BEBAS dari SEMUA atribut handler inline (bukan cuma onclick)", () => {
  const sisa = [...html.matchAll(/\son(?:click|change|input|submit|keyup|keydown|focus|blur)="([^"]*)"/g)]
    .map((m) => m[0].slice(0, 60));
  assert.deepEqual(sisa, [], `masih ada atribut handler inline: ${sisa.slice(0, 5).join(" | ")}`);
});

test("SETIAP aksi non-klik terdaftar di registry", () => {
  const daftar = new Set(registryEntries());
  const hilang = aksiNonKlik().filter((n) => !daftar.has(n));
  assert.deepEqual(hilang, [], `aksi non-klik tidak ada di uiActionRegistry(): ${hilang.join(", ")}`);
});

test("jumlah handler non-klik masuk akal", () => {
  const total = ATRIBUT_EVENT.reduce(
    (n, atr) => n + [...html.matchAll(new RegExp(`${atr}="`, "g"))].length, 0);
  assert.ok(total >= 60, `cuma ${total} handler non-klik terdeteksi -- curiga konversi hilang`);
});

test("data-on-*-args berisi JSON array yang valid", () => {
  const rusak = [];
  for (const atr of ATRIBUT_EVENT) {
    for (const m of html.matchAll(new RegExp(`${atr}-args='([^']*)'`, "g"))) {
      try {
        if (!Array.isArray(JSON.parse(m[1]))) rusak.push(`${atr}: ${m[1]} (bukan array)`);
      } catch { rusak.push(`${atr}: ${m[1]} (JSON tidak valid)`); }
    }
  }
  assert.deepEqual(rusak, [], rusak.join(" | "));
});

test("dispatcher menangani keenam jenis event, dan focus/blur lewat focusin/focusout", () => {
  // focus & blur TIDAK menggelembung; kalau didengarkan langsung di document,
  // handler-nya tidak akan pernah jalan. Ini penjaga kekeliruan itu.
  assert.match(src, /const UI_EVENT_ATTR = \{/);
  for (const [ev, atr] of [["change", "data-on-change"], ["input", "data-on-input"],
    ["submit", "data-on-submit"], ["keydown", "data-on-keydown"],
    ["focusin", "data-on-focus"], ["focusout", "data-on-blur"]]) {
    assert.match(src, new RegExp(`${ev}: '${atr}'`), `pemetaan ${ev} -> ${atr} harus ada`);
  }
  assert.ok(!/document\.addEventListener\('focus'/.test(src), "jangan dengarkan 'focus' di document -- ia tidak menggelembung");
  assert.ok(!/document\.addEventListener\('blur'/.test(src), "jangan dengarkan 'blur' di document -- ia tidak menggelembung");
});

test("placeholder argumen ($event/$el/$value/$checked) diselesaikan saat event", () => {
  const i = src.indexOf("function nilaiPlaceholder(");
  assert.notEqual(i, -1, "nilaiPlaceholder() harus ada");
  const fn = src.slice(i, i + 500);
  for (const ph of ["$event", "$el", "$value", "$checked"]) {
    assert.ok(fn.includes(`'${ph}'`), `placeholder ${ph} harus ditangani`);
  }
});

test("SEMUA callback onClickItem memakai kontrak {action, args}, bukan string kode", () => {
  // Kontrak ini berubah di v102. Tiga pemanggil di app.src.js ikut diperbarui,
  // tapi satu di src/ui/accounts.js TERLEWAT -- akibatnya membuka detail akun
  // melempar "args is not iterable" dan panelnya kosong. Tidak ada gerbang yang
  // menangkapnya karena unit test modul itu justru masih mengunci bentuk lama.
  // Guard ini memeriksa SELURUH berkas render sekaligus.
  const salah = [];
  for (const f of BERKAS_RENDER) {
    for (const baris of readFileSync(resolve(ROOT, f), "utf8").split("\n")) {
      const polos = baris.trim();
      if (polos.startsWith("//") || polos.startsWith("*")) continue; // komentar boleh menyebut kontraknya
      const m = polos.match(/onClickItem:\s*\([^)]*\)\s*=>\s*([^,\n]+)/);
      if (!m) continue;
      if (!m[1].trim().startsWith("({")) salah.push(`${f}: onClickItem => ${m[1].trim().slice(0, 60)}`);
    }
  }
  assert.deepEqual(salah, [],
    `onClickItem harus mengembalikan objek {action, args}:\n${salah.join("\n")}`);
});

test("renderDonutBreakdown menolak bentuk onClickItem yang salah tanpa menjatuhkan panel", () => {
  const i = src.indexOf("const aksiItem = clickable ? onClickItem(e.label) : null;");
  const j = src.indexOf("let aksiItem = clickable ? onClickItem(e.label) : null;");
  assert.equal(i, -1, "pemakaian tanpa validasi tidak boleh kembali");
  assert.notEqual(j, -1, "validasi bentuk aksiItem harus ada");
  const blok = src.slice(j, j + 600);
  assert.match(blok, /typeof aksiItem\.action !== 'string' \|\| !Array\.isArray\(aksiItem\.args\)/);
  assert.match(blok, /console\.error\('\[breakdown\]/);
});

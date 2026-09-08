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

test("harness E2E tidak memilih elemen index.html lewat selector [onclick=]", () => {
  // Pelajaran dari konversi ini: dua harness memilih tombol dengan
  // `button[onclick="fn()"]`. Begitu atribut itu hilang, harness-nya TIMEOUT
  // 30 detik lalu melempar -- bukan gagal cek yang terbaca. Selector semacam
  // itu hanya boleh menunjuk HTML DINAMIS app.src.js (yang memang masih
  // onclick= sampai Fase 4 tahap B), tidak boleh menunjuk markup index.html.
  const { readdirSync } = require("node:fs");
  const dir = resolve(ROOT, "scripts");
  const salah = [];
  for (const f of readdirSync(dir).filter((n) => n.startsWith("verify-") && n.endsWith(".mjs"))) {
    const teks = readFileSync(resolve(dir, f), "utf8");
    for (const m of teks.matchAll(/\[onclick="([A-Za-z_$][\w$]*)\(/g)) {
      const nama = m[1];
      if (html.includes(`data-action="${nama}"`)) {
        salah.push(`${f}: [onclick="${nama}(...)"] padahal di index.html sudah data-action="${nama}"`);
      }
    }
  }
  assert.deepEqual(salah, [], salah.join("\n"));
});

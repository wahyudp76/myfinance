import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { csvEscape, buildTransactionsCsv } from "../../src/domain/export-csv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const MONOLITH_SRC = readFileSync(resolve(ROOT, "app.src.js"), "utf8");

// ---------- helper: ekstrak implementasi DEFAULT __csv dari app.src.js ----------
// Sejak v78, implementasi monolit asli dipertahankan sebagai DEFAULT di `__csv`
// (objek top-level), dan fungsi global csvField menjadi delegasi tipis ke __csv.
// Guard ini membandingkan MODUL terhadap implementasi DEFAULT __csv yang tersimpan
// di app.src.js -- yang adalah kebenaran perilaku produksi yang berjalan selama ini.
function extractCsvDefault(name) {
  const re = new RegExp(name + "\\s*:\\s*function\\s*\\([^)]*\\)\\s*", "g");
  const m = re.exec(MONOLITH_SRC);
  assert.ok(m, `Default __csv.${name} tidak ditemukan di app.src.js -- kontrak berubah?`);
  const bodyStart = MONOLITH_SRC.indexOf("{", m.index + m[0].length - 1);
  let depth = 0, i = bodyStart;
  for (; i < MONOLITH_SRC.length; i++) {
    const ch = MONOLITH_SRC[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) break; }
  }
  const fnSource = MONOLITH_SRC.slice(m.index, i + 1);
  const fnOnly = fnSource.replace(new RegExp("\\s*^\\s*" + name + "\\s*:\\s*", "m"), "");
  return Function(`"use strict"; return (${fnOnly});`)();
}

const monolithFns = {};
try {
  monolithFns.csvEscape = extractCsvDefault("csvEscape");
} catch (e) {
  monolithFns.extractError = e;
}

// ============================================================================
// PERILAKU (modul)
// ============================================================================
test("csvEscape: quote RFC-4180 untuk koma/petik/baris baru", () => {
  assert.equal(csvEscape("Makan Siang"), "Makan Siang");
  assert.equal(csvEscape('Makan, "enak"'), '"Makan, ""enak"""');
  assert.equal(csvEscape("Baris\nBaru"), '"Baris\nBaru"');
  assert.equal(csvEscape("a\rb"), '"a\rb"');
});

test("csvEscape: nilai null/undefined jadi '' (String coercion)", () => {
  assert.equal(csvEscape(null), "");
  assert.equal(csvEscape(undefined), "");
});

test("csvEscape: sel diawali formula dinetralisir dengan apostrof (injection guard)", () => {
  assert.equal(csvEscape("=1+2"), "'=1+2");
  assert.equal(csvEscape('=HYPERLINK("http://evil","x")'), '"\'=HYPERLINK(""http://evil"",""x"")"');
  assert.equal(csvEscape("+cmd|'/C calc'!A0"), "'+cmd|'/C calc'!A0");
  assert.equal(csvEscape("-diskon"), "'-diskon");
  assert.equal(csvEscape("@SUM(A1:A2)"), "'@SUM(A1:A2)");
  assert.equal(csvEscape("\t=1"), "'\t=1");
});

test("csvEscape: angka polos (termasuk negatif/desimal) TIDAK dinetralisir", () => {
  assert.equal(csvEscape("1500000"), "1500000");
  assert.equal(csvEscape("0"), "0");
  assert.equal(csvEscape("-5000"), "-5000");
  assert.equal(csvEscape("1234.5"), "1234.5");
});

test("csvEscape: angka yang baru diawali -/+ bukan bilangan polos tetap dinetralisir", () => {
  assert.equal(csvEscape("-5+3"), "'-5+3"); // ekspresi, bukan angka
  assert.equal(csvEscape("+123"), "'+123");
});

// ============================================================================
// GUARD KONSISTENSI: modul vs implementasi DEFAULT __csv (kebenaran produksi)
// ============================================================================
test("KONSISTENSI: csvEscape modul == __csv default monolit app.src.js", () => {
  if (monolithFns.extractError) throw monolithFns.extractError;
  const cases = [
    "", "Makan Siang", 'Makan, "enak"', "Baris\nBaru", "a\rb",
    "=1+2", "+cmd|'/C calc'!A0", "-diskon", "@SUM(A1:A2)", "\t=1",
    "1500000", "0", "-5000", "1234.5", "-5+3", "+123",
    null, undefined, 0, true,
  ];
  for (const v of cases) {
    assert.equal(csvEscape(v), monolithFns.csvEscape(v), `csvEscape(${JSON.stringify(v)})`);
  }
});

// ============================================================================
// WIRING: pastikan monolit benar2 mengadopsi modul via __csv + delegator global
// ============================================================================
test("WIRING: app.src.js punya __csv + adoptCsvModule + delegasi csvField -> __csv.csvEscape", () => {
  assert.match(MONOLITH_SRC, /let __csv\s*=/);
  assert.match(MONOLITH_SRC, /adoptCsvModule\s*\(/);
  assert.match(MONOLITH_SRC, /typeof servicesModule\.csvEscape\s*===\s*["']function["']/);
  assert.match(MONOLITH_SRC, /__csv\s*=\s*\{\s*csvEscape:\s*servicesModule\.csvEscape\s*\}/);
  // fungsi global csvField DELEGASI (memanggil __csv.csvEscape), bukan menghitung sendiri.
  const fnSrc = (MONOLITH_SRC.match(/function\s+csvField\s*\([^)]*\)\s*\{[^}]*\}/) || [""])[0];
  assert.match(fnSrc, /__csv\.csvEscape/, "csvField harus delegasi ke __csv.csvEscape");
});

test("WIRING: index.html mengimpor csvEscape & memaparkannya di __myfinanceServices", () => {
  const HTML_SRC = readFileSync(resolve(ROOT, "index.html"), "utf8");
  assert.match(HTML_SRC, /import\s+\{[^}]*\bcsvEscape\b[^}]*\}\s+from\s+['"].*\bsrc\/domain\/export-csv\.js/);
  assert.match(HTML_SRC, /\bcsvEscape\b\s*,/);
  assert.equal(typeof csvEscape, "function");
});

test("WIRING: kedua jalur ekspor monolit memakai csvField (yang kini delegasi ber-guard)", () => {
  // exportTransactionsCsv (L4162-ish) & exportAssetsCsv (L5697-ish) keduanya map dengan csvField.
  const lines = MONOLITH_SRC.split("\n");
  const hits = lines.filter((l) => /\.map\(csvField\)/.test(l));
  // minimal 2 pemakaian `.map(csvField)` harus ada (transaksi + aset).
  assert.ok(hits.length >= 2, `diharapkan >=2 .map(csvField), ketemu ${hits.length}`);
  // Tidak boleh ada escaper lemah lama yang menulis ulang quote RFC-4180 tanpa guard di csvField.
  // (guard di atas sudah memastikan csvField delegasi; cek tidak ada definisi ulang csvField ber-logika.)
  const rawDef = MONOLITH_SRC.match(/function\s+csvField\s*\([^)]*\)\s*\{[^}]*\}/) || [""];
  assert.equal(rawDef.length, 1, "csvField harus didefinisikan sekali sebagai delegator tipis");
});

test("KONSISTENSI: buildTransactionsCsv memakai csvEscape yang sama (bukan duplikat)", () => {
  const csv = buildTransactionsCsv([{ tanggal: "2026-09-04", jenis: "Pengeluaran", kategori: "=evil", akun: "Cash", jumlah: 5000, keterangan: "x", mata_uang: "IDR" }]);
  assert.ok(csv.includes(",'=evil,"), "sel formula dinetralisir ('=evil) di hasil akhir CSV");
});

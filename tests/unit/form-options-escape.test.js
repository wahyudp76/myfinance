import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// GUARD (v60): dropdown "Akun" di form Catat Transaksi (updateFormOptions di
// app.src.js) MERENDER NAMA AKUN ke atribut value + teks <option>. Nama akun
// adalah input user bebas (bisa mengandung ", <, >, &) dan juga bisa datang
// dari restore backup JSON -- jadi WAJIB lewat escapeHtml, konsisten dengan
// dropdown akun lain (form berulang: openRecurringFormModal). Sebelumnya satu-
// satunya titik yang TIDAK di-escape; nama akun berisi karakter markup
// merusak markup dropdown (dan berpotensi menyuntik atribut/event handler).
const SOURCE = readFileSync(new URL("../../app.src.js", import.meta.url), "utf8");
const BUILD = readFileSync(new URL("../../app.js", import.meta.url), "utf8");

// Pola MENTAH: <option value="${X}">${X}</option> (X = nama variabel sama,
// tanpa escapeHtml di dalamnya). Regex memakai backreference supaya tidak
// salah menangkap pola yang SUDAH ter-escape (isinya escapeHtml(...)).
const RAW_OPTION_RE = /<option value="\$\{([A-Za-z_$][\w$]*)\}">\$\{\1\}<\/option>/;
// Pola AMAN: terser boleh me-mangle nama variabel (acc -> e), jadi cocokkan
// dengan token variabel apa pun di dalam escapeHtml(...).
const SAFE_OPTION_RE = /<option value="\$\{escapeHtml\([A-Za-z_$][\w$]*\)\}">\$\{escapeHtml\(/;

test("updateFormOptions: pola MENTAH (tanpa escape) tidak ada di sumber app.src.js", () => {
  assert.equal(RAW_OPTION_RE.test(SOURCE), false, "pola option tanpa escapeHtml masih ada di app.src.js");
});

test("updateFormOptions: pola TER-ESCAPE ada di sumber app.src.js", () => {
  assert.equal(SAFE_OPTION_RE.test(SOURCE), true, "pola option + escapeHtml hilang dari app.src.js");
});

test("hasil build app.js ikut ter-escape & bebas pola mentah (build:app dijalankan sebelum commit)", () => {
  assert.equal(SAFE_OPTION_RE.test(BUILD), true, "pola option + escapeHtml tidak ditemukan di app.js -- jalankan npm run build:app");
  assert.equal(RAW_OPTION_RE.test(BUILD), false, "pola option mentah masih tersisa di app.js -- jalankan npm run build:app");
});

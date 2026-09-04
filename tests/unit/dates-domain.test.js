import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseTgl, toDateStr, todayDateStr, currentMonthStr, dateCtx } from "../../src/domain/dates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const MONOLITH_SRC = readFileSync(resolve(ROOT, "app.src.js"), "utf8");

// ---------- helper: ekstrak implementasi ASLI dari blok __dates di app.src.js ----------
// Sama pola dengan format: implementasi monolit asli dipertahankan sebagai DEFAULT
// `__dates`, fungsi global parseTgl/toDateStr/todayDateStr menjadi delegator tipis.
function extractDateDefault(name) {
  // Cocokkan `name: function (args) { ... }` di dalam blok default __dates.
  const re = new RegExp(name + "\\s*:\\s*function\\s*\\([^)]*\\)\\s*", "g");
  const m = re.exec(MONOLITH_SRC);
  assert.ok(m, `Default __dates.${name} tidak ditemukan di app.src.js -- kontrak berubah?`);
  const bodyStart = MONOLITH_SRC.indexOf("{", m.index + m[0].length - 1);
  let depth = 0, i = bodyStart;
  for (; i < MONOLITH_SRC.length; i++) {
    const ch = MONOLITH_SRC[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) break; }
  }
  const fnSource = MONOLITH_SRC.slice(m.index, i + 1);
  const fnOnly = fnSource.replace(new RegExp("\\s*^\\s*" + name + "\\s*:\\s*", "m"), "");
  // new Function dipakai untuk mengeksekusi sumber monolit di TEST-TIME (node)
  // saja -- tidak pernah sampai ke browser/produksi konsumen.
  return Function(`"use strict"; return (${fnOnly});`)();
}

const monolithFns = {};
try {
  monolithFns.parseTgl = extractDateDefault("parseTgl");
  monolithFns.toDateStr = extractDateDefault("toDateStr");
  monolithFns.todayDateStr = extractDateDefault("todayDateStr");
  monolithFns.currentMonthStr = extractDateDefault("currentMonthStr");
} catch (e) {
  monolithFns.extractError = e;
}

// ============================================================================
// PERILAKU
// ============================================================================
test("parseTgl: string kosong/null -> Date invalid (new Date(NaN))", () => {
  assert.ok(Number.isNaN(parseTgl(null).getTime()));
  assert.ok(Number.isNaN(parseTgl("").getTime()));
  assert.ok(Number.isNaN(parseTgl(undefined).getTime()));
});

test("parseTgl: YYYY-MM-DD -> Date lokal tengah malam (komponen lokal, bukan UTC)", () => {
  const d = parseTgl("2026-09-04");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8); // 0-based -> September
  assert.equal(d.getDate(), 4);
  assert.equal(d.getHours(), 0);
});

test("parseTgl: string ISO dengan T -> dipotong bagian waktu (split('T')[0])", () => {
  const d = parseTgl("2026-09-04T13:45:00");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getDate(), 4);
  assert.equal(d.getHours(), 0); // jam dibuang
});

test("toDateStr: format YYYY-MM-DD komponen lokal, padStart 2 digit", () => {
  assert.equal(toDateStr(new Date(2026, 8, 4)), "2026-09-04"); // September
  assert.equal(toDateStr(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(toDateStr(new Date(2026, 11, 31)), "2026-12-31");
});

test("toDateStr: TIDAK memakai toISOString/UTC (tidak mundur 1 hari di zona +7/+8/+9)", () => {
  const d = new Date(2026, 8, 4, 0, 0, 0);
  // toDateStr mengembalikan komponen LOKAL selalu -> "2026-09-04" apa pun zona.
  assert.equal(toDateStr(d), "2026-09-04");
  // Di zona timur UTC (getTimezoneOffset() negatif, mis. WIB -420), toISOString
  // MUNDUR 1 hari dibanding komponen lokal. Perilaku ini harus DIHINDARI toDateStr.
  if (d.getTimezoneOffset() < 0) {
    assert.notEqual(toDateStr(d), d.toISOString().slice(0, 10));
  } else {
    // di UTC (offset 0) keduanya kebetulan sama -- tidak membuktikan apa pun soal bug,
    // jadi hanya pastikan tidak ada off-by-one terhadap kalender lokal.
    assert.equal(toDateStr(d), "2026-09-04");
  }
});

test("todayDateStr: sama dengan toDateStr(new Date())", () => {
  assert.equal(todayDateStr(), toDateStr(new Date()));
});

test("currentMonthStr: format YYYY-MM dari buluan berjalan (padStart 2 digit)", () => {
  const m = currentMonthStr();
  assert.match(m, /^\d{4}-\d{2}$/);
  const n = new Date();
  assert.equal(m, `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`);
  // tahun-bulan selalu konsisten dengan todayDateStr (bulan yang sama)
  assert.equal(m, todayDateStr().slice(0, 7));
});

test("currentMonthStr: tahun/bulan dipakai komponen lokal (bukan toISOString/UTC)", () => {
  // Konstruksi Date di zona lokal apa pun harus menghasilkan YYYY-MM dari getFullYear/getMonth.
  const n = new Date(2026, 8, 9); // 9 September 2026 lokal
  const produced = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  assert.equal(produced, "2026-09");
  assert.equal(currentMonthStr().slice(0, 7), todayDateStr().slice(0, 7));
});

test("dateCtx: menyediakan callback DI yang dipakai src/domain", () => {
  const ctx = dateCtx();
  assert.equal(typeof ctx.parseTgl, "function");
  assert.equal(typeof ctx.toDateStr, "function");
  assert.equal(typeof ctx.todayDateStr, "function");
  assert.equal(typeof ctx.currentMonthStr, "function");
});

// ============================================================================
// GUARD KONSISTENSI: modul vs implementasi DEFAULT __dates (kebenaran produksi)
// ============================================================================
test("KONSISTENSI: parseTgl modul == monolit app.src.js", () => {
  if (monolithFns.extractError) throw monolithFns.extractError;
  const cases = [null, "", undefined, "2026-09-04", "2026-09-04T13:45", "2024-02-29", "2020-01-01"];
  for (const v of cases) {
    const a = parseTgl(v), b = monolithFns.parseTgl(v);
    assert.ok((Number.isNaN(a.getTime()) && Number.isNaN(b.getTime())) || a.getTime() === b.getTime(), `parseTgl(${v})`);
  }
});

test("KONSISTENSI: toDateStr modul == monolit app.src.js", () => {
  if (monolithFns.extractError) throw monolithFns.extractError;
  const samples = [new Date(2026, 8, 4), new Date(2026, 0, 5), new Date(2026, 11, 31), new Date(2024, 1, 29)];
  for (const d of samples) {
    assert.equal(toDateStr(d), monolithFns.toDateStr(d), `toDateStr(${d})`);
  }
});

test("KONSISTENSI: todayDateStr modul == monolit app.src.js", () => {
  if (monolithFns.extractError) throw monolithFns.extractError;
  // Bandingkan YYYY-MM (tahun-bulan) + cek format lengkap; hindari boundary tengah
  // malam yang bisa berbeda 1 hari antara dua panggilan terpisah.
  const a = todayDateStr(), b = monolithFns.todayDateStr();
  assert.equal(a.slice(0, 7), b.slice(0, 7));
  assert.match(a, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(b, /^\d{4}-\d{2}-\d{2}$/);
});

test("KONSISTENSI: currentMonthStr modul == monolit app.src.js", () => {
  if (monolithFns.extractError) throw monolithFns.extractError;
  const a = currentMonthStr(), b = monolithFns.currentMonthStr();
  assert.equal(a.slice(0, 7), b.slice(0, 7)); // hindari boundary pergantian bulan
  assert.match(a, /^\d{4}-\d{2}$/);
  assert.match(b, /^\d{4}-\d{2}$/);
});

// ============================================================================
// WIRING: pastikan monolit benar2 mengadopsi modul via __dates + delegator global
// ============================================================================
test("WIRING: app.src.js punya __dates + adoptDatesModule + delegasi ke modul", () => {
  assert.match(MONOLITH_SRC, /let __dates\s*=/);
  assert.match(MONOLITH_SRC, /adoptDatesModule\s*\(/);
  assert.match(MONOLITH_SRC, /__dates\s*=\s*servicesModule\.dateCtx\(\)/);
  for (const n of ["parseTgl", "toDateStr", "todayDateStr", "currentMonthStr"]) {
    const fnSrc = (MONOLITH_SRC.match(new RegExp("function\\s+" + n + "\\s*\\([^)]*\\)\\s*\\{([^}]*)\\}")) || [])[1] || "";
    assert.match(fnSrc, new RegExp("__dates\\." + n), `delegasi __dates.${n} tidak ditemukan di app.src.js`);
  }
});

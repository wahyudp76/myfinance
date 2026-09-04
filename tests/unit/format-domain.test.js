import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  formatRp,
  formatShortVal,
  txIdrAmount,
  deepCloneDict,
  formatRibuanDigits,
  transferTargetAmount,
  formatCtx,
} from "../../src/domain/format.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const MONOLITH_SRC = readFileSync(resolve(ROOT, "app.src.js"), "utf8");

// ---------- helper: ekstrak implementasi ASLI dari blok __fmt di app.src.js ----------
// Sejak v71/72, implementasi monolit asli dipertahankan sebagai DEFAULT di
// `__fmt` (objek di top-level), dan fungsi global formatRp/etc. menjadi
// delegasi tipis ke __fmt (meng-adopsi modul ter-tes). Guard ini membandingkan
// MODUL terhadap implementasi DEFAULT __fmt yang tersimpan di app.src.js --
// yang adalah kebenaran perilaku produksi yang berjalan selama ini.
// Evaluasi dilakukan di test-time (node) saja, AMAN: tidak ke browser/CSP.
function extractFmtDefault(name) {
  // Cocokkan `name: function (args) { ... }` di dalam blok default __fmt.
  const re = new RegExp(name + "\\s*:\\s*function\\s*\\([^)]*\\)\\s*", "g");
  const m = re.exec(MONOLITH_SRC);
  assert.ok(m, `Default __fmt.${name} tidak ditemukan di app.src.js -- kontrak berubah?`);
  const bodyStart = MONOLITH_SRC.indexOf("{", m.index + m[0].length - 1);
  let depth = 0, i = bodyStart;
  for (; i < MONOLITH_SRC.length; i++) {
    const ch = MONOLITH_SRC[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) break; }
  }
  const fnSource = MONOLITH_SRC.slice(m.index, i + 1);
  // ubah `name: function` -> `function` supaya bisa dipanggil langsung.
  const fnOnly = fnSource.replace(new RegExp("\\s*^\\s*" + name + "\\s*:\\s*", "m"), "");
  // new Function dipakai untuk mengeksekusi sumber monolit di TEST-TIME (node)
  // saja -- tidak pernah sampai ke browser/produksi konsumen.
  return Function(`"use strict"; return (${fnOnly});`)();
}

const monolithFns = {};
try {
  monolithFns.formatRp = extractFmtDefault("formatRp");
  monolithFns.formatShortVal = extractFmtDefault("formatShortVal");
  monolithFns.txIdrAmount = extractFmtDefault("txIdrAmount");
  monolithFns.deepCloneDict = extractFmtDefault("deepCloneDict");
  monolithFns.transferTargetAmount = extractFmtDefault("transferTargetAmount");
} catch (e) {
  monolithFns.extractError = e;
}

const NUM_SAMPLES = [
  0, 1, 12, 999, 999.9, 1000, 1500, 1999, 999_999, 1_000_000, 1_234_567,
  2_500_000, 9_999_999, 10_000_000, 123_456_789, 1_234_567_890, -1, -999,
  -1000, -1500, -2_500_000, -99_999, 3.14159, 42.5, 999_999.9, 1234567.89,
];

test("formatRp: format id-ID, minimumFractionDigits=0", () => {
  assert.equal(formatRp(0), "0");
  assert.equal(formatRp(1234), "1.234");
  assert.equal(formatRp(2_500_000), "2.500.000");
  assert.equal(formatRp(-500), "-500");
  assert.equal(formatRp(999999), "999.999");
});

test("formatRp: angka desimal tampil (kontrak monolit)", () => {
  assert.equal(formatRp(1234.5), "1.234,5");
  assert.equal(formatRp(999.9), "999,9");
});

test("formatShortVal: M untuk >= 1jt, K untuk >= 1rb, lain apa adanya", () => {
  assert.equal(formatShortVal(0), 0);
  assert.equal(formatShortVal(999), 999);
  assert.equal(formatShortVal(1000), "1K");
  assert.equal(formatShortVal(1500), "2K");
  assert.equal(formatShortVal(999999), "1000K"); // < 1jt, tidak di-round ke 1.0M
  assert.equal(formatShortVal(1_000_000), "1.0M");
  assert.equal(formatShortVal(1_234_567), "1.2M");
  assert.equal(formatShortVal(2_500_000), "2.5M");
  assert.equal(formatShortVal(-2_500_000), "-2.5M");
  assert.equal(formatShortVal(-500), -500);
});

test("txIdrAmount: jumlah_idr dipakai dulu, fallback ke jumlah, null-aman", () => {
  assert.equal(txIdrAmount(null), 0);
  assert.equal(txIdrAmount(undefined), 0);
  assert.equal(txIdrAmount({}), 0);
  assert.equal(txIdrAmount({ jumlah_idr: 0 }), 0); // 0 bukan falsy-yang-di-ganti
  assert.equal(txIdrAmount({ jumlah: 25000 }), 25000);
  assert.equal(txIdrAmount({ jumlah_idr: 45000, jumlah: 25000 }), 45000);
  assert.equal(txIdrAmount({ jumlah: "abc" }), 0);
  assert.equal(txIdrAmount({ jumlah: "100000" }), 100000);
});

test("deepCloneDict: klon dalam, null-aman; undefined THROWS (kontrak monolit)", () => {
  assert.deepEqual(deepCloneDict({ a: { b: [1, 2] } }), { a: { b: [1, 2] } });
  assert.deepEqual(deepCloneDict(null), null);
  // JSON.stringify(undefined) === undefined -> JSON.parse(undefined) lempar —
  // PERILAKU INI SAMA dengan monolit (byte-compatible), jadi modul harus ikut melempar.
  assert.throws(() => deepCloneDict(undefined));
  const src = { a: 1 };
  const clone = deepCloneDict(src);
  clone.a = 99;
  assert.equal(src.a, 1); // tidak mengubah asli
});

test("formatRibuanDigits: ambil SEMUA digit + format id-ID", () => {
  assert.deepEqual(formatRibuanDigits(""), { digits: "", formatted: "" });
  assert.deepEqual(formatRibuanDigits(null), { digits: "", formatted: "" });
  assert.deepEqual(formatRibuanDigits("1234567"), { digits: "1234567", formatted: "1.234.567" });
  // Semua non-digit dibuang (termasuk angka di belakang koma) -- persis perilaku
  // handler input monolit yang hanya peduli digit bilangan bulat Rupiah.
  assert.deepEqual(formatRibuanDigits("Rp 1.000"), { digits: "1000", formatted: "1.000" });
  assert.deepEqual(formatRibuanDigits("abc"), { digits: "", formatted: "" });
});

test("transferTargetAmount: nominal sisi tujuan, fallback ke jumlah bila null", () => {
  assert.equal(transferTargetAmount({ transfer_jumlah_tujuan: 50000, jumlah: 25000 }), 50000);
  assert.equal(transferTargetAmount({ transfer_jumlah_tujuan: null, jumlah: 25000 }), 25000);
  assert.equal(transferTargetAmount({ jumlah: 25000 }), 25000); // tidak ada kolom tujuan
  assert.equal(transferTargetAmount({ transfer_jumlah_tujuan: 0, jumlah: 25000 }), 0); // 0 bukan null
  assert.equal(transferTargetAmount({}), undefined); // keduanya undefined -> jumlah (undefined)
});

test("formatCtx: menyediakan semua callback DI yang dipakai src/domain", () => {
  const ctx = formatCtx();
  assert.equal(typeof ctx.formatRp, "function");
  assert.equal(typeof ctx.formatShortVal, "function");
  assert.equal(typeof ctx.txIdrAmount, "function");
  assert.equal(typeof ctx.deepCloneDict, "function");
  assert.equal(typeof ctx.formatRibuanDigits, "function");
  assert.equal(typeof ctx.transferTargetAmount, "function");
});

// ============================================================================
// GUARD KONSISTENSI: modul vs implementasi DEFAULT __fmt (kebenaran perilaku
// produksi selama ini, tersimpan di app.src.js). Jika gagal => modul ini TIDAK
// byte-compatible dengan perilaku lama, JANGAN dipakai.
// ============================================================================
test("KONSISTENSI: formatRp modul == formatRp monolit app.src.js", () => {
  if (monolithFns.extractError) throw monolithFns.extractError;
  for (const n of NUM_SAMPLES) {
    assert.equal(formatRp(n), monolithFns.formatRp(n), `formatRp(${n})`);
  }
});

test("KONSISTENSI: formatShortVal modul == monolit app.src.js", () => {
  if (monolithFns.extractError) throw monolithFns.extractError;
  for (const n of NUM_SAMPLES) {
    assert.equal(formatShortVal(n), monolithFns.formatShortVal(n), `formatShortVal(${n})`);
  }
});

test("KONSISTENSI: txIdrAmount modul == monolit app.src.js", () => {
  if (monolithFns.extractError) throw monolithFns.extractError;
  const cases = [
    null,
    undefined,
    {},
    { jumlah: 125000 },
    { jumlah_idr: 250000 },
    { jumlah: 5000, jumlah_idr: 45000 },
    { jumlah: "abc" },
    { jumlah: "125000" },
    { jumlah_idr: 0, jumlah: 999 },
  ];
  for (const t of cases) {
    assert.equal(txIdrAmount(t), monolithFns.txIdrAmount(t), `txIdrAmount(${JSON.stringify(t)})`);
  }
});

test("KONSISTENSI: deepCloneDict modul == monolit app.src.js", () => {
  if (monolithFns.extractError) throw monolithFns.extractError;
  const cases = [{ a: { b: [1, 2, { c: 3 }] } }, { x: [] }, null, 7];
  for (const v of cases) {
    assert.deepEqual(deepCloneDict(v), monolithFns.deepCloneDict(v));
  }
});

test("KONSISTENSI: transferTargetAmount modul == monolit app.src.js", () => {
  if (monolithFns.extractError) throw monolithFns.extractError;
  const cases = [
    { transfer_jumlah_tujuan: 50000, jumlah: 25000 },
    { transfer_jumlah_tujuan: null, jumlah: 25000 },
    { jumlah: 25000 },
    { transfer_jumlah_tujuan: 0, jumlah: 25000 },
    {},
  ];
  // null/undefined tidak diikutkan di guard (keduanya melempar TypeError DI KEDUA
  // implementasi -- perilaku identik, tapi tidak bisa di-assert secara langsung).
  for (const v of cases) {
    assert.equal(transferTargetAmount(v), monolithFns.transferTargetAmount(v), `transferTargetAmount(${JSON.stringify(v)})`);
  }
});

// ============================================================================
// WIRING (v71/72): pastikan monolit benar2 mengadopsi modul via __fmt, bukan
// masih menghitung sendiri. Ini memastikan migrasi benar2 terpasang, bukan cuma
// ada filenya.
// ============================================================================
test("WIRING: app.src.js punya __fmt + adoptFormatModule + delegasi ke modul", () => {
  // __fmt harus didefinisikan & di-adopt dari servicesModule.formatCtx()
  assert.match(MONOLITH_SRC, /let __fmt\s*=/);
  assert.match(MONOLITH_SRC, /adoptFormatModule\s*\(/);
  assert.match(MONOLITH_SRC, /typeof servicesModule\.formatCtx\s*===\s*["']function["']/);
  assert.match(MONOLITH_SRC, /__fmt\s*=\s*servicesModule\.formatCtx\(\)/);
  // fungsi global yang DELEGASI (memanggil __fmt.<name>), bukan menghitung sendiri.
  for (const n of ["formatRp", "formatShortVal", "txIdrAmount", "deepCloneDict", "transferTargetAmount"]) {
    const fnSrc = (MONOLITH_SRC.match(new RegExp("function\\s+" + n + "\\s*\\([^)]*\\)\\s*\\{([^}]*)\\}")) || [])[1] || "";
    assert.match(fnSrc, new RegExp("__fmt\\." + n), `delegasi __fmt.${n} tidak ditemukan di app.src.js`);
  }
});

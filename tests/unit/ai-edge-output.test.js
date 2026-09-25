// tests/unit/ai-edge-output.test.js
//
// Uji untuk logika murni Edge Function AI (supabase/functions/_shared/ai-output.js).
//
// KENAPA ADA (audit AI 2026-09-17, temuan T7): sebelum v134 seluruh logika ini
// tertulis inline di dalam handler `analyze-finance/index.ts` (Deno), sehingga
// TIDAK ADA satu pun uji yang menjalankannya -- rate limit, sanitasi balasan, dan
// pembentukan prompt baru ketahuan rusak setelah function di-deploy ke produksi.
// Setelah dipindah ke modul .js biasa (pola _shared/bibit.js), Deno tetap bisa
// mengimpornya dan Node bisa mengujinya langsung di sini.
//
// Yang dijaga test ini:
//  - T1: pertanyaan bebas tidak boleh masuk prompt tanpa batas panjang.
//  - T2: setiap mode punya generationConfig (pagu token keluaran + temperature,
//        dan responseMimeType JSON untuk mode yang balasannya wajib JSON).
//  - T3: batas waktu panggilan Gemini terdefinisi (teks & vision).
//  - Kontrak sanitasi UI: {title<=80, message<=500, detail<=4000, severity
//        whitelist, maks 5 kartu} + fallback bila balasan bukan JSON.
//  - Guard kategori: AI tidak boleh mengarang nama kategori di luar daftar user.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_QUESTION_LENGTH, GEMINI_TIMEOUT_MS, GEMINI_VISION_TIMEOUT_MS,
  clampText, generationConfigFor, sanitizeInsights, sanitizeCategory,
} from "../../supabase/functions/_shared/ai-output.js";

// ---------------------------------------------------------------- T1: clampText
test("clampText: memotong ke batas, membuang spasi tepi, dan menolak non-string", () => {
  assert.equal(clampText("  halo dunia  ", 100), "halo dunia");
  assert.equal(clampText("abcdefghij", 4), "abcd");
  assert.equal(clampText("", 10), "");
  assert.equal(clampText(null, 10), "");
  assert.equal(clampText(undefined, 10), "");
  assert.equal(clampText(12345, 10), "");
  assert.equal(clampText({ a: 1 }, 10), "");
});

test("T1: pertanyaan 10.000 karakter dipotong jadi MAX_QUESTION_LENGTH", () => {
  const panjang = "a".repeat(10000);
  assert.equal(MAX_QUESTION_LENGTH, 2000);
  assert.equal(clampText(panjang, MAX_QUESTION_LENGTH).length, MAX_QUESTION_LENGTH);
});

// ------------------------------------------------- T2/T3: generationConfig & timeout
test("T2: setiap mode punya pagu token keluaran dan temperature", () => {
  for (const mode of ["insights", "suggest_category", "monthly_summary", "question", "scan_receipt", "mode-tak-dikenal"]) {
    const cfg = generationConfigFor(mode);
    assert.ok(Number.isFinite(cfg.maxOutputTokens) && cfg.maxOutputTokens > 0, `${mode}: maxOutputTokens`);
    assert.ok(Number.isFinite(cfg.temperature), `${mode}: temperature`);
  }
});

test("T2: mode berbalasan JSON memakai responseMimeType application/json", () => {
  for (const mode of ["insights", "suggest_category", "scan_receipt"]) {
    assert.equal(generationConfigFor(mode).responseMimeType, "application/json", mode);
  }
  for (const mode of ["question", "monthly_summary"]) {
    assert.equal(generationConfigFor(mode).responseMimeType, undefined, mode);
  }
});

test("T2: mode deterministik (saran kategori & struk) memakai temperature 0", () => {
  assert.equal(generationConfigFor("suggest_category").temperature, 0);
  assert.equal(generationConfigFor("scan_receipt").temperature, 0);
});

test("T3: batas waktu terdefinisi, dan mode vision lebih longgar dari teks", () => {
  assert.ok(GEMINI_TIMEOUT_MS > 0 && GEMINI_TIMEOUT_MS <= 60000);
  assert.ok(GEMINI_VISION_TIMEOUT_MS > GEMINI_TIMEOUT_MS);
});

// ------------------------------------------------------------ sanitasi insights
test("sanitizeInsights: JSON array dipertahankan sesuai kontrak UI", () => {
  const hasil = sanitizeInsights(JSON.stringify([
    { title: "Anggaran Bensin", message: "Terpakai 90% dari Rp 300.000", detail: "Rinciannya panjang", severity: "warning" },
    { title: "Tabungan", message: "Tingkat menabung 22%", severity: "success" },
  ]));
  assert.equal(hasil.length, 2);
  assert.deepEqual(hasil[0], {
    title: "Anggaran Bensin",
    message: "Terpakai 90% dari Rp 300.000",
    detail: "Rinciannya panjang",
    severity: "warning",
  });
  // detail tidak ada -> string kosong (client lama mengabaikannya)
  assert.equal(hasil[1].detail, "");
  assert.equal(hasil[1].severity, "success");
});

test("sanitizeInsights: memotong title 80, message 500, detail 4000 karakter", () => {
  const hasil = sanitizeInsights(JSON.stringify([{
    title: "t".repeat(300), message: "m".repeat(1200), detail: "d".repeat(9000), severity: "info",
  }]));
  assert.equal(hasil[0].title.length, 80);
  assert.equal(hasil[0].message.length, 500);
  assert.equal(hasil[0].detail.length, 4000);
});

test("sanitizeInsights: severity tak dikenal dipaksa jadi info", () => {
  const hasil = sanitizeInsights(JSON.stringify([
    { title: "a", message: "b", severity: "danger" },
    { title: "c", message: "d", severity: "INFO" },
  ]));
  assert.equal(hasil[0].severity, "info");
  assert.equal(hasil[1].severity, "info", "case-sensitive: 'INFO' bukan anggota whitelist");
});

test("sanitizeInsights: maksimal 5 kartu walau AI membalas lebih", () => {
  const banyak = Array.from({ length: 12 }, (_, i) => ({ title: `t${i}`, message: `m${i}` }));
  assert.equal(sanitizeInsights(JSON.stringify(banyak)).length, 5);
});

test("sanitizeInsights: item tanpa title/message teks dibuang", () => {
  const hasil = sanitizeInsights(JSON.stringify([
    { title: "ok", message: "isi" },
    { title: "", message: "tanpa judul" },
    { title: "tanpa pesan", message: "   " },
    { title: 42, message: "judul bukan string" },
    null,
    "bukan objek",
  ]));
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].title, "ok");
});

test("sanitizeInsights: membersihkan pagar ```json dan menerima objek tunggal", () => {
  const denganPagar = "```json\n[{\"title\":\"a\",\"message\":\"b\"}]\n```";
  assert.equal(sanitizeInsights(denganPagar).length, 1);
  const objekTunggal = "{\"title\":\"a\",\"message\":\"b\"}";
  assert.equal(sanitizeInsights(objekTunggal).length, 1, "objek tunggal dibungkus jadi array");
});

test("sanitizeInsights: balasan bukan JSON tetap tampil sebagai satu kartu", () => {
  const hasil = sanitizeInsights("Maaf, saya tidak bisa memproses permintaan itu.");
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].title, "Analisis Gemini");
  assert.equal(hasil[0].severity, "info");
  assert.match(hasil[0].message, /tidak bisa memproses/);
});

test("sanitizeInsights: input kosong tidak melempar", () => {
  assert.equal(sanitizeInsights("").length, 0, "string kosong -> '[]' -> 0 kartu");
  assert.equal(sanitizeInsights(undefined).length, 0);
  assert.equal(sanitizeInsights(null).length, 0);
});

// ------------------------------------------------------------- saran kategori
test("sanitizeCategory: menerima hanya kategori yang ada di daftar user", () => {
  const daftar = ["Makanan", "Transportasi", "Internet"];
  assert.equal(sanitizeCategory('{"kategori":"Makanan"}', daftar), "Makanan");
});

test("sanitizeCategory: menolak kategori karangan AI (di luar daftar)", () => {
  const daftar = ["Makanan", "Transportasi"];
  assert.equal(sanitizeCategory('{"kategori":"Hiburan"}', daftar), null);
  assert.equal(sanitizeCategory('{"kategori":"makanan"}', daftar), null, "case-sensitive");
});

test("sanitizeCategory: null untuk balasan rusak / kategori null / daftar kosong", () => {
  assert.equal(sanitizeCategory("bukan json", ["Makanan"]), null);
  assert.equal(sanitizeCategory('{"kategori":null}', ["Makanan"]), null);
  assert.equal(sanitizeCategory('{"kategori":"Makanan"}', []), null);
  assert.equal(sanitizeCategory("", ["Makanan"]), null);
  assert.equal(sanitizeCategory('{"kategori":"Makanan"}', null), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateActualByCategory,
  classifyBudgetUsage,
  summarizeBudgets,
  detectBudgetThresholdCrossing,
  shiftMonthStr,
} from "../../src/domain/budgets.js";

const parseTgl = (tanggalStr) => new Date(String(tanggalStr).split("T")[0] + "T00:00:00");
const txIdrAmount = (t) => Number(t.jumlah_idr != null ? t.jumlah_idr : t.jumlah);

// ===================== aggregateActualByCategory =====================

test("aggregateActualByCategory: cuma menjumlah Pengeluaran di bulan/tahun yang diminta", () => {
  const result = aggregateActualByCategory([
    { jenis: "Pengeluaran", tanggal: "2026-08-05", kategori: "Makan", jumlah: 50_000 },
    { jenis: "Pengeluaran", tanggal: "2026-08-10", kategori: "Makan", jumlah: 25_000 },
    { jenis: "Pengeluaran", tanggal: "2026-07-31", kategori: "Makan", jumlah: 999_999 }, // bulan lain
    { jenis: "Pemasukan", tanggal: "2026-08-01", kategori: "Gaji", jumlah: 5_000_000 }, // bukan pengeluaran
  ], { year: 2026, month: 8, txIdrAmount, parseTgl });

  assert.equal(result["Makan"], 75_000);
  assert.equal(result["Gaji"], undefined);
});

test("aggregateActualByCategory: dikelompokkan per nama kategori MENTAH, bukan parent", () => {
  const result = aggregateActualByCategory([
    { jenis: "Pengeluaran", tanggal: "2026-08-01", kategori: "Kopi", jumlah: 20_000 }, // sub-kategori
    { jenis: "Pengeluaran", tanggal: "2026-08-02", kategori: "Makan", jumlah: 30_000 }, // parent langsung
  ], { year: 2026, month: 8, txIdrAmount, parseTgl });

  assert.equal(result["Kopi"], 20_000);
  assert.equal(result["Makan"], 30_000);
});

test("aggregateActualByCategory: year/month boleh string (loose `!=`), tetap match", () => {
  const result = aggregateActualByCategory([
    { jenis: "Pengeluaran", tanggal: "2026-08-05", kategori: "Makan", jumlah: 10_000 },
  ], { year: "2026", month: "8", txIdrAmount, parseTgl });

  assert.equal(result["Makan"], 10_000);
});

test("aggregateActualByCategory: transaksi tanpa tanggal diabaikan, tidak error", () => {
  const result = aggregateActualByCategory([
    { jenis: "Pengeluaran", tanggal: null, kategori: "Makan", jumlah: 10_000 },
  ], { year: 2026, month: 8, txIdrAmount, parseTgl });

  assert.deepEqual(result, {});
});

// ===================== classifyBudgetUsage =====================

test("classifyBudgetUsage: >=100 -> over", () => {
  assert.equal(classifyBudgetUsage(100), "over");
  assert.equal(classifyBudgetUsage(150), "over");
});

test("classifyBudgetUsage: >=70 dan <100 -> warning", () => {
  assert.equal(classifyBudgetUsage(70), "warning");
  assert.equal(classifyBudgetUsage(99), "warning");
});

test("classifyBudgetUsage: <70 -> safe", () => {
  assert.equal(classifyBudgetUsage(0), "safe");
  assert.equal(classifyBudgetUsage(69), "safe");
});

// ===================== summarizeBudgets =====================

const stubStyle = () => ({ icon: "fa-tag", bg: "bg-slate-100", color: "text-slate-500", image: null });

test("summarizeBudgets: kategori tanpa sub -> budget/actual langsung dari cloudBudgets/actualCategoryMap", () => {
  const categoryDict = { "Makan": { subs: [] } };
  const result = summarizeBudgets(categoryDict, { "Makan": 1_000_000 }, { "Makan": 400_000 }, { getCategoryStyle: stubStyle });

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].name, "Makan");
  assert.equal(result.entries[0].budget, 1_000_000);
  assert.equal(result.entries[0].actual, 400_000);
  assert.equal(result.entries[0].pct, 40);
  assert.equal(result.totalBudget, 1_000_000);
  assert.equal(result.totalActual, 400_000);
  assert.equal(result.remaining, 600_000);
  assert.equal(result.overallPct, 40);
});

test("summarizeBudgets: kategori dengan sub -> budget/actual parent = akumulasi semua sub", () => {
  const categoryDict = { "Transport": { subs: [{ name: "Bensin" }, { name: "Ojek Online" }] } };
  const cloudBudgets = { "Bensin": 300_000, "Ojek Online": 200_000 };
  const actualCategoryMap = { "Bensin": 150_000, "Ojek Online": 250_000 };
  const result = summarizeBudgets(categoryDict, cloudBudgets, actualCategoryMap, { getCategoryStyle: stubStyle });

  const entry = result.entries[0];
  assert.equal(entry.budget, 500_000); // 300rb + 200rb
  assert.equal(entry.actual, 400_000); // 150rb + 250rb
  assert.equal(entry.subEntries.length, 2);
  const ojol = entry.subEntries.find((s) => s.name === "Ojek Online");
  assert.equal(ojol.pct, 125); // 250rb/200rb -- boleh lewat 100 di level sub
});

test("summarizeBudgets: transaksi tercatat LANGSUNG di parent yang punya sub -> masuk subEntries 'Tanpa sub-kategori'", () => {
  const categoryDict = { "Transport": { subs: [{ name: "Bensin" }] } };
  const cloudBudgets = { "Bensin": 100_000 };
  const actualCategoryMap = { "Bensin": 50_000, "Transport": 75_000 }; // dicatat langsung ke parent
  const result = summarizeBudgets(categoryDict, cloudBudgets, actualCategoryMap, { getCategoryStyle: stubStyle });

  const entry = result.entries[0];
  assert.equal(entry.actual, 125_000); // 50rb (sub) + 75rb (langsung parent)
  const direct = entry.subEntries.find((s) => s.isDirect);
  assert.equal(direct.name, "Tanpa sub-kategori");
  assert.equal(direct.actual, 75_000);
});

test("summarizeBudgets: kategori tanpa budget DAN tanpa realisasi tidak ikut masuk entries", () => {
  const categoryDict = { "Hiburan": { subs: [] }, "Makan": { subs: [] } };
  const result = summarizeBudgets(categoryDict, { "Makan": 500_000 }, { "Makan": 100_000 }, { getCategoryStyle: stubStyle });

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].name, "Makan");
});

test("summarizeBudgets: pct 100 kalau ada realisasi tapi budget-nya 0 (bukan Infinity/NaN)", () => {
  const categoryDict = { "Lain-lain": { subs: [] } };
  const result = summarizeBudgets(categoryDict, {}, { "Lain-lain": 50_000 }, { getCategoryStyle: stubStyle });

  assert.equal(result.entries[0].pct, 100);
});

test("summarizeBudgets: entries diurutkan pct DESC", () => {
  const categoryDict = { "A": { subs: [] }, "B": { subs: [] } };
  const cloudBudgets = { "A": 100_000, "B": 100_000 };
  const actualCategoryMap = { "A": 20_000, "B": 90_000 };
  const result = summarizeBudgets(categoryDict, cloudBudgets, actualCategoryMap, { getCategoryStyle: stubStyle });

  assert.deepEqual(result.entries.map((e) => e.name), ["B", "A"]);
});

test("summarizeBudgets: overallPct 0 kalau totalBudget 0 (tidak dibagi nol)", () => {
  const result = summarizeBudgets({}, {}, {}, { getCategoryStyle: stubStyle });
  assert.equal(result.overallPct, 0);
  assert.equal(result.entries.length, 0);
});

// ===================== detectBudgetThresholdCrossing =====================

test("detectBudgetThresholdCrossing: nyebrang dari <100% ke >=100% -> exceeded", () => {
  assert.equal(detectBudgetThresholdCrossing(0.9, 1.0), "exceeded");
  assert.equal(detectBudgetThresholdCrossing(0.99, 1.2), "exceeded");
});

test("detectBudgetThresholdCrossing: nyebrang dari <80% ke >=80% (tapi belum 100%) -> warning", () => {
  assert.equal(detectBudgetThresholdCrossing(0.7, 0.8), "warning");
  assert.equal(detectBudgetThresholdCrossing(0.75, 0.95), "warning");
});

test("detectBudgetThresholdCrossing: sudah di atas ambang SEBELUM transaksi ini -> null (bukan crossing baru)", () => {
  assert.equal(detectBudgetThresholdCrossing(1.1, 1.3), null); // sudah exceeded sebelumnya
  assert.equal(detectBudgetThresholdCrossing(0.85, 0.9), null); // sudah warning sebelumnya
});

test("detectBudgetThresholdCrossing: pct turun (mis. transaksi dihapus) tidak memicu notifikasi", () => {
  assert.equal(detectBudgetThresholdCrossing(1.2, 0.5), null);
});

test("detectBudgetThresholdCrossing: null kalau salah satu sisi tidak ada budget (before/after null)", () => {
  assert.equal(detectBudgetThresholdCrossing(null, 1.5), null);
  assert.equal(detectBudgetThresholdCrossing(0.5, null), null);
  assert.equal(detectBudgetThresholdCrossing(undefined, undefined), null);
});

test("detectBudgetThresholdCrossing: ambang notifikasi (100/80) SENGAJA beda dari classifyBudgetUsage (100/70)", () => {
  // 75% -> classifyBudgetUsage bilang 'warning' (badge amber), TAPI belum menyebrang
  // ambang notifikasi 80%, jadi tidak ada toast yang dipicu di sini.
  assert.equal(classifyBudgetUsage(75), "warning");
  assert.equal(detectBudgetThresholdCrossing(0.7, 0.75), null);
});

test("shiftMonthStr: geser bulan lintas tahun + input rusak", () => {
  assert.equal(shiftMonthStr("2026-09", -1), "2026-08");
  assert.equal(shiftMonthStr("2026-01", -1), "2025-12");
  assert.equal(shiftMonthStr("2025-12", 1), "2026-01");
  assert.equal(shiftMonthStr("2026-03", -13), "2025-02");
  assert.equal(shiftMonthStr("bukan-bulan", -1), null);
  assert.equal(shiftMonthStr(null, -1), null);
});

// ---------------------------------------------------------------------------
// v139 (bug fix): anggaran boleh dipasang pada SUB-kategori. Sebelumnya
// getCategoryBudgetStatus() di app.src.js hanya mencari budgets[parentName],
// jadi anggaran level sub tidak pernah terlihat -> status null sebelum &
// sesudah transaksi -> detectBudgetThresholdCrossing(null, null) = null ->
// notifikasi ambang TIDAK PERNAH muncul (direproduksi probe browser).
// ---------------------------------------------------------------------------
import { resolveBudgetStatusForCategory } from "../../src/domain/budgets.js";

test("v139: anggaran pada SUB-kategori dipakai, dengan realisasi per nama kategori mentah", () => {
  const st = resolveBudgetStatusForCategory({
    kategori: "Restoran",
    parentName: "Makanan & Minuman",
    budgetsByCategory: { Restoran: 1000000 },
    spentByParent: { "Makanan & Minuman": 750000 },
    actualByCategory: { Restoran: 750000, Camilan: 20000 },
  });
  assert.deepEqual(st, { key: "Restoran", budget: 1000000, spent: 750000, pct: 0.75 });
});

test("v139: anggaran pada KATEGORI UTAMA tetap memakai agregasi per parent (perilaku lama)", () => {
  const st = resolveBudgetStatusForCategory({
    kategori: "Restoran",
    parentName: "Makanan & Minuman",
    budgetsByCategory: { "Makanan & Minuman": 1000000 },
    spentByParent: { "Makanan & Minuman": 850000 },
    actualByCategory: null,
  });
  assert.deepEqual(st, { key: "Makanan & Minuman", budget: 1000000, spent: 850000, pct: 0.85 });
});

test("v139: anggaran sub LEBIH SPECIFIC -> menang bila keduanya ada", () => {
  const st = resolveBudgetStatusForCategory({
    kategori: "Restoran",
    parentName: "Makanan & Minuman",
    budgetsByCategory: { Restoran: 500000, "Makanan & Minuman": 2000000 },
    spentByParent: { "Makanan & Minuman": 850000 },
    actualByCategory: { Restoran: 400000 },
  });
  assert.equal(st.key, "Restoran");
  assert.equal(st.budget, 500000);
  assert.equal(st.spent, 400000);
  assert.equal(st.pct, 0.8);
});

test("v139: tanpa anggaran sama sekali -> null (tidak ada notifikasi)", () => {
  assert.equal(resolveBudgetStatusForCategory({
    kategori: "Restoran", parentName: "Makanan & Minuman",
    budgetsByCategory: {}, spentByParent: { "Makanan & Minuman": 850000 }, actualByCategory: null,
  }), null);
  assert.equal(resolveBudgetStatusForCategory({
    kategori: "Restoran", parentName: "Makanan & Minuman",
    budgetsByCategory: { Restoran: 0, "Makanan & Minuman": 0 }, spentByParent: {}, actualByCategory: {},
  }), null);
});

test("v139: kategori yang memang kategori utama (kategori === parentName) tetap jalan", () => {
  const st = resolveBudgetStatusForCategory({
    kategori: "Makanan & Minuman", parentName: "Makanan & Minuman",
    budgetsByCategory: { "Makanan & Minuman": 1000000 },
    spentByParent: { "Makanan & Minuman": 300000 },
    actualByCategory: null,
  });
  assert.deepEqual(st, { key: "Makanan & Minuman", budget: 1000000, spent: 300000, pct: 0.3 });
});

test("v139: bentuk masukan rusak tidak melempar (defensif)", () => {
  const st = resolveBudgetStatusForCategory({
    kategori: "Restoran", parentName: "Makanan & Minuman",
    budgetsByCategory: { Restoran: 1000000 },
    spentByParent: null, actualByCategory: null,
  });
  assert.deepEqual(st, { key: "Restoran", budget: 1000000, spent: 0, pct: 0 });
});

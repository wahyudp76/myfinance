import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFinancialHealthScore, computeFinancialInsights } from "../../src/domain/insights.js";

const formatRp = (n) => new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0 }).format(n);
const formatShortVal = (n) => {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return String(n);
};

// ===================== computeFinancialHealthScore =====================

test("computeFinancialHealthScore: tanpa monthIn, tanpa budget, tanpa monthlyMap -- cuma komponen Aktivitas Pencatatan yang dihitung", () => {
  const { finalScore, components } = computeFinancialHealthScore(
    { monthIn: 0, monthOut: 0, monthCatOutMap: {}, monthlyMap: {}, monthTxCount: 15 },
    { currentMonthBudgets: {} },
  );
  assert.equal(components.length, 1);
  assert.equal(components[0].label, "Aktivitas Pencatatan");
  assert.equal(finalScore, 100); // 15 transaksi = skor penuh komponen ini, dan itu satu2nya komponen
});

test("computeFinancialHealthScore: savings rate 20% dari pemasukan = skor penuh komponen Tingkat Menabung (tidak lebih dari 40)", () => {
  const { components } = computeFinancialHealthScore(
    { monthIn: 1_000_000, monthOut: 800_000, monthCatOutMap: {}, monthlyMap: {}, monthTxCount: 0 }, // saving rate = 20%
    { currentMonthBudgets: {} },
  );
  const savings = components.find((c) => c.label === "Tingkat Menabung");
  assert.equal(savings.score, 40);
  assert.equal(savings.max, 40);
});

test("computeFinancialHealthScore: savings rate negatif (boncos) skor 0, bukan negatif", () => {
  const { components } = computeFinancialHealthScore(
    { monthIn: 100_000, monthOut: 500_000, monthCatOutMap: {}, monthlyMap: {}, monthTxCount: 0 },
    { currentMonthBudgets: {} },
  );
  const savings = components.find((c) => c.label === "Tingkat Menabung");
  assert.equal(savings.score, 0);
});

test("computeFinancialHealthScore: kepatuhan anggaran cuma menghitung kategori yang budget-nya > 0", () => {
  const { components } = computeFinancialHealthScore(
    { monthIn: 0, monthOut: 0, monthCatOutMap: { Makanan: 100_000, Hiburan: 500_000 }, monthlyMap: {}, monthTxCount: 0 },
    { currentMonthBudgets: { Makanan: 200_000, Hiburan: 100_000, Transportasi: 0 } }, // Transportasi diabaikan (budget 0)
  );
  const kepatuhan = components.find((c) => c.label === "Kepatuhan Anggaran");
  assert.equal(kepatuhan.max, 25);
  assert.equal(kepatuhan.score, 12.5); // 1 dari 2 kategori (Makanan) masih dalam budget
});

test("computeFinancialHealthScore: konsistensi bulanan cuma pakai 6 bulan terakhir", () => {
  const monthlyMap = {};
  for (let i = 1; i <= 8; i++) monthlyMap[`bulan-${i}`] = { in: 100, out: i <= 2 ? 200 : 50 }; // 2 bulan pertama defisit
  const { components } = computeFinancialHealthScore(
    { monthIn: 0, monthOut: 0, monthCatOutMap: {}, monthlyMap, monthTxCount: 0 },
    { currentMonthBudgets: {} },
  );
  const konsistensi = components.find((c) => c.label === "Konsistensi Bulanan");
  // slice(-6) ambil bulan-3..bulan-8, semuanya net positif -> 6/6 = skor penuh 20
  assert.equal(konsistensi.score, 20);
});

test("computeFinancialHealthScore: finalScore 0 kalau tidak ada satupun komponen yang berlaku", () => {
  const { finalScore, components } = computeFinancialHealthScore(
    { monthIn: 0, monthOut: 0, monthCatOutMap: {}, monthlyMap: {}, monthTxCount: 0 },
    { currentMonthBudgets: {} },
  );
  // Aktivitas Pencatatan selalu ada (monthTxCount=0 -> score=0), jadi totalMax=15, totalScore=0
  assert.equal(components.length, 1);
  assert.equal(finalScore, 0);
});

// ===================== computeFinancialInsights =====================

function baseCtx(overrides = {}) {
  return {
    now: new Date(2026, 7, 20), // 20 Agustus 2026, dari 31 hari
    monthIn: 0,
    monthOut: 0,
    prevMonthIn: 0,
    prevMonthOut: 0,
    monthCatOutMap: {},
    catOut3MoMap: {},
    monthTxCount: 0,
    ...overrides,
  };
}

test("computeFinancialInsights: kategori yang pemakaian budget-nya jauh lebih cepat dari progres bulan berjalan memicu peringatan anggaran", () => {
  // 20 Agustus dari 31 hari = ~64.5% bulan berjalan. Kopi sudah 90% (>= 64.5+15=79.5%) -> trigger.
  const insights = computeFinancialInsights(
    baseCtx({ monthCatOutMap: { Kopi: 90_000 } }),
    { currentMonthBudgets: { Kopi: 100_000 }, formatRp, formatShortVal },
  );
  const budgetInsight = insights.find((i) => i.title.includes("Anggaran"));
  assert.ok(budgetInsight, "harus ada insight anggaran");
  assert.equal(budgetInsight.title, "Anggaran Mulai Menipis");
});

test("computeFinancialInsights: budget yang sudah terlampaui (>=100%) judulnya 'Anggaran Terlampaui'", () => {
  const insights = computeFinancialInsights(
    baseCtx({ monthCatOutMap: { Kopi: 150_000 } }),
    { currentMonthBudgets: { Kopi: 100_000 }, formatRp, formatShortVal },
  );
  const budgetInsight = insights.find((i) => i.title.includes("Anggaran"));
  assert.equal(budgetInsight.title, "Anggaran Terlampaui");
});

test("computeFinancialInsights: kategori naik >=30% & >20rb vs rata-rata 3 bulan terakhir memicu insight lonjakan", () => {
  const insights = computeFinancialInsights(
    baseCtx({ monthCatOutMap: { Hiburan: 200_000 }, catOut3MoMap: { Hiburan: 300_000 } }), // avg3mo = 100rb, naik 100%
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  const spike = insights.find((i) => i.title === "Pengeluaran Kategori Naik");
  assert.ok(spike, "harus ada insight lonjakan kategori");
  assert.match(spike.message, /Hiburan/);
});

test("computeFinancialInsights: kenaikan kategori kecil (di bawah threshold) TIDAK memicu insight", () => {
  const insights = computeFinancialInsights(
    baseCtx({ monthCatOutMap: { Hiburan: 105_000 }, catOut3MoMap: { Hiburan: 300_000 } }), // avg3mo=100rb, naik cuma 5%
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  assert.equal(insights.find((i) => i.title === "Pengeluaran Kategori Naik"), undefined);
});

test("computeFinancialInsights: penurunan tingkat menabung >=5 poin vs bulan lalu memicu insight", () => {
  const insights = computeFinancialInsights(
    baseCtx({ monthIn: 1_000_000, monthOut: 900_000, prevMonthIn: 1_000_000, prevMonthOut: 500_000 }), // rate 10% vs 50% lalu
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  const savings = insights.find((i) => i.title === "Tingkat Menabung");
  assert.ok(savings, "harus ada insight tingkat menabung");
  assert.match(savings.message, /turun/);
});

test("computeFinancialInsights: proyeksi akhir bulan cuma muncul kalau minimal hari ke-3 dan masih ada sisa hari", () => {
  const insights = computeFinancialInsights(
    baseCtx({ now: new Date(2026, 7, 10), monthOut: 500_000 }), // hari ke-10 dari 31 hari, pengeluaran tinggi di awal bulan
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  const proyeksi = insights.find((i) => i.title === "Proyeksi Akhir Bulan");
  assert.ok(proyeksi, "harus ada insight proyeksi");
});

test("computeFinancialInsights: hasil dibatasi maksimal 4 insight", () => {
  const insights = computeFinancialInsights(
    baseCtx({
      monthCatOutMap: { Kopi: 150_000, Hiburan: 200_000 },
      catOut3MoMap: { Hiburan: 300_000 },
      monthIn: 1_000_000, monthOut: 900_000, prevMonthIn: 1_000_000, prevMonthOut: 500_000,
    }),
    { currentMonthBudgets: { Kopi: 100_000 }, formatRp, formatShortVal },
  );
  assert.ok(insights.length <= 4);
});

test("computeFinancialInsights: data kosong/normal tidak menghasilkan insight apapun", () => {
  const insights = computeFinancialInsights(baseCtx(), { currentMonthBudgets: {}, formatRp, formatShortVal });
  assert.deepEqual(insights, []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFinancialHealthScore, computeFinancialInsights, buildInsightsContext } from "../../src/domain/insights.js";

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

test("computeFinancialInsights: hasil dibatasi maksimal 10 wawasan (v64 -- diperluas dari 4)", () => {
  const insights = computeFinancialInsights(
    baseCtx({
      monthCatOutMap: { Kopi: 150_000, Hiburan: 200_000 },
      catOut3MoMap: { Hiburan: 300_000 },
      monthIn: 1_000_000, monthOut: 900_000, prevMonthIn: 1_000_000, prevMonthOut: 500_000,
      monthTxCount: 12,
    }),
    { currentMonthBudgets: { Kopi: 100_000 }, formatRp, formatShortVal },
  );
  assert.ok(insights.length <= 10);
  // Context kaya tadi menghasilkan review + anggaran + lonjakan + tabungan +
  // proyeksi -> lebih banyak dari kapasitas lama 4 (intisari perbaikan v64).
  assert.ok(insights.length > 4, "data kaya harus memunculkan lebih dari 4 kartu");
});

test("computeFinancialInsights: data kosong/normal tidak menghasilkan insight apapun", () => {
  const insights = computeFinancialInsights(baseCtx(), { currentMonthBudgets: {}, formatRp, formatShortVal });
  assert.deepEqual(insights, []);
});


// ===================== v64: aturan tambahan & buildInsightsContext =====================

test("computeFinancialInsights: review bulan ini selalu muncul saat ada data (surplus)", () => {
  const insights = computeFinancialInsights(
    baseCtx({ monthIn: 1_200_000, monthOut: 800_000, monthTxCount: 14 }),
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  const rev = insights.find((i) => i.title === "Review Bulan Ini");
  assert.ok(rev, "harus ada kartu review");
  assert.match(rev.message, /surplus Rp 400\.000/);
  assert.match(rev.message, /14 transaksi/);
  assert.equal(insights[0].title, "Review Bulan Ini"); // paling atas sebagai ringkasan
});

test("computeFinancialInsights: review menyebut defisit saat pengeluaran > pemasukan", () => {
  const insights = computeFinancialInsights(
    baseCtx({ monthIn: 300_000, monthOut: 500_000, monthTxCount: 6 }),
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  const rev = insights.find((i) => i.title === "Review Bulan Ini");
  assert.match(rev.message, /defisit Rp 200\.000/);
});

test("computeFinancialInsights: defisit bulan ini memicu peringatan 'Pengeluaran Melebihi Pemasukan'", () => {
  const insights = computeFinancialInsights(
    baseCtx({ monthIn: 500_000, monthOut: 900_000, monthTxCount: 12, monthCatOutMap: { Makanan: 400_000, Transportasi: 200_000 } }),
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  const d = insights.find((i) => i.title === "Pengeluaran Melebihi Pemasukan");
  assert.ok(d, "harus ada kartu defisit");
  assert.match(d.message, /defisit Rp 400\.000/);
  assert.match(d.message, /Makanan/);
  assert.equal(insights.indexOf(d), 1); // tepat setelah Review
});

test("computeFinancialInsights: ada pengeluaran tapi nol pemasukan -> 'Belum Ada Pemasukan Bulan Ini'", () => {
  const insights = computeFinancialInsights(
    baseCtx({ monthIn: 0, monthOut: 200_000, monthTxCount: 3 }),
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  assert.ok(insights.some((i) => i.title === "Belum Ada Pemasukan Bulan Ini"));
});

test("computeFinancialInsights: konsentrasi kategori >= 45% total memicu 'Fokus Pengeluaran Terbesar'", () => {
  const insights = computeFinancialInsights(
    baseCtx({ monthOut: 700_000, monthTxCount: 10, monthCatOutMap: { "Makanan & Minuman": 500_000, Transportasi: 200_000 } }),
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  const f = insights.find((i) => i.title === "Fokus Pengeluaran Terbesar");
  assert.ok(f, "harus ada kartu fokus terbesar");
  assert.match(f.message, /Makanan & Minuman/);
  assert.match(f.message, /71%/); // 500rb/700rb
});

test("computeFinancialInsights: konsentrasi di bawah 45% TIDAK memicu (anti-spam)", () => {
  const insights = computeFinancialInsights(
    baseCtx({ monthOut: 700_000, monthTxCount: 10, monthCatOutMap: { "Makanan & Minuman": 300_000, Transportasi: 200_000, Hiburan: 200_000 } }),
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  assert.equal(insights.find((i) => i.title === "Fokus Pengeluaran Terbesar"), undefined);
});

test("computeFinancialInsights: transaksi tunggal >= 30% pengeluaran -> 'Transaksi Terbesar'", () => {
  const insights = computeFinancialInsights(
    baseCtx({
      monthOut: 1_000_000, monthTxCount: 5, monthCatOutMap: { Elektronik: 900_000, Makanan: 100_000 },
      biggestExpense: { kategori: "Elektronik", akun: "BCA", tanggal: "2026-08-10", jumlah: 900_000 },
    }),
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  const t = insights.find((i) => i.title === "Transaksi Terbesar");
  assert.ok(t);
  assert.match(t.message, /Elektronik/);
  assert.match(t.message, /90%/);
  assert.match(t.message, /10\/08/);
});

test("computeFinancialInsights: transaksi terbesar kecil (<30%) TIDAK memicu", () => {
  const insights = computeFinancialInsights(
    baseCtx({
      monthOut: 1_000_000, monthTxCount: 5, monthCatOutMap: { Makanan: 100_000 },
      biggestExpense: { kategori: "Makanan", akun: "BCA", tanggal: "2026-08-10", jumlah: 100_000 },
    }),
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  assert.equal(insights.find((i) => i.title === "Transaksi Terbesar"), undefined);
});

test("computeFinancialInsights: pos berulang naik >=50% & >=50rb -> 'Pos Berulang Naik'", () => {
  const insights = computeFinancialInsights(
    baseCtx({
      monthOut: 400_000, monthTxCount: 4, monthCatOutMap: { "Tagihan & Biaya": 400_000 },
      prevMonthCatOutMap: { "Tagihan & Biaya": 100_000 },
    }),
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  const r = insights.find((i) => i.title === "Pos Berulang Naik");
  assert.ok(r);
  assert.match(r.message, /Tagihan & Biaya/);
  assert.match(r.message, /300%/);
});

test("computeFinancialInsights: banyak transaksi kecil -> 'Banyak Transaksi Kecil'", () => {
  const insights = computeFinancialInsights(
    baseCtx({ monthOut: 600_000, monthTxCount: 20, monthCatOutMap: { Makanan: 300_000 },
      smallTx: { count: 9, total: 180_000 } }),
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  const s2 = insights.find((i) => i.title === "Banyak Transaksi Kecil");
  assert.ok(s2);
  assert.match(s2.message, /9 transaksi kecil/);
});

test("computeFinancialInsights: belanja akhir pekan >=40% total -> 'Belanja Padat di Akhir Pekan'", () => {
  const insights = computeFinancialInsights(
    baseCtx({ monthOut: 600_000, monthTxCount: 20, monthCatOutMap: { Makanan: 600_000 },
      weekendTx: { count: 8, out: 300_000 } }),
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  const w = insights.find((i) => i.title === "Belanja Padat di Akhir Pekan");
  assert.ok(w);
  assert.match(w.message, /50%/);
});

test("computeFinancialInsights: pengeluaran turun >=20% vs bulan lalu -> 'Pengeluaran Turun'", () => {
  const insights = computeFinancialInsights(
    baseCtx({ monthIn: 900_000, monthOut: 700_000, prevMonthOut: 1_000_000, monthTxCount: 20, monthCatOutMap: { Makanan: 700_000 } }),
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  const d = insights.find((i) => i.title === "Pengeluaran Turun");
  assert.ok(d);
  assert.match(d.message, /30%/);
});

test("computeFinancialInsights: tabungan >=30% pemasukan -> 'Menabung Konsisten'", () => {
  const insights = computeFinancialInsights(
    baseCtx({ monthIn: 1_000_000, monthOut: 500_000, monthTxCount: 10, monthCatOutMap: { Makanan: 500_000 } }),
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  const m = insights.find((i) => i.title === "Menabung Konsisten");
  assert.ok(m);
  assert.match(m.message, /50%/);
});

test("computeFinancialInsights: kolom tambahan absen (context lama) -> aturan baru no-op tanpa crash", () => {
  const insights = computeFinancialInsights(
    baseCtx({ monthIn: 2_000_000, monthOut: 1_500_000, monthTxCount: 30, monthCatOutMap: { Makanan: 1_000_000 } }),
    { currentMonthBudgets: {}, formatRp, formatShortVal },
  );
  assert.ok(insights.length >= 1); // review tetap ada
  assert.equal(insights.find((i) => i.title === "Transaksi Terbesar"), undefined);
  assert.equal(insights.find((i) => i.title === "Pos Berulang Naik"), undefined);
});

// ===================== buildInsightsContext =====================

test("buildInsightsContext: menggali transaksi terbesar, transaksi kecil, akhir pekan & kategori bulan lalu", () => {
  const now = new Date(2026, 7, 15); // 15 Agustus 2026 (Sabtu)
  const parseTgl = (s) => new Date(`${s}T12:00:00`);
  const parent = (k) => ({ Restoran: "Makanan & Minuman", "Kafe & Kopi": "Makanan & Minuman", Camilan: "Makanan & Minuman", Transportasi: "Transportasi", Elektronik: "Belanja" }[k]);
  const tx = (id, kategori, tanggal, jumlah) => ({ id, jenis: "Pengeluaran", kategori, tanggal, jumlah: String(jumlah) });
  const rows = [
    tx("a", "Restoran", "2026-08-03", 150000), // Senin
    tx("b", "Elektronik", "2026-08-03", 2500000), // Senin -> terbesar
    tx("c", "Kafe & Kopi", "2026-08-01", 20000), // Sabtu + kecil
    tx("d", "Restoran", "2026-08-08", 60000), // Sabtu
    tx("e", "Transportasi", "2026-08-09", 40000), // Minggu
    tx("f", "Camilan", "2026-08-10", 18000), // Senin + kecil
    tx("p1", "Restoran", "2026-07-05", 100000),
    tx("p2", "Elektronik", "2026-07-06", 500000),
    tx("o1", "Restoran", "2026-09-01", 999999), // di luar 2 bulan -> diabaikan
    { id: "in", jenis: "Pemasukan", kategori: "Gaji", tanggal: "2026-08-05", jumlah: "5000000" }, // bukan pengeluaran -> diabaikan
  ];
  const ctx = buildInsightsContext(
    { now, monthIn: 0, monthOut: 0, monthTxCount: 0 },
    { transactions: rows, now, parseTgl, txIdrAmount: (t) => Number(t.jumlah), categorizeExpenseParent: parent },
  );
  assert.deepEqual(ctx.biggestExpense, { kategori: "Elektronik", akun: "", tanggal: "2026-08-03", jumlah: 2500000 });
  assert.deepEqual(ctx.smallTx, { count: 2, total: 38000 }); // 20rb + 18rb
  assert.deepEqual(ctx.weekendTx, { count: 3, out: 120000 }); // 20rb + 60rb + 40rb
  assert.deepEqual(ctx.prevMonthCatOutMap, { "Makanan & Minuman": 100000, Belanja: 500000 });
  // field lama ikut dipertahankan
  assert.equal(ctx.monthIn, 0);
});

test("buildInsightsContext: tanpa transaksi -> semua kolom tambahan kosong aman", () => {
  const ctx = buildInsightsContext(
    { now: new Date(2026, 7, 15), monthIn: 0, monthOut: 0, monthTxCount: 0 },
    { transactions: [], now: new Date(2026, 7, 15), parseTgl: (s) => new Date(s), txIdrAmount: (t) => Number(t.jumlah), categorizeExpenseParent: () => null },
  );
  assert.equal(ctx.biggestExpense, null);
  assert.deepEqual(ctx.smallTx, { count: 0, total: 0 });
  assert.deepEqual(ctx.weekendTx, { count: 0, out: 0 });
  assert.deepEqual(ctx.prevMonthCatOutMap, {});
});

// ===================== v66: parameter skor kesehatan tambahan & presisi =====================

function healthCtx(overrides = {}) {
  return {
    monthIn: 2_000_000, monthOut: 1_000_000,
    monthCatOutMap: { "Makanan & Minuman": 400_000, Transportasi: 300_000, Hiburan: 200_000, "Lain-lain": 100_000 },
    monthlyMap: { "Agu 2026": { in: 2_000_000, out: 1_000_000 }, "Jul 2026": { in: 2_000_000, out: 900_000 } },
    monthTxCount: 20,
    smallTx: { count: 4, total: 80_000 },      // 8% dari 1jt -> sebagian kredit
    weekendTx: { count: 6, out: 300_000 },      // 30% -> penuh
    ...overrides,
  };
}

test("computeFinancialHealthScore: komponen baru muncul saat context kaya (v64) tersedia", () => {
  const { components } = computeFinancialHealthScore(healthCtx(), { currentMonthBudgets: { Transportasi: 350_000 } });
  const labels = components.map((c) => c.label);
  for (const want of ["Tingkat Menabung", "Kepatuhan Anggaran", "Konsistensi Bulanan", "Aktivitas Pencatatan",
    "Kendali Transaksi Kecil", "Keseimbangan Pengeluaran", "Pola Belanja Akhir Pekan"]) {
    assert.ok(labels.includes(want), `komponen ${want} harus ada`);
  }
});

test("computeFinancialHealthScore: Kendali Transaksi Kecil -- <=5% total penuh, >=30% nol, linear", () => {
  const base = { monthIn: 1_000_000, monthOut: 1_000_000, monthCatOutMap: { A: 1_000_000 }, monthlyMap: {}, monthTxCount: 10 };
  const get = (total) => computeFinancialHealthScore(
    { ...base, smallTx: { count: 9, total } },
    { currentMonthBudgets: {} },
  ).components.find((c) => c.label === "Kendali Transaksi Kecil");
  assert.equal(get(50_000).score, 10);      // 5% -> penuh
  assert.equal(get(300_000).score, 0);      // 30% -> nol
  assert.equal(get(175_000).score, 5);      // 17.5% -> 5 (tengah)
  assert.equal(get(0).score, 10);           // tanpa kebocoran -> penuh
});

test("computeFinancialHealthScore: Kendali Transaksi Kecil di-skip bila ctx.smallTx absen", () => {
  const { components } = computeFinancialHealthScore(
    { monthIn: 1_000_000, monthOut: 1_000_000, monthCatOutMap: { A: 1_000_000 }, monthlyMap: {}, monthTxCount: 10 },
    { currentMonthBudgets: {} },
  );
  assert.equal(components.find((c) => c.label === "Kendali Transaksi Kecil"), undefined);
});

test("computeFinancialHealthScore: Keseimbangan Pengeluaran -- share <=40% penuh, >=80% nol", () => {
  const base = { monthIn: 1_000_000, monthOut: 1_000_000, monthlyMap: {}, monthTxCount: 10, smallTx: { count: 0, total: 0 } };
  // Bangun peta kategori supaya kategori TERBESAR persis share yang dimau.
  const get = (share) => {
    const s = Math.round(share * 1_000_000);
    const map = share <= 0.4
      ? { A: s, B: Math.round((1_000_000 - s) * 0.5), C: 1_000_000 - s - Math.round((1_000_000 - s) * 0.5) }
      : { A: s, B: 1_000_000 - s };
    return computeFinancialHealthScore({ ...base, monthCatOutMap: map }, { currentMonthBudgets: {} })
      .components.find((c) => c.label === "Keseimbangan Pengeluaran");
  };
  assert.ok(Math.abs(get(0.3).score - 10) < 1e-9);
  assert.ok(Math.abs(get(0.6).score - 5) < 1e-9);
  assert.ok(Math.abs(get(0.85).score - 0) < 1e-9);
});

test("computeFinancialHealthScore: Pola Belanja Akhir Pekan -- porsi <=35% penuh; >=75% nol; dihitung bila >=5 transaksi", () => {
  const base = { monthIn: 1_000_000, monthOut: 1_000_000, monthCatOutMap: { A: 1_000_000 }, monthlyMap: {}, monthTxCount: 10, smallTx: { count: 0, total: 0 } };
  const get = (out, count = 8) => computeFinancialHealthScore(
    { ...base, weekendTx: { count, out } },
    { currentMonthBudgets: {} },
  ).components.find((c) => c.label === "Pola Belanja Akhir Pekan");
  assert.equal(get(300_000).score, 5); // 30% -> penuh
  assert.equal(get(500_000).score, 3.125); // 50% -> (0.75-0.5)/0.4*5
  assert.equal(get(800_000).score, 0); // 80% -> nol
  // kurang dari 5 transaksi akhir pekan -> tidak dihukum, komponen di-skip
  const { components } = computeFinancialHealthScore({ ...base, weekendTx: { count: 2, out: 900_000 } }, { currentMonthBudgets: {} });
  assert.equal(components.find((c) => c.label === "Pola Belanja Akhir Pekan"), undefined);
});

test("computeFinancialHealthScore: Aktivitas Pencatatan presisi -- target mengikuti hari berjalan (1 tx/2 hari)", () => {
  const base = { monthIn: 1_000_000, monthOut: 500_000, monthCatOutMap: { A: 500_000 }, monthlyMap: {}, smallTx: { count: 0, total: 0 } };
  const get = (now, count) => computeFinancialHealthScore(
    { ...base, now, monthTxCount: count },
    { currentMonthBudgets: {} },
  ).components.find((c) => c.label === "Aktivitas Pencatatan");
  // Hari ke-10 -> target 5 transaksi: 5 tx = penuh, 2 tx = 40%
  assert.equal(get(new Date(2026, 7, 10), 5).score, 15);
  assert.equal(get(new Date(2026, 7, 10), 2).score, 6);
  // Hari ke-31 -> target 15 (cap): 10 tx = 10
  assert.equal(get(new Date(2026, 7, 31), 10).score, 10);
  // Tanpa ctx.now -> fallback 15/bulan (perilaku lama)
  assert.equal(get(undefined, 15).score, 15);
});

test("computeFinancialHealthScore: Kepatuhan Anggaran kredit PARSIAL -- over tipis tidak langsung 0", () => {
  const get = (spent, budget) => computeFinancialHealthScore(
    { monthIn: 0, monthOut: 0, monthCatOutMap: { Hiburan: spent }, monthlyMap: {}, monthTxCount: 0 },
    { currentMonthBudgets: { Hiburan: budget } },
  ).components.find((c) => c.label === "Kepatuhan Anggaran");
  assert.equal(get(80_000, 100_000).score, 25);       // dalam budget -> penuh
  assert.equal(get(150_000, 100_000).score, 12.5);    // over 50% -> kredit 0.5
  assert.equal(get(500_000, 100_000).score, 0);       // over 400% -> 0
});

test("computeFinancialHealthScore: skor akhir menormalisasi ke 100 dari total bobot komponen yang berlaku", () => {
  // Semua 7 komponen berlaku & sempurna -> 100
  const perfect = computeFinancialHealthScore(
    { ...healthCtx(), smallTx: { count: 1, total: 10_000 }, weekendTx: { count: 6, out: 100_000 }, now: new Date(2026, 7, 30) },
    { currentMonthBudgets: { Transportasi: 500_000, "Makanan & Minuman": 600_000, Hiburan: 300_000 } },
  );
  assert.equal(perfect.finalScore, 100);
  assert.equal(perfect.components.length, 7);

  // Semua 7 berlaku tapi buruk semua -> 0
  const terrible = computeFinancialHealthScore(
    {
      monthIn: 100_000, monthOut: 900_000, monthCatOutMap: { A: 850_000, B: 50_000 },
      monthlyMap: { "Agu 2026": { in: 100_000, out: 900_000 } }, monthTxCount: 0, now: new Date(2026, 7, 30),
      smallTx: { count: 10, total: 800_000 }, weekendTx: { count: 8, out: 800_000 },
    },
    { currentMonthBudgets: { A: 10_000 } },
  );
  assert.equal(terrible.finalScore, 0);
});

test("computeFinancialHealthScore: skor komponen tetap <= max-nya masing-masing (tidak pernah negatif/overflow)", () => {
  const { components } = computeFinancialHealthScore(
    { ...healthCtx(), now: new Date(2026, 7, 30), smallTx: { count: 50, total: 5_000_000 }, weekendTx: { count: 20, out: 5_000_000 },
      monthCatOutMap: { A: 2_000_000 }, monthIn: 1_000_000, monthOut: 3_000_000 },
    { currentMonthBudgets: { A: 10_000 } },
  );
  for (const c of components) {
    assert.ok(c.score >= 0 && c.score <= c.max, `${c.label}: ${c.score} dalam [0, ${c.max}]`);
  }
});

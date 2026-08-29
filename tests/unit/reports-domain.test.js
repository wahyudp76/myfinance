import { test } from "node:test";
import assert from "node:assert/strict";
import { computeYearlySummary, computeMonthlyBreakdown, computeCategoryTrend } from "../../src/domain/reports.js";

const parseTgl = (tanggalStr) => new Date(String(tanggalStr).split("T")[0] + "T00:00:00");
const txIdrAmount = (t) => Number(t.jumlah_idr != null ? t.jumlah_idr : t.jumlah);

// ===================== computeYearlySummary =====================

test("computeYearlySummary: totalIn/totalOut/monthlyNet cuma menghitung tahun yang diminta", () => {
  const result = computeYearlySummary([
    { jenis: "Pemasukan", tanggal: "2026-01-05", jumlah: 1_000_000 },
    { jenis: "Pengeluaran", tanggal: "2026-02-10", jumlah: 300_000 },
    { jenis: "Pemasukan", tanggal: "2025-01-05", jumlah: 999_999 }, // tahun lain, tidak dihitung ke totalIn
  ], { year: 2026, txIdrAmount, parseTgl });

  assert.equal(result.totalIn, 1_000_000);
  assert.equal(result.totalOut, 300_000);
  assert.equal(result.monthlyNet[0], 1_000_000); // Januari
  assert.equal(result.monthlyNet[1], -300_000); // Februari
  assert.equal(result.hasDataThisYear, true);
});

test("computeYearlySummary: totalInLast/totalOutLast menghitung tahun SEBELUMNYA (year - 1)", () => {
  const result = computeYearlySummary([
    { jenis: "Pemasukan", tanggal: "2025-06-01", jumlah: 500_000 },
    { jenis: "Pengeluaran", tanggal: "2025-06-02", jumlah: 100_000 },
    { jenis: "Pemasukan", tanggal: "2024-06-01", jumlah: 999_999 }, // 2 tahun lalu, tidak dihitung
  ], { year: 2026, txIdrAmount, parseTgl });

  assert.equal(result.totalInLast, 500_000);
  assert.equal(result.totalOutLast, 100_000);
  assert.equal(result.hasDataThisYear, false); // tidak ada data thn 2026 di test ini
});

test("computeYearlySummary: totalNet/totalNetLast = masuk - keluar", () => {
  const result = computeYearlySummary([
    { jenis: "Pemasukan", tanggal: "2026-01-05", jumlah: 1_000_000 },
    { jenis: "Pengeluaran", tanggal: "2026-01-06", jumlah: 400_000 },
  ], { year: 2026, txIdrAmount, parseTgl });
  assert.equal(result.totalNet, 600_000);
});

test("computeYearlySummary: `year` dibandingkan STRICT (===) -- string tahun tidak match ke number", () => {
  const result = computeYearlySummary([
    { jenis: "Pemasukan", tanggal: "2026-01-05", jumlah: 1_000_000 },
  ], { year: "2026", txIdrAmount, parseTgl }); // year sengaja string, TIDAK sesuai kontrak
  // getFullYear() (number) === "2026" (string) -> false, jadi tidak masuk hitungan sama sekali
  assert.equal(result.totalIn, 0);
  assert.equal(result.hasDataThisYear, false);
});

test("computeYearlySummary: data kosong tidak error, semua 0", () => {
  const result = computeYearlySummary([], { year: 2026, txIdrAmount, parseTgl });
  assert.equal(result.totalIn, 0);
  assert.deepEqual(result.monthlyNet, Array(12).fill(0));
  assert.equal(result.hasDataThisYear, false);
});

// ===================== computeMonthlyBreakdown =====================

function catDeps(overrides = {}) {
  return {
    txIdrAmount,
    parseTgl,
    categorizeParent: (kategori) => (kategori === "Kopi" || kategori === "Makan Siang" ? "Makanan" : kategori),
    ...overrides,
  };
}

test("computeMonthlyBreakdown: catOutMap/catInMap terkelompok per kategori parent, hanya bulan yang diminta", () => {
  const result = computeMonthlyBreakdown([
    { jenis: "Pengeluaran", kategori: "Kopi", tanggal: "2026-08-05", jumlah: 20_000 },
    { jenis: "Pengeluaran", kategori: "Makan Siang", tanggal: "2026-08-06", jumlah: 35_000 },
    { jenis: "Pemasukan", kategori: "Gaji", tanggal: "2026-08-01", jumlah: 1_000_000 },
    { jenis: "Pengeluaran", kategori: "Kopi", tanggal: "2026-07-05", jumlah: 999_999 }, // bulan lain
  ], { year: 2026, month: 8, ...catDeps() });

  assert.equal(result.catOutMap.Makanan, 55_000);
  assert.equal(result.catInMap.Gaji, 1_000_000);
});

test("computeMonthlyBreakdown: `year`/`month` boleh string numerik (loose equality, sesuai kode asli)", () => {
  const result = computeMonthlyBreakdown([
    { jenis: "Pengeluaran", kategori: "Kopi", tanggal: "2026-08-05", jumlah: 20_000 },
  ], { year: "2026", month: "08", ...catDeps() }); // string, seperti hasil filterVal.split('-')
  assert.equal(result.catOutMap.Makanan, 20_000);
});

test("computeMonthlyBreakdown: dailyMap terisi 0 utk SEMUA hari di bulan itu, bukan cuma hari yang ada transaksi", () => {
  const result = computeMonthlyBreakdown([
    { jenis: "Pengeluaran", kategori: "Kopi", tanggal: "2026-08-05", jumlah: 20_000 },
  ], { year: 2026, month: 8, ...catDeps() });
  assert.equal(Object.keys(result.dailyMap).length, 31); // Agustus = 31 hari
  assert.equal(result.dailyMap[5].out, 20_000);
  assert.equal(result.dailyMap[1].out, 0);
});

test("computeMonthlyBreakdown: outEntries/inEntries terurut nilai turun (terbesar dulu)", () => {
  const result = computeMonthlyBreakdown([
    { jenis: "Pengeluaran", kategori: "Transportasi", tanggal: "2026-08-01", jumlah: 15_000 },
    { jenis: "Pengeluaran", kategori: "Kopi", tanggal: "2026-08-02", jumlah: 50_000 },
  ], { year: 2026, month: 8, ...catDeps() });
  assert.deepEqual(result.outEntries.map((e) => e.label), ["Makanan", "Transportasi"]);
});

test("computeMonthlyBreakdown: kategori tanpa parent (categorizeParent return undefined) fallback ke nama kategori aslinya", () => {
  const result = computeMonthlyBreakdown([
    { jenis: "Pengeluaran", kategori: "Kategori Aneh", tanggal: "2026-08-01", jumlah: 10_000 },
  ], { year: 2026, month: 8, ...catDeps() }); // categorizeParent return "Kategori Aneh" sendiri (tidak match Kopi/Makan Siang)
  assert.equal(result.catOutMap["Kategori Aneh"], 10_000);
});

// ===================== computeCategoryTrend =====================

test("computeCategoryTrend: cuma menghitung transaksi Pengeluaran dalam N bulan terakhir", () => {
  const now = new Date(2026, 7, 15); // Agustus 2026
  const result = computeCategoryTrend([
    { jenis: "Pengeluaran", kategori: "Kopi", tanggal: "2026-08-01", jumlah: 20_000 },
    { jenis: "Pemasukan", kategori: "Gaji", tanggal: "2026-08-01", jumlah: 999_999 }, // bukan Pengeluaran, diabaikan
    { jenis: "Pengeluaran", kategori: "Kopi", tanggal: "2025-01-01", jumlah: 999_999 }, // di luar rentang
  ], 6, { now, txIdrAmount, categorizeExpenseParent: (k) => k });

  assert.equal(result.labels.length, 6);
  const kopiSeries = result.series.find((s) => s.label === "Kopi");
  assert.ok(kopiSeries);
  assert.equal(kopiSeries.data[5], 20_000); // bulan terakhir (Agustus) = index 5
  assert.equal(kopiSeries.data[0], 0); // 6 bulan lalu (Maret) = 0
});

test("computeCategoryTrend: dibatasi maksimal top-5 kategori berdasar total pengeluaran tertinggi", () => {
  const now = new Date(2026, 7, 15);
  const transactions = [];
  const kategoris = ["A", "B", "C", "D", "E", "F"];
  kategoris.forEach((k, i) => {
    transactions.push({ jenis: "Pengeluaran", kategori: k, tanggal: "2026-08-01", jumlah: (i + 1) * 10_000 });
  });
  const result = computeCategoryTrend(transactions, 6, { now, txIdrAmount, categorizeExpenseParent: (k) => k });
  assert.equal(result.series.length, 5);
  assert.ok(!result.series.some((s) => s.label === "A")); // kategori dgn total terkecil (10rb) tersisih
});

test("computeCategoryTrend: default monthsCount 6 kalau tidak diisi/falsy", () => {
  const now = new Date(2026, 7, 15);
  const result = computeCategoryTrend([], undefined, { now, txIdrAmount, categorizeExpenseParent: (k) => k });
  assert.equal(result.labels.length, 6);
});

test("computeCategoryTrend: data kosong menghasilkan series kosong, tidak error", () => {
  const now = new Date(2026, 7, 15);
  const result = computeCategoryTrend([], 6, { now, txIdrAmount, categorizeExpenseParent: (k) => k });
  assert.deepEqual(result.series, []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAccountTotals,
  buildAccountBalanceSeries,
  computeAccountChartSeries,
  resolveAccountCategoryDateRange,
  aggregateAccountExpenseByCategory,
  computeAccountGroupNet,
} from "../../src/domain/accounts.js";

function makeDeps(overrides = {}) {
  return {
    transferTargetAmount: (row) => Number(row.transfer_jumlah_tujuan != null ? row.transfer_jumlah_tujuan : row.jumlah),
    parseTgl: (tanggalStr) => new Date(String(tanggalStr).split("T")[0] + "T00:00:00"),
    ...overrides,
  };
}

test("computeAccountTotals: Pemasukan menambah totalIn, Pengeluaran menambah totalOut, balance = totalIn - totalOut", () => {
  const result = computeAccountTotals([
    { jenis: "Pemasukan", akun: "Dompet", kategori: "Gaji", tanggal: "2026-08-01", jumlah: 500_000 },
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Kopi", tanggal: "2026-08-02", jumlah: 20_000 },
  ], "Dompet", makeDeps());

  assert.equal(result.totalIn, 500_000);
  assert.equal(result.totalOut, 20_000);
  assert.equal(result.balance, 480_000);
  assert.equal(result.relatedTx.length, 2);
});

test("computeAccountTotals: transfer keluar dari akun ini masuk transferOut, transfer masuk ke akun ini masuk transferIn (native amount)", () => {
  const result = computeAccountTotals([
    { jenis: "Transfer", akun: "Dompet", kategori: "Bank", tanggal: "2026-08-03", jumlah: 100_000 },
  ], "Dompet", makeDeps());

  assert.equal(result.transferOut, 100_000);
  assert.equal(result.transferIn, 0);
  assert.equal(result.balance, -100_000);

  const resultBank = computeAccountTotals([
    { jenis: "Transfer", akun: "Dompet", kategori: "Bank", tanggal: "2026-08-03", jumlah: 100_000 },
  ], "Bank", makeDeps());
  assert.equal(resultBank.transferIn, 100_000);
  assert.equal(resultBank.transferOut, 0);
  assert.equal(resultBank.balance, 100_000);
});

test("computeAccountTotals: transfer lintas mata uang -- akun tujuan pakai transferTargetAmount, bukan jumlah sisi sumber", () => {
  const result = computeAccountTotals([
    { jenis: "Transfer", akun: "Dompet", kategori: "Bank USD", tanggal: "2026-08-03", jumlah: 1_600_000, transfer_jumlah_tujuan: 100 },
  ], "Bank USD", makeDeps());

  assert.equal(result.transferIn, 100); // bukan 1_600_000
  assert.equal(result.balance, 100);
});

test("computeAccountTotals: transaksi akun lain yang tidak terkait tidak ikut terhitung", () => {
  const result = computeAccountTotals([
    { jenis: "Pemasukan", akun: "Dompet", kategori: "Gaji", tanggal: "2026-08-01", jumlah: 500_000 },
    { jenis: "Pengeluaran", akun: "Bank", kategori: "Kopi", tanggal: "2026-08-02", jumlah: 999_999 },
  ], "Dompet", makeDeps());

  assert.equal(result.relatedTx.length, 1);
  assert.equal(result.totalOut, 0);
});

test("computeAccountTotals: data kosong tidak error, semua 0", () => {
  const result = computeAccountTotals([], "Dompet", makeDeps());
  assert.deepEqual(result, { relatedTx: [], totalIn: 0, totalOut: 0, transferIn: 0, transferOut: 0, balance: 0 });
});

test("buildAccountBalanceSeries: saldo berjalan terurut dari transaksi terlama ke terbaru", () => {
  const series = buildAccountBalanceSeries([
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Kopi", tanggal: "2026-08-03", jumlah: 10_000 },
    { jenis: "Pemasukan", akun: "Dompet", kategori: "Gaji", tanggal: "2026-08-01", jumlah: 100_000 },
  ], "Dompet", makeDeps());

  assert.equal(series.length, 2);
  assert.equal(series[0].balance, 100_000); // Gaji (01 Agustus) diproses duluan
  assert.equal(series[0].in, 100_000);
  assert.equal(series[1].balance, 90_000); // Kopi (03 Agustus) sesudahnya
  assert.equal(series[1].out, 10_000);
});

test("buildAccountBalanceSeries: transfer lintas mata uang di sisi akun tujuan pakai transferTargetAmount utk running balance", () => {
  const series = buildAccountBalanceSeries([
    { jenis: "Transfer", akun: "Dompet", kategori: "Bank USD", tanggal: "2026-08-01", jumlah: 1_600_000, transfer_jumlah_tujuan: 100 },
  ], "Bank USD", makeDeps());

  assert.equal(series[0].in, 100);
  assert.equal(series[0].balance, 100);
});

test("buildAccountBalanceSeries: transaksi tanpa tanggal diabaikan (sama seperti computeAccountTotals)", () => {
  const series = buildAccountBalanceSeries([
    { jenis: "Pemasukan", akun: "Dompet", kategori: "Gaji", tanggal: null, jumlah: 100_000 },
  ], "Dompet", makeDeps());
  assert.equal(series.length, 0);
});

// ===================== computeAccountChartSeries =====================

function makeSeriesPoint(dateStr, balance, inAmt = 0, outAmt = 0) {
  return { raw: {}, date: new Date(dateStr + "T00:00:00"), balance, in: inAmt, out: outAmt };
}

test("computeAccountChartSeries: rentang pendek (<=62 hari) -> granularity 'day'", () => {
  const now = new Date("2026-08-15T12:00:00");
  const fullSeries = [makeSeriesPoint("2026-08-10", 100_000, 100_000, 0)];
  const result = computeAccountChartSeries(fullSeries, "10", { now });
  assert.equal(result.granularity, "day");
});

test("computeAccountChartSeries: rentang sedang (63-400 hari) -> granularity 'week'", () => {
  const now = new Date("2026-08-15T12:00:00");
  const fullSeries = [makeSeriesPoint("2026-01-01", 100_000, 100_000, 0)];
  const result = computeAccountChartSeries(fullSeries, "227", { now }); // ~227 hari -> di antara 62 & 400
  assert.equal(result.granularity, "week");
});

test("computeAccountChartSeries: rentang panjang (>400 hari) -> granularity 'month'", () => {
  const now = new Date("2027-08-15T12:00:00");
  const fullSeries = [makeSeriesPoint("2026-01-01", 100_000, 100_000, 0)];
  const result = computeAccountChartSeries(fullSeries, "all", { now });
  assert.equal(result.granularity, "month");
});

test("computeAccountChartSeries: periodVal 'all' -> tidak ada cutoff, balanceLabels TIDAK diawali 'Awal'", () => {
  const now = new Date("2026-08-05T00:00:00");
  const fullSeries = [makeSeriesPoint("2026-08-01", 50_000, 50_000, 0)];
  const result = computeAccountChartSeries(fullSeries, "all", { now });
  assert.notEqual(result.balanceLabels[0], "Awal");
  assert.deepEqual(result.balanceLabels, result.bucketLabels); // tanpa cutoff, keduanya identik
});

test("computeAccountChartSeries: dengan cutoff (periodVal angka) -> balanceLabels/balanceChartData diawali 'Awal', TAPI bucketLabels/cashInData/cashOutData TIDAK", () => {
  const now = new Date("2026-08-05T00:00:00");
  const fullSeries = [
    makeSeriesPoint("2026-07-01", 200_000, 200_000, 0), // sebelum cutoff -> jadi startBalance
    makeSeriesPoint("2026-08-02", 250_000, 50_000, 0),
  ];
  const result = computeAccountChartSeries(fullSeries, "10", { now }); // cutoff = 2026-07-26
  assert.equal(result.balanceLabels[0], "Awal");
  assert.equal(result.balanceChartData[0], 200_000); // startBalance dari titik terakhir sebelum cutoff
  assert.notEqual(result.bucketLabels[0], "Awal");
  assert.equal(result.bucketLabels.length, result.cashInData.length);
  assert.equal(result.balanceLabels.length, result.bucketLabels.length + 1); // +1 krn 'Awal'
});

test("computeAccountChartSeries: bucket tanpa transaksi membawa saldo terakhir (running balance rata)", () => {
  const now = new Date("2026-08-05T00:00:00");
  const fullSeries = [makeSeriesPoint("2026-08-01", 100_000, 100_000, 0)];
  const result = computeAccountChartSeries(fullSeries, "all", { now });
  // Semua bucket harian dari 01 s/d 05 Agustus -- yang tanpa transaksi tetap bersaldo 100rb.
  result.balanceChartData.forEach((bal) => assert.equal(bal, 100_000));
});

test("computeAccountChartSeries: mengembalikan `cutoff` (null kalau periodVal 'all', Date kalau ada rentang)", () => {
  const now = new Date("2026-08-05T00:00:00");
  const fullSeries = [makeSeriesPoint("2026-08-01", 50_000, 50_000, 0)];
  assert.equal(computeAccountChartSeries(fullSeries, "all", { now }).cutoff, null);
  const withCutoff = computeAccountChartSeries(fullSeries, "10", { now });
  assert.deepEqual(withCutoff.cutoff, new Date(2026, 7, 5 - 10));
});

// ===================== resolveAccountCategoryDateRange =====================

test("resolveAccountCategoryDateRange: 'sync' -> start = syncCutoff, end = null", () => {
  const cutoff = new Date("2026-07-01");
  const result = resolveAccountCategoryDateRange("sync", { now: new Date("2026-08-15"), syncCutoff: cutoff });
  assert.equal(result.start, cutoff);
  assert.equal(result.end, null);
});

test("resolveAccountCategoryDateRange: 'this_month' -> start = tanggal 1 bulan ini, end = null", () => {
  const result = resolveAccountCategoryDateRange("this_month", { now: new Date(2026, 7, 15) });
  assert.deepEqual(result.start, new Date(2026, 7, 1));
  assert.equal(result.end, null);
});

test("resolveAccountCategoryDateRange: 'last_month' -> rentang bulan lalu penuh", () => {
  const result = resolveAccountCategoryDateRange("last_month", { now: new Date(2026, 7, 15) });
  assert.deepEqual(result.start, new Date(2026, 6, 1));
  assert.deepEqual(result.end, new Date(2026, 6, 31, 23, 59, 59, 999));
});

test("resolveAccountCategoryDateRange: 'this_year'/'last_year' -> rentang tahun penuh", () => {
  const thisYear = resolveAccountCategoryDateRange("this_year", { now: new Date(2026, 7, 15) });
  assert.deepEqual(thisYear.start, new Date(2026, 0, 1));
  assert.equal(thisYear.end, null);

  const lastYear = resolveAccountCategoryDateRange("last_year", { now: new Date(2026, 7, 15) });
  assert.deepEqual(lastYear.start, new Date(2025, 0, 1));
  assert.deepEqual(lastYear.end, new Date(2025, 11, 31, 23, 59, 59, 999));
});

test("resolveAccountCategoryDateRange: 'custom' dengan bulan dipilih -> rentang bulan itu", () => {
  const result = resolveAccountCategoryDateRange("custom", { now: new Date(2026, 7, 15), customMonthStr: "2026-03" });
  assert.deepEqual(result.start, new Date(2026, 2, 1));
  assert.deepEqual(result.end, new Date(2026, 2, 31, 23, 59, 59, 999));
});

test("resolveAccountCategoryDateRange: 'custom' TANPA bulan dipilih, atau 'all' -> tidak ada batas", () => {
  const customEmpty = resolveAccountCategoryDateRange("custom", { now: new Date(2026, 7, 15), customMonthStr: "" });
  assert.deepEqual(customEmpty, { start: null, end: null });

  const all = resolveAccountCategoryDateRange("all", { now: new Date(2026, 7, 15) });
  assert.deepEqual(all, { start: null, end: null });
});

// ===================== aggregateAccountExpenseByCategory =====================

const stubAccStyle = (kategori) => ({ parentName: kategori === "Kopi" ? "Makan" : null });
const parseTgl2 = (tanggalStr) => new Date(String(tanggalStr).split("T")[0] + "T00:00:00");

test("aggregateAccountExpenseByCategory: cuma menghitung Pengeluaran milik akun ini, dikelompokkan per PARENT", () => {
  const result = aggregateAccountExpenseByCategory([
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Kopi", tanggal: "2026-08-01", jumlah: 20_000 },
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Makan", tanggal: "2026-08-02", jumlah: 30_000 },
    { jenis: "Pengeluaran", akun: "Bank", kategori: "Kopi", tanggal: "2026-08-01", jumlah: 999_999 }, // akun lain
    { jenis: "Pemasukan", akun: "Dompet", kategori: "Gaji", tanggal: "2026-08-01", jumlah: 999_999 }, // bukan pengeluaran
  ], "Dompet", { getCategoryStyle: stubAccStyle, parseTgl: parseTgl2 });

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].label, "Makan");
  assert.equal(result.entries[0].val, 50_000); // Kopi (resolve ke Makan) + Makan langsung
  assert.deepEqual(result.top, { label: "Makan", val: 50_000 });
});

test("aggregateAccountExpenseByCategory: tanpa start/end -> all-time, semua transaksi ikut", () => {
  const result = aggregateAccountExpenseByCategory([
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Makan", tanggal: "2020-01-01", jumlah: 10_000 },
  ], "Dompet", { getCategoryStyle: stubAccStyle, parseTgl: parseTgl2 });
  assert.equal(result.entries[0].val, 10_000);
});

test("aggregateAccountExpenseByCategory: dengan start/end -> transaksi di luar rentang dikecualikan", () => {
  const result = aggregateAccountExpenseByCategory([
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Makan", tanggal: "2026-06-15", jumlah: 10_000 }, // di luar
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Makan", tanggal: "2026-08-15", jumlah: 20_000 }, // di dalam
  ], "Dompet", { getCategoryStyle: stubAccStyle, parseTgl: parseTgl2, start: new Date(2026, 7, 1), end: new Date(2026, 7, 31, 23, 59, 59, 999) });
  assert.equal(result.entries[0].val, 20_000);
});

test("aggregateAccountExpenseByCategory: tidak ada data -> entries kosong, top null", () => {
  const result = aggregateAccountExpenseByCategory([], "Dompet", { getCategoryStyle: stubAccStyle, parseTgl: parseTgl2 });
  assert.deepEqual(result.entries, []);
  assert.equal(result.top, null);
});

// ===================== computeAccountGroupNet =====================

const transferTargetAmount2 = (row) => Number(row.transfer_jumlah_tujuan != null ? row.transfer_jumlah_tujuan : row.jumlah);

test("computeAccountGroupNet: Pemasukan menambah net, Pengeluaran mengurangi net", () => {
  const net = computeAccountGroupNet([
    { jenis: "Pemasukan", akun: "Dompet", jumlah: 100_000 },
    { jenis: "Pengeluaran", akun: "Dompet", jumlah: 30_000 },
  ], "Dompet", { transferTargetAmount: transferTargetAmount2 });
  assert.equal(net, 70_000);
});

test("computeAccountGroupNet: transfer KELUAR dari akun ini -> mengurangi net (pakai jumlah sisi sumber)", () => {
  const net = computeAccountGroupNet([
    { jenis: "Transfer", akun: "Dompet", kategori: "Bank", jumlah: 50_000 },
  ], "Dompet", { transferTargetAmount: transferTargetAmount2 });
  assert.equal(net, -50_000);
});

test("computeAccountGroupNet: transfer MASUK ke akun ini -> menambah net, pakai transferTargetAmount (lintas mata uang)", () => {
  const net = computeAccountGroupNet([
    { jenis: "Transfer", akun: "Dompet", kategori: "Bank USD", jumlah: 1_600_000, transfer_jumlah_tujuan: 100 },
  ], "Bank USD", { transferTargetAmount: transferTargetAmount2 });
  assert.equal(net, 100); // bukan 1_600_000
});

test("computeAccountGroupNet: grup kosong -> net 0", () => {
  assert.equal(computeAccountGroupNet([], "Dompet", { transferTargetAmount: transferTargetAmount2 }), 0);
});

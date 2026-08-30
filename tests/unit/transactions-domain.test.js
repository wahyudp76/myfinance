import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchesTransactionSearch,
  computeLast30DaysView,
  computeCustomMonthView,
  computeDateRangeView,
  isWithinAmountRange,
  computeDayNetTotal,
} from "../../src/domain/transactions.js";

const parseTgl = (tanggalStr) => new Date(String(tanggalStr).split("T")[0] + "T00:00:00");
const txIdrAmount = (t) => Number(t.jumlah_idr != null ? t.jumlah_idr : t.jumlah);
const toDateStr = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

// ===================== matchesTransactionSearch =====================

test("matchesTransactionSearch: cocok di kategori, keterangan, jenis, ATAU akun", () => {
  const item = { kategori: "Makan Siang", keterangan: "Nasi padang", jenis: "Pengeluaran", akun: "Dompet" };
  assert.equal(matchesTransactionSearch(item, "siang"), true);
  assert.equal(matchesTransactionSearch(item, "padang"), true);
  assert.equal(matchesTransactionSearch(item, "pengeluaran"), true);
  assert.equal(matchesTransactionSearch(item, "dompet"), true);
  assert.equal(matchesTransactionSearch(item, "gaji"), false);
});

test("matchesTransactionSearch: field null/undefined tidak error", () => {
  const item = { kategori: null, keterangan: undefined, jenis: "Pemasukan", akun: "Bank" };
  assert.equal(matchesTransactionSearch(item, "bank"), true);
  assert.equal(matchesTransactionSearch(item, "apapun"), false);
});

// ===================== computeLast30DaysView =====================

test("computeLast30DaysView: transaksi lebih tua dari 30 hari dikecualikan dari `filtered`", () => {
  const now = new Date(2026, 7, 30);
  const result = computeLast30DaysView([
    { jenis: "Pemasukan", tanggal: "2026-08-01", jumlah: 100_000 }, // 29 hari lalu -- masuk
    { jenis: "Pemasukan", tanggal: "2026-06-01", jumlah: 999_999 }, // jauh lebih tua -- dikecualikan
  ], { now, parseTgl, txIdrAmount });

  assert.equal(result.filtered.length, 1);
  assert.equal(result.filtered[0].tanggal, "2026-08-01");
});

test("computeLast30DaysView: chart SELALU 30 hari penuh, hari tanpa transaksi terisi 0", () => {
  const now = new Date(2026, 7, 30);
  const result = computeLast30DaysView([], { now, parseTgl, txIdrAmount });
  assert.equal(result.chartLabels.length, 30);
  assert.equal(result.chartIn.length, 30);
  assert.equal(result.chartOut.length, 30);
  result.chartIn.forEach((v) => assert.equal(v, 0));
});

test("computeLast30DaysView: nominal masuk/keluar terakumulasi di hari yang tepat", () => {
  const now = new Date(2026, 7, 30); // 30 Agustus 2026
  const result = computeLast30DaysView([
    { jenis: "Pemasukan", tanggal: "2026-08-30", jumlah: 500_000 },
    { jenis: "Pengeluaran", tanggal: "2026-08-30", jumlah: 100_000 },
  ], { now, parseTgl, txIdrAmount });

  assert.equal(result.chartIn[29], 500_000); // hari terakhir (hari ini)
  assert.equal(result.chartOut[29], 100_000);
});

// ===================== computeCustomMonthView =====================

test("computeCustomMonthView: monthYearVal kosong -> data apa adanya, chart kosong", () => {
  const data = [{ jenis: "Pemasukan", tanggal: "2026-08-01", jumlah: 100_000 }];
  const result = computeCustomMonthView(data, "", { parseTgl, txIdrAmount });
  assert.equal(result.filtered, data); // reference sama, tidak difilter
  assert.deepEqual(result.chartLabels, []);
});

test("computeCustomMonthView: cuma menyertakan transaksi di bulan/tahun yang diminta", () => {
  const result = computeCustomMonthView([
    { jenis: "Pemasukan", tanggal: "2026-08-05", jumlah: 100_000 },
    { jenis: "Pemasukan", tanggal: "2026-07-31", jumlah: 999_999 }, // bulan lain
  ], "2026-08", { parseTgl, txIdrAmount });

  assert.equal(result.filtered.length, 1);
  assert.equal(result.chartLabels.length, 31); // Agustus 31 hari
  assert.equal(result.chartLabels[0], "1");
  assert.equal(result.chartIn[4], 100_000); // tanggal 5 -> index 4
});

test("computeCustomMonthView: menghormati jumlah hari di bulan spesifik (Februari kabisat)", () => {
  const result = computeCustomMonthView([], "2024-02", { parseTgl, txIdrAmount });
  assert.equal(result.chartLabels.length, 29);
});

// ===================== computeDateRangeView =====================

test("computeDateRangeView: fromVal/toVal kosong keduanya -> data tidak difilter, chart kosong", () => {
  const data = [{ jenis: "Pemasukan", tanggal: "2026-08-01", jumlah: 100_000 }];
  const result = computeDateRangeView(data, "", "", { parseTgl, txIdrAmount, toDateStr });
  assert.equal(result.filtered, data);
  assert.deepEqual(result.chartLabels, []);
});

test("computeDateRangeView: cuma fromVal terisi -> filter batas bawah saja, chart TETAP kosong (butuh keduanya)", () => {
  const result = computeDateRangeView([
    { jenis: "Pemasukan", tanggal: "2026-08-01", jumlah: 10_000 },
    { jenis: "Pemasukan", tanggal: "2026-07-01", jumlah: 20_000 },
  ], "2026-07-15", "", { parseTgl, txIdrAmount, toDateStr });

  assert.equal(result.filtered.length, 1);
  assert.deepEqual(result.chartLabels, []);
});

test("computeDateRangeView: rentang <=31 hari -> granularity HARIAN", () => {
  const result = computeDateRangeView([
    { jenis: "Pemasukan", tanggal: "2026-08-05", jumlah: 50_000 },
  ], "2026-08-01", "2026-08-10", { parseTgl, txIdrAmount, toDateStr });

  assert.equal(result.chartLabels.length, 10); // 1-10 Agustus inklusif
  assert.equal(result.chartIn[4], 50_000); // tanggal 5 -> index 4
});

test("computeDateRangeView: rentang >31 hari -> granularity BULANAN", () => {
  const result = computeDateRangeView([
    { jenis: "Pengeluaran", tanggal: "2026-03-15", jumlah: 75_000 },
  ], "2026-01-01", "2026-04-30", { parseTgl, txIdrAmount, toDateStr });

  assert.equal(result.chartLabels.length, 4); // Jan, Feb, Mar, Apr
  assert.equal(result.chartOut[2], 75_000); // Maret -> index 2
});

test("computeDateRangeView: rentang persis 31 hari -> masih granularity HARIAN (ambang inklusif)", () => {
  const result = computeDateRangeView([], "2026-08-01", "2026-08-31", { parseTgl, txIdrAmount, toDateStr });
  assert.equal(result.chartLabels.length, 31);
});

test("computeDateRangeView: rentang persis 32 hari -> granularity BULANAN", () => {
  const result = computeDateRangeView([], "2026-08-01", "2026-09-01", { parseTgl, txIdrAmount, toDateStr });
  assert.equal(result.chartLabels.length, 2); // Agustus, September
});

test("computeDateRangeView: toVal sebelum fromVal (rentang terbalik) -> chart kosong, tidak error", () => {
  const result = computeDateRangeView([], "2026-08-10", "2026-08-01", { parseTgl, txIdrAmount, toDateStr });
  assert.deepEqual(result.chartLabels, []);
  assert.deepEqual(result.chartIn, []);
});

// ===================== isWithinAmountRange =====================

test("isWithinAmountRange: di dalam rentang -> true", () => {
  assert.equal(isWithinAmountRange({ jumlah: 50_000 }, 10_000, 100_000, { txIdrAmount }), true);
});

test("isWithinAmountRange: di bawah minimum -> false", () => {
  assert.equal(isWithinAmountRange({ jumlah: 5_000 }, 10_000, null, { txIdrAmount }), false);
});

test("isWithinAmountRange: di atas maksimum -> false", () => {
  assert.equal(isWithinAmountRange({ jumlah: 200_000 }, null, 100_000, { txIdrAmount }), false);
});

test("isWithinAmountRange: min & max null (tanpa batas) -> selalu true", () => {
  assert.equal(isWithinAmountRange({ jumlah: 999_999_999 }, null, null, { txIdrAmount }), true);
});

test("isWithinAmountRange: pas di batas (inklusif)", () => {
  assert.equal(isWithinAmountRange({ jumlah: 100_000 }, 100_000, 100_000, { txIdrAmount }), true);
});

// ===================== computeDayNetTotal =====================

test("computeDayNetTotal: Pemasukan menambah, Pengeluaran mengurangi", () => {
  const net = computeDayNetTotal([
    { jenis: "Pemasukan", jumlah: 100_000 },
    { jenis: "Pengeluaran", jumlah: 30_000 },
  ], { txIdrAmount });
  assert.equal(net, 70_000);
});

test("computeDayNetTotal: Transfer TIDAK dihitung sama sekali", () => {
  const net = computeDayNetTotal([
    { jenis: "Transfer", jumlah: 500_000 },
  ], { txIdrAmount });
  assert.equal(net, 0);
});

test("computeDayNetTotal: grup kosong -> 0", () => {
  assert.equal(computeDayNetTotal([], { txIdrAmount }), 0);
});

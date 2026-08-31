import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCategoryAndSubNames,
  computeCategoryDetailMonthChart,
  aggregateSubCategoryShares,
} from "../../src/domain/categories.js";

const parseTgl = (tanggalStr) => new Date(String(tanggalStr).split("T")[0] + "T00:00:00");
const txIdrAmount = (t) => Number(t.jumlah_idr != null ? t.jumlah_idr : t.jumlah);

// ===================== resolveCategoryAndSubNames =====================

test("resolveCategoryAndSubNames: kategori PARENT dengan sub -> nama parent + semua nama sub", () => {
  const categoryDict = { pengeluaran: { "Transport": { subs: [{ name: "Bensin" }, { name: "Ojek Online" }] } } };
  const result = resolveCategoryAndSubNames(categoryDict, "Transport", "Pengeluaran");
  assert.deepEqual(result, ["Transport", "Bensin", "Ojek Online"]);
});

test("resolveCategoryAndSubNames: jenis dicocokkan case-insensitive ke kunci categoryDict (huruf kecil)", () => {
  const categoryDict = { pemasukan: { "Gaji": { subs: [{ name: "Gaji Pokok" }] } } };
  const result = resolveCategoryAndSubNames(categoryDict, "Gaji", "Pemasukan");
  assert.deepEqual(result, ["Gaji", "Gaji Pokok"]);
});

test("resolveCategoryAndSubNames: kategori TANPA sub (parent dgn subs kosong) -> cuma nama itu sendiri", () => {
  const categoryDict = { pengeluaran: { "Lain-lain": { subs: [] } } };
  const result = resolveCategoryAndSubNames(categoryDict, "Lain-lain", "Pengeluaran");
  assert.deepEqual(result, ["Lain-lain"]);
});

test("resolveCategoryAndSubNames: nama SUB-kategori (bukan parent) -> cuma nama itu sendiri", () => {
  const categoryDict = { pengeluaran: { "Transport": { subs: [{ name: "Bensin" }] } } };
  const result = resolveCategoryAndSubNames(categoryDict, "Bensin", "Pengeluaran"); // "Bensin" bukan key parent
  assert.deepEqual(result, ["Bensin"]);
});

test("resolveCategoryAndSubNames: kategori tidak ditemukan di categoryDict sama sekali -> cuma nama itu sendiri", () => {
  const result = resolveCategoryAndSubNames({ pengeluaran: {} }, "Kategori Ngasal", "Pengeluaran");
  assert.deepEqual(result, ["Kategori Ngasal"]);
});

// ===================== computeCategoryDetailMonthChart =====================

test("computeCategoryDetailMonthChart: totalMonth cuma menjumlah transaksi di bulan/tahun yang diminta", () => {
  const result = computeCategoryDetailMonthChart([
    { tanggal: "2026-08-05", jumlah: 50_000 },
    { tanggal: "2026-08-10", jumlah: 25_000 },
    { tanggal: "2026-07-31", jumlah: 999_999 }, // bulan lain
  ], 2026, 8, { parseTgl, txIdrAmount });

  assert.equal(result.totalMonth, 75_000);
});

test("computeCategoryDetailMonthChart: dailyLabels mencakup SEMUA hari di bulan itu, bukan cuma yang ada transaksinya", () => {
  const result = computeCategoryDetailMonthChart([
    { tanggal: "2026-02-05", jumlah: 10_000 },
  ], 2024, 2, { parseTgl, txIdrAmount }); // Februari 2024 (kabisat) -> 29 hari
  assert.equal(result.dailyLabels.length, 29);
  assert.equal(result.dailyData.length, 29);
});

test("computeCategoryDetailMonthChart: dailyData terisi 0 di hari tanpa transaksi, terakumulasi di hari yang ada", () => {
  const result = computeCategoryDetailMonthChart([
    { tanggal: "2026-08-01", jumlah: 10_000 },
    { tanggal: "2026-08-01", jumlah: 5_000 }, // 2 transaksi di hari yang sama -> diakumulasi
    { tanggal: "2026-08-15", jumlah: 20_000 },
  ], 2026, 8, { parseTgl, txIdrAmount });

  assert.equal(result.dailyData[0], 15_000); // hari ke-1 (index 0)
  assert.equal(result.dailyData[14], 20_000); // hari ke-15 (index 14)
  assert.equal(result.dailyData[1], 0); // hari ke-2, tidak ada transaksi
  assert.equal(result.dailyLabels[0], "1");
});

test("computeCategoryDetailMonthChart: transaksi tanpa tanggal diabaikan, tidak error", () => {
  const result = computeCategoryDetailMonthChart([
    { tanggal: null, jumlah: 10_000 },
  ], 2026, 8, { parseTgl, txIdrAmount });
  assert.equal(result.totalMonth, 0);
});

test("computeCategoryDetailMonthChart: tidak ada transaksi sama sekali -> total 0, semua hari 0", () => {
  const result = computeCategoryDetailMonthChart([], 2026, 8, { parseTgl, txIdrAmount });
  assert.equal(result.totalMonth, 0);
  assert.equal(result.dailyLabels.length, 31); // Agustus 31 hari
  result.dailyData.forEach((v) => assert.equal(v, 0));
});

// ===================== aggregateSubCategoryShares (slice proporsi sub) =====================

const parseTglS = (s) => new Date(s + "T00:00:00");
const idrS = (t) => t.jumlah_idr;

test("aggregateSubCategoryShares: kelompok per sub, pct 1 desimal, urut menurun", () => {
  const data = [
    { tanggal: "2026-08-02", kategori: "Makan di Luar", jumlah_idr: 60000 },
    { tanggal: "2026-08-05", kategori: "Bahan Baku", jumlah_idr: 30000 },
    { tanggal: "2026-08-09", kategori: "Makan di Luar", jumlah_idr: 60000 },
    { tanggal: "2026-08-21", kategori: "Katering", jumlah_idr: 30000 },
  ];
  const { items, totalMonth } = aggregateSubCategoryShares(data, 2026, 8, { parseTgl: parseTglS, txIdrAmount: idrS });
  assert.equal(totalMonth, 180000);
  assert.deepEqual(items.map((i) => i.name), ["Makan di Luar", "Bahan Baku", "Katering"]);
  assert.equal(items[0].total, 120000);
  assert.equal(items[0].count, 2);
  assert.equal(items[0].pct, 66.7);
  assert.equal(items[1].pct, 16.7);
  assert.equal(items[2].pct, 16.7);
});

test("aggregateSubCategoryShares: HANYA bulan ybs -- bulan/tahun lain dikecualikan", () => {
  const data = [
    { tanggal: "2026-07-31", kategori: "Makan di Luar", jumlah_idr: 999999 },
    { tanggal: "2026-08-01", kategori: "Makan di Luar", jumlah_idr: 10000 },
    { tanggal: "2026-09-01", kategori: "Bahan Baku", jumlah_idr: 888888 },
  ];
  const { items, totalMonth } = aggregateSubCategoryShares(data, 2026, 8, { parseTgl: parseTglS, txIdrAmount: idrS });
  assert.equal(totalMonth, 10000);
  assert.equal(items.length, 1);
  assert.equal(items[0].pct, 100);
});

test("aggregateSubCategoryShares: multi-mata uang lewat txIdrAmount (nilai IDR-equivalent)", () => {
  const data = [
    { tanggal: "2026-08-01", kategori: "A", jumlah: 10 },
    { tanggal: "2026-08-02", kategori: "B", jumlah: 5 },
  ];
  const rate = (t) => t.jumlah * 16000;
  const { items, totalMonth } = aggregateSubCategoryShares(data, 2026, 8, { parseTgl: parseTglS, txIdrAmount: rate });
  assert.equal(totalMonth, 240000);
  assert.equal(items[0].pct, 66.7);
});

test("aggregateSubCategoryShares: kosong / tanpa transaksi bulan itu -> items [] & total 0", () => {
  const kosong = aggregateSubCategoryShares([], 2026, 8, { parseTgl: parseTglS, txIdrAmount: idrS });
  assert.deepEqual(kosong.items, []);
  assert.equal(kosong.totalMonth, 0);
  const bedaBulan = aggregateSubCategoryShares([{ tanggal: "2026-01-01", kategori: "A", jumlah_idr: 1 }], 2026, 8, { parseTgl: parseTglS, txIdrAmount: idrS });
  assert.deepEqual(bedaBulan.items, []);
  assert.equal(bedaBulan.totalMonth, 0);
});

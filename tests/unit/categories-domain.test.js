import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCategoryAndSubNames,
  computeCategoryDetailMonthChart,
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

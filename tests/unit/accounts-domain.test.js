import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAccountTotals, buildAccountBalanceSeries } from "../../src/domain/accounts.js";

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

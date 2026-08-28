import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateDashboardData } from "../../src/domain/dashboard.js";

// Dependensi disuntik persis seperti yang sebenarnya dipakai index.html, versi sederhana
// utk keperluan test (tidak butuh DOM/appSettings/getCategoryStyle sungguhan).
function makeDeps(overrides = {}) {
  return {
    accounts: ["Dompet", "Bank"],
    now: new Date(2026, 7, 15), // 15 Agustus 2026 (bulan = index 0-based)
    txIdrAmount: (t) => Number(t.jumlah_idr != null ? t.jumlah_idr : t.jumlah),
    transferTargetAmount: (row) => Number(row.transfer_jumlah_tujuan != null ? row.transfer_jumlah_tujuan : row.jumlah),
    parseTgl: (tanggalStr) => new Date(String(tanggalStr).split("T")[0] + "T00:00:00"),
    categorizeExpenseParent: (kategori) => (kategori === "Kopi" || kategori === "Makan Siang" ? "Makanan" : kategori),
    ...overrides,
  };
}

test("Pemasukan menambah saldo akun & totalIn, Pengeluaran mengurangi saldo & menambah totalOut", () => {
  const result = aggregateDashboardData([
    { jenis: "Pemasukan", akun: "Dompet", kategori: "Gaji", tanggal: "2026-08-01", jumlah: 1_000_000 },
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Kopi", tanggal: "2026-08-02", jumlah: 50_000 },
  ], makeDeps());

  assert.equal(result.accBalances.Dompet, 950_000);
  assert.equal(result.totalIn, 1_000_000);
  assert.equal(result.totalOut, 50_000);
});

test("Transfer: akun sumber berkurang (amt native), akun tujuan bertambah (transferTargetAmount), tidak masuk totalIn/totalOut", () => {
  const result = aggregateDashboardData([
    { jenis: "Transfer", akun: "Dompet", kategori: "Bank", tanggal: "2026-08-03", jumlah: 200_000 },
  ], makeDeps());

  assert.equal(result.accBalances.Dompet, -200_000);
  assert.equal(result.accBalances.Bank, 200_000);
  assert.equal(result.totalIn, 0);
  assert.equal(result.totalOut, 0);
});

test("Transfer lintas mata uang: akun tujuan pakai transfer_jumlah_tujuan, BUKAN jumlah sisi sumber", () => {
  const result = aggregateDashboardData([
    { jenis: "Transfer", akun: "Dompet", kategori: "Bank", tanggal: "2026-08-03", jumlah: 100, transfer_jumlah_tujuan: 1_600_000 },
  ], makeDeps());

  assert.equal(result.accBalances.Dompet, -100);
  assert.equal(result.accBalances.Bank, 1_600_000);
});

test("Transaksi ke akun yang tidak dikenal (sudah dihapus dari appSettings.accounts) tidak bikin error", () => {
  assert.doesNotThrow(() => {
    aggregateDashboardData([
      { jenis: "Pemasukan", akun: "Akun Lama Sudah Dihapus", kategori: "Gaji", tanggal: "2026-08-01", jumlah: 100 },
    ], makeDeps());
  });
});

test("monthIn/monthOut/monthTxCount cuma menghitung transaksi BULAN INI (relatif ke `now`), Transfer tidak dihitung ke monthTxCount", () => {
  const result = aggregateDashboardData([
    { jenis: "Pemasukan", akun: "Dompet", kategori: "Gaji", tanggal: "2026-08-01", jumlah: 500_000 },
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Kopi", tanggal: "2026-08-02", jumlah: 20_000 },
    { jenis: "Transfer", akun: "Dompet", kategori: "Bank", tanggal: "2026-08-02", jumlah: 10_000 },
    { jenis: "Pemasukan", akun: "Dompet", kategori: "Gaji", tanggal: "2026-07-01", jumlah: 999_999 }, // bulan lalu, tidak dihitung
  ], makeDeps());

  assert.equal(result.monthIn, 500_000);
  assert.equal(result.monthOut, 20_000);
  assert.equal(result.monthTxCount, 2); // Pemasukan + Pengeluaran, Transfer TIDAK dihitung
});

test("prevMonthIn/prevMonthOut menghitung bulan SEBELUM `now`, bukan bulan ini/lalu-lalu", () => {
  const result = aggregateDashboardData([
    { jenis: "Pemasukan", akun: "Dompet", kategori: "Gaji", tanggal: "2026-07-15", jumlah: 300_000 }, // Juli = bulan lalu
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Kopi", tanggal: "2026-07-20", jumlah: 40_000 },
    { jenis: "Pemasukan", akun: "Dompet", kategori: "Gaji", tanggal: "2026-06-15", jumlah: 1_000_000 }, // 2 bulan lalu, tidak dihitung
  ], makeDeps());

  assert.equal(result.prevMonthIn, 300_000);
  assert.equal(result.prevMonthOut, 40_000);
});

test("monthCatOutMap mengelompokkan pengeluaran bulan ini per kategori PARENT", () => {
  const result = aggregateDashboardData([
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Kopi", tanggal: "2026-08-05", jumlah: 20_000 },
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Makan Siang", tanggal: "2026-08-06", jumlah: 35_000 },
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Transportasi", tanggal: "2026-08-06", jumlah: 15_000 },
  ], makeDeps());

  assert.equal(result.monthCatOutMap.Makanan, 55_000); // Kopi + Makan Siang digabung ke parent "Makanan"
  assert.equal(result.monthCatOutMap.Transportasi, 15_000);
});

test("catOut3MoMap mengakumulasi 3 bulan SEBELUM bulan ini (bukan bulan ini)", () => {
  const result = aggregateDashboardData([
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Kopi", tanggal: "2026-08-05", jumlah: 999_999 }, // bulan ini, TIDAK dihitung
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Kopi", tanggal: "2026-07-05", jumlah: 20_000 }, // 1 bulan lalu
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Kopi", tanggal: "2026-06-05", jumlah: 10_000 }, // 2 bulan lalu
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Kopi", tanggal: "2026-05-05", jumlah: 5_000 },  // 3 bulan lalu
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Kopi", tanggal: "2026-04-05", jumlah: 1_000_000 }, // 4 bulan lalu, TIDAK dihitung
  ], makeDeps());

  assert.equal(result.catOut3MoMap.Makanan, 35_000);
});

test("last7Map cuma mem-bucket transaksi dalam 7 hari terakhir (termasuk hari ini), sisanya diabaikan", () => {
  const deps = makeDeps({ now: new Date(2026, 7, 15) }); // 15 Agustus 2026
  const result = aggregateDashboardData([
    { jenis: "Pemasukan", akun: "Dompet", kategori: "Gaji", tanggal: "2026-08-15", jumlah: 10_000 }, // hari ini
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Kopi", tanggal: "2026-08-10", jumlah: 5_000 }, // 5 hari lalu
    { jenis: "Pengeluaran", akun: "Dompet", kategori: "Kopi", tanggal: "2026-07-01", jumlah: 999_999 }, // di luar 7 hari
  ], deps);

  const totalInLast7 = Object.values(result.last7Map).reduce((s, v) => s + v.in, 0);
  const totalOutLast7 = Object.values(result.last7Map).reduce((s, v) => s + v.out, 0);
  assert.equal(totalInLast7, 10_000);
  assert.equal(totalOutLast7, 5_000); // transaksi 2026-07-01 TIDAK ikut ke-bucket
  assert.equal(result.last7Order.length, 7);
});

test("data kosong tidak error dan semua total 0", () => {
  const result = aggregateDashboardData([], makeDeps());
  assert.equal(result.totalIn, 0);
  assert.equal(result.totalOut, 0);
  assert.equal(result.monthTxCount, 0);
  assert.deepEqual(result.accBalances, { Dompet: 0, Bank: 0 });
});

import assert from "node:assert/strict";
import { compareTransactionLists } from "../../src/services/parity/transactions.js";

const legacyFixture = [
  {
    id: "t-2",
    jenis: "pengeluaran",
    tanggal: "2026-08-20",
    jumlah: "125000",
    akun: "Cash",
    kategori: "Makan",
    keterangan: "Lunch",
    mata_uang: "IDR",
    kurs: "1",
    jumlah_idr: "125000",
  },
  {
    id: "t-1",
    jenis: "pemasukan",
    tanggal: "2026-08-19",
    jumlah: 500000,
    akun: "Bank",
    kategori: "Salary",
    keterangan: null,
    mata_uang: null,
    kurs: null,
    jumlah_idr: null,
  },
];

const nativeFixture = [
  {
    id: "t-2",
    jenis: "pengeluaran",
    tanggal: "2026-08-20",
    jumlah: 125000,
    akun: "Cash",
    kategori: "Makan",
    keterangan: "Lunch",
    mata_uang: "IDR",
    kurs: 1,
    jumlah_idr: 125000,
  },
  {
    id: "t-1",
    jenis: "pemasukan",
    tanggal: "2026-08-19",
    jumlah: 500000,
    akun: "Bank",
    kategori: "Salary",
    keterangan: null,
    mata_uang: null,
    kurs: null,
    jumlah_idr: null,
  },
];

const result = compareTransactionLists(legacyFixture, nativeFixture);
assert.equal(result.equal, true, JSON.stringify(result, null, 2));
assert.equal(result.legacyCount, result.nativeCount);

console.log("Transaction read parity: PASS");

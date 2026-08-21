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
  {
    id: "t-usd",
    jenis: "pengeluaran",
    tanggal: "2026-08-18",
    jumlah: "10.5",
    akun: "Card",
    kategori: "Travel",
    keterangan: "USD purchase",
    mata_uang: "USD",
    kurs: "16000",
    jumlah_idr: "168000",
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
  {
    id: "t-usd",
    jenis: "pengeluaran",
    tanggal: "2026-08-18",
    jumlah: 10.5,
    akun: "Card",
    kategori: "Travel",
    keterangan: "USD purchase",
    mata_uang: "USD",
    kurs: 16000,
    jumlah_idr: 168000,
  },
];

const equalResult = compareTransactionLists(legacyFixture, nativeFixture);
assert.equal(equalResult.equal, true, JSON.stringify(equalResult, null, 2));
assert.equal(equalResult.legacyCount, 3);
assert.equal(equalResult.nativeCount, 3);
assert.deepEqual(equalResult.diagnostics, {
  missingInNative: [],
  missingInLegacy: [],
  fieldMismatches: [],
});

const changedNative = nativeFixture.map((row) =>
  row.id === "t-usd" ? { ...row, kurs: 15500 } : row
);
const mismatchResult = compareTransactionLists(legacyFixture, changedNative);
assert.equal(mismatchResult.equal, false);
assert.deepEqual(mismatchResult.diagnostics.fieldMismatches, [
  { id: "t-usd", field: "kurs" },
]);

const missingNative = nativeFixture.filter((row) => row.id !== "t-1");
const missingResult = compareTransactionLists(legacyFixture, missingNative);
assert.deepEqual(missingResult.diagnostics.missingInNative, ["t-1"]);

console.log("Transaction parity fixture coverage: PASS");

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
    transfer_jumlah_tujuan: null,
    transfer_mata_uang_tujuan: null,
    transfer_kurs_tujuan: null,
    transfer_jumlah_tujuan_idr: null,
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
    transfer_jumlah_tujuan: null,
    transfer_mata_uang_tujuan: null,
    transfer_kurs_tujuan: null,
    transfer_jumlah_tujuan_idr: null,
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
    transfer_jumlah_tujuan: null,
    transfer_mata_uang_tujuan: null,
    transfer_kurs_tujuan: null,
    transfer_jumlah_tujuan_idr: null,
  },
  {
    id: "t-transfer",
    jenis: "Transfer",
    tanggal: "2026-08-21",
    jumlah: "100",
    akun: "USD Card",
    kategori: "Transfer",
    keterangan: "Top up rekening IDR",
    mata_uang: "USD",
    kurs: "16000",
    jumlah_idr: "1600000",
    transfer_jumlah_tujuan: "1595000",
    transfer_mata_uang_tujuan: "IDR",
    transfer_kurs_tujuan: "1",
    transfer_jumlah_tujuan_idr: "1595000",
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
    transfer_jumlah_tujuan: null,
    transfer_mata_uang_tujuan: null,
    transfer_kurs_tujuan: null,
    transfer_jumlah_tujuan_idr: null,
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
    transfer_jumlah_tujuan: null,
    transfer_mata_uang_tujuan: null,
    transfer_kurs_tujuan: null,
    transfer_jumlah_tujuan_idr: null,
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
    transfer_jumlah_tujuan: null,
    transfer_mata_uang_tujuan: null,
    transfer_kurs_tujuan: null,
    transfer_jumlah_tujuan_idr: null,
  },
  {
    id: "t-transfer",
    jenis: "Transfer",
    tanggal: "2026-08-21",
    jumlah: 100,
    akun: "USD Card",
    kategori: "Transfer",
    keterangan: "Top up rekening IDR",
    mata_uang: "USD",
    kurs: 16000,
    jumlah_idr: 1600000,
    transfer_jumlah_tujuan: 1595000,
    transfer_mata_uang_tujuan: "IDR",
    transfer_kurs_tujuan: 1,
    transfer_jumlah_tujuan_idr: 1595000,
  },
];

const equalResult = compareTransactionLists(legacyFixture, nativeFixture);
assert.equal(equalResult.equal, true, JSON.stringify(equalResult, null, 2));
assert.equal(equalResult.legacyCount, 4);
assert.equal(equalResult.nativeCount, 4);
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

// Regresi spesifik: sebelum diperbaiki, list() di src/services/transactions.js sama sekali
// tidak SELECT 4 kolom transfer_* -- comparableRows() dulu juga tidak memeriksanya, jadi
// kombinasi keduanya akan lolos sebagai "PASS" palsu walau nilai tujuan transfer hilang total.
// Test ini memastikan skenario itu sekarang benar-benar terdeteksi sebagai fieldMismatches.
const nativeMissingTransferDestination = nativeFixture.map((row) =>
  row.id === "t-transfer"
    ? { ...row, transfer_jumlah_tujuan: null, transfer_mata_uang_tujuan: null, transfer_kurs_tujuan: null, transfer_jumlah_tujuan_idr: null }
    : row
);
const transferGapResult = compareTransactionLists(legacyFixture, nativeMissingTransferDestination);
assert.equal(transferGapResult.equal, false);
assert.deepEqual(transferGapResult.diagnostics.fieldMismatches, [
  { id: "t-transfer", field: "transfer_jumlah_tujuan" },
  { id: "t-transfer", field: "transfer_mata_uang_tujuan" },
  { id: "t-transfer", field: "transfer_kurs_tujuan" },
  { id: "t-transfer", field: "transfer_jumlah_tujuan_idr" },
]);

console.log("Transaction parity fixture coverage: PASS");

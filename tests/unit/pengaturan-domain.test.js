import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CSV_TRANSACTIONS_HEADER,
  csvEscape,
  buildTransactionsCsv,
  csvFileName,
  filterTransactionsForRange,
} from "../../src/domain/export-csv.js";
import { summarizeAppData, formatBytes } from "../../src/domain/app-info.js";
import { validatePasswordChange } from "../../src/domain/settings.js";

const tx = (over = {}) => ({
  tanggal: "2026-09-01", jenis: "Pengeluaran", kategori: "Restoran", akun: "DANA",
  jumlah: "77000", keterangan: "Makan", mata_uang: "IDR", ...over,
});

// ---------- export-csv ----------
test("csvEscape: polos tidak di-quote; koma/petik/baris baru di-quote RFC-4180", () => {
  assert.equal(csvEscape("Aman"), "Aman");
  assert.equal(csvEscape("Kopi, roti"), '"Kopi, roti"');
  assert.equal(csvEscape('Kata "petik"'), '"Kata ""petik"""');
  assert.equal(csvEscape("dua\nbaris"), '"dua\nbaris"');
  assert.equal(csvEscape(null), "");
});

test("buildTransactionsCsv: BOM + header + baris urut pemanggil", () => {
  const csv = buildTransactionsCsv([tx(), tx({ kategori: "Bensin", jumlah: "50000" })]);
  assert.ok(csv.startsWith("\uFEFF"), "diawali BOM UTF-8");
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[0], CSV_TRANSACTIONS_HEADER.join(","));
  assert.equal(lines.length, 3);
  assert.equal(lines[1], "2026-09-01,Pengeluaran,Restoran,DANA,77000,Makan,IDR");
  assert.equal(lines[2], "2026-09-01,Pengeluaran,Bensin,DANA,50000,Makan,IDR");
});

test("buildTransactionsCsv: keterangan berkoma di-quote; jumlah non-numerik jadi 0", () => {
  const csv = buildTransactionsCsv([tx({ keterangan: "Beli kopi, roti" })]);
  assert.ok(csv.includes('"Beli kopi, roti"'));
  const csv2 = buildTransactionsCsv([tx({ jumlah: "abc" })]);
  assert.ok(csv2.includes(",0,"), "jumlah tidak valid -> 0");
});

test("buildTransactionsCsv: txIdrAmount opsional dipakai bila diberikan", () => {
  const csv = buildTransactionsCsv([tx()], { txIdrAmount: () => 123 });
  assert.ok(csv.includes(",123,"));
});

test("csvFileName: prefix + tanggal 10 karakter", () => {
  assert.equal(csvFileName("myfinance-transaksi", "2026-09-01T10:00:00Z"), "myfinance-transaksi-2026-09-01.csv");
});

test("filterTransactionsForRange: 'month' hanya bulan berjalan", () => {
  const rows = [tx({ tanggal: "2026-09-02" }), tx({ tanggal: "2026-08-31" })];
  const out = filterTransactionsForRange(rows, "month", "2026-09-15");
  assert.equal(out.length, 1);
  assert.equal(out[0].tanggal, "2026-09-02");
});

test("filterTransactionsForRange: '3month' = 92 hari inklusif, hasil urut menaik", () => {
  const rows = [
    tx({ tanggal: "2026-09-01" }),
    tx({ tanggal: "2026-05-01" }),  // di luar jendela
    tx({ tanggal: "2026-06-08" }),  // tepat di batas awal jendela 92 hari (today-91d = 2026-06-08)
  ];
  const out = filterTransactionsForRange(rows, "3month", "2026-09-07");
  assert.equal(out.length, 2);
  assert.equal(out[0].tanggal, "2026-06-08"); // urut menaik
  assert.equal(out[1].tanggal, "2026-09-01");
});

test("filterTransactionsForRange: 'all' mengembalikan semua, tetap urut", () => {
  const rows = [tx({ tanggal: "2026-09-05" }), tx({ tanggal: "2026-01-01" })];
  const out = filterTransactionsForRange(rows, "all", "2026-09-05");
  assert.equal(out.length, 2);
  assert.equal(out[0].tanggal, "2026-01-01");
});

// ---------- app-info ----------
test("summarizeAppData: hitung array & kategori (angka maupun dict)", () => {
  const s = summarizeAppData({ transactions: [1, 2, 3], accounts: ["BCA"], categories: { A: {}, B: {} }, assets: [], recurring: [1] });
  assert.deepEqual(s, { transactions: 3, accounts: 1, categories: 2, assets: 0, recurring: 1 });
  const s2 = summarizeAppData({ categories: 7 });
  assert.equal(s2.categories, 7);
  assert.equal(s2.transactions, 0);
});

test("formatBytes: B/KB/MB + desimal koma ala id-ID", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(1536), "1,5 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5 MB");
  assert.equal(formatBytes(150 * 1024), "150 KB");
});

// ---------- validatePasswordChange ----------
test("validatePasswordChange: kosong/pendek/beda konfirmasi ditolak; sama & >=8 diterima", () => {
  assert.equal(validatePasswordChange("", "x").valid, false);
  assert.match(validatePasswordChange("abc", "abc").error, /minimal 8 karakter/);
  assert.match(validatePasswordChange("rahasia123", "rahasia124").error, /tidak sama/);
  assert.deepEqual(validatePasswordChange("rahasia123", "rahasia123"), { valid: true, error: null });
  assert.equal(validatePasswordChange("rahasia", "rahasia", { minLength: 6 }).valid, true);
});

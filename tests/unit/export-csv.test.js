import { test } from "node:test";
import assert from "node:assert/strict";
import {
  csvEscape,
  buildTransactionsCsv,
  csvFileName,
  filterTransactionsForRange,
} from "../../src/domain/export-csv.js";

// ============================================================================
// Ekspor CSV (v60): sel data user yang diawali karakter formula (=, +, -, @,
// TAB, CR) dinetralkan dengan apostrof supaya Excel/Google Sheets membacanya
// sebagai TEKS, bukan FORMULA (CSV/spreadsheet injection -- OWASP). Angka
// polos (kolom Nominal) tidak boleh berubah supaya tetap bisa di-SUM.
// ============================================================================

test("csvEscape: sel biasa & sel ber-koma/petik/baris baru (RFC-4180) tidak berubah perilaku", () => {
  assert.equal(csvEscape("Makan Siang"), "Makan Siang");
  assert.equal(csvEscape('Makan, "enak"'), '"Makan, ""enak"""');
  assert.equal(csvEscape("Baris\nBaru"), '"Baris\nBaru"');
});

test("csvEscape: sel diawali = + - @ TAB dinetralkan dengan apostrof", () => {
  assert.equal(csvEscape("=1+2"), "'=1+2");
  // sel yang juga mengandung tanda kutip tetap di-quote RFC-4180 (petik diganda)
  assert.equal(csvEscape('=HYPERLINK("http://evil","x")'), '"\'=HYPERLINK(""http://evil"",""x"")"');
  assert.equal(csvEscape("+cmd|'/C calc'!A0"), "'+cmd|'/C calc'!A0");
  assert.equal(csvEscape("-diskon"), "'-diskon");
  assert.equal(csvEscape("@SUM(A1:A2)"), "'@SUM(A1:A2)");
  assert.equal(csvEscape("\t=1"), "'\t=1");
});

test("csvEscape: angka polos (termasuk negatif/desimal) TIDAK dinetralkan", () => {
  assert.equal(csvEscape("1500000"), "1500000");
  assert.equal(csvEscape("0"), "0");
  assert.equal(csvEscape("-5000"), "-5000");
  assert.equal(csvEscape("1234.5"), "1234.5");
  // mengandung koma -> tetap di-quote RFC-4180 (perilaku standar, bukan netralisasi)
  assert.equal(csvEscape("1234,5"), '"1234,5"');
});

test("csvEscape: angka yang baru diawali -/+ bukan bilangan polos tetap dinetralkan", () => {
  assert.equal(csvEscape("-5+3"), "'-5+3"); // ekspresi, bukan angka
  assert.equal(csvEscape("+123"), "'+123");
});

test("buildTransactionsCsv: keterangan berbahaya dinetralkan, nominal tetap angka", () => {
  const rows = [
    { tanggal: "2026-09-01", jenis: "Pengeluaran", kategori: "Makanan", akun: "BCA", jumlah: 25000, keterangan: "=cmd|'/C calc'!A0", mata_uang: "IDR" },
    { tanggal: "2026-09-02", jenis: "Pemasukan", kategori: "Gaji", akun: "BCA", jumlah: 5000000, keterangan: "Gaji bulanan", mata_uang: "IDR" },
  ];
  const csv = buildTransactionsCsv(rows);
  assert.equal(csv.startsWith("\uFEFF"), true);
  const lines = csv.replace("\uFEFF", "").split("\r\n");
  assert.equal(lines[0], "Tanggal,Jenis,Kategori,Akun,Nominal,Keterangan,Mata Uang");
  // baris berbahaya: sel keterangan diawali apostrof (netral), nominal tetap angka polos
  assert.equal(lines[1].includes("'=cmd|'/C calc'!A0"), true);
  assert.equal(lines[1].includes(",25000,"), true);
  assert.equal(lines[2].includes(",5000000,"), true);
});

test("csvFileName memakai 10 karakter pertama tanggal (ISO penuh aman)", () => {
  assert.equal(csvFileName("transaksi", "2026-09-01"), "transaksi-2026-09-01.csv");
  assert.equal(csvFileName("transaksi", "2026-09-01T10:00:00.000Z"), "transaksi-2026-09-01.csv");
  assert.equal(csvFileName("transaksi", ""), "transaksi-export.csv");
});

test("filterTransactionsForRange: month & 3month & all konsisten", () => {
  const rows = [
    { tanggal: "2026-07-31", id: "a" },
    { tanggal: "2026-08-01", id: "b" },
    { tanggal: "2026-08-31", id: "c" },
    { tanggal: "2026-09-02", id: "d" }, // hari ini
  ];
  assert.deepEqual(filterTransactionsForRange(rows, "month", "2026-08-15").map((r) => r.id), ["b", "c"]);
  // 92 hari inklusif dari 2026-09-02 = mulai 2026-06-03 (2026-06 punya 30 hari)
  assert.deepEqual(filterTransactionsForRange(rows, "3month", "2026-09-02").map((r) => r.id), ["a", "b", "c", "d"]);
  assert.equal(filterTransactionsForRange(rows, "all", "2026-09-02").length, 4);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchesTransactionSearch,
  computeLast30DaysView,
  computeCustomMonthView,
  computeDateRangeView,
  isWithinAmountRange,
  computeDayNetTotal,
  reconcileTxRowsWithPending,
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

// ===== v119: rekonsiliasi mutasi lokal vs respons fetch (anti lost-update) =====
const mkTx = (id, jumlah, ket) => ({ id, jenis: "Pengeluaran", kategori: "Makanan", akun: "BCA", tanggal: "2026-09-01", jumlah: String(jumlah), keterangan: ket ?? id, mata_uang: null, kurs: 1, jumlah_idr: String(jumlah) });

test("v119 reconcileTxRowsWithPending: insert belum termuat respons basi -> baris lokal DIPERTAHANKAN, pending tetap", () => {
  const fetched = [mkTx("a", 100), mkTx("b", 200)];
  const baru = mkTx("baru", 300);
  const pending = new Map([["baru", { op: "upsert", row: baru, at: 500 }]]);
  // fetch dimulai SEBELUM insert (100 < 500) -> snapshot basi tak memuat baris
  const { rows, satisfied } = reconcileTxRowsWithPending(fetched, pending, 100);
  assert.equal(rows.length, 3);
  assert.ok(rows.some((r) => r.id === "baru"));
  assert.deepEqual(satisfied, []);
});

test("v119 reconcileTxRowsWithPending: respons basi memuat versi LAMA -> versi lokal (baru) menimpa, pending tetap", () => {
  const lama = mkTx("x", 100, "versi-lama");
  const baru = mkTx("x", 999, "versi-baru");
  const pending = new Map([["x", { op: "upsert", row: baru, at: 500 }]]);
  const { rows, satisfied } = reconcileTxRowsWithPending([mkTx("a", 1), lama], pending, 100);
  const x = rows.find((r) => r.id === "x");
  assert.equal(x.keterangan, "versi-baru");
  assert.equal(x.jumlah, "999");
  assert.deepEqual(satisfied, []); // isi respons != lokal -> pending dipertahankan
});

test("v119 reconcileTxRowsWithPending: fetch PASCA-mutasi menyajikan versi baru -> pending selesai", () => {
  const baru = mkTx("x", 999, "sama");
  const pending = new Map([["x", { op: "upsert", row: baru, at: 500 }]]);
  const { rows, satisfied } = reconcileTxRowsWithPending([mkTx("a", 1), baru], pending, 600);
  assert.equal(rows.length, 2);
  assert.deepEqual(satisfied, ["x"]);
});

test("v119 reconcileTxRowsWithPending: fetch PRA-mutasi (saksi tak valid) -> meski isi sama, pending TETAP", () => {
  const baru = mkTx("x", 999, "sama");
  const pending = new Map([["x", { op: "upsert", row: baru, at: 500 }]]);
  const { satisfied } = reconcileTxRowsWithPending([mkTx("a", 1), baru], pending, 100);
  assert.deepEqual(satisfied, []); // fetch yang dimulai sebelum mutasi tak bisa memuaskan
});

test("v119 reconcileTxRowsWithPending: delete + respons basi masih memuat baris -> dibuang, pending tetap", () => {
  const fetched = [mkTx("a", 1), mkTx("hapus", 2), mkTx("c", 3)];
  const pending = new Map([["hapus", { op: "delete", at: 500 }]]);
  const { rows, satisfied } = reconcileTxRowsWithPending(fetched, pending, 100);
  assert.ok(!rows.some((r) => r.id === "hapus"));
  assert.equal(rows.length, 2);
  assert.deepEqual(satisfied, []);
});

test("v119 reconcileTxRowsWithPending: delete + fetch PASCA-delete tanpa baris -> pending selesai", () => {
  const pending = new Map([["hapus", { op: "delete", at: 500 }]]);
  const { rows, satisfied } = reconcileTxRowsWithPending([mkTx("a", 1)], pending, 600);
  assert.equal(rows.length, 1);
  assert.deepEqual(satisfied, ["hapus"]);
});

test("v119 reconcileTxRowsWithPending: delete + fetch PRA-delete tanpa baris (baris belum pernah ada di snapshot) -> pending TETAP", () => {
  // Skenario probe: fetch segar (pasca-delete) memuaskan pending terlalu cepat, lalu respons
  // basi yang tiba BELAKANGAN menghidupkan baris lagi. Aturan fetchStart mencegah itu: hanya
  // fetch yang MULAI setelah delete yang boleh memuaskan.
  const pending = new Map([["hapus", { op: "delete", at: 500 }]]);
  const { satisfied } = reconcileTxRowsWithPending([mkTx("a", 1)], pending, 100);
  assert.deepEqual(satisfied, []);
});

test("v119 reconcileTxRowsWithPending: tanpa pending -> identik; input null aman", () => {
  const fetched = [mkTx("a", 1)];
  assert.deepEqual(reconcileTxRowsWithPending(fetched, new Map(), 999).rows, fetched);
  assert.deepEqual(reconcileTxRowsWithPending(fetched, null, 999).rows, fetched);
  assert.deepEqual(reconcileTxRowsWithPending(null, new Map([["z", { op: "delete", at: 1 }]]), 999).rows, []);
});

test("v119 reconcileTxRowsWithPending: kombinasi (insert baru + edit + delete) dalam satu respons basi", () => {
  const n = mkTx("new", 50);
  const ed = mkTx("edit", 60, "baru");
  const fetched = [mkTx("edit", 10, "lama"), mkTx("del", 20), mkTx("tetap", 30)];
  const pending = new Map([
    ["new", { op: "upsert", row: n, at: 500 }],
    ["edit", { op: "upsert", row: ed, at: 500 }],
    ["del", { op: "delete", at: 500 }],
  ]);
  const { rows, satisfied } = reconcileTxRowsWithPending(fetched, pending, 100);
  assert.ok(rows.some((r) => r.id === "new"), "insert dipertahankan");
  assert.equal(rows.find((r) => r.id === "edit").keterangan, "baru", "edit menimpa versi lama");
  assert.ok(!rows.some((r) => r.id === "del"), "hapus tetap terhapus");
  assert.ok(rows.some((r) => r.id === "tetap"));
  assert.deepEqual(satisfied, []);
});

test("v119 reconcileTxRowsWithPending: fetch pasca-delete TAPI ada fetch pra-delete masih in-flight -> pending TETAP (anti resurrect)", () => {
  // Kasus nyata probe: refresh (mulai 600, pasca-delete at=500) tak memuat baris, tapi
  // loadData (mulai 100, pra-delete) masih berjalan & respons basinya bisa tiba belakangan.
  const pending = new Map([["hapus", { op: "delete", at: 500 }]]);
  const r = reconcileTxRowsWithPending([mkTx("a", 1)], pending, 600, [100, 600]);
  assert.deepEqual(r.satisfied, []);
  // setelah fetch tua (100) selesai, fetch segar berikutnya boleh memuaskan
  const r2 = reconcileTxRowsWithPending([mkTx("a", 1)], pending, 700, [700]);
  assert.deepEqual(r2.satisfied, ["hapus"]);
});

test("v119 reconcileTxRowsWithPending: upsert content-sama tapi ada fetch lebih tua berjalan -> pending TETAP", () => {
  const baru = mkTx("x", 999, "sama");
  const pending = new Map([["x", { op: "upsert", row: baru, at: 500 }]]);
  const r = reconcileTxRowsWithPending([mkTx("a", 1), baru], pending, 600, [100]);
  assert.deepEqual(r.satisfied, []);
  const r2 = reconcileTxRowsWithPending([mkTx("a", 1), baru], pending, 600, []);
  assert.deepEqual(r2.satisfied, ["x"]);
});

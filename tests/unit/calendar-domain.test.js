import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCalendarMonthSummary,
  buildDailyCashflowMap,
  projectRecurringDueDates,
} from "../../src/domain/calendar.js";

const parseTgl = (tanggalStr) => new Date(String(tanggalStr).split("T")[0] + "T00:00:00");
const txIdrAmount = (t) => Number(t.jumlah_idr != null ? t.jumlah_idr : t.jumlah);

// ===================== computeCalendarMonthSummary =====================

test("computeCalendarMonthSummary: cuma menjumlah transaksi di bulan yang ditampilkan (titik tengah viewStart/viewEnd)", () => {
  const result = computeCalendarMonthSummary([
    { jenis: "Pemasukan", tanggal: "2026-08-05", jumlah: 500_000 },
    { jenis: "Pengeluaran", tanggal: "2026-08-10", jumlah: 100_000 },
    { jenis: "Pemasukan", tanggal: "2026-07-31", jumlah: 999_999 }, // bulan lain, dari baris minggu di grid
    { jenis: "Pengeluaran", tanggal: "2026-09-01", jumlah: 999_999 }, // bulan lain juga
  ], new Date(2026, 6, 27), new Date(2026, 8, 6), { parseTgl, txIdrAmount }); // grid Agustus 2026 (Senin pertama - Minggu terakhir)

  assert.equal(result.totalIn, 500_000);
  assert.equal(result.totalOut, 100_000);
});

test("computeCalendarMonthSummary: Transfer tidak ikut dihitung (bukan Pemasukan/Pengeluaran)", () => {
  const result = computeCalendarMonthSummary([
    { jenis: "Transfer", tanggal: "2026-08-05", jumlah: 200_000 },
  ], new Date(2026, 7, 1), new Date(2026, 7, 31), { parseTgl, txIdrAmount });
  assert.equal(result.totalIn, 0);
  assert.equal(result.totalOut, 0);
});

test("computeCalendarMonthSummary: tidak ada transaksi -> 0 tanpa error", () => {
  const result = computeCalendarMonthSummary([], new Date(2026, 7, 1), new Date(2026, 7, 31), { parseTgl, txIdrAmount });
  assert.deepEqual(result, { totalIn: 0, totalOut: 0 });
});

// ===================== buildDailyCashflowMap =====================

test("buildDailyCashflowMap: mengelompokkan in/out/transfer per tanggal", () => {
  const result = buildDailyCashflowMap([
    { jenis: "Pemasukan", tanggal: "2026-08-05", jumlah: 500_000 },
    { jenis: "Pengeluaran", tanggal: "2026-08-05", jumlah: 100_000 },
    { jenis: "Transfer", tanggal: "2026-08-06", jumlah: 50_000 },
  ], { txIdrAmount });

  assert.deepEqual(result["2026-08-05"], { in: 500_000, out: 100_000, transfer: 0 });
  assert.deepEqual(result["2026-08-06"], { in: 0, out: 0, transfer: 50_000 });
});

test("buildDailyCashflowMap: beberapa transaksi di tanggal sama diakumulasi", () => {
  const result = buildDailyCashflowMap([
    { jenis: "Pengeluaran", tanggal: "2026-08-05", jumlah: 20_000 },
    { jenis: "Pengeluaran", tanggal: "2026-08-05", jumlah: 30_000 },
  ], { txIdrAmount });
  assert.equal(result["2026-08-05"].out, 50_000);
});

test("buildDailyCashflowMap: kunci tanggal diambil dari potongan sebelum 'T' (bukan re-parse Date)", () => {
  const result = buildDailyCashflowMap([
    { jenis: "Pemasukan", tanggal: "2026-08-05T00:00:00.000Z", jumlah: 10_000 },
  ], { txIdrAmount });
  assert.equal(result["2026-08-05"].in, 10_000);
});

test("buildDailyCashflowMap: tidak ada transaksi -> object kosong", () => {
  assert.deepEqual(buildDailyCashflowMap([], { txIdrAmount }), {});
});

// ===================== projectRecurringDueDates =====================

const advanceDueDate = (dateStr, frequency) => {
  const d = new Date(dateStr + "T00:00:00");
  if (frequency === "harian") d.setDate(d.getDate() + 1);
  else if (frequency === "mingguan") d.setDate(d.getDate() + 7);
  else if (frequency === "bulanan") d.setMonth(d.getMonth() + 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

test("projectRecurringDueDates: proyeksi harian sampai untilDateStr, inklusif", () => {
  const result = projectRecurringDueDates(
    { next_due_date: "2026-08-01", end_date: null, frequency: "harian" },
    { untilDateStr: "2026-08-05", advanceDueDate }
  );
  assert.deepEqual(result, ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"]);
});

test("projectRecurringDueDates: dibatasi end_date walau untilDateStr lebih jauh", () => {
  const result = projectRecurringDueDates(
    { next_due_date: "2026-08-01", end_date: "2026-08-03", frequency: "harian" },
    { untilDateStr: "2026-08-10", advanceDueDate }
  );
  assert.deepEqual(result, ["2026-08-01", "2026-08-02", "2026-08-03"]);
});

test("projectRecurringDueDates: dibatasi maxIterations (default 60) supaya tidak meledak di frekuensi harian", () => {
  const result = projectRecurringDueDates(
    { next_due_date: "2020-01-01", end_date: null, frequency: "harian" },
    { untilDateStr: "2030-01-01", advanceDueDate }
  );
  assert.equal(result.length, 60);
});

test("projectRecurringDueDates: maxIterations custom dihormati", () => {
  const result = projectRecurringDueDates(
    { next_due_date: "2026-08-01", end_date: null, frequency: "harian" },
    { untilDateStr: "2026-12-31", advanceDueDate, maxIterations: 3 }
  );
  assert.equal(result.length, 3);
});

test("projectRecurringDueDates: next_due_date sudah melewati untilDateStr -> array kosong", () => {
  const result = projectRecurringDueDates(
    { next_due_date: "2026-09-01", end_date: null, frequency: "harian" },
    { untilDateStr: "2026-08-01", advanceDueDate }
  );
  assert.deepEqual(result, []);
});

test("projectRecurringDueDates: bisa dipakai utk cek 'apakah jatuh tempo PERSIS di tanggal X' via .includes()", () => {
  // Mingguan dari 1 Agustus -> 1, 8, 15, 22, 29 Agustus. 10 Agustus BUKAN salah satunya.
  const dates = projectRecurringDueDates(
    { next_due_date: "2026-08-01", end_date: null, frequency: "mingguan" },
    { untilDateStr: "2026-08-10", advanceDueDate }
  );
  assert.equal(dates.includes("2026-08-08"), true);
  assert.equal(dates.includes("2026-08-10"), false);
});

test("projectRecurringDueDates: next_due_date kosong/null -> array kosong, tidak error", () => {
  assert.deepEqual(
    projectRecurringDueDates({ next_due_date: null, end_date: null, frequency: "harian" }, { untilDateStr: "2026-12-31", advanceDueDate }),
    []
  );
});

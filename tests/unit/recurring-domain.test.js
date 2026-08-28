import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceDueDate, planRecurringCatchup } from "../../src/domain/recurring.js";

// ---------------------------------------------------------------------------
// advanceDueDate()
// ---------------------------------------------------------------------------

test("advanceDueDate: harian menambah 1 hari", () => {
  assert.equal(advanceDueDate("2026-08-24", "harian"), "2026-08-25");
});

test("advanceDueDate: mingguan menambah 7 hari", () => {
  assert.equal(advanceDueDate("2026-08-24", "mingguan"), "2026-08-31");
});

test("advanceDueDate: bulanan kasus normal", () => {
  assert.equal(advanceDueDate("2026-01-15", "bulanan"), "2026-02-15");
});

test("advanceDueDate: bulanan dari 31 Jan jatuh ke akhir Feb (bukan meluber ke Maret)", () => {
  assert.equal(advanceDueDate("2026-01-31", "bulanan"), "2026-02-28");
});

test("advanceDueDate: bulanan dari 31 Mar ke 30 Apr (April cuma 30 hari)", () => {
  assert.equal(advanceDueDate("2026-03-31", "bulanan"), "2026-04-30");
});

test("advanceDueDate: tahunan kasus normal", () => {
  assert.equal(advanceDueDate("2025-08-24", "tahunan"), "2026-08-24");
});

test("advanceDueDate: tahunan dari 29 Feb (kabisat) ke tahun non-kabisat jatuh ke 28 Feb", () => {
  assert.equal(advanceDueDate("2024-02-29", "tahunan"), "2025-02-28");
});

// ---------------------------------------------------------------------------
// planRecurringCatchup()
// ---------------------------------------------------------------------------

test("planRecurringCatchup: belum jatuh tempo -> dueDates kosong, next_due_date tidak berubah", () => {
  const plan = planRecurringCatchup({
    nextDueDate: "2026-09-01",
    endDate: null,
    frequency: "bulanan",
    todayStr: "2026-08-24",
  });
  assert.deepEqual(plan.dueDates, []);
  assert.equal(plan.nextDueDateAfter, "2026-09-01");
  assert.equal(plan.shouldDeactivate, false);
});

test("planRecurringCatchup: tepat jatuh tempo hari ini -> 1 periode diproses", () => {
  const plan = planRecurringCatchup({
    nextDueDate: "2026-08-24",
    endDate: null,
    frequency: "bulanan",
    todayStr: "2026-08-24",
  });
  assert.deepEqual(plan.dueDates, ["2026-08-24"]);
  assert.equal(plan.nextDueDateAfter, "2026-09-24");
});

test("planRecurringCatchup: mengejar ketinggalan beberapa periode sekaligus (harian)", () => {
  const plan = planRecurringCatchup({
    nextDueDate: "2026-08-20",
    endDate: null,
    frequency: "harian",
    todayStr: "2026-08-24",
  });
  assert.deepEqual(plan.dueDates, ["2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24"]);
  assert.equal(plan.nextDueDateAfter, "2026-08-25");
  assert.equal(plan.shouldDeactivate, false);
});

test("planRecurringCatchup: end_date memotong catch-up & menandai shouldDeactivate", () => {
  const plan = planRecurringCatchup({
    nextDueDate: "2026-08-20",
    endDate: "2026-08-22",
    frequency: "harian",
    todayStr: "2026-08-24",
  });
  // 23 & 24 Agustus sudah lewat end_date (22 Agustus), jadi tidak ikut diproses.
  assert.deepEqual(plan.dueDates, ["2026-08-20", "2026-08-21", "2026-08-22"]);
  assert.equal(plan.shouldDeactivate, true);
});

test("planRecurringCatchup: end_date persis sama dengan salah satu tanggal jatuh tempo -> tetap diproses, lalu nonaktif", () => {
  const plan = planRecurringCatchup({
    nextDueDate: "2026-08-22",
    endDate: "2026-08-22",
    frequency: "harian",
    todayStr: "2026-08-24",
  });
  assert.deepEqual(plan.dueDates, ["2026-08-22"]);
  assert.equal(plan.shouldDeactivate, true);
});

test("planRecurringCatchup: menghormati batas maxCatchup supaya tidak meledak", () => {
  const plan = planRecurringCatchup({
    nextDueDate: "2020-01-01", // sudah bertahun-tahun ketinggalan
    endDate: null,
    frequency: "harian",
    todayStr: "2026-08-24",
    maxCatchup: 5,
  });
  assert.equal(plan.dueDates.length, 5);
  assert.deepEqual(plan.dueDates, ["2020-01-01", "2020-01-02", "2020-01-03", "2020-01-04", "2020-01-05"]);
  // Masih ketinggalan jauh -- next_due_date dimajukan sebagian saja, akan lanjut dikejar sesi berikutnya.
  assert.equal(plan.nextDueDateAfter, "2020-01-06");
  assert.equal(plan.shouldDeactivate, false);
});

test("planRecurringCatchup: tanpa end_date tidak pernah shouldDeactivate walau catch-up sangat panjang", () => {
  const plan = planRecurringCatchup({
    nextDueDate: "2026-01-01",
    endDate: null,
    frequency: "bulanan",
    todayStr: "2026-08-24",
  });
  assert.deepEqual(plan.dueDates, ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"]);
  assert.equal(plan.shouldDeactivate, false);
});

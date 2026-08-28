import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGoalProgress, computeDebtProgress } from "../../src/domain/goals-debts.js";

// ===================== computeGoalProgress =====================

test("computeGoalProgress: pct dibulatkan & sisa = target - terkumpul", () => {
  const result = computeGoalProgress({ target: 1_000_000, terkumpul: 333_000 }, new Date(2026, 7, 15));
  assert.equal(result.pct, 33); // Math.round(33.3)
  assert.equal(result.sisa, 667_000);
  assert.equal(result.isDone, false);
});

test("computeGoalProgress: pct dibatasi maksimal 100 walau terkumpul melebihi target", () => {
  const result = computeGoalProgress({ target: 100_000, terkumpul: 150_000 }, new Date(2026, 7, 15));
  assert.equal(result.pct, 100);
  assert.equal(result.sisa, 0); // Math.max(0, ...) -- tidak minus
  assert.equal(result.isDone, true);
});

test("computeGoalProgress: target 0/kosong tidak error, pct 0 dan isDone false", () => {
  const result = computeGoalProgress({ target: 0, terkumpul: 0 }, new Date(2026, 7, 15));
  assert.equal(result.pct, 0);
  assert.equal(result.isDone, false);
});

test("computeGoalProgress: tanpa deadline -> daysUntilDeadline null", () => {
  const result = computeGoalProgress({ target: 100, terkumpul: 50 }, new Date(2026, 7, 15));
  assert.equal(result.daysUntilDeadline, null);
});

test("computeGoalProgress: deadline di masa depan -> daysUntilDeadline positif", () => {
  const result = computeGoalProgress({ target: 100, terkumpul: 50, deadline: "2026-08-20" }, new Date(2026, 7, 15));
  assert.equal(result.daysUntilDeadline, 5);
});

test("computeGoalProgress: deadline hari ini -> daysUntilDeadline 0", () => {
  const result = computeGoalProgress({ target: 100, terkumpul: 50, deadline: "2026-08-15" }, new Date(2026, 7, 15));
  assert.equal(result.daysUntilDeadline, 0);
});

test("computeGoalProgress: deadline sudah lewat -> daysUntilDeadline negatif", () => {
  const result = computeGoalProgress({ target: 100, terkumpul: 50, deadline: "2026-08-10" }, new Date(2026, 7, 15));
  assert.equal(result.daysUntilDeadline, -5);
});

test("computeGoalProgress: waktu 'now' di jam berapapun di hari itu tidak mengubah hitungan hari (dibulatkan ke tengah malam)", () => {
  const pagi = computeGoalProgress({ target: 100, terkumpul: 50, deadline: "2026-08-20" }, new Date(2026, 7, 15, 1, 0));
  const malam = computeGoalProgress({ target: 100, terkumpul: 50, deadline: "2026-08-20" }, new Date(2026, 7, 15, 23, 59));
  assert.equal(pagi.daysUntilDeadline, 5);
  assert.equal(malam.daysUntilDeadline, 5);
});

// ===================== computeDebtProgress =====================

test("computeDebtProgress: paidPct dari (total-sisa)/total, dibulatkan", () => {
  const result = computeDebtProgress({ totalUtang: 1_000_000, sisaUtang: 250_000 });
  assert.equal(result.paidPct, 75);
  assert.equal(result.sisa, 250_000);
  assert.equal(result.isLunas, false);
});

test("computeDebtProgress: sisaUtang <= 0 dianggap lunas, paidPct 100 kalau totalUtang > 0", () => {
  const result = computeDebtProgress({ totalUtang: 1_000_000, sisaUtang: 0 });
  assert.equal(result.isLunas, true);
  assert.equal(result.paidPct, 100);
});

test("computeDebtProgress: sisaUtang negatif (anomali data) tidak bikin sisa negatif", () => {
  const result = computeDebtProgress({ totalUtang: 1_000_000, sisaUtang: -50_000 });
  assert.equal(result.sisa, 0);
  assert.equal(result.isLunas, true);
});

test("computeDebtProgress: totalUtang 0 tidak error, paidPct 0", () => {
  const result = computeDebtProgress({ totalUtang: 0, sisaUtang: 0 });
  assert.equal(result.paidPct, 0);
});

test("computeDebtProgress: bulanLagi dihitung dari sisa/cicilanPerBulan (dibulatkan ke atas)", () => {
  const result = computeDebtProgress({ totalUtang: 1_000_000, sisaUtang: 250_000, cicilanPerBulan: 100_000 });
  assert.equal(result.bulanLagi, 3); // Math.ceil(2.5)
});

test("computeDebtProgress: bulanLagi null kalau sudah lunas (walau cicilanPerBulan diisi)", () => {
  const result = computeDebtProgress({ totalUtang: 1_000_000, sisaUtang: 0, cicilanPerBulan: 100_000 });
  assert.equal(result.bulanLagi, null);
});

test("computeDebtProgress: bulanLagi null kalau cicilanPerBulan tidak diisi/0", () => {
  const result = computeDebtProgress({ totalUtang: 1_000_000, sisaUtang: 250_000 });
  assert.equal(result.bulanLagi, null);
});

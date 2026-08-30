import { test } from "node:test";
import assert from "node:assert/strict";
import { isChartNarrow, selectSparseLabelIndices } from "../../src/domain/chart-labels.js";

// ===================== isChartNarrow =====================

test("isChartNarrow: px per bucket di bawah ambang -> true", () => {
  assert.equal(isChartNarrow(300, 10, 60), true); // 30px/bucket < 60
});

test("isChartNarrow: px per bucket di atas ambang -> false", () => {
  assert.equal(isChartNarrow(1200, 10, 60), false); // 120px/bucket >= 60
});

test("isChartNarrow: pas di ambang (60px persis) -> false (bukan '<=')", () => {
  assert.equal(isChartNarrow(600, 10, 60), false);
});

test("isChartNarrow: bucketCount 0 -> false (tidak ada apa-apa yang bisa numpuk)", () => {
  assert.equal(isChartNarrow(50, 0, 60), false);
});

test("isChartNarrow: ambang default 60 kalau tidak dikasih eksplisit", () => {
  assert.equal(isChartNarrow(300, 10), true);
  assert.equal(isChartNarrow(1200, 10), false);
});

test("isChartNarrow: window LEBAR tapi batang BANYAK sekali -> tetap true (ini bug yg diperbaiki)", () => {
  // 1200px (window lebar) dibagi 40 batang (mis. transaksi 40 hari) = 30px/batang -> sempit,
  // walau window.innerWidth-nya sendiri jauh di atas 640.
  assert.equal(isChartNarrow(1200, 40, 60), true);
});

// ===================== selectSparseLabelIndices =====================

test("selectSparseLabelIndices: memilih dari nilai absolut TERBESAR dulu", () => {
  const magnitudes = [10, 100, 5, 50, 1];
  const result = selectSparseLabelIndices(magnitudes, 2);
  assert.equal(result.has(1), true); // 100 -- terbesar
  assert.equal(result.size, 2);
});

test("selectSparseLabelIndices: nilai NEGATIF dibandingkan berdasarkan nilai absolutnya", () => {
  const magnitudes = [5, -100, 10];
  const result = selectSparseLabelIndices(magnitudes, 1);
  assert.deepEqual([...result], [1]); // -100 -> abs 100, paling signifikan
});

test("selectSparseLabelIndices: nilai 0 tidak pernah dipilih", () => {
  const magnitudes = [0, 0, 0, 5];
  const result = selectSparseLabelIndices(magnitudes, 5);
  assert.deepEqual([...result], [3]);
});

test("selectSparseLabelIndices: menghormati jarak minimal antar indeks terpilih (tidak numpuk)", () => {
  // Semua nilai signifikan & berdekatan -- gap minimal HARUS mencegah 2 indeks bersebelahan
  // sama-sama kepilih walau keduanya sama-sama besar.
  const magnitudes = [100, 99, 98, 97, 96, 1, 1, 1, 1, 1]; // len=10, maxLabelCount=3 -> minGap=max(2, floor(10/4))=2
  const result = selectSparseLabelIndices(magnitudes, 3);
  const chosen = [...result].sort((a, b) => a - b);
  for (let i = 1; i < chosen.length; i++) {
    assert.ok(chosen[i] - chosen[i - 1] >= 2, `jarak ${chosen[i - 1]}->${chosen[i]} harus >= 2`);
  }
});

test("selectSparseLabelIndices: tidak pernah melebihi maxLabelCount", () => {
  const magnitudes = Array.from({ length: 50 }, (_, i) => i + 1); // semua unik & signifikan
  const result = selectSparseLabelIndices(magnitudes, 4);
  assert.ok(result.size <= 4);
});

test("selectSparseLabelIndices: semua 0 -> hasil kosong", () => {
  const result = selectSparseLabelIndices([0, 0, 0], 5);
  assert.equal(result.size, 0);
});

test("selectSparseLabelIndices: dipakai utk chart 2-dataset -> pemanggil menjumlah abs(A)+abs(B) dulu", () => {
  const cashIn = [0, 500, 0, 0, 0, 0];
  const cashOut = [0, 0, 0, 0, 300, 0];
  const magnitudes = cashIn.map((v, i) => Math.abs(v) + Math.abs(cashOut[i]));
  const result = selectSparseLabelIndices(magnitudes, 4);
  assert.equal(result.has(1), true); // 500
  assert.equal(result.has(4), true); // 300 -- cukup jauh dari indeks 1, tidak kena batasan jarak minimal
  assert.equal(result.has(0), false); // 0 -- tidak signifikan
});

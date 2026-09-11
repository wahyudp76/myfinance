import { test } from "node:test";
import assert from "node:assert/strict";
import { isChartNarrow, selectSparseLabelIndices, selectSparseLabelCells } from "../../src/domain/chart-labels.js";

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

// ===================== selectSparseLabelCells (v120) =====================
// Chart 2-dataset (Masuk & Keluar): per bucket terpilih HANYA dataset dominan
// yang dikasih angka -> maksimal `maxLabelCount` angka, bukan 2x lipatnya.

test("selectSparseLabelCells: per bucket terpilih, hanya dataset DOMINAN (abs terbesar) yang masuk", () => {
  // magnitudes = [150, 250]; len 2 -> minIndexGap = max(2, floor(2/5)) = 2 ->
  // hanya index 1 (250) yang terpilih. Dominan index 1: |200| > |50| -> dataset 1.
  const cells = selectSparseLabelCells([[100, 50], [50, 200]], 4);
  assert.equal(cells.size, 1);
  assert.equal(cells.get(1), 1);
});

test("selectSparseLabelCells: bucket yang TIDAK terpilih tidak muncul di Map", () => {
  const cashIn = [0, 500, 0, 0, 0, 0];
  const cashOut = [0, 0, 0, 0, 300, 0];
  const cells = selectSparseLabelCells([cashIn, cashOut], 4);
  assert.equal(cells.get(1), 0); // 500 dari dataset Masuk
  assert.equal(cells.get(4), 1); // 300 dari dataset Keluar
  assert.equal(cells.has(0), false); // bucket 0 tidak signifikan
  assert.equal(cells.size, 2);
});

test("selectSparseLabelCells: hasil maksimal maxLabelCount angka (bukan 2x)", () => {
  const vals = Array.from({ length: 31 }, (_, i) => (i % 2 === 0 ? 100000 + i * 1000 : 0));
  const cashIn = vals.slice();
  const cashOut = vals.map((v, i) => (i % 3 === 0 ? v + 1 : 0)); // dominan selalu Keluar di i%3==0
  const cells = selectSparseLabelCells([cashIn, cashOut], 4);
  assert.ok(cells.size <= 4, `size ${cells.size} harus <= 4`);
  const idxs = [...cells.keys()].sort((a, b) => a - b);
  for (let k = 1; k < idxs.length; k++) assert.ok(idxs[k] - idxs[k - 1] >= 2, "jarak minimal antar bucket terpilih");
});

test("selectSparseLabelCells: TIE nilai sama -> dataset indeks terkecil menang (deterministik)", () => {
  const cells = selectSparseLabelCells([[0, 700], [0, 700]], 4);
  assert.equal(cells.get(1), 0);
});

test("selectSparseLabelCells: nilai null/undefined dihitung 0", () => {
  const cells = selectSparseLabelCells([[null, 900], [undefined, 100]], 4);
  assert.equal(cells.get(1), 0);
});

test("selectSparseLabelCells: semua 0 -> Map kosong", () => {
  assert.equal(selectSparseLabelCells([[0, 0], [0, 0]], 4).size, 0);
});

test("selectSparseLabelCells: input bukan array / kosong -> Map kosong (guard)", () => {
  assert.equal(selectSparseLabelCells(null, 4).size, 0);
  assert.equal(selectSparseLabelCells([], 4).size, 0);
  assert.equal(selectSparseLabelCells([null, "x"], 4).size, 0);
});

test("selectSparseLabelCells: dataset 3+ tetap bekerja (dominan lintas dataset)", () => {
  // magnitudes index 5 paling besar; dominan = dataset 2 (900).
  const s = Array.from({ length: 10 }, () => 0);
  const a = s.slice(); a[5] = 100;
  const b = s.slice(); b[5] = 400;
  const c = s.slice(); c[5] = 900;
  const cells = selectSparseLabelCells([a, b, c], 4);
  assert.equal(cells.get(5), 2);
});

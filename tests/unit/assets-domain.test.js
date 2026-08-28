import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeAssets, computeNetWorth } from "../../src/domain/assets.js";

test("summarizeAssets: menghitung returnRp/returnPct per aset dengan benar", () => {
  const { sortedAssets } = summarizeAssets([
    { nama: "Saham A", kategori: "Saham", modal: 1_000_000, nilai: 1_200_000 },
    { nama: "Reksadana B", kategori: "Reksadana", modal: 500_000, nilai: 450_000 },
  ]);

  const saham = sortedAssets.find((a) => a.nama === "Saham A");
  assert.equal(saham.returnRp, 200_000);
  assert.equal(saham.returnPct, 20);
  assert.equal(saham.isUp, true);

  const reksadana = sortedAssets.find((a) => a.nama === "Reksadana B");
  assert.equal(reksadana.returnRp, -50_000);
  assert.equal(reksadana.returnPct, -10);
  assert.equal(reksadana.isUp, false);
});

test("summarizeAssets: sortedAssets diurutkan nilai (nilai SEKARANG) turun, bukan berdasarkan modal atau return", () => {
  const { sortedAssets } = summarizeAssets([
    { nama: "Kecil", kategori: "Saham", modal: 100, nilai: 100 },
    { nama: "Besar", kategori: "Saham", modal: 100, nilai: 900 },
    { nama: "Sedang", kategori: "Saham", modal: 100, nilai: 500 },
  ]);
  assert.deepEqual(sortedAssets.map((a) => a.nama), ["Besar", "Sedang", "Kecil"]);
});

test("summarizeAssets: totalNilai/totalModal/catMap terakumulasi benar lintas kategori", () => {
  const { totalNilai, totalModal, catMap } = summarizeAssets([
    { nama: "A", kategori: "Saham", modal: 1_000_000, nilai: 1_200_000 },
    { nama: "B", kategori: "Saham", modal: 500_000, nilai: 600_000 },
    { nama: "C", kategori: "Emas", modal: 2_000_000, nilai: 2_100_000 },
  ]);
  assert.equal(totalNilai, 3_900_000);
  assert.equal(totalModal, 3_500_000);
  assert.deepEqual(catMap, { Saham: 1_800_000, Emas: 2_100_000 });
});

test("summarizeAssets: modal 0 tidak bikin returnPct per-aset Infinity/NaN (fallback ke 0)", () => {
  const { sortedAssets } = summarizeAssets([
    { nama: "Hadiah", kategori: "Lainnya", modal: 0, nilai: 500_000 },
  ]);
  assert.equal(sortedAssets[0].returnPct, 0);
  assert.equal(sortedAssets[0].returnRp, 500_000);
});

test("summarizeAssets: totalReturnPct 0 kalau totalModal 0 (bukan NaN/Infinity)", () => {
  const { totalReturnPct } = summarizeAssets([
    { nama: "Hadiah", kategori: "Lainnya", modal: 0, nilai: 500_000 },
  ]);
  assert.equal(totalReturnPct, 0);
});

test("summarizeAssets: best/worst null kalau aset bermodal>0 kurang dari 2", () => {
  const oneAsset = summarizeAssets([{ nama: "A", kategori: "Saham", modal: 100, nilai: 200 }]);
  assert.equal(oneAsset.best, null);
  assert.equal(oneAsset.worst, null);

  const zeroAsset = summarizeAssets([]);
  assert.equal(zeroAsset.best, null);
  assert.equal(zeroAsset.worst, null);
});

test("summarizeAssets: best/worst mengabaikan aset bermodal 0, dan pilih ekstrem pct tertinggi/terendah", () => {
  const { best, worst } = summarizeAssets([
    { nama: "Untung Besar", kategori: "Saham", modal: 100, nilai: 200 }, // +100%
    { nama: "Rugi Besar", kategori: "Saham", modal: 100, nilai: 50 },   // -50%
    { nama: "Netral", kategori: "Saham", modal: 100, nilai: 110 },       // +10%
    { nama: "Modal Nol Diabaikan", kategori: "Saham", modal: 0, nilai: 999_999_999 },
  ]);
  assert.equal(best.nama, "Untung Besar");
  assert.equal(worst.nama, "Rugi Besar");
});

test("computeNetWorth: netWorth = totalNilai - total sisa utang", () => {
  const { totalUtangBersih, netWorth } = computeNetWorth(10_000_000, [
    { sisaUtang: 2_000_000 },
    { sisaUtang: 1_000_000 },
  ]);
  assert.equal(totalUtangBersih, 3_000_000);
  assert.equal(netWorth, 7_000_000);
});

test("computeNetWorth: sisaUtang negatif dianggap 0, tidak menambah kekayaan bersih", () => {
  const { totalUtangBersih, netWorth } = computeNetWorth(5_000_000, [
    { sisaUtang: -500_000 }, // lunas lebih / anomali data -- tidak boleh menambah netWorth
  ]);
  assert.equal(totalUtangBersih, 0);
  assert.equal(netWorth, 5_000_000);
});

test("computeNetWorth: debts null/undefined/kosong tidak error, netWorth = totalNilai", () => {
  assert.deepEqual(computeNetWorth(1_000_000, null), { totalUtangBersih: 0, netWorth: 1_000_000 });
  assert.deepEqual(computeNetWorth(1_000_000, undefined), { totalUtangBersih: 0, netWorth: 1_000_000 });
  assert.deepEqual(computeNetWorth(1_000_000, []), { totalUtangBersih: 0, netWorth: 1_000_000 });
});

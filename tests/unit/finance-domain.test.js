import { test } from "node:test";
import assert from "node:assert/strict";
import { accountImpact, convertCurrency, isCashflowTransaction, roundMoney } from "../../src/domain/finance.js";

// Port dari src/domain/finance.test.ts (gaya Jest/Vitest -- describe/it/expect) yang tidak
// pernah bisa benar-benar jalan karena repo ini tidak punya jest/vitest ter-install, cuma
// node:test bawaan Node.js. File .ts itu sudah dihapus; kasus-kasus di bawah ini isinya sama.

test("convertCurrency: USD ke IDR pakai rate IDR-per-unit", () => {
  const result = convertCurrency({
    sourceAmount: 100,
    sourceRate: { idrPerUnit: 16000 },
    destinationRate: { idrPerUnit: 1 },
  });
  assert.equal(result.sourceAmountIdr, 1_600_000);
  assert.equal(result.destinationAmount, 1_600_000);
  assert.equal(result.destinationAmountIdr, 1_600_000);
});

test("convertCurrency: IDR ke USD", () => {
  const result = convertCurrency({
    sourceAmount: 1_600_000,
    sourceRate: { idrPerUnit: 1 },
    destinationRate: { idrPerUnit: 16000 },
  });
  assert.equal(result.destinationAmount, 100);
  assert.equal(result.destinationAmountIdr, 1_600_000);
});

test("convertCurrency: menolak jumlah atau rate yang tidak positif", () => {
  assert.throws(() => convertCurrency({
    sourceAmount: 0,
    sourceRate: { idrPerUnit: 16000 },
    destinationRate: { idrPerUnit: 1 },
  }));
});

test("isCashflowTransaction: Transfer tidak dihitung sebagai pemasukan/pengeluaran", () => {
  assert.equal(isCashflowTransaction("Transfer"), false);
  assert.equal(isCashflowTransaction("Pemasukan"), true);
  assert.equal(isCashflowTransaction("Pengeluaran"), true);
});

test("accountImpact: dampak ke saldo akun untuk transaksi biasa", () => {
  assert.equal(accountImpact("Pemasukan", 100), 100);
  assert.equal(accountImpact("Pengeluaran", 100), -100);
});

test("roundMoney: membulatkan sisa floating-point di batas UI/domain", () => {
  assert.equal(roundMoney(100.005), 100.01);
  assert.equal(roundMoney(12.3456, 2), 12.35);
});

// v123: dua cacat roundMoney diperbaiki. Keduanya HARUS punya kasus uji, karena
// fungsi ini belum dipakai runtime -- tanpa test, regresi tidak akan terlihat
// sampai Phase 4 mulai memanggilnya dan uang salah ikut ter-commit.
test("roundMoney: simetris untuk nilai negatif (half away from zero)", () => {
  // Sebelumnya: Math.round() JS membulatkan .5 ke +Infinity, jadi sisi negatif
  // kehilangan satu satuan sementara sisi positif mendapatkannya. Akibatnya
  // sebuah pengeluaran dan pembalikannya tidak saling meniadakan.
  assert.equal(roundMoney(2.5, 0), 3);
  assert.equal(roundMoney(-2.5, 0), -3, "dulu -2: pengeluaran & pembalikannya tidak nol");
  assert.equal(roundMoney(1.005, 2), 1.01);
  assert.equal(roundMoney(-1.005, 2), -1.01, "dulu -1: asimetris terhadap sisi positif");
  assert.equal(roundMoney(-12.3456, 2), -12.35);

  // Jumlah sepasang nilai berlawanan tanda harus persis nol (bukan 0.01).
  assert.equal(roundMoney(1.005, 2) + roundMoney(-1.005, 2), 0);
});

test("roundMoney: -0 tidak bocor, dan desimal tidak valid ditolak eksplisit", () => {
  assert.equal(Object.is(roundMoney(-0.001, 2), -0), false, "-0 harus dinormalkan jadi 0");
  assert.equal(roundMoney(-0.001, 2), 0);

  // Sebelumnya ketiganya mengembalikan angka SALAH tanpa keluhan:
  // NaN (sumber "Rp NaN" di UI), 1.4964467362266598, dan 0.
  for (const decimals of [NaN, 1.7, -1, Infinity, "2"]) {
    assert.throws(() => roundMoney(1.5, decimals), /desimal uang harus bilangan bulat/,
      `decimals=${String(decimals)} seharusnya ditolak`);
  }
  assert.throws(() => roundMoney(NaN), /Nilai uang tidak valid/);
  assert.throws(() => roundMoney(Infinity), /Nilai uang tidak valid/);

  // Batas atas: di atas 15 desimal, 10**decimals sendiri sudah kehilangan
  // presisi integer sehingga hasilnya tidak bisa dipercaya.
  assert.equal(roundMoney(1.5, 15), 1.5);
  assert.throws(() => roundMoney(1.5, 16), /desimal uang harus bilangan bulat/);
});

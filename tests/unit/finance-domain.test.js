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

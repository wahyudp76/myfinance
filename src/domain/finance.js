/**
 * Browser-compatible financial domain primitives.
 * No DOM, Supabase, localStorage or network access.
 */

function assertFinitePositive(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} harus berupa angka positif.`);
  }
}

export function convertCurrency({ sourceAmount, sourceRate, destinationRate }) {
  assertFinitePositive(sourceAmount, "sourceAmount");
  assertFinitePositive(sourceRate.idrPerUnit, "sourceRate.idrPerUnit");
  assertFinitePositive(destinationRate.idrPerUnit, "destinationRate.idrPerUnit");

  const sourceAmountIdr = sourceAmount * sourceRate.idrPerUnit;
  const destinationAmountIdr = sourceAmountIdr;
  const destinationAmount = destinationAmountIdr / destinationRate.idrPerUnit;

  return {
    sourceAmount,
    destinationAmount,
    sourceAmountIdr,
    destinationAmountIdr,
  };
}

export function isCashflowTransaction(kind) {
  return kind === "Pemasukan" || kind === "Pengeluaran";
}

export function accountImpact(kind, amount) {
  assertFinitePositive(amount, "amount");
  if (kind !== "Pemasukan" && kind !== "Pengeluaran") {
    throw new Error("Jenis transaksi tidak valid untuk accountImpact.");
  }
  return kind === "Pemasukan" ? amount : -amount;
}

export function roundMoney(value, decimals = 2) {
  if (!Number.isFinite(value)) throw new Error("Nilai uang tidak valid.");
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

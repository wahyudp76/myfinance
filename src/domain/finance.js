/**
 * MyFinance financial-domain primitives.
 *
 * Pure functions only: no DOM, Supabase, localStorage or network access.
 * Keeping these rules isolated makes the financial engine testable before the
 * monolithic UI is migrated to the Supabase-native service layer.
 */

function assertFinitePositive(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} harus berupa angka positif.`);
  }
}

/**
 * Convert a source-currency amount into a destination currency.
 *
 * Rates are deliberately defined as IDR per one unit of currency, so:
 * destination = source × sourceRate / destinationRate.
 */
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

/** Transfers never contribute to income/expense reporting. */
export function isCashflowTransaction(kind) {
  return kind === "Pemasukan" || kind === "Pengeluaran";
}

/** Signed native-account impact for ordinary income/expense transactions. */
export function accountImpact(kind, amount) {
  assertFinitePositive(amount, "amount");
  if (kind !== "Pemasukan" && kind !== "Pengeluaran") {
    throw new Error("Jenis transaksi tidak valid untuk accountImpact.");
  }
  return kind === "Pemasukan" ? amount : -amount;
}

/**
 * Avoid floating-point residue for values displayed/stored as money.
 * This does not replace database NUMERIC precision; it is only a UI/domain
 * boundary helper for normal currency amounts.
 */
export function roundMoney(value, decimals = 2) {
  if (!Number.isFinite(value)) throw new Error("Nilai uang tidak valid.");
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

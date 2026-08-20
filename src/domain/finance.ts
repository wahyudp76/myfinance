/**
 * MyFinance financial-domain primitives.
 *
 * Pure functions only: no DOM, Supabase, localStorage or network access.
 * Keeping these rules isolated makes the financial engine testable before the
 * monolithic UI is migrated to the Supabase-native service layer.
 */

export type TransactionKind = "Pemasukan" | "Pengeluaran" | "Transfer";

export interface CurrencyRate {
  /** IDR value of one unit of this currency. */
  idrPerUnit: number;
}

export interface CrossCurrencyTransfer {
  sourceAmount: number;
  sourceRate: CurrencyRate;
  destinationRate: CurrencyRate;
}

export interface TransferResult {
  sourceAmount: number;
  destinationAmount: number;
  sourceAmountIdr: number;
  destinationAmountIdr: number;
}

function assertFinitePositive(value: number, name: string): void {
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
export function convertCurrency({
  sourceAmount,
  sourceRate,
  destinationRate,
}: CrossCurrencyTransfer): TransferResult {
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
export function isCashflowTransaction(kind: TransactionKind): boolean {
  return kind === "Pemasukan" || kind === "Pengeluaran";
}

/** Signed native-account impact for ordinary income/expense transactions. */
export function accountImpact(kind: Exclude<TransactionKind, "Transfer">, amount: number): number {
  assertFinitePositive(amount, "amount");
  return kind === "Pemasukan" ? amount : -amount;
}

/**
 * Avoid floating-point residue for values displayed/stored as money.
 * This does not replace database NUMERIC precision; it is only a UI/domain
 * boundary helper for normal currency amounts.
 */
export function roundMoney(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) throw new Error("Nilai uang tidak valid.");
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

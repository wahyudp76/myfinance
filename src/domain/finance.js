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
 *
 * v123 (2026-09-12) — dua cacat lama diperbaiki:
 *
 *  1. PEMBULATAN ASIMETRIS. `Math.round()` JavaScript membulatkan .5 ke arah
 *     +Infinity, jadi `roundMoney(2.5, 0)` = 3 tetapi `roundMoney(-2.5, 0)` = -2
 *     (bukan -3), dan `roundMoney(-1.005, 2)` = -1 sementara sisi positifnya
 *     1.01. Untuk uang itu berarti sebuah pengeluaran dan pembalikannya TIDAK
 *     saling meniadakan — menyisakan selisih satu satuan terkecil yang
 *     terakumulasi di laporan. Kini dibulatkan half-away-from-zero (simetris):
 *     bulatkan nilai absolut, lalu kembalikan tandanya.
 *  2. `decimals` TIDAK tervalidasi, padahal hasilnya langsung jadi uang.
 *     `roundMoney(1.5, NaN)` dulu mengembalikan NaN (sumber "Rp NaN" di UI),
 *     `roundMoney(1.5, 1.7)` mengembalikan 1.4964467362266598, dan
 *     `roundMoney(1.5, -1)` mengembalikan 0. Ketiganya kini melempar error
 *     eksplisit — gagal keras lebih baik daripada uang salah yang kelihatan sah.
 *
 * Fungsi ini saat ini belum dipakai runtime (hanya diekspor + diuji); ia adalah
 * API batas UI/domain untuk migrasi Phase 4, jadi kedua cacat itu diperbaiki
 * SEBELUM ada pemanggil yang mewarisinya.
 */
export function roundMoney(value, decimals = 2) {
  if (!Number.isFinite(value)) throw new Error("Nilai uang tidak valid.");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 15) {
    throw new Error("Jumlah desimal uang harus bilangan bulat 0-15.");
  }
  const factor = 10 ** decimals;
  // Number.EPSILON menyerap sisa floating-point di bawah batas (mis. 100.005
  // yang tersimpan sedikit lebih kecil daripada nilai desimalnya).
  const magnitude = Math.round((Math.abs(value) + Number.EPSILON) * factor) / factor;
  const signed = value < 0 ? -magnitude : magnitude;
  // Hindari -0 bocor ke UI (Object.is(-0, 0) false; -0 tampil sebagai "-0").
  return signed === 0 ? 0 : signed;
}

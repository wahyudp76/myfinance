/**
 * src/domain/account-currency.js — Resolusi mata uang default akun (murni).
 *
 * PILOT MIGRASI MONOLIT → MODUL (lanjutan setelah src/domain/bank-icons.js).
 * `getAccountCurrency(akun)` sebelumnya HANYA hidup di monolit app.src.js
 * (global, tanpa unit test), padahal merupakan lookup murni:
 *   (appSettings.account_currencies && appSettings.account_currencies[akun]) || 'IDR'
 * Satu-satunya bagian stateful adalah sumber datanya (`appSettings.account_currencies`,
 * cache user di monolit). Di sini fungsinya di-pure-kan — menerima PETA mata uang sbg
 * parameter DI — sehingga ter-tes unit & deterministik, sementara kepemilikan state
 * tetap di monolit (yang meneruskan `appSettings.account_currencies`).
 *
 * KONTRAK (jangan diubah tanpa mengubah test):
 * - resolveAccountCurrency(currencies, akun) : return currencies[akun] bila ada,
 *   else 'IDR'. `currencies` boleh null/undefined/object kosong.
 */

/** Resolusi mata uang akun: prefer peta `currencies[akun]`, fallback 'IDR'. */
export function resolveAccountCurrency(currencies, akun) {
  return (currencies && currencies[akun]) || "IDR";
}

/** Objek DI (default-injection) yang dipakai monolit untuk meng-adopt ke modul ter-tes. */
export function accountCurrencyCtx() {
  return { resolveAccountCurrency };
}

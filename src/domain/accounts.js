/**
 * MyFinance per-account domain logic.
 *
 * Pure functions only: no DOM, Supabase, localStorage or network access.
 * Extracted from openAccountDetail() dan buildAccountSeries() di index.html
 * (lanjutan Phase 4 -- "Break the monolithic client into modules by
 * domain", lihat docs/architecture-modernization-plan.md). Perilaku
 * dipertahankan 100% sama seperti kode lama -- ini pemindahan, bukan
 * penulisan ulang.
 *
 * transferTargetAmount/parseTgl SENGAJA disuntik lewat parameter, bukan
 * diduplikasi di sini -- supaya index.html tetap satu-satunya sumber
 * kebenaran untuk fungsi-fungsi itu.
 */

/**
 * Filter transaksi milik 1 akun (baik sebagai akun sumber MAUPUN sebagai
 * akun tujuan transfer) lalu hitung total masuk/keluar/transfer & saldo.
 *
 * @param {Array<object>} transactions - semua transaksi (globalData).
 * @param {string} accName - nama akun yang mau dihitung.
 * @param {object} deps
 * @param {(row: object) => number} deps.transferTargetAmount - nominal sisi tujuan transfer.
 * @returns {{ relatedTx: object[], totalIn: number, totalOut: number, transferIn: number, transferOut: number, balance: number }}
 */
export function computeAccountTotals(transactions, accName, { transferTargetAmount }) {
  const relatedTx = transactions.filter((d) => d.tanggal && (d.akun === accName || (d.jenis === "Transfer" && d.kategori === accName)));

  let totalIn = 0, totalOut = 0, transferIn = 0, transferOut = 0;
  relatedTx.forEach((d) => {
    const amt = Number(d.jumlah) || 0;
    if (d.jenis === "Pemasukan" && d.akun === accName) {
      totalIn += amt;
    } else if (d.jenis === "Pengeluaran" && d.akun === accName) {
      totalOut += amt;
    } else if (d.jenis === "Transfer") {
      if (d.akun === accName) transferOut += amt;
      // Akun ini sbg TUJUAN menerima transferTargetAmount(d) (nominal dlm mata uang akun
      // ini sendiri), bukan `amt` (nominal sisi sumber, yg mata uangnya bisa beda).
      if (d.kategori === accName) transferIn += transferTargetAmount(d);
    }
  });
  const balance = totalIn - totalOut - transferOut + transferIn;

  return { relatedTx, totalIn, totalOut, transferIn, transferOut, balance };
}

/**
 * Bangun deret saldo berjalan (running balance) 1 akun, terurut dari transaksi
 * terlama ke terbaru -- dipakai untuk grafik tren saldo akun.
 *
 * @param {Array<object>} transactions - semua transaksi (globalData).
 * @param {string} accName - nama akun yang mau dihitung.
 * @param {object} deps
 * @param {(row: object) => number} deps.transferTargetAmount - nominal sisi tujuan transfer.
 * @param {(tanggalStr: string) => Date} deps.parseTgl - parser tanggal transaksi.
 * @returns {Array<{ raw: object, date: Date, balance: number, in: number, out: number }>}
 */
export function buildAccountBalanceSeries(transactions, accName, { transferTargetAmount, parseTgl }) {
  const tx = transactions.filter((d) => d.tanggal && (d.akun === accName || (d.jenis === "Transfer" && d.kategori === accName)));
  tx.sort((a, b) => parseTgl(a.tanggal) - parseTgl(b.tanggal));

  let running = 0;
  return tx.map((d) => {
    const amt = Number(d.jumlah) || 0;
    let inAmt = 0, outAmt = 0;
    if (d.jenis === "Pemasukan" && d.akun === accName) {
      running += amt;
      inAmt = amt;
    } else if (d.jenis === "Pengeluaran" && d.akun === accName) {
      running -= amt;
      outAmt = amt;
    } else if (d.jenis === "Transfer") {
      if (d.akun === accName) { running -= amt; outAmt = amt; }
      // Akun ini sbg TUJUAN menerima transferTargetAmount(d) (nominal dlm mata uang akun
      // ini sendiri), bukan `amt`.
      if (d.kategori === accName) {
        const amtTujuan = transferTargetAmount(d);
        running += amtTujuan;
        inAmt = amtTujuan;
      }
    }
    return { raw: d, date: parseTgl(d.tanggal), balance: running, in: inAmt, out: outAmt };
  });
}

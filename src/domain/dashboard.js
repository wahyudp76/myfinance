/**
 * MyFinance dashboard aggregation.
 *
 * Pure function only: no DOM, Supabase, localStorage or network access.
 * Extracted from processDataForUI() in index.html (lanjutan Phase 4 --
 * "Break the monolithic client into modules by domain", lihat
 * docs/architecture-modernization-plan.md). Perilakunya dipertahankan
 * 100% SAMA seperti kode lama di index.html -- ini murni pemindahan,
 * bukan penulisan ulang -- supaya bisa di-unit-test terpisah dari DOM
 * tanpa mengubah angka yang tampil ke user.
 *
 * Fungsi bantu yang sebelumnya dipakai langsung di index.html
 * (txIdrAmount, transferTargetAmount, parseTgl, kategorisasi parent
 * pengeluaran) SENGAJA disuntik lewat parameter, bukan diduplikasi di
 * sini -- supaya index.html tetap satu-satunya sumber kebenaran untuk
 * fungsi-fungsi itu, dan tidak ada risiko 2 implementasi diam-diam beda
 * perilaku di masa depan.
 */

/**
 * @param {Array<object>} transactions - baris transaksi (bentuk sama seperti tabel `transactions`).
 * @param {object} deps
 * @param {string[]} deps.accounts - daftar nama akun (appSettings.accounts).
 * @param {Date} deps.now - waktu "sekarang" (disuntik, bukan `new Date()` internal, supaya testable).
 * @param {(t: object) => number} deps.txIdrAmount - nilai IDR-equivalent 1 transaksi.
 * @param {(row: object) => number} deps.transferTargetAmount - nominal sisi tujuan transfer.
 * @param {(tanggalStr: string) => Date} deps.parseTgl - parser tanggal transaksi.
 * @param {(kategori: string) => (string|null|undefined)} deps.categorizeExpenseParent -
 *   nama kategori parent utk 1 kategori pengeluaran (mis. dari getCategoryStyle().parentName).
 */
export function aggregateDashboardData(transactions, {
  accounts,
  now,
  txIdrAmount,
  transferTargetAmount,
  parseTgl,
  categorizeExpenseParent,
}) {
  let totalIn = 0, totalOut = 0, monthIn = 0, monthOut = 0;

  const accBalances = {};
  accounts.forEach((acc) => { accBalances[acc] = 0; });

  const monthlyMap = {};
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  let prevMonthIn = 0, prevMonthOut = 0;
  let monthTxCount = 0;
  const monthCatOutMap = {};
  // Total pengeluaran per kategori (PARENT), diakumulasi utk 3 bulan SEBELUM bulan ini --
  // dipakai computeFinancialInsights() di index.html utk bandingkan pengeluaran bulan ini
  // vs rata-rata 3 bulan terakhir per kategori (deteksi "kategori X naik signifikan").
  const catOut3MoMap = {};

  const monthKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prior3MonthKeys = [1, 2, 3].map((i) => monthKeyOf(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  const padZero = (n) => String(n).padStart(2, "0");
  const localKey = (d) => `${d.getFullYear()}-${padZero(d.getMonth() + 1)}-${padZero(d.getDate())}`;

  const last7Map = {};
  const last7Order = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = localKey(d);
    last7Map[key] = { in: 0, out: 0, dateObj: d };
    last7Order.push(key);
  }

  transactions.forEach((d) => {
    const date = parseTgl(d.tanggal);
    // amt = NATIVE (mata uang akun itu sendiri) -- dipakai HANYA utk saldo per-akun,
    // karena saldo 1 akun ya dalam mata uang akun itu sendiri.
    // amtIdr = versi IDR (fallback ke amt kalau transaksi lama belum punya jumlah_idr) --
    // dipakai utk SEMUA total gabungan lintas akun/kategori.
    const amt = Number(d.jumlah);
    const amtIdr = txIdrAmount(d);
    const monthLabel = date.toLocaleDateString("id-ID", { month: "short", year: "numeric" });

    if (d.jenis === "Pemasukan") {
      if (accBalances[d.akun] !== undefined) accBalances[d.akun] += amt;
      totalIn += amtIdr;
    } else if (d.jenis === "Pengeluaran") {
      if (accBalances[d.akun] !== undefined) accBalances[d.akun] -= amt;
      totalOut += amtIdr;
    } else if (d.jenis === "Transfer") {
      if (accBalances[d.akun] !== undefined) accBalances[d.akun] -= amt;
      // Akun tujuan mendapat transferTargetAmount(d) (nominal DALAM MATA UANG AKUN TUJUAN,
      // sudah dikonversi kalau beda mata uang dari akun sumber) -- bukan `amt` (nominal sisi
      // SUMBER) yang cuma benar kalau kedua akun kebetulan sama mata uangnya.
      if (accBalances[d.kategori] !== undefined) accBalances[d.kategori] += transferTargetAmount(d);
    }

    const isCurMonth = date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    if (isCurMonth) {
      if (d.jenis === "Pemasukan") monthIn += amtIdr;
      if (d.jenis === "Pengeluaran") {
        monthOut += amtIdr;
        const parentName = categorizeExpenseParent(d.kategori) || "Lain-lain";
        monthCatOutMap[parentName] = (monthCatOutMap[parentName] || 0) + amtIdr;
      }
      if (d.jenis !== "Transfer") monthTxCount++;
    }
    if (date.getMonth() === prevMonthDate.getMonth() && date.getFullYear() === prevMonthDate.getFullYear()) {
      if (d.jenis === "Pemasukan") prevMonthIn += amtIdr;
      if (d.jenis === "Pengeluaran") prevMonthOut += amtIdr;
    }
    if (d.jenis === "Pengeluaran" && prior3MonthKeys.includes(monthKeyOf(date))) {
      const parentName = categorizeExpenseParent(d.kategori) || "Lain-lain";
      catOut3MoMap[parentName] = (catOut3MoMap[parentName] || 0) + amtIdr;
    }
    const dKey = localKey(date);
    if (last7Map[dKey]) {
      if (d.jenis === "Pemasukan") last7Map[dKey].in += amtIdr;
      if (d.jenis === "Pengeluaran") last7Map[dKey].out += amtIdr;
    }

    if (!monthlyMap[monthLabel]) monthlyMap[monthLabel] = { in: 0, out: 0 };
    if (d.jenis === "Pemasukan") monthlyMap[monthLabel].in += amtIdr;
    if (d.jenis === "Pengeluaran") monthlyMap[monthLabel].out += amtIdr;
  });

  return {
    accBalances,
    totalIn,
    totalOut,
    monthIn,
    monthOut,
    prevMonthIn,
    prevMonthOut,
    monthTxCount,
    monthCatOutMap,
    catOut3MoMap,
    last7Map,
    last7Order,
    monthlyMap,
  };
}

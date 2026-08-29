/**
 * MyFinance report-tab domain logic (ringkasan tahunan, breakdown bulanan,
 * tren kategori).
 *
 * Pure functions only: no DOM, Supabase, localStorage or network access.
 * Extracted dari renderYearlyReport(), renderReportTab(), dan
 * computeCategoryTrend() di index.html (lanjutan Phase 4 -- "Break the
 * monolithic client into modules by domain", lihat
 * docs/architecture-modernization-plan.md). Perilaku dipertahankan 100%
 * sama -- ini pemindahan, bukan penulisan ulang.
 *
 * txIdrAmount/parseTgl/kategorisasi parent SENGAJA disuntik lewat
 * parameter, bukan diduplikasi -- supaya index.html tetap satu-satunya
 * sumber kebenaran untuk fungsi-fungsi itu.
 */

/**
 * Ringkasan tahunan: net bulanan (12 elemen, Jan-Des), total masuk/keluar
 * tahun ini vs tahun lalu.
 *
 * PENTING: `year` di sini dibandingkan dengan STRICT equality (===) ke
 * `date.getFullYear()` (number) -- jadi `year` HARUS berupa number, bukan
 * string, persis seperti perilaku asli di index.html (selectedReportYear).
 *
 * @param {Array<object>} transactions - semua transaksi (globalData).
 * @param {object} deps
 * @param {number} deps.year - tahun yang mau diringkas (number, bukan string).
 * @param {(t: object) => number} deps.txIdrAmount
 * @param {(tanggalStr: string) => Date} deps.parseTgl
 * @returns {{ monthlyNet: number[], totalIn: number, totalOut: number, totalInLast: number, totalOutLast: number, totalNet: number, totalNetLast: number, hasDataThisYear: boolean }}
 */
export function computeYearlySummary(transactions, { year, txIdrAmount, parseTgl }) {
  const lastYear = year - 1;
  const monthlyNet = Array(12).fill(0);
  let totalIn = 0, totalOut = 0, totalInLast = 0, totalOutLast = 0;
  let hasDataThisYear = false;

  (transactions || []).forEach((row) => {
    if (!row.tanggal) return;
    const d = parseTgl(row.tanggal);
    const y = d.getFullYear();
    const amt = txIdrAmount(row);
    if (y === year) {
      hasDataThisYear = true;
      if (row.jenis === "Pemasukan") { totalIn += amt; monthlyNet[d.getMonth()] += amt; }
      else if (row.jenis === "Pengeluaran") { totalOut += amt; monthlyNet[d.getMonth()] -= amt; }
    } else if (y === lastYear) {
      if (row.jenis === "Pemasukan") totalInLast += amt;
      else if (row.jenis === "Pengeluaran") totalOutLast += amt;
    }
  });

  return {
    monthlyNet,
    totalIn,
    totalOut,
    totalInLast,
    totalOutLast,
    totalNet: totalIn - totalOut,
    totalNetLast: totalInLast - totalOutLast,
    hasDataThisYear,
  };
}

/**
 * Breakdown 1 bulan tertentu: total per kategori (parent) utk pengeluaran &
 * pemasukan, dan total harian (utk grafik tren harian).
 *
 * PENTING: `year`/`month` di sini dibandingkan dengan LOOSE equality (==)
 * persis seperti kode asli -- boleh number ATAU string numerik (mis. dari
 * `"2026-08".split("-")`), sengaja dipertahankan supaya perilakunya identik.
 *
 * @param {Array<object>} transactions - semua transaksi (globalData).
 * @param {object} deps
 * @param {number|string} deps.year
 * @param {number|string} deps.month - 1-12.
 * @param {(t: object) => number} deps.txIdrAmount
 * @param {(tanggalStr: string) => Date} deps.parseTgl
 * @param {(kategori: string, jenis: string) => (string|null|undefined)} deps.categorizeParent -
 *   nama kategori parent (mis. dari getCategoryStyle(kategori, jenis).parentName).
 * @returns {{
 *   catOutMap: Record<string, number>, catInMap: Record<string, number>,
 *   dailyMap: Record<number, {in: number, out: number}>,
 *   outEntries: Array<{label: string, val: number}>, inEntries: Array<{label: string, val: number}>,
 * }}
 */
export function computeMonthlyBreakdown(transactions, { year, month, txIdrAmount, parseTgl, categorizeParent }) {
  const filteredData = transactions.filter((d) => {
    if (!d.tanggal) return false;
    const dDate = parseTgl(d.tanggal);
    return dDate.getFullYear() == year && (dDate.getMonth() + 1) == month;
  });

  const catOutMap = {};
  const catInMap = {};
  const dailyMap = {};
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let i = 1; i <= daysInMonth; i++) dailyMap[i] = { in: 0, out: 0 };

  filteredData.forEach((d) => {
    const date = parseTgl(d.tanggal);
    const amt = txIdrAmount(d);
    if (d.jenis === "Pengeluaran") {
      const pName = categorizeParent(d.kategori, "Pengeluaran") || d.kategori;
      catOutMap[pName] = (catOutMap[pName] || 0) + amt;
      dailyMap[date.getDate()].out += amt;
    } else if (d.jenis === "Pemasukan") {
      const pName = categorizeParent(d.kategori, "Pemasukan") || d.kategori;
      catInMap[pName] = (catInMap[pName] || 0) + amt;
      dailyMap[date.getDate()].in += amt;
    }
  });

  const outEntries = Object.keys(catOutMap).map((k) => ({ label: k, val: catOutMap[k] })).sort((a, b) => b.val - a.val);
  const inEntries = Object.keys(catInMap).map((k) => ({ label: k, val: catInMap[k] })).sort((a, b) => b.val - a.val);

  return { catOutMap, catInMap, dailyMap, outEntries, inEntries };
}

/**
 * Tren pengeluaran per kategori (parent), N bulan terakhir dari `now`,
 * dibatasi ke top-5 kategori dengan total pengeluaran tertinggi dlm rentang itu.
 *
 * @param {Array<object>} transactions - semua transaksi (globalData).
 * @param {number} monthsCount - jumlah bulan ke belakang (termasuk bulan ini).
 * @param {object} deps
 * @param {Date} deps.now - waktu "sekarang" (disuntik supaya testable).
 * @param {(t: object) => number} deps.txIdrAmount
 * @param {(kategori: string) => (string|null|undefined)} deps.categorizeExpenseParent
 * @returns {{ labels: string[], series: Array<{label: string, data: number[]}> }}
 */
export function computeCategoryTrend(transactions, monthsCount, { now, txIdrAmount, categorizeExpenseParent }) {
  monthsCount = monthsCount || 6;
  const monthKeys = [];
  for (let i = monthsCount - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString("id-ID", { month: "short", year: "2-digit" }) });
  }
  const catMonthMap = {}; // { namaKategori: { 'YYYY-MM': total } }
  transactions.forEach((t) => {
    if (t.jenis !== "Pengeluaran" || !t.tanggal) return;
    const mk = t.tanggal.slice(0, 7);
    if (!monthKeys.some((m) => m.key === mk)) return;
    const pName = categorizeExpenseParent(t.kategori) || t.kategori;
    if (!catMonthMap[pName]) catMonthMap[pName] = {};
    catMonthMap[pName][mk] = (catMonthMap[pName][mk] || 0) + txIdrAmount(t);
  });
  const totals = Object.keys(catMonthMap).map((cat) => ({ cat, total: Object.values(catMonthMap[cat]).reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total);
  const top5 = totals.slice(0, 5).map((t) => t.cat);
  return {
    labels: monthKeys.map((m) => m.label),
    series: top5.map((cat) => ({ label: cat, data: monthKeys.map((m) => (catMonthMap[cat] && catMonthMap[cat][m.key]) || 0) })),
  };
}

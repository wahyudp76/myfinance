/**
 * MyFinance budget domain logic (ringkasan anggaran per kategori, status
 * pemakaian, & deteksi ambang notifikasi).
 *
 * Pure functions only: no DOM, Supabase, localStorage or network access.
 * Extracted dari renderBudgetView() dan notifyIfBudgetThresholdCrossed() di
 * index.html (lanjutan Phase 4/7 -- "Break the monolithic client into
 * modules by domain", lihat docs/architecture-modernization-plan.md).
 * Perilaku dipertahankan 100% sama seperti kode lama -- ini pemindahan,
 * bukan penulisan ulang.
 *
 * txIdrAmount/parseTgl/getCategoryStyle SENGAJA disuntik lewat parameter,
 * bukan diduplikasi -- supaya index.html tetap satu-satunya sumber
 * kebenaran untuk fungsi-fungsi itu (pola yang sama dengan
 * src/domain/reports.js).
 */

/**
 * Total pengeluaran AKTUAL 1 bulan, dikelompokkan per nama kategori MENTAH
 * (parent ATAU sub, apa adanya sesuai `d.kategori` transaksi) -- BEDA dari
 * computeMonthlyBreakdown() di reports.js yang mengelompokkan per nama
 * PARENT hasil resolve gaya. Budget disimpan per kategori individual, jadi
 * agregasinya juga harus per nama kategori individual supaya bisa
 * dicocokkan 1:1 ke cloudBudgets[namaKategori] oleh summarizeBudgets().
 *
 * PENTING: perbandingan tahun/bulan pakai LOOSE inequality (`!=`) persis
 * seperti kode asli, supaya `year`/`month` boleh number ATAU string (mis.
 * dari `targetBulan.split('-')`).
 *
 * @param {Array<object>} transactions - semua transaksi (globalData).
 * @param {object} deps
 * @param {number|string} deps.year
 * @param {number|string} deps.month - 1-12.
 * @param {(t: object) => number} deps.txIdrAmount
 * @param {(tanggalStr: string) => Date} deps.parseTgl
 * @returns {Record<string, number>} nama kategori mentah -> total pengeluaran IDR.
 */
export function aggregateActualByCategory(transactions, { year, month, txIdrAmount, parseTgl }) {
  const actualCategoryMap = {};
  (transactions || []).forEach((d) => {
    if (d.jenis !== "Pengeluaran" || !d.tanggal) return;
    const dt = parseTgl(d.tanggal);
    if (dt.getFullYear() != year || (dt.getMonth() + 1) != month) return;
    actualCategoryMap[d.kategori] = (actualCategoryMap[d.kategori] || 0) + txIdrAmount(d);
  });
  return actualCategoryMap;
}

/**
 * Klasifikasi status pemakaian budget -- dipakai utk warna progress bar &
 * badge, baik di kartu kategori individual maupun ringkasan keseluruhan.
 * Ambang batas: >=100% over, >=70% warning, selebihnya safe.
 *
 * CATATAN: ambang ini (100/70) SENGAJA beda dari ambang notifikasi di
 * detectBudgetThresholdCrossing() (100/80) -- keduanya dipertahankan
 * terpisah persis seperti kode asli, bukan disatukan.
 *
 * @param {number} pct
 * @returns {'over'|'warning'|'safe'}
 */
export function classifyBudgetUsage(pct) {
  if (pct >= 100) return "over";
  if (pct >= 70) return "warning";
  return "safe";
}

/**
 * Ringkasan budget per kategori (parent + sub-kategori) utk 1 bulan: budget
 * vs realisasi, persentase, & entri diurutkan pct desc (sama seperti
 * urutan tampilan kartu di renderBudgetView()).
 *
 * @param {Record<string, {subs?: Array<{name: string}>}>} categoryDictPengeluaran -
 *   categoryDict.pengeluaran, { [parentName]: { subs: [{name}] } }.
 * @param {Record<string, number>} cloudBudgets - nama kategori -> nominal budget.
 * @param {Record<string, number>} actualCategoryMap - dari aggregateActualByCategory().
 * @param {object} deps
 * @param {(kategori: string, jenis: string) => {icon: string, bg: string, color: string, image?: string}} deps.getCategoryStyle
 * @returns {{
 *   entries: Array<{name: string, budget: number, actual: number, pct: number, icon: string, bg: string, color: string, image?: string, subEntries: Array<object>}>,
 *   totalBudget: number,
 *   totalActual: number,
 *   remaining: number,
 *   overallPct: number,
 * }}
 */
export function summarizeBudgets(categoryDictPengeluaran, cloudBudgets, actualCategoryMap, { getCategoryStyle }) {
  let totalBudget = 0;
  let totalActual = 0;
  const entries = [];

  Object.keys(categoryDictPengeluaran || {}).forEach((parentName) => {
    const parent = categoryDictPengeluaran[parentName];
    const hasSubs = parent.subs && parent.subs.length > 0;
    const parentStyle = getCategoryStyle(parentName, "Pengeluaran");

    let pBudget = 0;
    let pActual = 0;
    const subEntries = [];

    if (hasSubs) {
      parent.subs.forEach((sub) => {
        const sBudget = cloudBudgets[sub.name] || 0;
        const sActual = actualCategoryMap[sub.name] || 0;
        pBudget += sBudget;
        pActual += sActual;
        const sPct = sBudget > 0 ? Math.round((sActual / sBudget) * 100) : (sActual > 0 ? 100 : 0);
        const subStyle = getCategoryStyle(sub.name, "Pengeluaran");
        subEntries.push({ name: sub.name, budget: sBudget, actual: sActual, pct: sPct, icon: subStyle.icon, bg: subStyle.bg, color: subStyle.color, image: subStyle.image });
      });
    } else {
      pBudget = cloudBudgets[parentName] || 0;
    }

    const directActual = actualCategoryMap[parentName] || 0;
    pActual += directActual;
    if (hasSubs && directActual > 0) {
      subEntries.push({ name: "Tanpa sub-kategori", budget: 0, actual: directActual, pct: 100, icon: "fa-ellipsis", bg: parentStyle.bg, color: parentStyle.color, image: parentStyle.image, isDirect: true });
    }

    if (pBudget > 0 || pActual > 0) {
      totalBudget += pBudget;
      totalActual += pActual;
      const pct = pBudget > 0 ? Math.round((pActual / pBudget) * 100) : (pActual > 0 ? 100 : 0);
      entries.push({ name: parentName, budget: pBudget, actual: pActual, pct, icon: parentStyle.icon, bg: parentStyle.bg, color: parentStyle.color, image: parentStyle.image, subEntries });
    }
  });

  entries.sort((a, b) => b.pct - a.pct);

  const remaining = totalBudget - totalActual;
  const overallPct = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0;

  return { entries, totalBudget, totalActual, remaining, overallPct };
}

/**
 * Deteksi apakah 1 transaksi baru/diubah baru saja membuat kategori
 * nyebrang ambang notifikasi: TERLAMPAUI (dari <100% ke >=100%) atau
 * WASPADA (dari <80% ke >=80%). `null` kalau kategori ini tidak ada
 * budget-nya sebelum ATAU sesudah transaksi (tidak ada pct utk dibandingkan).
 *
 * CATATAN: ambang notifikasi ini (100/80) SENGAJA beda dari ambang warna
 * badge di classifyBudgetUsage/summarizeBudgets (100/70) -- dipertahankan
 * terpisah persis seperti kode asli, supaya perilaku notifikasi tidak ikut
 * berubah kalau suatu saat ambang warna badge disesuaikan.
 *
 * @param {number|null|undefined} beforePct - pecahan (0.8 = 80%), bukan persen.
 * @param {number|null|undefined} afterPct
 * @returns {'exceeded'|'warning'|null}
 */
export function detectBudgetThresholdCrossing(beforePct, afterPct) {
  if (beforePct == null || afterPct == null) return null;
  if (beforePct < 1 && afterPct >= 1) return "exceeded";
  if (beforePct < 0.8 && afterPct >= 0.8) return "warning";
  return null;
}

/**
 * MyFinance asset/investment domain logic.
 *
 * Pure functions only: no DOM, Supabase, localStorage or network access.
 * Extracted from renderAssetView() di index.html (lanjutan Phase 4 --
 * "Break the monolithic client into modules by domain", lihat
 * docs/architecture-modernization-plan.md). Perilaku dipertahankan 100%
 * sama seperti kode lama -- ini pemindahan, bukan penulisan ulang.
 *
 * renderAssetView() sendiri TIDAK dipindah seluruhnya ke sini karena
 * sebagian besar isinya adalah pembuatan HTML/chart (DOM) yang menyatu
 * erat dengan kalkulasinya -- hanya bagian angka murni yang diekstrak,
 * sisanya tetap di index.html.
 */

/**
 * Ringkas semua aset: return per-aset, saldo per kategori, total return, dan
 * cuan/rugi terbesar (best/worst performer, minimal 2 aset bermodal > 0).
 *
 * @param {Array<object>} assets - daftar aset (globalAssets), tiap item minimal
 *   punya { nilai, modal, kategori, nama }.
 * @returns {{
 *   sortedAssets: Array<object>,   // assets diurutkan nilai desc, tiap item dapat tambahan returnRp/returnPct/isUp
 *   totalNilai: number,
 *   totalModal: number,
 *   catMap: Record<string, number>,
 *   totalReturn: number,
 *   totalReturnPct: number,
 *   best: {nama: string, pct: number} | null,
 *   worst: {nama: string, pct: number} | null,
 * }}
 */
export function summarizeAssets(assets) {
  const sortedAssets = [...assets]
    .sort((a, b) => Number(b.nilai) - Number(a.nilai))
    .map((a) => {
      const nilai = Number(a.nilai);
      const modal = Number(a.modal);
      const returnRp = nilai - modal;
      const returnPct = modal > 0 ? (returnRp / modal) * 100 : 0;
      return { ...a, returnRp, returnPct, isUp: returnRp >= 0 };
    });

  let totalNilai = 0, totalModal = 0;
  const catMap = {};
  sortedAssets.forEach((a) => {
    totalModal += Number(a.modal);
    totalNilai += Number(a.nilai);
    catMap[a.kategori] = (catMap[a.kategori] || 0) + Number(a.nilai);
  });

  const totalReturn = totalNilai - totalModal;
  const totalReturnPct = totalModal > 0 ? (totalReturn / totalModal) * 100 : 0;

  // Cuma dihitung dari aset yang modalnya > 0 (supaya persentase return-nya bermakna).
  const rankable = assets
    .filter((a) => Number(a.modal) > 0)
    .map((a) => ({ nama: a.nama, pct: ((Number(a.nilai) - Number(a.modal)) / Number(a.modal)) * 100 }))
    .sort((a, b) => b.pct - a.pct);

  const best = rankable.length >= 2 ? rankable[0] : null;
  const worst = rankable.length >= 2 ? rankable[rankable.length - 1] : null;

  return { sortedAssets, totalNilai, totalModal, catMap, totalReturn, totalReturnPct, best, worst };
}

/**
 * Kekayaan bersih = total nilai aset saat ini dikurangi total sisa utang yang
 * belum lunas (sisa utang negatif dianggap 0, bukan menambah kekayaan bersih).
 *
 * @param {number} totalNilai - total nilai aset saat ini (dari summarizeAssets().totalNilai).
 * @param {Array<{sisaUtang: number}>} debts - appSettings.debts.
 * @returns {{ totalUtangBersih: number, netWorth: number }}
 */
export function computeNetWorth(totalNilai, debts) {
  const totalUtangBersih = (debts || []).reduce((sum, d) => sum + Math.max(0, Number(d.sisaUtang) || 0), 0);
  const netWorth = totalNilai - totalUtangBersih;
  return { totalUtangBersih, netWorth };
}

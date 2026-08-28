/**
 * MyFinance financial goals & debt payoff progress.
 *
 * Pure functions only: no DOM, Supabase, localStorage or network access.
 * Extracted dari renderGoalsList() dan renderDebtsList() di index.html
 * (lanjutan Phase 4 -- "Break the monolithic client into modules by
 * domain", lihat docs/architecture-modernization-plan.md). Perilaku
 * dipertahankan 100% sama -- ini pemindahan, bukan penulisan ulang.
 *
 * `now` SENGAJA disuntik lewat parameter (bukan `new Date()` internal),
 * sama seperti pola di src/domain/dashboard.js, supaya testable.
 */

/**
 * @param {{ target: number, terkumpul: number, deadline?: string }} goal
 * @param {Date} now - waktu "sekarang" (disuntik supaya testable).
 * @returns {{ pct: number, sisa: number, isDone: boolean, daysUntilDeadline: number|null }}
 *   daysUntilDeadline: null kalau goal tidak punya deadline; negatif kalau sudah lewat tenggat.
 */
export function computeGoalProgress(goal, now) {
  const target = Number(goal.target) || 0;
  const terkumpul = Number(goal.terkumpul) || 0;
  const pct = target > 0 ? Math.min(100, Math.round((terkumpul / target) * 100)) : 0;
  const sisa = Math.max(0, target - terkumpul);
  const isDone = terkumpul >= target && target > 0;

  let daysUntilDeadline = null;
  if (goal.deadline) {
    const today = new Date(now.toDateString()); // tengah malam hari ini (waktu lokal)
    daysUntilDeadline = Math.ceil((new Date(goal.deadline + "T00:00:00") - today) / 86400000);
  }

  return { pct, sisa, isDone, daysUntilDeadline };
}

/**
 * @param {{ totalUtang: number, sisaUtang: number, cicilanPerBulan?: number }} debt
 * @returns {{ paidPct: number, sisa: number, isLunas: boolean, bulanLagi: number|null }}
 *   bulanLagi: null kalau sudah lunas atau cicilanPerBulan tidak diisi/<=0 (estimasi tidak bisa dihitung).
 */
export function computeDebtProgress(debt) {
  const total = Number(debt.totalUtang) || 0;
  const sisa = Math.max(0, Number(debt.sisaUtang) || 0);
  const paidPct = total > 0 ? Math.min(100, Math.round(((total - sisa) / total) * 100)) : 0;
  const isLunas = sisa <= 0;

  let bulanLagi = null;
  if (!isLunas && debt.cicilanPerBulan > 0) {
    bulanLagi = Math.ceil(sisa / debt.cicilanPerBulan);
  }

  return { paidPct, sisa, isLunas, bulanLagi };
}

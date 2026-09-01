/**
 * MyFinance financial health score & rule-based insights.
 *
 * Pure functions only: no DOM, Supabase, localStorage or network access.
 * Extracted from computeFinancialHealthScore() dan computeFinancialInsights()
 * di index.html (lanjutan Phase 4 -- "Break the monolithic client into
 * modules by domain", lihat docs/architecture-modernization-plan.md).
 * Perilaku dipertahankan 100% sama -- ini pemindahan, bukan penulisan ulang.
 * Kedua fungsi ini sebenarnya SUDAH pure sebelumnya (cuma baca `ctx`), yang
 * diubah cuma 2 dependensi eksternal (currentMonthBudgetsCache global, dan
 * formatRp/formatShortVal) yang sekarang disuntik lewat parameter supaya
 * modul ini benar-benar berdiri sendiri tanpa scope index.html.
 */

/**
 * Skor kesehatan keuangan bulan ini (0-100), dari 4 komponen berbobot:
 * tingkat menabung, kepatuhan anggaran, konsistensi bulanan, aktivitas
 * pencatatan. Komponen yang datanya tidak tersedia (mis. belum ada budget
 * bulan ini) di-skip, bukan dianggap 0 -- supaya user yang belum pasang
 * budget tidak dihukum skornya.
 *
 * @param {object} ctx - dashboard aggregation context (lihat aggregateDashboardData()):
 *   { monthIn, monthOut, monthCatOutMap, monthlyMap, monthTxCount }.
 * @param {object} deps
 * @param {Record<string, number>} deps.currentMonthBudgets - budget kategori bulan ini (currentMonthBudgetsCache).
 * @returns {{ finalScore: number, components: Array<{label: string, score: number, max: number}> }}
 */
export function computeFinancialHealthScore(ctx, { currentMonthBudgets }) {
  const components = [];

  // 1. Tingkat menabung bulan ini (maks 40) -- target acuan 20% dari pemasukan = skor penuh.
  if (ctx.monthIn > 0) {
    const savingsRate = (ctx.monthIn - ctx.monthOut) / ctx.monthIn;
    components.push({ label: "Tingkat Menabung", score: Math.max(0, Math.min(40, (savingsRate / 0.20) * 40)), max: 40 });
  }

  // 2. Kepatuhan anggaran (maks 25) -- % kategori yg pengeluarannya masih <= budget-nya.
  const budgetCats = Object.keys(currentMonthBudgets || {}).filter((c) => Number(currentMonthBudgets[c]) > 0);
  if (budgetCats.length > 0) {
    const withinBudget = budgetCats.filter((c) => (ctx.monthCatOutMap[c] || 0) <= Number(currentMonthBudgets[c])).length;
    components.push({ label: "Kepatuhan Anggaran", score: (withinBudget / budgetCats.length) * 25, max: 25 });
  }

  // 3. Konsistensi bulanan (maks 20) -- dari beberapa bulan terakhir yg ada datanya, berapa
  //    persen yang net-nya positif (pemasukan >= pengeluaran).
  if (ctx.monthlyMap) {
    const labels = Object.keys(ctx.monthlyMap).slice(-6);
    if (labels.length > 0) {
      const positiveMonths = labels.filter((l) => (ctx.monthlyMap[l].in - ctx.monthlyMap[l].out) >= 0).length;
      components.push({ label: "Konsistensi Bulanan", score: (positiveMonths / labels.length) * 20, max: 20 });
    }
  }

  // 4. Aktivitas pencatatan (maks 15) -- kebiasaan mencatat transaksi cukup rutin bulan ini
  //    (acuan: 15 transaksi/bulan = skor penuh, ~1 transaksi tiap 2 hari).
  components.push({ label: "Aktivitas Pencatatan", score: Math.max(0, Math.min(15, (ctx.monthTxCount / 15) * 15)), max: 15 });

  const totalScore = components.reduce((s, c) => s + c.score, 0);
  const totalMax = components.reduce((s, c) => s + c.max, 0);
  const finalScore = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;
  return { finalScore, components };
}

/**
 * Wawasan keuangan rule-based (maks 4), diprioritaskan: peringatan anggaran >
 * kategori naik signifikan > tingkat menabung > proyeksi akhir bulan.
 *
 * @param {object} ctx - dashboard aggregation context: { now, monthIn, monthOut,
 *   prevMonthIn, prevMonthOut, monthCatOutMap, catOut3MoMap, monthTxCount }.
 * @param {object} deps
 * @param {Record<string, number>} deps.currentMonthBudgets - budget kategori bulan ini.
 * @param {(angka: number) => string} deps.formatRp - format rupiah penuh ("1.234.567").
 * @param {(angka: number) => string} deps.formatShortVal - format rupiah ringkas ("1.2M"/"500K").
 * @returns {Array<{icon: string, bg: string, color: string, title: string, message: string}>}
 */
export function computeFinancialInsights(ctx, { currentMonthBudgets, formatRp, formatShortVal }) {
  const { now, monthIn, monthOut, prevMonthIn, prevMonthOut, monthCatOutMap, catOut3MoMap } = ctx;
  const insights = [];
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const pctMonthElapsed = dayOfMonth / daysInMonth;

  // 1. Peringatan anggaran -- kategori dengan progres pemakaian anggaran paling jauh
  //    melewati progres bulan berjalan (prioritas tertinggi, paling actionable).
  let worstBudget = null;
  Object.keys(currentMonthBudgets).forEach((cat) => {
    const budget = Number(currentMonthBudgets[cat]);
    if (!budget) return;
    const spent = monthCatOutMap[cat] || 0;
    const pctUsed = spent / budget;
    if (pctUsed >= 0.5 && pctUsed > pctMonthElapsed + 0.15) {
      if (!worstBudget || pctUsed > worstBudget.pctUsed) worstBudget = { cat, budget, spent, pctUsed };
    }
  });
  if (worstBudget) {
    const over = worstBudget.pctUsed >= 1;
    insights.push({
      icon: over ? "fa-circle-exclamation" : "fa-triangle-exclamation",
      bg: over ? "bg-rose-100" : "bg-amber-100",
      color: over ? "text-rose-600" : "text-amber-600",
      title: over ? "Anggaran Terlampaui" : "Anggaran Mulai Menipis",
      message: `Anggaran "${worstBudget.cat}" sudah terpakai ${(worstBudget.pctUsed * 100).toFixed(0)}% (Rp ${formatRp(worstBudget.spent)} dari Rp ${formatRp(worstBudget.budget)}), padahal baru ${(pctMonthElapsed * 100).toFixed(0)}% bulan berjalan.`,
    });
  }

  // 2. Kategori pengeluaran naik signifikan vs rata-rata 3 bulan terakhir.
  let bestSpike = null;
  Object.keys(monthCatOutMap).forEach((cat) => {
    const avg3mo = (catOut3MoMap[cat] || 0) / 3;
    const cur = monthCatOutMap[cat];
    if (avg3mo > 0 && cur > avg3mo * 1.3 && (cur - avg3mo) > 20000) {
      const pctUp = (cur / avg3mo - 1) * 100;
      if (!bestSpike || pctUp > bestSpike.pctUp) bestSpike = { cat, avg3mo, cur, pctUp };
    }
  });
  if (bestSpike) {
    insights.push({
      icon: "fa-chart-line",
      bg: "bg-orange-100",
      color: "text-orange-600",
      title: "Pengeluaran Kategori Naik",
      message: `Pengeluaran "${bestSpike.cat}" bulan ini Rp ${formatRp(bestSpike.cur)}, naik ${bestSpike.pctUp.toFixed(0)}% dari rata-rata 3 bulan terakhir (Rp ${formatRp(Math.round(bestSpike.avg3mo))}).`,
    });
  }

  // 3. Tingkat menabung bulan ini vs bulan lalu.
  if (monthIn > 0) {
    const rateThis = (monthIn - monthOut) / monthIn * 100;
    if (prevMonthIn > 0) {
      const rateLast = (prevMonthIn - prevMonthOut) / prevMonthIn * 100;
      const diff = rateThis - rateLast;
      if (Math.abs(diff) >= 5) {
        insights.push({
          icon: diff >= 0 ? "fa-piggy-bank" : "fa-arrow-trend-down",
          bg: diff >= 0 ? "bg-emerald-100" : "bg-rose-100",
          color: diff >= 0 ? "text-emerald-600" : "text-rose-600",
          title: "Tingkat Menabung",
          message: `Kamu menabung ${rateThis.toFixed(0)}% dari pemasukan bulan ini, ${diff >= 0 ? "naik" : "turun"} ${Math.abs(diff).toFixed(0)} poin dibanding bulan lalu (${rateLast.toFixed(0)}%).`,
        });
      }
    }
  }

  // 4. Proyeksi pengeluaran akhir bulan berdasar rata-rata harian sejauh ini (perlu minimal
  //    3 hari data & masih ada sisa hari berjalan, biar tidak proyeksi hal yang sudah pasti).
  if (dayOfMonth >= 3 && dayOfMonth < daysInMonth && monthOut > 0) {
    const avgDaily = monthOut / dayOfMonth;
    const projected = avgDaily * daysInMonth;
    if (projected > monthOut * 1.05) {
      insights.push({
        icon: "fa-magnifying-glass-chart",
        bg: "bg-violet-100",
        color: "text-violet-600",
        title: "Proyeksi Akhir Bulan",
        message: `Dengan laju pengeluaran saat ini (~Rp ${formatShortVal(avgDaily)}/hari), total pengeluaran bulan ini diperkirakan mencapai Rp ${formatShortVal(projected)} kalau berlanjut sampai akhir bulan.`,
      });
    }
  }

  return insights.slice(0, 4);
}

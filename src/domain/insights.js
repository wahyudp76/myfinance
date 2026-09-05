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
 * Skor kesehatan keuangan bulan ini (0-100) -- v66: diperluas dari 4 menjadi
 * 7 komponen berbobot supaya lebih presisi, teliti & komprehensif mencerminkan
 * kondisi finansial riil:
 *   1. Tingkat Menabung            (maks 40) -- acuan 20% pemasukan = penuh.
 *   2. Kepatuhan Anggaran          (maks 25) -- kredit PARSIAL per kategori:
 *      dalam budget = 1, over = menyusut proporsional (bukan hitam-putih).
 *   3. Konsistensi Bulanan         (maks 20) -- % 6 bulan terakhir net positif.
 *   4. Aktivitas Pencatatan        (maks 15) -- target disesuaikan hari
 *      berjalan (1 transaksi tiap 2 hari; bulan baru tidak dihukum).
 *   5. Kendali Transaksi Kecil     (maks 10, BARU) -- total jajan <= Rp 25.000
 *      dibanding total pengeluaran (ctx.smallTx, v64).
 *   6. Keseimbangan Pengeluaran    (maks 10, BARU) -- konsentrasi kategori
 *      terbesar; >40% total mulai mengurangi skor (risiko 1 pos dominan).
 *   7. Pola Belanja Akhir Pekan    (maks 5, BARU) -- belanja Sabtu/Minggu
 *      >= 35% total & >= 5 transaksi mulai mengurangi skor (ctx.weekendTx).
 * Komponen yang datanya tidak tersedia di-skip (bukan 0): user tanpa budget /
 * tanpa data pola tidak dihukum -- skor dinormalisasi ke /100 dari total bobot
 * komponen yang benar2 berlaku.
 *
 * @param {object} ctx - context (dari buildInsightsContext()/aggregateDashboardData()):
 *   { monthIn, monthOut, monthCatOutMap, monthlyMap, monthTxCount, now?,
 *     smallTx?, weekendTx? } -- kolom pola (v64) opsional; bila absen komponen
 *   5/7 di-skip.
 * @param {object} deps
 * @param {Record<string, number>} deps.currentMonthBudgets - budget kategori bulan ini (currentMonthBudgetsCache).
 * @returns {{ finalScore: number, components: Array<{label: string, score: number, max: number}> }}
 */
export function computeFinancialHealthScore(ctx, { currentMonthBudgets }) {
  const components = [];
  const monthIn = Number(ctx.monthIn) || 0;
  const monthOut = Number(ctx.monthOut) || 0;
  const clamp01 = (n) => Math.max(0, Math.min(1, n));

  // 1. Tingkat menabung bulan ini (maks 40) -- target acuan 20% dari pemasukan = skor penuh.
  if (monthIn > 0) {
    const savingsRate = (monthIn - monthOut) / monthIn;
    components.push({ label: "Tingkat Menabung", score: Math.max(0, Math.min(40, (savingsRate / 0.20) * 40)), max: 40 });
  }

  // 2. Kepatuhan anggaran (maks 25) -- kredit PER-KATEGORI: dalam budget = 1;
  //    over dihitung parsial (1 - kelebihan/budget), bukan langsung 0, supaya
  //    sedikit meleset tidak disamakan dengan jebol total.
  const budgetCats = Object.keys(currentMonthBudgets || {}).filter((c) => Number(currentMonthBudgets[c]) > 0);
  if (budgetCats.length > 0) {
    const creditSum = budgetCats.reduce((sum, c) => {
      const budget = Number(currentMonthBudgets[c]);
      const spent = Number((ctx.monthCatOutMap || {})[c]) || 0;
      const credit = spent <= budget ? 1 : Math.max(0, 1 - (spent - budget) / budget);
      return sum + credit;
    }, 0);
    components.push({ label: "Kepatuhan Anggaran", score: (creditSum / budgetCats.length) * 25, max: 25 });
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

  // 4. Aktivitas pencatatan (maks 15) -- v66 presisi: target mengikuti hari
  //    berjalan (~1 transaksi tiap 2 hari, maks 15/bulan) kalau ctx.now ada,
  //    sehingga awal bulan tidak dihukum; fallback 15/bulan tanpa ctx.now.
  const monthTxCount = Number(ctx.monthTxCount) || 0;
  const dayOfMonth = ctx.now instanceof Date ? ctx.now.getDate() : 0;
  const expectedTx = dayOfMonth > 0 ? Math.min(15, Math.max(1, Math.ceil(dayOfMonth / 2))) : 15;
  components.push({ label: "Aktivitas Pencatatan", score: 15 * Math.min(1, monthTxCount / expectedTx), max: 15 });

  // 5. Kendali Transaksi Kecil (maks 10, BARU v66) -- total jajan harian
  //    (<= Rp 25.000/transaksi, ctx.smallTx) yang "menggerus tanpa terasa":
  //    <= 5% total pengeluaran = penuh; >= 30% = 0; linear di antaranya.
  const smallTx = ctx.smallTx;
  if (smallTx && monthOut > 0) {
    const leakPct = (Number(smallTx.total) || 0) / monthOut;
    components.push({ label: "Kendali Transaksi Kecil", score: 10 * clamp01((0.30 - leakPct) / 0.25), max: 10 });
  }

  // 6. Keseimbangan Pengeluaran (maks 10, BARU v66) -- konsentrasi ke SATU
  //    kategori: share kategori terbesar <= 40% total = penuh; >= 80% = 0.
  const catEntries = Object.entries(ctx.monthCatOutMap || {});
  if (monthOut > 0 && catEntries.length > 0) {
    const topShare = Math.max(...catEntries.map(([, v]) => Number(v) || 0)) / monthOut;
    components.push({ label: "Keseimbangan Pengeluaran", score: 10 * clamp01((0.80 - topShare) / 0.40), max: 10 });
  }

  // 7. Pola Belanja Akhir Pekan (maks 5, BARU v66) -- belanja Sabtu/Minggu
  //    (ctx.weekendTx) yang dominan menandakan pengeluaran impulsif: porsi
  //    <= 35% total = penuh; >= 75% = 0; cuma dihitung kalau >= 5 transaksi.
  const weekendTx = ctx.weekendTx;
  if (weekendTx && monthOut > 0 && (Number(weekendTx.count) || 0) >= 5) {
    const wkndShare = (Number(weekendTx.out) || 0) / monthOut;
    components.push({ label: "Pola Belanja Akhir Pekan", score: 5 * clamp01((0.75 - wkndShare) / 0.40), max: 5 });
  }

  const totalScore = components.reduce((s, c) => s + c.score, 0);
  const totalMax = components.reduce((s, c) => s + c.max, 0);
  const finalScore = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;
  return { finalScore, components };
}

/**
 * Wawasan keuangan rule-based yang KOMPREHENSIF (v64): selain 4 aturan lama
 * (peringatan anggaran, kategori naik, tingkat menabung vs bulan lalu, proyeksi
 * akhir bulan) kini menghasilkan review ringkas + saran tambahan yang digali
 * dari data transaksi: defisit/tiada pemasukan, konsentrasi kategori terbesar,
 * transaksi tunggal terbesar, pos berulang yang naik, banyak transaksi kecil,
 * pola belanja akhir pekan, pengeluaran turun vs bulan lalu, dan tabungan yang
 * sehat. Maksimal 10 kartu, diurutkan paling actionable di depan.
 *
 * @param {object} ctx - aggregation context dari aggregateDashboardData +
 *   buildInsightsContext(): { now, monthIn, monthOut, prevMonthIn, prevMonthOut,
 *   monthCatOutMap, catOut3MoMap, monthTxCount, monthlyMap, prevMonthCatOutMap,
 *   biggestExpense, smallTx, weekendTx } -- kolom tambahan opsional (diabaikan
 *   bila tidak tersedia) supaya pemanggil lama/tes tetap kompatibel.
 * @param {object} deps
 * @param {Record<string, number>} deps.currentMonthBudgets - budget kategori bulan ini.
 * @param {(angka: number) => string} deps.formatRp - format rupiah penuh ("1.234.567").
 * @param {(angka: number) => string} deps.formatShortVal - format rupiah ringkas ("1.2M"/"500K").
 * @returns {Array<{icon: string, bg: string, color: string, title: string, message: string,
 *   short?: string, detail?: string}>} -- `short` = ringkasan singkat utk kartu compact;
 *   `detail` = penjabaran lengkap utk modal (mungkin berisi baris baru "\n\n" / daftar "- ").
 */
export function computeFinancialInsights(ctx, { currentMonthBudgets, formatRp, formatShortVal }) {
  const { now, monthIn, monthOut, prevMonthIn, prevMonthOut, monthCatOutMap, catOut3MoMap } = ctx;
  const monthRows = ctx.monthTxCount || 0;
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const pctMonthElapsed = dayOfMonth / daysInMonth;
  const toPct = (n) => `${Math.round(n * 100)}%`;
  const topCat = Object.entries(monthCatOutMap || {}).sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))[0];
  const rateThis = monthIn > 0 ? ((monthIn - monthOut) / monthIn) * 100 : null;
  const rateLast = prevMonthIn > 0 ? ((prevMonthIn - prevMonthOut) / prevMonthIn) * 100 : null;

  const review = [];
  const urgent = [];
  const watch = [];
  const positive = [];

  // ------------------------------------------------------------------ REVIEW
  // Ringkasan angka bulan ini (data apa adanya) -- selalu muncul begitu ada
  // transaksi, supaya bagian ini tidak pernah kosong saat user punya data.
  if (monthRows > 0 || monthIn > 0) {
    const net = monthIn - monthOut;
    let msg = `Pemasukan Rp ${formatRp(monthIn)}, pengeluaran Rp ${formatRp(monthOut)} -- ${net >= 0 ? "surplus" : "defisit"} Rp ${formatRp(Math.abs(net))}.`;
    if (monthRows > 0) {
      msg += ` Rata-rata pengeluaran Rp ${formatRp(Math.round(monthOut / Math.max(1, dayOfMonth)))}/hari dari ${monthRows} transaksi.`;
    }
    if (monthOut > 0 && prevMonthOut > 0) {
      const dPct = ((monthOut - prevMonthOut) / prevMonthOut) * 100;
      msg += ` Dibanding bulan lalu, pengeluaran ${dPct >= 0 ? "naik" : "turun"} ${Math.abs(dPct).toFixed(0)}%.`;
    } else if (monthOut > 0 && !prevMonthOut) {
      msg += ` Bulan lalu tidak ada pengeluaran tercatat, jadi belum ada pembanding.`;
    }
    if (rateThis != null && rateLast == null && monthOut > 0) {
      msg += ` Dari pemasukan bulan ini, ${rateThis >= 0 ? `${rateThis.toFixed(0)}% tersisa sebagai tabungan` : "pengeluaran melebihi pemasukan"}.`;
    }
    review.push({
      icon: "fa-file-lines",
      bg: "bg-indigo-50",
      color: "text-indigo-600",
      title: "Review Bulan Ini",
      message: msg,
      short: "Ringkasan angka pemasukan, pengeluaran & sisa bulan ini.",
      detail: "Ini adalah rekap cepat dari semua transaksi yang tercatat bulan ini.\n\n"
        + `${msg}\n\n`
        + "Gunakan angka ini sebagai dasar untuk menilai apakah arus kas berjalan sehat atau perlu "
        + "dikoreksi. Kalau masih surplus, lanjutkan pola yang ada. Kalau mulai defisit, tinjau "
        + "kembali pengeluaran non-prioritas sebelum akhir bulan.",
    });
  }

  // --------------------------------------------------- DARURAT / PERINGATAN
  // 1. Defisit: pengeluaran > pemasukan bulan ini (kondisi paling genting).
  if (monthIn > 0 && monthOut > monthIn) {
    const deficit = monthOut - monthIn;
    const top = topCat ? topCat[0] : null;
    urgent.push({
      icon: "fa-arrow-trend-down",
      bg: "bg-rose-100",
      color: "text-rose-600",
      title: "Pengeluaran Melebihi Pemasukan",
      message: `Pengeluaran Rp ${formatRp(monthOut)} sudah melebihi pemasukan Rp ${formatRp(monthIn)} (defisit Rp ${formatRp(deficit)}).${top ? ` Kategori terbesar: "${top}" (Rp ${formatRp(monthCatOutMap[top])}).` : ""} Coba tahan pengeluaran non-prioritas sisa bulan ini.`,
      short: "Pengeluaran lebih besar dari pemasukan bulan ini (defisit).",
      detail: "Kamu sedang mengalami defisit: total pengeluaran melebihi total pemasukan bulan ini.\n\n"
        + `Dari data tercatat, pengeluaran mencapai Rp ${formatRp(monthOut)} sementara pemasukan Rp ${formatRp(monthIn)}, sehingga ada selisih (defisit) Rp ${formatRp(deficit)}.`
        + (top ? `\n\nKategori yang paling besar menyumbang saat ini adalah "${top}" (Rp ${formatRp(monthCatOutMap[top])}).` : "")
        + "\n\nBerikut beberapa hal yang bisa dilakukan:\n"
        + "- Tunda dulu pengeluaran non-prioritas (hiburan, jajan, langganan yang bisa ditunda) sampai akhir bulan.\n"
        + "- Cek pemasukan yang mungkin belum dicatat (pending transfer, invoice belum masuk).\n"
        + "- Kalau defisit berulang, pertimbangkan menyusun ulang anggaran kategori.",
    });
  } else if (monthOut > 0 && monthIn === 0) {
    urgent.push({
      icon: "fa-money-bill-wave",
      bg: "bg-amber-100",
      color: "text-amber-600",
      title: "Belum Ada Pemasukan Bulan Ini",
      message: `Sudah ada ${monthRows} transaksi pengeluaran (Rp ${formatRp(monthOut)}) tapi belum ada pemasukan tercatat. Pastikan semua pemasukan (gaji, freelance, dll) sudah dicatat.`,
      short: "Ada pengeluaran, tetapi belum ada pemasukan yang tercatat.",
      detail: `Sudah tercatat ${monthRows} transaksi pengeluaran senilai Rp ${formatRp(monthOut)}, tetapi belum ada pemasukan yang masuk bulan ini.\n\n`
        + "Ini menandakan salah satu dari dua kemungkinan:\n"
        + "- Memang belum ada yang diterima (mis. gaji masih di awal/tengah bulan), atau\n"
        + "- Ada pemasukan yang belum sempat kamu catat (transfer, pendapatan sampingan, dll).\n\n"
        + "Supaya arus kas dan skor kesehatan akurat, pastikan semua pemasukan sudah dicatat. "
        + "Kalau benar-benar belum ada pemasukan, pertimbangkan menunda pengeluaran besar hingga dana masuk.",
    });
  }

  // 2. Peringatan anggaran -- kategori dengan progres pemakaian anggaran paling jauh
  //    melewati progres bulan berjalan (paling actionable untuk yang pasang budget).
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
    urgent.push({
      icon: over ? "fa-circle-exclamation" : "fa-triangle-exclamation",
      bg: over ? "bg-rose-100" : "bg-amber-100",
      color: over ? "text-rose-600" : "text-amber-600",
      title: over ? "Anggaran Terlampaui" : "Anggaran Mulai Menipis",
      message: `Anggaran "${worstBudget.cat}" sudah terpakai ${(worstBudget.pctUsed * 100).toFixed(0)}% (Rp ${formatRp(worstBudget.spent)} dari Rp ${formatRp(worstBudget.budget)}), padahal baru ${(pctMonthElapsed * 100).toFixed(0)}% bulan berjalan.`,
      short: `Anggaran "${worstBudget.cat}" ${over ? "terlampaui" : "menipis"} ($ {(worstBudget.pctUsed * 100).toFixed(0)}%).`,
      detail: `Kategori anggaran "${worstBudget.cat}" ${over ? "SUDAH melewati batas anggarannya" : "sudah terpakai jauh lebih cepat dari progres bulan berjalan"}.\n\n`
        + `Sudah terpakai ${(worstBudget.pctUsed * 100).toFixed(0)}% dari anggaran Rp ${formatRp(worstBudget.budget)} `
        + `(tercatat Rp ${formatRp(worstBudget.spent)}), sementara baru ${(pctMonthElapsed * 100).toFixed(0)}% bulan berjalan.\n\n`
        + "Ini berarti laju pengeluaran di kategori ini jauh lebih tinggi dari biasanya. Langkah yang disarankan:\n"
        + "- Tahan atau tunda pengeluaran di kategori ini sampai bulan berikutnya.\n"
        + "- Tinjau apakah anggarannya memang terlalu rendah untuk kebutuhan riil, lalu sesuaikan di Pengaturan.\n"
        + "- Kalau sering melewati anggaran, pisahkan pengeluaran rutin vs non-rutin agar lebih terkontrol.",
    });
  }

  // 3. Kategori pengeluaran naik signifikan vs rata-rata 3 bulan terakhir.
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
    urgent.push({
      icon: "fa-chart-line",
      bg: "bg-orange-100",
      color: "text-orange-600",
      title: "Pengeluaran Kategori Naik",
      message: `Pengeluaran "${bestSpike.cat}" bulan ini Rp ${formatRp(bestSpike.cur)}, naik ${bestSpike.pctUp.toFixed(0)}% dari rata-rata 3 bulan terakhir (Rp ${formatRp(Math.round(bestSpike.avg3mo))}).`,
      short: `Pengeluaran "${bestSpike.cat}" naik ${bestSpike.pctUp.toFixed(0)}%.`,
      detail: `Kategori "${bestSpike.cat}" bulan ini tercatat Rp ${formatRp(bestSpike.cur)}, naik ${bestSpike.pctUp.toFixed(0)}% dibanding rata-rata 3 bulan terakhir (Rp ${formatRp(Math.round(bestSpike.avg3mo))}).\n\n`
        + "Kenaikan yang cukup besar (di atas 30% dan > Rp 20.000) layak ditelusuri: apakah karena kebutuhan "
        + "sekali waktu (mis. tambahan belanja, perbaikan) atau memang mulai rutin.\n\n"
        + "Kalau hanya sekali, itu wajar. Kalau mulai berulang, cek kembali transaksinya dan sesuaikan "
        + "anggaran atau batasi kategorinya bulan depan.",
    });
  }

  // 4. Konsentrasi pengeluaran: satu kategori > 45% total bulan ini.
  if (topCat && monthOut >= 100000) {
    const [cat, val] = topCat;
    const share = monthOut > 0 ? val / monthOut : 0;
    if (share >= 0.45) {
      watch.push({
        icon: "fa-chart-pie",
        bg: "bg-sky-100",
        color: "text-sky-600",
        title: "Fokus Pengeluaran Terbesar",
        message: `"${cat}" menghabiskan Rp ${formatRp(val)} = ${toPct(share)} dari total pengeluaran bulan ini. Kalau ini bukan kebutuhan pokok, coba tetapkan batas bulanannya.`,
        short: `"${cat}" mendominasi pengeluaran (${toPct(share)}).`,
        detail: `Satu kategori, "${cat}", menghabiskan Rp ${formatRp(val)} atau ${toPct(share)} dari total pengeluaran bulan ini.\n\n`
          + "Ketika satu pos menguasai hampir separuh pengeluaran, keuangan kamu jadi rentan: kalau pos itu "
          + "membengkak sekali saja, seluruh anggaran bisa terganggu.\n\n"
          + "Langkah yang disarankan:\n"
          + "- Kalau itu kebutuhan pokok (mis. transportasi/makan), coba tetapkan batas bulanan supaya tidak membengkak.\n"
          + "- Kalau itu pengeluaran fleksibel, pertimbangkan menekan proporsinya agar lebih seimbang.",
      });
    }
  }

  // 5. Transaksi tunggal terbesar (>= 30% pengeluaran bulan ini).
  const big = ctx.biggestExpense;
  if (big && big.jumlah >= 100000 && monthOut > 0 && big.jumlah / monthOut >= 0.3) {
    const when = big.tanggal && String(big.tanggal).length >= 10 ? String(big.tanggal).slice(8, 10) + "/" + String(big.tanggal).slice(5, 7) : "";
    watch.push({
      icon: "fa-magnifying-glass-dollar",
      bg: "bg-orange-100",
      color: "text-orange-600",
      title: "Transaksi Terbesar",
      message: `Transaksi "${big.kategori}" senilai Rp ${formatRp(big.jumlah)}${big.akun ? ` di ${big.akun}` : ""}${when ? ` (${when})` : ""} = ${toPct(big.jumlah / monthOut)} pengeluaran bulan ini. Pastikan nilainya memang sesuai kebutuhan.`,
      short: `Satu transaksi ${toPct(big.jumlah / monthOut)} dari pengeluaran bulan ini.`,
      detail: `Ada satu transaksi sebesar Rp ${formatRp(big.jumlah)}${big.akun ? ` di ${big.akun}` : ""}${when ? ` (${when})` : ""} `
        + `yang setara ${toPct(big.jumlah / monthOut)} dari total pengeluaran bulan ini.\n\n`
        + "Karena sangat besar, transaksi ini hampir sendirian membentuk arus kas bulanan. Hal yang perlu dicek:\n"
        + "- Apakah nilainya memang sesuai kebutuhan / sudah tepat.\n"
        + "- Apakah ini pengeluaran sekali waktu atau bakal berulang.\n"
        + "- Kalau berulang, pastikan ada dananya dan tidak memaksa pengeluaran lain ikut terpotong.",
    });
  }

  // 6. Pos berulang yang naik tajam vs bulan lalu (tagihan/langganan/pos rutin).
  const prevMap = ctx.prevMonthCatOutMap || {};
  let worstRecur = null;
  Object.keys(monthCatOutMap).forEach((cat) => {
    const prev = prevMap[cat] || 0;
    const cur = monthCatOutMap[cat] || 0;
    if (prev >= 50000 && cur >= prev * 1.5 && cur >= prev + 50000 && cur >= 150000) {
      const pctUp = (cur / prev - 1) * 100;
      if (!worstRecur || pctUp > worstRecur.pctUp) worstRecur = { cat, prev, cur, pctUp };
    }
  });
  if (worstRecur) {
    watch.push({
      icon: "fa-repeat",
      bg: "bg-amber-100",
      color: "text-amber-600",
      title: "Pos Berulang Naik",
      message: `"${worstRecur.cat}" bulan lalu Rp ${formatRp(worstRecur.prev)} menjadi Rp ${formatRp(worstRecur.cur)} (naik ${worstRecur.pctUp.toFixed(0)}%). Cek apakah tagihan/langganan memang naik atau ada transaksi tak biasa.`,
      short: `Pos berulang "${worstRecur.cat}" naik ${worstRecur.pctUp.toFixed(0)}%.`,
      detail: `Pos berulang "${worstRecur.cat}" bulan lalu Rp ${formatRp(worstRecur.prev)} menjadi Rp ${formatRp(worstRecur.cur)} bulan ini, `
        + `naik ${worstRecur.pctUp.toFixed(0)}%.\n\n`
        + "Karena ini pos rutin (tagihan/langganan), kenaikan ini akan terasa terus menerus. Layak dicek:\n"
        + "- Apakah tagihan/langganan memang menaikkan harga, atau ada paket/charge tambahan.\n"
        + "- Kalau hanya transaksi sekali waktu yang kebetulan di kategori yang sama, bedakan dari kenaikan rutin.\n"
        + "- Kalau tagihan naik, pertimbangkan negosiasi atau ganti ke paket yang lebih hemat.",
    });
  }

  // 7. Banyak transaksi kecil (jajan harian) -- menggerus tanpa terasa.
  const small = ctx.smallTx;
  if (small && small.count >= 6 && small.total >= 100000) {
    watch.push({
      icon: "fa-mug-hot",
      bg: "bg-orange-100",
      color: "text-orange-600",
      title: "Banyak Transaksi Kecil",
      message: `Ada ${small.count} transaksi kecil (masing-masing ≤ Rp 25.000) bulan ini dengan total Rp ${formatRp(small.total)} -- biasanya dari jajan/konsumsi harian. Memangkas sebagian kecil saja bisa menghemat signifikan.`,
      short: `${small.count} transaksi kecil senilai Rp ${formatRp(small.total)}.`,
      detail: `Tercatat ${small.count} transaksi berukuran kecil (masing-masing ≤ Rp 25.000) bulan ini, `
        + `total Rp ${formatRp(small.total)} -- biasanya berasal dari jajan/konsumsi harian.\n\n`
        + "Pengeluaran kecil sering terasa sepele, tetapi akumulasinya bisa besar. Ini pilihan paling mudah "
        + "dipangkas tanpa mengorbankan kebutuhan pokok.\n\n"
        + "Cara menghemat:\n"
        + "- Identifikasi 2-3 transaksi kecil yang paling sering (mis. kopi/snack) lalu kurangi frekuensinya.\n"
        + "- Buat batas harian/mingguan untuk pengeluaran fleksibel.\n"
        + "- Kalau total ini saja dikurangi sepertiga, itu sudah penghematan yang terasa di akhir bulan.",
    });
  }

  // 8. Belanja akhir pekan mendominasi.
  const wknd = ctx.weekendTx;
  if (wknd && wknd.count >= 5 && monthOut > 0 && wknd.out / monthOut >= 0.4) {
    watch.push({
      icon: "fa-calendar-week",
      bg: "bg-violet-100",
      color: "text-violet-600",
      title: "Belanja Padat di Akhir Pekan",
      message: `${toPct(wknd.out / monthOut)} pengeluaran bulan ini (Rp ${formatRp(wknd.out)}, ${wknd.count} transaksi) terjadi di akhir pekan. Coba rencanakan belanja kebutuhan di awal pekan biar lebih terkontrol.`,
      short: `${toPct(wknd.out / monthOut)} pengeluaran terjadi di akhir pekan.`,
      detail: `${toPct(wknd.out / monthOut)} dari pengeluaran bulan ini (Rp ${formatRp(wknd.out)} lewat ${wknd.count} transaksi) `
        + "terjadi pada Sabtu/Minggu.\n\n"
        + "Belanja besar di akhir pekan sering tidak terkontrol karena bersifat impulsif. Jika pola ini begitu dominan, "
        + "coba:\n"
        + "- Pindahkan belanja kebutuhan pokok ke awal pekan (saat lebih terencana).\n"
        + "- Buat daftar belanja sebelum ke luar rumah dan patuhi itu.\n"
        + "- Batasi plafon per outing supaya tetap terkontrol.",
    });
  }

  // 9. Tingkat menabung bulan ini vs bulan lalu (aturan lama, pesan dipertahankan).
  if (monthIn > 0 && rateThis != null && rateLast != null) {
    const diff = rateThis - rateLast;
    if (Math.abs(diff) >= 5) {
      positive.push({
        icon: diff >= 0 ? "fa-piggy-bank" : "fa-arrow-trend-down",
        bg: diff >= 0 ? "bg-emerald-100" : "bg-rose-100",
        color: diff >= 0 ? "text-emerald-600" : "text-rose-600",
        title: "Tingkat Menabung",
        message: `Kamu menabung ${rateThis.toFixed(0)}% dari pemasukan bulan ini, ${diff >= 0 ? "naik" : "turun"} ${Math.abs(diff).toFixed(0)} poin dibanding bulan lalu (${rateLast.toFixed(0)}%).`,
        short: `Tingkat menabung ${rateThis.toFixed(0)}% (${diff >= 0 ? "naik" : "turun"} ${Math.abs(diff).toFixed(0)} poin).`,
        detail: `Kamu berhasil menyisihkan ${rateThis.toFixed(0)}% dari pemasukan bulan ini -- ${diff >= 0 ? "lebih tinggi" : "lebih rendah"} `
          + `${Math.abs(diff).toFixed(0)} poin dibanding bulan lalu (${rateLast.toFixed(0)}%).\n\n`
          + "Tingkat menabung adalah indikator paling penting untuk kesehatan keuangan jangka panjang.\n\n"
          + "Saran:\n"
          + "- Kalau masih naik, coba targetkan ke 20%+ dan rutin di awal bulan (bayar diri sendiri duluan).\n"
          + "- Kalau turun, cek apa yang menggerusnya bulan ini dan koreksi sebelum jadi kebiasaan.",
      });
    }
  }

  // 10. Pengeluaran turun signifikan vs bulan lalu (penguatan positif).
  if (monthOut > 0 && prevMonthOut > 0 && monthOut <= prevMonthOut * 0.8 && !(monthIn > 0 && monthOut > monthIn)) {
    const downPct = ((prevMonthOut - monthOut) / prevMonthOut) * 100;
    positive.push({
      icon: "fa-arrow-down",
      bg: "bg-emerald-100",
      color: "text-emerald-600",
      title: "Pengeluaran Turun",
      message: `Pengeluaran bulan ini Rp ${formatRp(monthOut)}, ${downPct.toFixed(0)}% lebih hemat dari bulan lalu (Rp ${formatRp(prevMonthOut)}). Pertahankan pola ini!`,
      short: `Pengeluaran turun ${downPct.toFixed(0)}% dari bulan lalu.`,
      detail: `Pengeluaran bulan ini Rp ${formatRp(monthOut)}, ${downPct.toFixed(0)}% lebih hemat dari bulan lalu (Rp ${formatRp(prevMonthOut)}).\n\n`
        + "Ini kabar baik! Untuk mempertahankannya, catat kebiasaan yang berhasil supaya bisa diulang bulan berikutnya.\n\n"
        + "Kalau penurunan ini karena menunda pengeluaran (bukan benar-benar mengurangi kebutuhan), waspadai "
        + "kemungkinan 'balas dendam' belanja di bulan depan. Jaga agar tetap terkendali dan rutin.",
    });
  }

  // 11. Kebiasaan menabung sehat (>= 30% pemasukan), bila belum tercakup aturan lain.
  if (monthIn > 0 && rateThis != null && rateThis >= 30 && !positive.some((i) => i.title === "Tingkat Menabung") && !(monthIn > 0 && monthOut > monthIn)) {
    positive.push({
      icon: "fa-piggy-bank",
      bg: "bg-emerald-100",
      color: "text-emerald-600",
      title: "Menabung Konsisten",
      message: `Kamu berhasil menyisihkan ${rateThis.toFixed(0)}% dari pemasukan bulan ini (Rp ${formatRp(Math.max(0, monthIn - monthOut))}). Kebiasaan bagus -- pertahankan!`,
      short: `Kamu menyisihkan ${rateThis.toFixed(0)}% pemasukan bulan ini.`,
      detail: `Kamu berhasil menyisihkan ${rateThis.toFixed(0)}% dari pemasukan bulan ini, sekitar Rp ${formatRp(Math.max(0, monthIn - monthOut))}.\n\n`
        + "Menabung 20-30% secara konsisten adalah fondasi keuangan yang sehat. Kamu sudah melakukan ini dengan baik.\n\n"
        + "Untuk memaksimalkannya:\n"
        + "- Otomatiskan: sisihkan dana tabungan di awal bulan, bukan sisa di akhir.\n"
        + "- Pisahkan tabungan ke rekening/dana terpisah supaya tidak mudah tersentuh.\n"
        + "- Kalau sudah nyaman, naikkan persentase atau arahkan ke tujuan spesifik (dana darurat, investasi).",
    });
  }

  // 12. Proyeksi pengeluaran akhir bulan berdasar rata-rata harian sejauh ini (perlu minimal
  //    3 hari data & masih ada sisa hari berjalan, biar tidak proyeksi hal yang sudah pasti).
  if (dayOfMonth >= 3 && dayOfMonth < daysInMonth && monthOut > 0) {
    const avgDaily = monthOut / dayOfMonth;
    const projected = avgDaily * daysInMonth;
    if (projected > monthOut * 1.05) {
      watch.push({
        icon: "fa-magnifying-glass-chart",
        bg: "bg-violet-100",
        color: "text-violet-600",
        title: "Proyeksi Akhir Bulan",
        message: `Dengan laju pengeluaran saat ini (~Rp ${formatShortVal(avgDaily)}/hari), total pengeluaran bulan ini diperkirakan mencapai Rp ${formatShortVal(projected)} kalau berlanjut sampai akhir bulan.`,
        short: `Proyeksi pengeluaran akhir bulan ±Rp ${formatShortVal(projected)}.`,
        detail: `Berdasarkan rata-rata pengeluaran harian sejauh ini (sekitar Rp ${formatShortVal(avgDaily)}/hari), `
          + `proyeksi total pengeluaran akhir bulan mencapai sekitar Rp ${formatShortVal(projected)}.\n\n`
          + "Ini perkiraan, bukan angka pasti -- sangat bergantung pada sisa hari dan pengeluaran yang masih akan terjadi.\n\n"
          + "Gunakan proyeksi ini untuk:\n"
          + "- Menyesuaikan sisa anggaran agar tidak jebol di akhir bulan.\n"
          + "- Menunda atau mengecilkan rencana pengeluaran besar kalau proyeksi sudah mendekati batas.\n"
          + "- Sebagai kontrol diri agar laju harian tetap stabil.",
      });
    }
  }

  return [...review, ...urgent, ...watch, ...positive].slice(0, 10);
}


/**
 * Perkaya context wawasan (v64) dengan agregasi tambahan yang digali langsung
 * dari baris transaksi, supaya aturan wawasan bisa membaca POLA yang tidak
 * terlihat dari agregat bulanan saja. Murni & bebas efek samping.
 *
 * @param {object} baseCtx - context agregat dari aggregateDashboardData()
 *   ({ now, monthIn, monthOut, prevMonthIn, prevMonthOut, monthCatOutMap,
 *   catOut3MoMap, monthTxCount, monthlyMap, ... }) -- dikembalikan apa adanya
 *   plus kolom tambahan di bawah.
 * @param {object} deps
 * @param {Array<object>} deps.transactions - SEMUA baris transaksi (bentuk sama
 *   seperti tabel `transactions`; bulan ini & lalu difilter di dalam).
 * @param {Date} deps.now - waktu "sekarang" (disuntik, supaya testable).
 * @param {(tanggalStr: string) => Date} deps.parseTgl
 * @param {(t: object) => number} deps.txIdrAmount - nilai IDR-equivalent 1 transaksi.
 * @param {(kategori: string) => (string|null|undefined)} deps.categorizeExpenseParent -
 *   nama kategori parent utk 1 kategori pengeluaran.
 * @returns {object} baseCtx + {
 *   prevMonthCatOutMap: Record<parent, number> - pengeluaran bulan lalu per parent
 *     (dipakai aturan "Pos Berulang Naik").
 *   biggestExpense: {kategori, akun, tanggal, jumlah}|null - pengeluaran tunggal
 *     terbesar bulan ini (dipakai aturan "Transaksi Terbesar").
 *   smallTx: {count, total} - transaksi pengeluaran <= Rp 25.000 bulan ini.
 *   weekendTx: {count, out} - pengeluaran yang terjadi Sabtu/Minggu bulan ini.
 * }
 */
export function buildInsightsContext(baseCtx, {
  transactions = [],
  now = new Date(),
  parseTgl = (s) => new Date(s),
  txIdrAmount = (t) => Number(t.jumlah_idr != null ? t.jumlah_idr : t.jumlah),
  categorizeExpenseParent = () => null,
}) {
  const prevMonthCatOutMap = {};
  let biggest = null;
  let smallTxCount = 0, smallTxTotal = 0;
  let weekendTxCount = 0, weekendOut = 0;
  const curYear = now.getFullYear(), curMonth = now.getMonth();
  const prevStart = new Date(curYear, curMonth - 1, 1);
  const prevYear = prevStart.getFullYear(), prevMonth = prevStart.getMonth();

  (transactions || []).forEach((row) => {
    if (!row || row.jenis !== "Pengeluaran") return;
    const date = parseTgl(row.tanggal);
    if (!date || Number.isNaN(date.getTime())) return;
    const amt = Number(txIdrAmount(row)) || 0;
    const isCur = date.getFullYear() === curYear && date.getMonth() === curMonth;
    const isPrev = date.getFullYear() === prevYear && date.getMonth() === prevMonth;
    if (!isCur && !isPrev) return;

    if (isPrev) {
      const parent = categorizeExpenseParent(row.kategori) || "Lain-lain";
      prevMonthCatOutMap[parent] = (prevMonthCatOutMap[parent] || 0) + amt;
      return;
    }
    if (amt <= 0) return;
    const day = date.getDay();
    if (day === 0 || day === 6) { weekendTxCount += 1; weekendOut += amt; }
    if (amt <= 25000) { smallTxCount += 1; smallTxTotal += amt; }
    if (!biggest || amt > biggest.jumlah) {
      biggest = { kategori: row.kategori || "Lain-lain", akun: row.akun || "", tanggal: row.tanggal ? String(row.tanggal) : "", jumlah: amt };
    }
  });

  return {
    ...baseCtx,
    prevMonthCatOutMap,
    biggestExpense: biggest,
    smallTx: { count: smallTxCount, total: smallTxTotal },
    weekendTx: { count: weekendTxCount, out: weekendOut },
  };
}

/**
 * MyFinance UI rendering untuk Wawasan Keuangan (Financial Insights) &
 * Skor Kesehatan Finansial di Dashboard.
 *
 * INI BUKAN modul domain (src/domain/) -- fungsi di sini MASIH menyentuh
 * DOM (baca/tulis elemen, bangun innerHTML). Bedanya dengan sebelum
 * dipindah: semua dependency (elemen `document`, cache budget bulan ini,
 * helper format, fungsi domain, pemicu analisis AI) SEKARANG disuntik
 * lewat 1 objek `ctx`, bukan dibaca dari closure/global langsung -- supaya
 * (a) eksplisit apa saja yang dibutuhkan fungsi ini, (b) tetap bisa dites
 * tanpa browser sungguhan (lihat tests/unit/ui-insights.test.js,
 * `document` di-stub pakai objek biasa, tidak butuh jsdom/Playwright).
 *
 * index.html memanggil fungsi2 ini lewat wrapper tipis bernama sama
 * (mis. `function renderInsights(ctx) { lastInsightsCtx = ctx; ...renderInsightsUI({...}) }`)
 * supaya SEMUA pemanggil lama tidak perlu diubah sama sekali. Catatan:
 * state `lastInsightsCtx` SENGAJA tetap dikelola wrapper di index.html
 * (dipakai juga oleh fitur AI chat/rekomendasi di luar modul ini) --
 * modul ini stateless.
 *
 * Lanjutan "UI separation" phase split-monolith
 * (docs/architecture-modernization-plan.md), pola kedua setelah
 * src/ui/recurring.js (commit 13d8a37). Pasangan domain-nya:
 * src/domain/insights.js (computeFinancialHealthScore &
 * computeFinancialInsights, commit 483b3a4). Perilaku dipertahankan
 * 100% sama seperti kode lama -- ini pemindahan, bukan penulisan ulang.
 */

/**
 * Render Skor Kesehatan Finansial di Dashboard: angka skor, progress bar
 * berwarna sesuai band (Sehat / Perlu Perhatian / Kritis), label band,
 * dan rincian persen per komponen (elemen `#health-score-number`,
 * `#health-score-bar`, `#health-score-label`, `#health-score-breakdown`).
 *
 * @param {object} ctx
 * @param {Document|{getElementById: Function}} ctx.document
 * @param {object} ctx.dataCtx - agregat dari processDataForUI (ctx lama di index.html).
 * @param {object} ctx.currentMonthBudgets - cache budget bulan berjalan (currentMonthBudgetsCache).
 * @param {(dataCtx: object, opts: {currentMonthBudgets: object}) => {finalScore: number, components: Array<{label: string, score: number, max: number}>}} ctx.computeFinancialHealthScore -
 *   dari src/domain/insights.js (via servicesModule).
 */
export function renderHealthScore({ document, dataCtx, currentMonthBudgets, computeFinancialHealthScore, accentColor }) {
  const numEl = document.getElementById("health-score-number");
  if (!numEl) return;
  const { finalScore, components } = computeFinancialHealthScore(dataCtx, { currentMonthBudgets });
  const barEl = document.getElementById("health-score-bar");
  const labelEl = document.getElementById("health-score-label");
  const breakdownEl = document.getElementById("health-score-breakdown");

  numEl.innerText = finalScore;
  barEl.style.width = finalScore + "%";

  let band;
  if (finalScore >= 75) band = { text: "Sehat", color: (accentColor && accentColor("income500")) || "#10b981", badge: "bg-emerald-100 text-emerald-600" };
  else if (finalScore >= 50) band = { text: "Perlu Perhatian", color: "#f59e0b", badge: "bg-amber-100 text-amber-600" };
  else band = { text: "Kritis", color: "#f43f5e", badge: "bg-rose-100 text-rose-600" };
  barEl.style.background = band.color;
  labelEl.innerText = band.text;
  labelEl.className = "text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0 " + band.badge;

  breakdownEl.innerHTML = components.map(c => {
    const pct = c.max > 0 ? Math.round((c.score / c.max) * 100) : 0;
    return `<div class="flex items-center justify-between text-[10px] md:text-xs"><span class="text-slate-400 truncate mr-2">${c.label}</span><span class="font-bold text-slate-600 flex-shrink-0">${pct}%</span></div>`;
  }).join("");
}

/**
 * Render daftar kartu Wawasan Keuangan (elemen `#insights-container`):
 * insight rule-based dari src/domain/insights.js, atau kartu "aman/tidak
 * ada transaksi" kalau tidak ada temuan. Setelah render daftar non-kosong,
 * memicu requestAiInsight(false) utk analisis Gemini yang lebih dalam
 * (cache-aware) -- SENGAJA lewat ctx (bukan import langsung) supaya urutan
 * & kondisi pemanggilannya persis seperti kode lama: HANYA dipanggil di
 * cabang non-kosong, tidak dipanggil saat daftar kosong.
 *
 * @param {object} ctx
 * @param {Document|{getElementById: Function}} ctx.document
 * @param {object} ctx.dataCtx - agregat dari processDataForUI; `monthTxCount` dipakai utk pesan kosong.
 * @param {object} ctx.currentMonthBudgets
 * @param {(dataCtx: object, opts: {currentMonthBudgets: object, formatRp: Function, formatShortVal: Function}) => Array<{icon: string, bg: string, color: string, title: string, message: string}>} ctx.computeFinancialInsights -
 *   dari src/domain/insights.js (via servicesModule).
 * @param {(angka: number) => string} ctx.formatRp
 * @param {(angka: number) => string} ctx.formatShortVal
 * @param {(force: boolean) => void} ctx.requestAiInsight - pemicu analisis AI (didefinisikan di index.html).
 */
export function renderInsights({
  document, dataCtx, currentMonthBudgets, computeFinancialInsights,
  formatRp, formatShortVal, requestAiInsight,
}) {
  const container = document.getElementById("insights-container"); if (!container) return;
  const insights = computeFinancialInsights(dataCtx, { currentMonthBudgets, formatRp, formatShortVal });

  if (insights.length === 0) {
    container.innerHTML = `
        <div class="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0"><i class="fas fa-circle-check text-sm"></i></div>
            <p class="text-xs md:text-sm text-slate-500">${dataCtx.monthTxCount > 0 ? "Belum ada hal mencolok bulan ini -- keuangan kamu terlihat stabil 👍" : "Belum ada transaksi bulan ini. Wawasan akan muncul begitu ada transaksi tercatat."}</p>
        </div>`;
    return;
  }

  container.innerHTML = insights.map(ins => `
    <div class="bg-white rounded-2xl p-3.5 md:p-4 border border-slate-100 shadow-sm flex items-start gap-3">
        <div class="w-9 h-9 rounded-xl ${ins.bg} ${ins.color} flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fas ${ins.icon} text-sm"></i></div>
        <div class="min-w-0">
            <p class="text-xs md:text-sm font-bold text-slate-800">${ins.title}</p>
            <p class="text-[11px] md:text-xs text-slate-500 mt-0.5 leading-relaxed">${ins.message}</p>
        </div>
    </div>`).join("");

  // Wawasan rule-based di atas selalu instan & gratis; di sisi ini kita juga minta analisis
  // Gemini yang lebih dalam lewat Edge Function (lihat requestAiInsight()) -- TAPI cuma
  // benar2 manggil Gemini kalau belum ada cache tersimpan; kalau sudah ada, cache itu yang
  // ditampilkan (lihat requestAiInsight()).
  requestAiInsight(false);
}

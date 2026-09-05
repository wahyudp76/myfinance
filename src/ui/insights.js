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
import { escapeHtml } from "../domain/sanitize.js";

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
/**
 * Bangun innerHTML kartu "wawasan" yang COMPACT. `short` (bila ada) = ringkasan
 * singkat di kartu; fallback ke `message` supaya data lama (tanpa `short`) tetap
 * berfungsi dan test tetap hijau. `idx` dipakai sbg `data-insight-idx` utk klik.
 */
export function renderInsightCard(ins, idx) {
  const short = ins.short || ins.message || "";
  return `
    <button type="button" data-insight-idx="${idx}"
        class="group text-left bg-white rounded-xl p-2.5 md:p-3 border border-slate-100 shadow-sm hover:shadow-md hover:border-indigo-200 hover:-translate-y-0.5 transition-all duration-200 flex items-start gap-2.5 cursor-pointer"
        aria-haspopup="dialog" aria-label="Lihat detail: ${escapeHtml(ins.title)}">
        <div class="w-7 h-7 rounded-lg ${ins.bg} ${ins.color} flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fas ${ins.icon} text-xs"></i></div>
        <div class="min-w-0 flex-1">
            <p class="text-[11px] md:text-xs font-bold text-slate-800 leading-tight line-clamp-1">${escapeHtml(ins.title)}</p>
            <p class="text-[10px] md:text-[11px] text-slate-500 leading-snug line-clamp-2 mt-0.5">${escapeHtml(short)}</p>
        </div>
        <i class="fas fa-chevron-right text-[10px] text-slate-300 group-hover:text-indigo-400 transition-colors flex-shrink-0 mt-1"></i>
    </button>`;
}

/**
 * Build innerHTML modal detail wawasan. `detail` (bila ada) ditampilkan dengan
 * `whitespace-pre-line` supaya paragraf & daftar "- " yang dibuat domain tetap
 * terlihat rapi. `message`/`short` jadi fallback bila `detail` tidak ada (data lama).
 * Modal di-overlay penuh; klik backdrop / tombol tutup / tombol X akan menutup.
 */
export function buildInsightDetailHtml(ins) {
  const short = ins.short || ins.message || "";
  const detail = ins.detail || ins.message || "";
  const safeBg = ins.bg || "bg-slate-100", safeColor = ins.color || "text-slate-600";
  return `
    <div data-close-insight="true" class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"></div>
    <div class="relative bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div class="flex items-start gap-3 p-4 md:p-5 border-b border-slate-100">
            <div class="w-10 h-10 rounded-xl ${safeBg} ${safeColor} flex items-center justify-center flex-shrink-0"><i class="fas ${ins.icon} text-base"></i></div>
            <div class="min-w-0 flex-1">
                <p class="text-sm md:text-base font-bold text-slate-800">${escapeHtml(ins.title)}</p>
                <p class="text-[11px] md:text-xs text-slate-500 mt-0.5 leading-snug">${escapeHtml(short)}</p>
            </div>
            <button type="button" data-close-insight="true" aria-label="Tutup penjelasan" class="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center flex-shrink-0 transition-colors"><i class="fas fa-xmark text-sm"></i></button>
        </div>
        <div class="max-h-[60vh] overflow-y-auto p-4 md:p-5 whitespace-pre-line text-xs md:text-sm text-slate-600 leading-relaxed">${escapeHtml(detail)}</div>
    </div>`;
}

/**
 * Render daftar Wawasan Keuangan (elemen `#insights-container`) sbg grid kartu
 * COMPACT yang bisa diklik -> membuka modal penjabaran detail.
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

  container.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">` +
    insights.map((ins, i) => renderInsightCard(ins, i)).join("") +
    `</div>`;

  // Delegasi klik pada container (bukan per-kartu). Di-stub test `document`
  // tidak punya addEventListener -> guard biar tidak error; di browser asli
  // klik kartu akan membuka modal detail.
  if (container && typeof container.addEventListener === "function") {
    container.addEventListener("click", (e) => {
      const target = e && e.target && typeof e.target.closest === "function" ? e.target.closest("[data-insight-idx]") : null;
      if (target) {
        const idx = Number(target.getAttribute("data-insight-idx"));
        openInsightDetail(document, insights[idx]);
      }
    });
  }

  // Wawasan rule-based di atas selalu instan & gratis; di sisi ini kita juga minta analisis
  // Gemini yang lebih dalam lewat Edge Function (lihat requestAiInsight()) -- TAPI cuma
  // benar2 manggil Gemini kalau belum ada cache tersimpan; kalau sudah ada, cache itu yang
  // ditampilkan (lihat requestAiInsight()).
  requestAiInsight(false);
}

/**
 * Buka modal detail wawasan (append overlay ke `document.body` bila belum ada).
 * Klik backdrop / tombol tutup / X / Escape akan menutup. Aman di environment
 * tanpa DOM penuh (guard `document.body` / `createElement`/`querySelector`).
 */
export function openInsightDetail(document, ins) {
  if (!ins || !document) return;
  if (!document.body || typeof document.createElement !== "function") return;

  const id = "insight-detail-modal";
  let modal = document.getElementById(id);
  if (!modal) {
    modal = document.createElement("div");
    modal.id = id;
    modal.className = "fixed inset-0 z-[95] hidden items-center justify-center p-4";
    document.body.appendChild(modal);
  }

  modal.innerHTML = buildInsightDetailHtml(ins);
  modal.classList.remove("hidden");
  modal.classList.add("flex");

  if (typeof modal.addEventListener === "function") {
    // Hapus listener lama supaya tidak menumpuk saat modal dibuka berulang.
    modal.style.display = "";
    // Gunakan satu handler idempoten.
    const handler = (e) => {
      const el = e && e.target && typeof e.target.closest === "function" ? e.target.closest("[data-close-insight]") : null;
      if (el) closeInsightDetail(document, modal);
    };
    modal.__closeHandler && modal.removeEventListener("click", modal.__closeHandler);
    modal.__closeHandler = handler;
    modal.addEventListener("click", handler);
  }
  if (typeof document.addEventListener === "function") {
    const keyHandler = (e) => { if (e && e.key === "Escape") closeInsightDetail(document, modal); };
    if (modal.__keyHandler) document.removeEventListener("keydown", modal.__keyHandler);
    modal.__keyHandler = keyHandler;
    document.addEventListener("keydown", keyHandler);
  }
}

/** Tutup & bersihkan modal detail wawasan. */
export function closeInsightDetail(document, modal) {
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
  if (typeof document.addEventListener === "function" && modal.__keyHandler) {
    document.removeEventListener("keydown", modal.__keyHandler);
    modal.__keyHandler = null;
  }
}

/**
 * MyFinance UI rendering untuk "Rekomendasi AI" (Gemini) di Dashboard —
 * v94: list vertikal baris-baris singkat, klik baris -> modal penjelasan
 * DETAIL (pola & komponen modal yang sama dengan Wawasan Keuangan,
 * src/ui/insights.js, jadi perilaku close/Escape/backdrop seragam).
 *
 * Bukan modul domain — fungsi di sini menyentuh DOM; dependency disuntik
 * lewat ctx (pola yang sama dengan src/ui/insights.js, teruji tanpa browser
 * asli di tests/unit/ui-ai-recommendations.test.js).
 */

import { escapeHtml } from "../domain/sanitize.js";
import { openInsightDetail } from "./insights.js";

/**
 * innerHTML satu baris rekomendasi (tombol full-width, list ke bawah).
 * `idx` dipakai sebagai `data-ai-rec-idx` untuk delegasi klik.
 */
export function renderAiRecommendationRow(rec, idx) {
  return `
    <button type="button" data-ai-rec-idx="${idx}"
        class="group text-left w-full bg-white rounded-2xl p-3 md:p-4 border border-slate-100 shadow-sm hover:shadow-md hover:border-indigo-200 hover:-translate-y-0.5 transition-all duration-200 flex items-center gap-3 cursor-pointer"
        aria-haspopup="dialog" aria-label="Lihat detail: ${escapeHtml(rec.title)}">
        <div class="w-9 h-9 rounded-xl ${rec.bg} ${rec.color} flex items-center justify-center flex-shrink-0"><i class="fas ${rec.icon} text-sm"></i></div>
        <div class="min-w-0 flex-1">
            <p class="text-[10px] text-slate-400 font-medium leading-tight truncate">${escapeHtml(rec.title)}</p>
            <p class="text-[11px] md:text-xs font-bold text-slate-800 leading-snug line-clamp-2">${escapeHtml(rec.short)}</p>
        </div>
        <i class="fas fa-chevron-right text-[10px] text-slate-300 group-hover:text-indigo-400 transition-colors flex-shrink-0"></i>
    </button>`;
}

/**
 * Render list vertikal rekomendasi ke `#ai-insights-container` (atau id lain).
 * Daftar terbaru disimpan di container.__aiRecs supaya listener delegasi klik
 * (dipasang SEKALI) selalu membaca data hasil render TERAKHIR, bukan closure
 * render pertama — kalau tidak, refresh analisis baru lalu klik baris akan
 * menampilkan detail basi (bug klasik delegasi + re-render innerHTML).
 *
 * @returns {boolean} true bila list ter-render; false bila kosong/tidak ada
 *   container — pemanggil (app.src.js) yang menangani state kosongnya.
 */
export function renderAiRecommendations({ document, recommendations, containerId = "ai-insights-container" }) {
  const container = document.getElementById(containerId);
  if (!container) return false;
  const recs = Array.isArray(recommendations) ? recommendations : [];
  if (recs.length === 0) return false;
  container.__aiRecs = recs;
  container.innerHTML = recs.map((rec, i) => renderAiRecommendationRow(rec, i)).join("");

  if (typeof container.addEventListener === "function" && !container.__aiRecClickBound) {
    container.__aiRecClickBound = true;
    container.addEventListener("click", (e) => {
      const target = e && e.target && typeof e.target.closest === "function" ? e.target.closest("[data-ai-rec-idx]") : null;
      if (!target) return;
      const idx = Number(target.getAttribute("data-ai-rec-idx"));
      const rec = container.__aiRecs && container.__aiRecs[idx];
      if (rec) openInsightDetail(document, rec);
    });
  }
  return true;
}

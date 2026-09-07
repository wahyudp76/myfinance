/**
 * src/domain/ai-recommendations.js — Normalisasi Rekomendasi AI (Gemini) untuk
 * tampilan list-vertikal + modal detail di Dashboard (v94).
 *
 * Domain MURNI: mengubah keluaran Edge Function `analyze-finance` (array
 * {title, message, severity} — format lama — atau {title, message, detail,
 * severity} — format baru v94) menjadi item siap-render {title, short, detail,
 * severity, icon, bg, color}. Tanpa DOM/network; ter-unit-test penuh di
 * tests/unit/ai-recommendations-domain.test.js.
 *
 * KOMPATIBILITAS (dua arah, penting supaya deploy tidak harus serentak):
 * - CACHE LAMA (appSettings.ai_insight_cache dari function lama) tidak punya
 *   `detail` -> fallback detail = message, modal tetap menampilkan penjelasan
 *   (sependek apa pun) — bukan layar kosong.
 * - CLIENT LAMA + function BARU: field `detail` diabaikan (client lama hanya
 *   membaca title/message/severity).
 */

/** Gaya visual per severity (kelas Tailwind, konsisten dgn kartu wawasan). */
export const AI_REC_SEVERITY_STYLES = {
    warning: { icon: 'fa-triangle-exclamation', bg: 'bg-amber-100', color: 'text-amber-600' },
    success: { icon: 'fa-thumbs-up', bg: 'bg-emerald-100', color: 'text-emerald-600' },
    info: { icon: 'fa-lightbulb', bg: 'bg-indigo-100', color: 'text-indigo-600' },
};

/** Batas jumlah kartu (sama dgn Edge Function: maks 5 rekomendasi). */
export const AI_REC_MAX_ITEMS = 5;

/** Batas panjang teks (simetris dgn sanitasi di Edge Function + defensif). */
const TITLE_MAX = 120;
const MESSAGE_MAX = 600;
const DETAIL_MAX = 4000;

/**
 * Normalisasi keluaran AI menjadi item siap-render.
 *
 * @param {Array<{title: string, message: string, detail?: string, severity?: string}>} raw
 * @returns {Array<{title: string, short: string, detail: string, severity: string,
 *   icon: string, bg: string, color: string}>}
 *   - `short`  : teks singkat di baris list (judul kartu);
 *   - `detail` : isi modal detail (fallback ke `short` bila Gemini/function lama
 *     tidak mengirimkannya — cache lama tetap tampil wajar).
 * Item tanpa title ATAU message dibuang (kontrak server); lebih dari
 * AI_REC_MAX_ITEMS dipotong; severity tak dikenal -> "info".
 */
export function normalizeAiRecommendations(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const it of arr) {
        if (!it || typeof it !== 'object') continue;
        const title = typeof it.title === 'string' ? it.title.trim().slice(0, TITLE_MAX) : '';
        const message = typeof it.message === 'string' ? it.message.trim().slice(0, MESSAGE_MAX) : '';
        if (!title || !message) continue; // kontrak Edge Function: keduanya wajib
        const detail = typeof it.detail === 'string' ? it.detail.trim().slice(0, DETAIL_MAX) : '';
        const severity = it.severity === 'warning' || it.severity === 'success' ? it.severity : 'info';
        const style = AI_REC_SEVERITY_STYLES[severity];
        out.push({
            title,
            short: message,
            detail: detail || message, // fallback: cache lama / function lama
            severity,
            icon: style.icon,
            bg: style.bg,
            color: style.color,
        });
        if (out.length >= AI_REC_MAX_ITEMS) break;
    }
    return out;
}

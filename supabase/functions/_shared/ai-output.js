// supabase/functions/_shared/ai-output.js
//
// Logika MURNI (tanpa Deno, tanpa fetch, tanpa Supabase) yang dipakai Edge
// Function AI: pemotongan input user, pembentukan generationConfig Gemini, dan
// sanitasi balasan model supaya kontrak UI tetap valid apa pun yang dikembalikan AI.
//
// KENAPA DIPISAH (audit AI 2026-09-17, temuan T7): sebelumnya semua logika ini
// tertulis inline di dalam handler `analyze-finance/index.ts`, sehingga tidak
// ada satu pun uji yang menjalankannya -- perubahan sanitasi baru ketahuan
// setelah function di-deploy. Sebagai berkas .js biasa (pola yang sama dengan
// _shared/bibit.js & _shared/price-sources.js) ia bisa diimpor Deno DAN diuji
// langsung di Node: tests/unit/ai-edge-output.test.js.
//
// PENTING: isi fungsi di bawah adalah PEMINDAHAN apa adanya dari logika inline
// (v65/v94), bukan penulisan ulang -- perilakunya sengaja identik supaya
// perpindahan ini bisa dibuktikan setara oleh uji.

/** Batas karakter pertanyaan bebas (Tanya AI). Sebelum T1 tidak ada batas sama
 *  sekali, sehingga prompt bisa berukuran berapa pun. */
export const MAX_QUESTION_LENGTH = 2000;

/** Batas waktu satu panggilan Gemini. Tanpa ini (T3) permintaan yang menggantung
 *  menahan Edge Function sampai batas platform dan UI menunggu tanpa kepastian. */
export const GEMINI_TIMEOUT_MS = 30000;

/** Batas waktu utk mode vision (scan struk): gambarnya bisa ~6 MB base64, jadi
 *  lebih longgar daripada mode teks. */
export const GEMINI_VISION_TIMEOUT_MS = 60000;

/** Potong teks ke panjang maksimum; nilai non-string jadi string kosong.
 *  Dipakai untuk input bebas dari pengguna sebelum masuk ke prompt. */
export function clampText(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

/** generationConfig per mode. `json: true` untuk mode yang balasannya wajib JSON
 *  (insights, suggest_category) -- dengan responseMimeType JSON, model tidak lagi
 *  perlu "diingatkan" lewat markdown/backtick dan pembersihan manual jadi lapisan
 *  kedua, bukan satu-satunya. maxOutputTokens memagar biaya keluaran (T2).
 *  temperature rendah dipakai supaya data yang sama menghasilkan jawaban yang
 *  kurang lebih sama (penting untuk angka keuangan). */
export function generationConfigFor(mode) {
  if (mode === "suggest_category") {
    return { temperature: 0, maxOutputTokens: 128, responseMimeType: "application/json" };
  }
  if (mode === "insights") {
    return { temperature: 0.3, maxOutputTokens: 2048, responseMimeType: "application/json" };
  }
  if (mode === "scan_receipt") {
    return { temperature: 0, maxOutputTokens: 512, responseMimeType: "application/json" };
  }
  if (mode === "monthly_summary") {
    return { temperature: 0.4, maxOutputTokens: 1024 };
  }
  // mode "question" (Tanya AI) dan apa pun yang tidak dikenal
  return { temperature: 0.3, maxOutputTokens: 1024 };
}

const KNOWN_SEVERITY = new Set(["info", "warning", "success"]);

/** Bersihkan balasan Gemini untuk mode insights jadi array kartu yang aman
 *  dirender: buang item tanpa title/message teks, potong panjang teks, paksa
 *  severity ke daftar yang dikenal UI, maksimal 5 kartu. Kalau balasannya bukan
 *  JSON, teksnya tetap ditampilkan sebagai satu kartu (lebih baik daripada
 *  gagal total) -- perilaku yang sama dengan versi inline sebelumnya. */
export function sanitizeInsights(rawText) {
  let insights;
  try {
    const cleaned = (rawText || "[]").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    insights = Array.isArray(parsed) ? parsed : [parsed];
  } catch (_e) {
    const teks = rawText || "Tidak ada respons dari Gemini.";
    insights = [{
      title: "Analisis Gemini",
      message: teks.slice(0, 200),
      detail: teks,
      severity: "info",
    }];
  }

  return (Array.isArray(insights) ? insights : [])
    .filter((it) => it && typeof it === "object"
      && typeof it.title === "string" && it.title.trim()
      && typeof it.message === "string" && it.message.trim())
    .map((it) => ({
      title: it.title.trim().slice(0, 80),
      message: it.message.trim().slice(0, 500),
      detail: typeof it.detail === "string" ? it.detail.trim().slice(0, 4000) : "",
      severity: KNOWN_SEVERITY.has(it.severity) ? it.severity : "info",
    }))
    .slice(0, 5);
}

/** Ambil saran kategori dari balasan Gemini dan TOLAK nama yang tidak ada di
 *  daftar kategori milik user (AI tidak boleh mengarang kategori baru).
 *  Mengembalikan null bila balasan tidak bisa dibaca atau tidak cocok. */
export function sanitizeCategory(rawText, categories) {
  const daftar = Array.isArray(categories) ? categories : [];
  try {
    const cleaned = String(rawText || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return (parsed?.kategori && daftar.includes(parsed.kategori)) ? parsed.kategori : null;
  } catch (_e) {
    return null;
  }
}
